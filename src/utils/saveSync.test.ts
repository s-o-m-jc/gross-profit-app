/**
 * 保存まわり(saveSync.ts)のテスト。メモリ上の偽Supabaseで動かす。
 * 実行: npm test
 *
 * 2026-11-13: レビューで見つかった問題の再発防止。
 * - H1: 古いタブで保存すると、その後にDB補正・別のタブで入った内容が全月分巻き戻り、その間に増えた月が消えた。
 * - H2: 保存に失敗しても「保存済み」扱いになり、再試行されなかった。ほかの会社の成功でエラー表示も消えた。
 * - 同じタブで保存が重なると、古い保存が後から届いてDBに古い内容が残った。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SaveManager,
  executeCompanySave,
  fetchCompanyMonths,
  planCompanySave,
  type SaveClient,
} from './saveSync';
import { deleteCompanyMonth, groupByTargetMonth, mergeGroupedRowsIntoCompanyMonths, type CompanyMonthlyData } from './monthlyData';
import type { CompanyId } from '../config/companies';

// ---------------------------------------------------------------------------
// 偽Supabase(monthly_dataテーブルだけ)。updated_atは本物と同じくマイクロ秒まである文字列で、書き込みのたびにサーバ側で変わる
// ---------------------------------------------------------------------------
type Row = { company_id: string; target_month: string; state: any; updated_at: string };

class FakeDb implements SaveClient {
  rows: Row[] = [];
  log: string[] = [];
  /** この会社への書き込みを失敗させる */
  failCompanies = new Set<string>();
  /** 次の書き込みをこのミリ秒だけ遅らせる(保存の重なりの再現) */
  delayNextWriteMs = 0;
  inFlight = 0;
  /** insertの返事に updated_at を入れない(サーバの返事が欠けた場合の再現) */
  insertOmitsVersion = false;
  /** 次のN回のselectを失敗させる */
  failSelects = 0;
  maxInFlight = 0;
  private clock = 0;

  nextVersion(): string {
    this.clock += 1;
    // 例: 2026-11-13T00:00:00.000001+00:00(マイクロ秒の桁に意味がある)
    return `2026-11-13T00:00:00.${String(this.clock).padStart(6, '0')}+00:00`;
  }
  seed(company_id: string, target_month: string, tag: string): void {
    this.rows.push({ company_id, target_month, state: st(tag), updated_at: this.nextVersion() });
  }
  /** DB補正のスクリプト・別のタブによる更新(updated_atが変わる) */
  externalUpdate(company_id: string, target_month: string, tag: string): void {
    const r = this.find(company_id, target_month)!;
    r.state = st(tag);
    r.updated_at = this.nextVersion();
  }
  find(company_id: string, target_month: string): Row | undefined {
    return this.rows.find((r) => r.company_id === company_id && r.target_month === target_month);
  }
  tagOf(company_id: string, target_month: string): string | undefined {
    return this.find(company_id, target_month)?.state.billingRows[0]?.tag;
  }
  months(company_id: string): string[] {
    return this.rows.filter((r) => r.company_id === company_id).map((r) => r.target_month).sort();
  }

  from(_table: string): any {
    const db = this;
    type Op = { kind: 'select' | 'update' | 'insert' | 'delete'; values?: any; filters: [string, any][] };
    const builder = (op: Op): any => ({
      eq: (col: string, v: any) => builder({ ...op, filters: [...op.filters, [col, v]] }),
      select: (_cols: string) => builder(op),
      then: (res: any, rej: any) => db.exec(op).then(res, rej),
    });
    return {
      select: (_cols: string) => builder({ kind: 'select', filters: [] }),
      update: (values: any) => builder({ kind: 'update', values, filters: [] }),
      insert: (values: any) => builder({ kind: 'insert', values, filters: [] }),
      delete: () => builder({ kind: 'delete', filters: [] }),
    };
  }

  private async exec(op: { kind: string; values?: any; filters: [string, any][] }): Promise<{ data: any; error: any }> {
    const match = (r: Row) => op.filters.every(([c, v]) => (r as any)[c] === v); // 文字列のまま厳密に比べる(本物のeqと同じく値の一致)
    if (op.kind === 'select') {
      if (this.failSelects > 0) {
        this.failSelects -= 1;
        return { data: null, error: { message: '(テスト)読み込み失敗' } };
      }
      return { data: this.rows.filter(match).map((r) => ({ ...r })), error: null };
    }
    const company = op.kind === 'insert' ? op.values.company_id : op.filters.find(([c]) => c === 'company_id')?.[1];
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayNextWriteMs) {
        const ms = this.delayNextWriteMs;
        this.delayNextWriteMs = 0;
        await new Promise((r) => setTimeout(r, ms));
      } else {
        await Promise.resolve();
      }
      if (this.failCompanies.has(company)) return { data: null, error: { message: '(テスト)ネットワーク切断' } };
      if (op.kind === 'insert') {
        if (this.find(op.values.company_id, op.values.target_month)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        const row = { ...op.values, updated_at: this.nextVersion() };
        this.rows.push(row);
        this.log.push(`INSERT ${row.target_month}`);
        return { data: this.insertOmitsVersion ? [{}] : [{ updated_at: row.updated_at }], error: null };
      }
      const hit = this.rows.filter(match);
      if (op.kind === 'update') {
        hit.forEach((r) => {
          r.state = op.values.state;
          r.updated_at = this.nextVersion();
        });
        this.log.push(`UPDATE ${hit.map((r) => r.target_month).join(',') || '(0件)'}`);
        return { data: hit.map((r) => ({ updated_at: r.updated_at })), error: null };
      }
      this.rows = this.rows.filter((r) => !hit.includes(r));
      this.log.push(`DELETE ${hit.map((r) => r.target_month).join(',') || '(0件)'}`);
      return { data: hit.map((r) => ({ target_month: r.target_month })), error: null };
    } finally {
      this.inFlight -= 1;
    }
  }
}

