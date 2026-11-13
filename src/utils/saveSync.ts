/**
 * 派遣事業 粗利・経理管理システム
 * monthly_data(会社×対象月ごとに1行)の読み込み・保存。画面(React)から切り離した部品。
 *
 * ★2026-11-13 全面的に作り直し(レビューで見つかった保存まわりの問題 H1・H2 への対応):
 * 以前の replaceCompanyMonthlyData は、変更のあった会社の全月を画面の内容で上書き(upsert)し、画面に無い月を削除していた。
 * そのため、古いタブで保存すると、その後にDB補正・別のタブで入った内容が全月分巻き戻り、その間に増えた月が消えていた(H1)。
 * また保存に失敗しても「保存済み」扱いになり、再試行されなかった(H2)。保存が重なると古い内容が後から届いてDBに残った。
 *
 * いまの方式:
 * - 読み込んだときの updated_at(サーバ側のトリガーが書き込みのたびに更新する)を月ごとに持ち、
 *   「同じ updated_at のときだけ」書き込む。書けた行が0件なら、その間に他で更新されたとみなして衝突にする。
 *   updated_at はDBが返した文字列のまま比べる(JavaScriptの日付に変換するとマイクロ秒が落ちて一致しなくなる)。
 * - 変わった月だけを書く(月ごとのオブジェクトが前回保存したものと同じかで判定。取込み・手入力・削除の処理は、
 *   触っていない月のオブジェクトをそのまま残す作りになっている: monthlyData.ts)。
 * - 自動保存では削除しない。削除するのは、削除ボタン・ファイル読込・取り消しの操作で消した月(markDeleted)だけ。
 * - 保存は会社ごとに1つずつ順番に行う。保存中に次の変更が来たら、終わってからもう一度保存する。
 * - 衝突したら、その会社の自動保存を止める(ほかの会社は続ける)。失敗したら「未保存」のまま残し、5秒・30秒・2分と間隔を
 *   延ばして再試行する。エラーは会社ごとに持ち、ほかの会社が成功しても消さない。
 */

import type { CompanyId } from '../config/companies';
import { CompanyMonthlyData, MonthlyDataState, emptyMonthlyDataState } from './monthlyData';

/** Supabaseのクライアント(テストでは偽物を渡す)。使うのは from() から始まる問い合わせだけ */
export interface SaveClient {
  from(table: string): any;
}

/** 対象月 → 読み込んだ(または最後に書き込んだ)ときの updated_at(DBが返した文字列のまま) */
export type MonthVersions = Record<string, string>;

const TABLE = 'monthly_data';

/** DBから取得したstate(JSONB)を、欠けているカテゴリ配列を空配列で補いながら正規化する */
export function normalizeState(state: Partial<MonthlyDataState> | null | undefined): MonthlyDataState {
  const base = emptyMonthlyDataState();
  if (!state) return base;
  return {
    payrollRows: state.payrollRows || [],
    billingRows: state.billingRows || [],
    invoiceRows: state.invoiceRows || [],
    retirementRows: state.retirementRows || [],
    leaveCompensationRows: state.leaveCompensationRows || [],
    leaveAllowanceRows: state.leaveAllowanceRows || [],
    nextMonthAdjustmentRows: state.nextMonthAdjustmentRows || [],
    paidLeaveOverrideRows: state.paidLeaveOverrideRows || [],
    personInChargeRows: state.personInChargeRows || [],
    referralFeeRows: state.referralFeeRows || [],
    transportExTaxOverrideRows: state.transportExTaxOverrideRows || [],
  };
}

/**
 * 1社分のmonthly_dataを全件取得する。月ごとの updated_at も一緒に返す(保存のときの一致判定に使う)。
 * ★2026-09-30: 会社ごとに独立したクエリにしている(3社まとめて1クエリだとstatement timeoutで全社が読めなくなった)。
 */