const st = (tag: string) => ({ billingRows: [{ tag }] }) as any;
const tagOf = (m: CompanyMonthlyData, month: string) => (m[month] as any)?.billingRows[0]?.tag;
const OSAKA = 'osaka' as CompanyId;
const SHIKOKU = 'shikoku' as CompanyId;

/** 手動で進めるタイマー(再試行の間隔を確かめるため) */
class FakeTimers {
  pending: { fn: () => void; ms: number; id: number }[] = [];
  private id = 0;
  set = (fn: () => void, ms: number) => {
    const id = ++this.id;
    this.pending.push({ fn, ms, id });
    return id;
  };
  clear = (h: unknown) => {
    this.pending = this.pending.filter((t) => t.id !== h);
  };
  /** 待ち時間がms以下のタイマーを全部実行する */
  async fire(ms = 0): Promise<void> {
    const due = this.pending.filter((t) => t.ms <= ms);
    this.pending = this.pending.filter((t) => t.ms > ms);
    due.forEach((t) => t.fn());
  }
  delays(): number[] {
    return this.pending.map((t) => t.ms);
  }
}

async function setup(db: FakeDb, companies: CompanyId[] = [OSAKA], onSaved?: (id: CompanyId, m: CompanyMonthlyData) => void) {
  const timers = new FakeTimers();
  const manager = new SaveManager({ client: db, debounceMs: 0, setTimer: timers.set, clearTimer: timers.clear, onSaved });
  const loaded: Record<string, CompanyMonthlyData> = {};
  for (const id of companies) {
    const { months, versions } = await fetchCompanyMonths(db, id);
    manager.reset(id, months, versions);
    loaded[id] = months;
  }
  /** 保存を最後まで進める(待ち0のタイマーを、保存が落ち着くまで繰り返し実行) */
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await timers.fire(0);
      await manager.flush();
      if (!timers.pending.some((t) => t.ms === 0)) return;
    }
  };
  return { manager, timers, loaded, settle };
}

// ---------------------------------------------------------------------------

test('変えた月だけを書く(触っていない月は書かない)', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02', '2026-03'].forEach((m) => db.seed('osaka', m, 'v1'));
  const { manager, loaded, settle } = await setup(db);
  const edited = { ...loaded.osaka, '2026-02': st('編集') };
  manager.requestSave(OSAKA, edited);
  await settle();
  assert.deepEqual(db.log, ['UPDATE 2026-02']);
  assert.equal(db.tagOf('osaka', '2026-02'), '編集');
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
});