export async function fetchCompanyMonths(
  client: SaveClient,
  companyId: CompanyId
): Promise<{ months: CompanyMonthlyData; versions: MonthVersions }> {
  const { data, error } = await client.from(TABLE).select('target_month, state, updated_at').eq('company_id', companyId);
  if (error) {
    throw new Error(`Supabaseからのデータ読込に失敗しました(${companyId}): ${error.message}`);
  }
  const months: CompanyMonthlyData = {};
  const versions: MonthVersions = {};
  ((data as { target_month: string; state: Partial<MonthlyDataState> | null; updated_at: string }[] | null) || []).forEach((row) => {
    months[row.target_month] = normalizeState(row.state);
    versions[row.target_month] = row.updated_at;
  });
  return { months, versions };
}

export interface SavePlan {
  /** 書き込む月(前回保存したものから変わった月・新しい月) */
  upserts: string[];
  /** 削除する月(削除の操作で消した月のうち、画面にもう無いもの) */
  deletes: string[];
}

/**
 * 何を書くかを決める。saved=前回保存(または読込)した月の内容、current=いまの画面の内容、
 * pendingDeletes=削除の操作で消した月。画面に無いだけの月(削除の操作をしていない月)は削除しない。
 */
export function planCompanySave(
  saved: CompanyMonthlyData,
  current: CompanyMonthlyData,
  pendingDeletes: ReadonlySet<string>
): SavePlan {
  const upserts = Object.keys(current)
    .filter((m) => current[m] !== saved[m])
    .sort();
  const deletes = [...pendingDeletes].filter((m) => !(m in current)).sort();
  return { upserts, deletes };
}

export type SaveOutcome =
  | { status: 'ok' }
  | { status: 'conflict'; month: string; reason: string }
  | { status: 'error'; message: string };

export interface SaveExecution {
  outcome: SaveOutcome;
  /** 書けた月と、その新しい updated_at(途中で止まっても、書けた分は返す。次の保存の一致判定に必要) */
  written: Record<string, string>;
  /** 削除できた月(他で既に削除されていた月も含む) */
  deleted: string[];
  /** 新しく作れたが、その updated_at が分からなかった月(次の保存の前に読み直す。読み直すまでは再試行扱い) */
  insertedNeedingVersion: string[];
}