test('画面に無いだけの月は削除しない。削除の操作で消した月だけを削除する', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02'].forEach((m) => db.seed('osaka', m, 'v1'));
  const { manager, loaded, settle } = await setup(db);
  // 画面から2月が消えているが、削除の操作はしていない → DBの2月は残す
  const { ['2026-02']: _gone, ...without } = loaded.osaka;
  manager.requestSave(OSAKA, without);
  await settle();
  assert.deepEqual(db.months('osaka'), ['2026-01', '2026-02']);
  // 削除ボタンの操作(deleteCompanyMonth + markDeleted) → 削除する
  manager.markDeleted(OSAKA, ['2026-02']);
  manager.requestSave(OSAKA, deleteCompanyMonth(loaded.osaka, '2026-02'));
  await settle();
  assert.deepEqual(db.months('osaka'), ['2026-01']);
});

test('H1: 読み込んだ後にDBが変わっていたら、書かずに衝突を返す(巻き戻らない・その間に増えた月も消えない)', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02'].forEach((m) => db.seed('osaka', m, 'v1'));
  const { manager, loaded, settle } = await setup(db);
  db.externalUpdate('osaka', '2026-01', 'DB補正後');
  db.seed('osaka', '2026-03', '別タブで追加');
  // 古いタブが2月だけ編集 → 2月は(誰も触っていないので)書ける。1月は巻き戻らない。3月は消えない
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-02': st('古いタブで編集') });
  await settle();
  assert.equal(db.tagOf('osaka', '2026-01'), 'DB補正後');
  assert.equal(db.tagOf('osaka', '2026-02'), '古いタブで編集');
  assert.equal(db.tagOf('osaka', '2026-03'), '別タブで追加');
  // 古いタブが1月を編集 → 衝突。DBの1月はDB補正後のまま
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('古いタブで1月を編集'), '2026-02': st('古いタブで編集') });
  await settle();
  const s = manager.getState(OSAKA)!;
  assert.equal(s.status, 'conflict');
  assert.equal(s.conflictMonth, '2026-01');
  assert.equal(db.tagOf('osaka', '2026-01'), 'DB補正後');
});

test('補正のスクリプトで内容が同じまま updated_at だけ変わった場合も衝突にする', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { manager, loaded, settle } = await setup(db);
  const r = db.find('osaka', '2026-01')!;
  r.updated_at = db.nextVersion(); // 内容は同じ、updated_atだけ変わる
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('古いタブで編集') });
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'conflict');
  assert.equal(db.tagOf('osaka', '2026-01'), 'v1');
});

test('updated_at はDBが返した文字列のまま比べる(マイクロ秒の違いも別の版として扱う)', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { versions } = await fetchCompanyMonths(db, OSAKA);
  assert.match(versions['2026-01'], /\.\d{6}\+00:00$/);
  // JavaScriptの日付に変換するとマイクロ秒が落ちる(ミリ秒まで)ので、変換した値では一致しない
  const viaDate = new Date(versions['2026-01']).toISOString();
  const res = await executeCompanySave(db, OSAKA, { upserts: ['2026-01'], deletes: [] }, { '2026-01': st('x') }, { '2026-01': viaDate });
  assert.equal(res.outcome.status, 'conflict');
  const ok = await executeCompanySave(db, OSAKA, { upserts: ['2026-01'], deletes: [] }, { '2026-01': st('x') }, versions);
  assert.equal(ok.outcome.status, 'ok');
  assert.equal(ok.written['2026-01'], db.find('osaka', '2026-01')!.updated_at);
});

test('その間に他で作られた月への書き込みは衝突になる', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { manager, loaded, settle } = await setup(db);
  db.seed('osaka', '2026-02', '別タブで追加');
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-02': st('古いタブで取込み') });
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'conflict');
  assert.equal(db.tagOf('osaka', '2026-02'), '別タブで追加');
});

test('衝突した会社は自動保存を止め、ほかの会社は保存を続ける', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  db.seed('shikoku', '2026-01', 'v1');
  const { manager, loaded, settle } = await setup(db, [OSAKA, SHIKOKU]);
  db.externalUpdate('osaka', '2026-01', '他で更新');
  manager.requestSave(OSAKA, { '2026-01': st('古いタブ') });
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'conflict');
  db.log = [];
  manager.requestSave(OSAKA, { '2026-01': st('古いタブでさらに編集') });
  manager.requestSave(SHIKOKU, { ...loaded.shikoku, '2026-01': st('四国の編集') });
  await settle();
  assert.deepEqual(db.log, ['UPDATE 2026-01']); // 四国だけ
  assert.equal(db.tagOf('osaka', '2026-01'), '他で更新');
  assert.equal(db.tagOf('shikoku', '2026-01'), '四国の編集');
  assert.ok(manager.hasUnsaved());
});

test('H2: 保存に失敗したら未保存が残り、5秒・30秒・2分と間隔を延ばして再試行し、成功すれば保存済みになる', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { manager, timers, loaded, settle } = await setup(db);
  db.failCompanies.add('osaka');
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('取込み後') });
  await settle();
  let s = manager.getState(OSAKA)!;
  assert.equal(s.status, 'error');
  assert.equal(s.unsavedMonths, 1);
  assert.deepEqual(timers.delays(), [5_000]);
  assert.ok(manager.hasUnsaved());
  await timers.fire(5_000);
  await manager.flush();
  assert.deepEqual(timers.delays(), [30_000]);
  await timers.fire(30_000);
  await manager.flush();
  assert.deepEqual(timers.delays(), [120_000]);
  await timers.fire(120_000);
  await manager.flush();
  assert.deepEqual(timers.delays(), [120_000]); // 以降は2分ごと
  db.failCompanies.clear();
  await timers.fire(120_000);
  await manager.flush();
  s = manager.getState(OSAKA)!;
  assert.equal(s.status, 'saved');
  assert.equal(s.unsavedMonths, 0);
  assert.equal(db.tagOf('osaka', '2026-01'), '取込み後');
  assert.ok(!manager.hasUnsaved());
});

test('H2: 「今すぐ再試行」(ネットにつながったとき)で、待たずに再試行する', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { manager, loaded, settle } = await setup(db);
  db.failCompanies.add('osaka');
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('取込み後') });
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'error');
  db.failCompanies.clear();
  manager.retryNow();
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
  assert.equal(db.tagOf('osaka', '2026-01'), '取込み後');
});

test('H2: ほかの会社の保存が成功しても、失敗した会社のエラーは消えない', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  db.seed('shikoku', '2026-01', 'v1');
  const { manager, loaded, settle } = await setup(db, [OSAKA, SHIKOKU]);
  db.failCompanies.add('osaka');
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('取込み後') });
  manager.requestSave(SHIKOKU, { ...loaded.shikoku, '2026-01': st('四国の編集') });
  await settle();
  assert.equal(manager.getState(SHIKOKU)!.status, 'saved');
  const s = manager.getState(OSAKA)!;
  assert.equal(s.status, 'error');
  assert.match(s.errorMessage!, /ネットワーク切断/);
});

test('保存に失敗した間の変更も、再試行のときに一緒に保存される', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02'].forEach((m) => db.seed('osaka', m, 'v1'));
  const { manager, loaded, settle } = await setup(db);
  db.failCompanies.add('osaka');
  const first = { ...loaded.osaka, '2026-01': st('1回目') };
  manager.requestSave(OSAKA, first);
  await settle();
  manager.requestSave(OSAKA, { ...first, '2026-02': st('2回目') });
  assert.equal(manager.getState(OSAKA)!.unsavedMonths, 2);
  db.failCompanies.clear();
  manager.retryNow(OSAKA);
  await settle();
  assert.equal(db.tagOf('osaka', '2026-01'), '1回目');
  assert.equal(db.tagOf('osaka', '2026-02'), '2回目');
});

test('保存が重なっても順番に実行され、DBには最新の内容が残る', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { manager, timers, loaded, settle } = await setup(db);
  db.delayNextWriteMs = 50; // 1回目の書き込みが遅い
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('1回目の編集') });
  await timers.fire(0); // 1回目の保存を始める(終わるのは待たない)
  assert.equal(manager.getState(OSAKA)!.status, 'saving');
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('2回目の編集(最新)') }); // 1回目の保存中に2回目
  await new Promise((r) => setTimeout(r, 80));
  await settle();
  assert.equal(db.maxInFlight, 1); // 同じ会社の書き込みは同時に走らない
  assert.equal(db.tagOf('osaka', '2026-01'), '2回目の編集(最新)');
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
  assert.deepEqual(db.log, ['UPDATE 2026-01', 'UPDATE 2026-01']);
});