/** 1つの月の updated_at を読み直す(無ければ undefined) */
async function readVersion(client: SaveClient, companyId: CompanyId, month: string): Promise<string | undefined> {
  const { data, error } = await client
    .from(TABLE)
    .select('updated_at')
    .eq('company_id', companyId)
    .eq('target_month', month);
  if (error) throw new Error(`Supabaseの版(updated_at)の確認に失敗しました(${companyId} ${month}): ${error.message}`);
  const v = data?.[0]?.updated_at;
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * planを実行する。月ごとに「読み込んだときと同じ updated_at のときだけ」書く。衝突・失敗したら、その場で止める
 * (画面が古いと分かった後に、ほかの月まで書き進めない)。
 */
export async function executeCompanySave(
  client: SaveClient,
  companyId: CompanyId,
  plan: SavePlan,
  current: CompanyMonthlyData,
  versions: MonthVersions
): Promise<SaveExecution> {
  const written: Record<string, string> = {};
  const deleted: string[] = [];
  const insertedNeedingVersion: string[] = [];
  const done = (outcome: SaveOutcome): SaveExecution => ({ outcome, written, deleted, insertedNeedingVersion });
  try {
    for (const month of plan.upserts) {
      const state = current[month];
      const known = versions[month];
      if (known !== undefined) {
        const { data, error } = await client
          .from(TABLE)
          .update({ state })
          .eq('company_id', companyId)
          .eq('target_month', month)
          .eq('updated_at', known)
          .select('updated_at');
        if (error) return done({ status: 'error', message: `Supabaseへの保存に失敗しました(${companyId} ${month}): ${error.message}` });
        if (!data || data.length === 0) {
          return done({ status: 'conflict', month, reason: 'あなたが画面を開いた後に、他で更新(または削除)されました' });
        }
        written[month] = data[0].updated_at;
      } else {
        const { data, error } = await client
          .from(TABLE)
          .insert({ company_id: companyId, target_month: month, state })
          .select('updated_at');
        if (error) {
          // 23505 = 一意制約違反(会社×対象月の行が、その間に他で作られていた)
          if (error.code === '23505') {
            return done({ status: 'conflict', month, reason: 'あなたが画面を開いた後に、他でこの月のデータが作られました' });
          }
          return done({ status: 'error', message: `Supabaseへの保存に失敗しました(${companyId} ${month}): ${error.message}` });
        }
        // ★2026-11-13: サーバの返事に updated_at が無かったら、undefined のまま版にしない(次の保存で「すでに作られた」と
        // 誤って衝突になる)。読み直して版に使い、読み直せなければ再試行(作れたことは記録し、次の保存の前に読み直す)
        let version: string | undefined = data?.[0]?.updated_at;
        if (typeof version !== 'string' || !version) {
          try {
            version = await readVersion(client, companyId, month);
          } catch (e) {
            version = undefined;
          }
        }
        if (!version) {
          insertedNeedingVersion.push(month);
          return done({ status: 'error', message: `保存はできましたが、版(updated_at)を確認できませんでした(${companyId} ${month})。再試行します` });
        }
        written[month] = version;
      }
    }
    for (const month of plan.deletes) {
      const known = versions[month];
      if (known === undefined) {
        // 一度も保存していない月(画面の中だけにあった月)。DBには触らない
        deleted.push(month);
        continue;
      }
      const { data, error } = await client
        .from(TABLE)
        .delete()
        .eq('company_id', companyId)
        .eq('target_month', month)
        .eq('updated_at', known)
        .select('target_month');
      if (error) return done({ status: 'error', message: `Supabase上の削除に失敗しました(${companyId} ${month}): ${error.message}` });
      if (!data || data.length === 0) {
        // 消せなかった: 他で既に削除されていれば目的は果たしているので成功、まだあれば(他で更新された)衝突
        const { data: still, error: checkError } = await client
          .from(TABLE)
          .select('target_month')
          .eq('company_id', companyId)
          .eq('target_month', month);
        if (checkError) return done({ status: 'error', message: `Supabase上の削除の確認に失敗しました(${companyId} ${month}): ${checkError.message}` });
        if (still && still.length > 0) {
          return done({ status: 'conflict', month, reason: 'あなたが画面を開いた後に、他で更新されたため削除していません' });
        }
      }
      deleted.push(month);
    }
    return done({ status: 'ok' });
  } catch (e) {
    return done({ status: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

// ---------------------------------------------------------------------------
// 会社ごとの保存の順番待ち・再試行・状態の管理
// ---------------------------------------------------------------------------

export type CompanySaveStatus = 'saved' | 'saving' | 'error' | 'conflict';

export interface CompanySaveState {
  status: CompanySaveStatus;
  /** 未保存の月数(書く月+削除する月) */
  unsavedMonths: number;
  /** 失敗の内容(status='error') */
  errorMessage?: string;
  /** 衝突した月と理由(status='conflict') */
  conflictMonth?: string;
  conflictReason?: string;
  /** 次の自動再試行までのミリ秒(status='error'のとき) */
  nextRetryMs?: number;
}

export interface SaveManagerOptions {
  client: SaveClient;
  /** 保存が成功したときだけ呼ぶ(決算期集計キャッシュの更新など)。保存した内容そのものを渡す */
  onSaved?: (companyId: CompanyId, months: CompanyMonthlyData) => void | Promise<void>;
  /** 状態が変わったときに呼ぶ(画面の表示更新用) */
  onChange?: () => void;
  /** 変更を受けてから保存を始めるまでの待ち(連続した変更をまとめる)。既定500ms */
  debounceMs?: number;
  /** 失敗したときの再試行の間隔。既定 5秒・30秒・2分(以降は2分ごと) */
  retryDelaysMs?: number[];
  /** テスト用にタイマーを差し替える */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface CompanyEntry {
  saved: CompanyMonthlyData;
  versions: MonthVersions;
  current: CompanyMonthlyData;
  pendingDeletes: Set<string>;
  status: CompanySaveStatus;
  errorMessage?: string;
  conflictMonth?: string;
  conflictReason?: string;
  running: boolean;
  rerun: boolean;
  retryCount: number;
  nextRetryMs?: number;
  timer?: unknown;
  /** 作れたが updated_at が分からない月(次の保存の前に読み直す) */
  needsVersion: Set<string>;
}

export class SaveManager {
  private readonly entries = new Map<CompanyId, CompanyEntry>();
  private readonly opts: Required<Omit<SaveManagerOptions, 'onSaved' | 'onChange'>> &
    Pick<SaveManagerOptions, 'onSaved' | 'onChange'>;

  constructor(options: SaveManagerOptions) {
    this.opts = {
      debounceMs: 500,
      retryDelaysMs: [5_000, 30_000, 120_000],
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  /** 読み込んだ内容を「保存済み」の基準にする(起動時・最新の内容の読み込み時) */
  reset(companyId: CompanyId, months: CompanyMonthlyData, versions: MonthVersions): void {
    const prev = this.entries.get(companyId);
    if (prev?.timer !== undefined) this.opts.clearTimer(prev.timer);
    this.entries.set(companyId, {
      saved: months,
      versions: { ...versions },
      current: months,
      pendingDeletes: new Set(),
      status: 'saved',
      running: false,
      rerun: false,
      retryCount: 0,
      needsVersion: new Set(),
    });
    this.opts.onChange?.();
  }

  /** この会社を保存の対象として登録済みか(読込に失敗した会社は登録しない=保存しない) */
  has(companyId: CompanyId): boolean {
    return this.entries.has(companyId);
  }

  /** 削除ボタン・ファイル読込・取り消しの操作で消した月を記録する(自動保存では、これ以外の月は削除しない) */
  markDeleted(companyId: CompanyId, months: string[]): void {
    const e = this.entries.get(companyId);
    if (!e) return;
    months.forEach((m) => e.pendingDeletes.add(m));
  }

  /** いまの画面の内容を渡す。少し待ってから保存する(衝突中は保存しない) */
  requestSave(companyId: CompanyId, current: CompanyMonthlyData): void {
    const e = this.entries.get(companyId);
    if (!e) return;
    e.current = current;
    this.opts.onChange?.();
    if (e.status === 'conflict') return;
    if (e.running) {
      e.rerun = true;
      return;
    }
    if (e.status === 'error') return; // 再試行のタイマーに任せる(今すぐは retryNow)
    this.schedule(companyId, this.opts.debounceMs);
  }

  /** 失敗している会社(省略時は全社)を今すぐ再試行する。ネットにつながったときにも呼ぶ */
  retryNow(companyId?: CompanyId): void {
    const ids = companyId ? [companyId] : [...this.entries.keys()];
    ids.forEach((id) => {
      const e = this.entries.get(id);
      if (!e || e.status === 'conflict') return;
      if (e.status === 'error' || this.plan(e).upserts.length + this.plan(e).deletes.length > 0) this.schedule(id, 0);
    });
  }

  /** 保存がすべて終わるまで待つ(テスト用) */
  async flush(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const busy = [...this.entries.values()].some((e) => e.running);
      if (!busy) return;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  getState(companyId: CompanyId): CompanySaveState | undefined {
    const e = this.entries.get(companyId);
    if (!e) return undefined;
    const p = this.plan(e);
    return {
      status: e.status,
      unsavedMonths: p.upserts.length + p.deletes.length + e.needsVersion.size,
      errorMessage: e.errorMessage,
      conflictMonth: e.conflictMonth,
      conflictReason: e.conflictReason,
      nextRetryMs: e.status === 'error' ? e.nextRetryMs : undefined,
    };
  }

  /** 未保存の変更がある会社があるか(タブを閉じるときの警告用。衝突中の会社も未保存) */
  hasUnsaved(): boolean {
    return [...this.entries.keys()].some((id) => {
      const s = this.getState(id)!;
      return s.status !== 'saved' || s.unsavedMonths > 0;
    });
  }

  private plan(e: CompanyEntry): SavePlan {
    return planCompanySave(e.saved, e.current, e.pendingDeletes);
  }

  private schedule(companyId: CompanyId, ms: number): void {
    const e = this.entries.get(companyId);
    if (!e) return;
    if (e.timer !== undefined) this.opts.clearTimer(e.timer);
    e.timer = this.opts.setTimer(() => {
      e.timer = undefined;
      void this.run(companyId);
    }, ms);
  }

  private fail(companyId: CompanyId, e: CompanyEntry, message: string): void {
    e.status = 'error';
    e.errorMessage = message;
    const delays = this.opts.retryDelaysMs;
    const delay = delays[Math.min(e.retryCount, delays.length - 1)];
    e.retryCount += 1;
    e.nextRetryMs = delay;
    this.opts.onChange?.();
    this.schedule(companyId, delay);
  }

  private async run(companyId: CompanyId): Promise<void> {
    const e = this.entries.get(companyId);
    if (!e || e.running || e.status === 'conflict') return;
    // ★2026-11-13: 保存の途中で「最新の内容を読み込む」(reset)が押されると、この会社の状態は新しいものに置き換わる。
    // そのあとに届いた前の保存の結果は捨てる(古い内容で版・決算期集計キャッシュを書かない)
    const stale = () => this.entries.get(companyId) !== e;
    e.running = true;
    e.rerun = false;

    // 前の保存で作れたが updated_at が分からなかった月は、先に読み直す(読み直せなければ再試行)
    for (const m of [...e.needsVersion]) {
      let v: string | undefined;
      let message = `版(updated_at)を確認できませんでした(${companyId} ${m})。再試行します`;
      try {
        v = await readVersion(this.opts.client, companyId, m);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      if (stale()) return;
      if (!v) {
        e.running = false;
        this.fail(companyId, e, message);
        return;
      }
      e.versions[m] = v;
      e.needsVersion.delete(m);
    }

    const current = e.current;
    const plan = this.plan(e);
    if (plan.upserts.length === 0 && plan.deletes.length === 0) {
      e.running = false;
      if (e.status !== 'saved') {
        e.status = 'saved';
        e.errorMessage = undefined;
        e.retryCount = 0;
        e.nextRetryMs = undefined;
        this.opts.onChange?.();
      }
      return;
    }
    e.status = 'saving';
    this.opts.onChange?.();

    const result = await executeCompanySave(this.opts.client, companyId, plan, current, e.versions);
    if (stale()) return;

    // 書けた月・消せた月は、結果がどうであれ基準に反映する(次の保存で「同じ updated_at」の判定に使う)
    const saved = { ...e.saved };
    Object.entries(result.written).forEach(([m, v]) => {
      saved[m] = current[m];
      e.versions[m] = v;
    });
    result.insertedNeedingVersion.forEach((m) => {
      saved[m] = current[m];
      e.needsVersion.add(m);
    });
    result.deleted.forEach((m) => {
      delete saved[m];
      delete e.versions[m];
      e.pendingDeletes.delete(m);
    });
    e.saved = saved;
    e.running = false;

    if (result.outcome.status === 'ok') {
      e.status = 'saved';
      e.errorMessage = undefined;
      e.retryCount = 0;
      e.nextRetryMs = undefined;
      this.opts.onChange?.();
      try {
        await this.opts.onSaved?.(companyId, current);
      } catch (err) {
        console.warn('保存後の処理に失敗しました:', err);
      }
      if (stale()) return;
      if (e.rerun || this.plan(e).upserts.length + this.plan(e).deletes.length > 0) this.schedule(companyId, 0);
    } else if (result.outcome.status === 'conflict') {
      e.status = 'conflict';
      e.conflictMonth = result.outcome.month;
      e.conflictReason = result.outcome.reason;
      this.opts.onChange?.();
    } else {
      this.fail(companyId, e, result.outcome.message);
    }
  }
}