test('取込み → 取り消し: 取込みで変えた月は元に戻り、取込みで増えた月は削除され、DBは取込み前と同じになる', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02'].forEach((m) => db.seed('osaka', m, 'v1'));
  const { manager, loaded, settle } = await setup(db);
  // 取込み(App.tsxのhandleBillingLoadedと同じ関数): 2月を置き換え、3月を追加
  const rows = [{ targetMonth: '2026-02', tag: '取込み' }, { targetMonth: '2026-03', tag: '取込み' }] as any[];
  const snapshot = loaded.osaka;
  const imported = mergeGroupedRowsIntoCompanyMonths(snapshot, 'billingRows', groupByTargetMonth(rows) as any);
  manager.requestSave(OSAKA, imported);
  await settle();
  assert.deepEqual(db.log, ['UPDATE 2026-02', 'INSERT 2026-03']);
  // 取り消し(handleUndoLastCsvUpload): 取込み前の内容に戻し、取込みで増えた月を削除の操作として記録
  manager.markDeleted(OSAKA, Object.keys(imported).filter((m) => !(m in snapshot)));
  manager.requestSave(OSAKA, snapshot);
  await settle();
  assert.deepEqual(db.months('osaka'), ['2026-01', '2026-02']);
  assert.equal(db.tagOf('osaka', '2026-02'), 'v1');
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
});

test('ファイル読込(全部上書き): ファイルの全月を書き、ファイルに無い月を削除する', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02'].forEach((m) => db.seed('osaka', m, 'v1'));
  const { manager, loaded, settle } = await setup(db);
  const restored: CompanyMonthlyData = { '2026-02': st('ファイル'), '2026-04': st('ファイル') };
  manager.markDeleted(OSAKA, Object.keys(loaded.osaka).filter((m) => !(m in restored)));
  manager.requestSave(OSAKA, restored);
  await settle();
  assert.deepEqual(db.months('osaka'), ['2026-02', '2026-04']);
  assert.equal(db.tagOf('osaka', '2026-02'), 'ファイル');
});

test('月の削除: 削除した後に他でその月が更新されていたら、削除せずに衝突にする', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02'].forEach((m) => db.seed('osaka', m, 'v1'));
  const { manager, loaded, settle } = await setup(db);
  db.externalUpdate('osaka', '2026-02', '他で更新');
  manager.markDeleted(OSAKA, ['2026-02']);
  manager.requestSave(OSAKA, deleteCompanyMonth(loaded.osaka, '2026-02'));
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'conflict');
  assert.equal(db.tagOf('osaka', '2026-02'), '他で更新');
});

test('月の削除: 他で既に削除されていた月は、そのまま削除できたものとして扱う', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02'].forEach((m) => db.seed('osaka', m, 'v1'));
  const { manager, loaded, settle } = await setup(db);
  db.rows = db.rows.filter((r) => r.target_month !== '2026-02');
  manager.markDeleted(OSAKA, ['2026-02']);
  manager.requestSave(OSAKA, deleteCompanyMonth(loaded.osaka, '2026-02'));
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
});

test('決算期集計の保存(onSaved)は、保存が成功したときだけ行う', async () => {
  const db = new FakeDb();
  ['2026-01', '2026-02'].forEach((m) => db.seed('osaka', m, 'v1'));
  const saved: string[] = [];
  const { manager, loaded, settle } = await setup(db, [OSAKA], (id, m) => saved.push(`${id}:${tagOf(m, '2026-01')}`));
  // 失敗 → 呼ばない
  db.failCompanies.add('osaka');
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('失敗') });
  await settle();
  assert.deepEqual(saved, []);
  // 成功 → 保存した内容で呼ぶ
  db.failCompanies.clear();
  manager.retryNow();
  await settle();
  assert.deepEqual(saved, ['osaka:失敗']);
  // 衝突 → 呼ばない
  db.externalUpdate('osaka', '2026-02', '他で更新');
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('失敗'), '2026-02': st('衝突') });
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'conflict');
  assert.deepEqual(saved, ['osaka:失敗']);
});

test('最新の内容の読み込み(reset)で衝突が解け、また保存できる', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { manager, settle } = await setup(db);
  db.externalUpdate('osaka', '2026-01', '他で更新');
  manager.requestSave(OSAKA, { '2026-01': st('古いタブ') });
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'conflict');
  const fresh = await fetchCompanyMonths(db, OSAKA);
  manager.reset(OSAKA, fresh.months, fresh.versions);
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
  assert.ok(!manager.hasUnsaved());
  manager.requestSave(OSAKA, { ...fresh.months, '2026-01': st('読み直してから編集') });
  await settle();
  assert.equal(db.tagOf('osaka', '2026-01'), '読み直してから編集');
});

test('planCompanySave: 削除の操作で消した月でも、画面にまた戻っていれば削除しない(書き込みになる)', () => {
  const a = st('a');
  const plan = planCompanySave({ '2026-01': a }, { '2026-01': st('取込み直し') }, new Set(['2026-01']));
  assert.deepEqual(plan, { upserts: ['2026-01'], deletes: [] });
});

test('登録していない会社(読込に失敗した会社)は保存しない', async () => {
  const db = new FakeDb();
  const { manager, settle } = await setup(db, []);
  manager.requestSave(OSAKA, { '2026-01': st('x') });
  await settle();
  assert.deepEqual(db.log, []);
  assert.ok(!manager.has(OSAKA));
});

test('新しい月のinsertの返事に updated_at が無くても、読み直して版にする(次の保存が誤って衝突にならない)', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { manager, loaded, settle } = await setup(db);
  db.insertOmitsVersion = true;
  const withNew = { ...loaded.osaka, '2026-02': st('新しい月') };
  manager.requestSave(OSAKA, withNew);
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
  // 次に同じ月を編集 → 更新できる(undefinedのままだと insert になり「すでに作られた」と衝突していた)
  manager.requestSave(OSAKA, { ...withNew, '2026-02': st('新しい月を編集') });
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
  assert.equal(db.tagOf('osaka', '2026-02'), '新しい月を編集');
  assert.deepEqual(db.log, ['INSERT 2026-02', 'UPDATE 2026-02']);
});

test('updated_at を読み直せなければ再試行にし、再試行で読み直せれば保存済みになる(二重に作らない・衝突にしない)', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const { manager, timers, loaded, settle } = await setup(db);
  db.insertOmitsVersion = true;
  db.failSelects = 1; // 直後の読み直しが失敗
  const withNew = { ...loaded.osaka, '2026-02': st('新しい月') };
  manager.requestSave(OSAKA, withNew);
  await settle();
  let s = manager.getState(OSAKA)!;
  assert.equal(s.status, 'error');
  assert.equal(s.unsavedMonths, 1); // 版の確認待ちの1ヶ月
  assert.deepEqual(timers.delays(), [5_000]);
  await timers.fire(5_000); // 再試行: 先に読み直す
  await manager.flush();
  await settle();
  s = manager.getState(OSAKA)!;
  assert.equal(s.status, 'saved');
  assert.equal(s.unsavedMonths, 0);
  assert.deepEqual(db.log, ['INSERT 2026-02']); // 二重に作っていない
  manager.requestSave(OSAKA, { ...withNew, '2026-02': st('編集') });
  await settle();
  assert.equal(manager.getState(OSAKA)!.status, 'saved');
  assert.equal(db.tagOf('osaka', '2026-02'), '編集');
});

test('保存の途中で「最新の内容を読み込む」(reset)をしたら、前の保存の結果は捨て、決算期集計(onSaved)を古い内容で書かない', async () => {
  const db = new FakeDb();
  db.seed('osaka', '2026-01', 'v1');
  const saved: string[] = [];
  const { manager, timers, loaded, settle } = await setup(db, [OSAKA], (id, m) => saved.push(`${id}:${tagOf(m, '2026-01')}`));
  db.delayNextWriteMs = 50; // 保存が遅い
  manager.requestSave(OSAKA, { ...loaded.osaka, '2026-01': st('古い画面の編集') });
  await timers.fire(0);
  assert.equal(manager.getState(OSAKA)!.status, 'saving');
  // 保存中に、別の内容でreset(最新の内容を読み込んだ)
  manager.reset(OSAKA, { '2026-01': st('読み込んだ最新') }, { '2026-01': 'reset時の版' });
  await new Promise((r) => setTimeout(r, 80)); // 前の保存の書き込みが届く
  await settle();
  assert.deepEqual(saved, []); // 古い内容で決算期集計を書いていない
  const s = manager.getState(OSAKA)!;
  assert.equal(s.status, 'saved');
  assert.equal(s.unsavedMonths, 0);
  assert.ok(!manager.hasUnsaved());
});
