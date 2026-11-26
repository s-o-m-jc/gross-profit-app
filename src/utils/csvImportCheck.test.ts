/**
 * 取込み前の確認(ストッパー)の判定のテスト(npm test)。ダミーのCSVだけを使う(実データは使わない)。
 * 2026-11-26: 松山のCSVを四国を選んだまま取り込んだ事故(2026-11-25)の再発防止。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsvImportPreview,
  detectCsvKind,
  detectCompanyFromCsv,
  companyFromId,
  closingFromFileName,
  PendingCsvFile,
} from './csvImportCheck';
import { emptyMonthlyDataState, MonthlyDataState } from './monthlyData';

// 松山の形(8桁・3始まり)のダミー
const payroll = (payDate = '2026/08/14', staff = ['30000001', '30000002'], gross = [200000, 150000]) =>
  ['スタッフ番号,スタッフ氏名,出勤日数,総支給額,社保合計額,課税対象額,差引支給額,支払日']
    .concat(staff.map((s, i) => `${s},テスト${i},20,${gross[i]},20000,170000,150000,${payDate}`))
    .join('\n');
const billing = (opts: { social?: '社保負担額' | '社保他' | null; pay?: number[] } = {}) => {
  const social = opts.social === undefined ? '社保負担額' : opts.social;
  const pay = opts.pay ?? [200000, 150000];
  const head = ['請求No', 'クライアント番号', 'クライアント名称', 'スタッフNo', 'スタッフ氏名', '受注番号', '受注名称', '請求額', '支払額', ...(social ? [social] : []), '担当者'];
  const rows = [
    ['30007001', '30000010', 'テスト社', '30000001', 'テスト0', '31000001', '事務', '280000', String(pay[0]), ...(social ? ['25000'] : []), '担当'],
    ['30007002', '30000011', 'テスト社2', '30000002', 'テスト1', '31000002', '事務', '210000', String(pay[1]), ...(social ? ['18000'] : []), '担当'],
  ];
  return [head, ...rows].map((r) => r.join(',')).join('\n');
};
const invoice = (rows: [string, string, string, number][]) =>
  ['クライアント番号,受注番号,スタッフ番号,時間内－単価,交通費－金額,小計,請求番号']
    .concat(rows.map(([billNo, order, staff, sub]) => `30000010,${order},${staff},1900,0,${sub},${billNo}`))
    .join('\n');

const invoiceList = (date = '2026/07/31') =>
  ['ｸﾗｲｱﾝﾄ番号,請求先部署番号,クライアント名,請求先部署名,請求日,請求No,売上(課税),売上(非課税),消費税,請求合計額',
    `30000010,1,テスト社,総務,${date},30007001,280000,0,28000,308000`,
    `30000011,1,テスト社2,総務,${date},30007002,210000,0,21000,231000`].join('\n');
const f = (card: PendingCsvFile['card'], fileName: string, text: string): PendingCsvFile => ({ card, fileName, text });
const list4 = () => f('invoiceList', '請求一覧.csv', invoiceList());
const noData = () => undefined;

test('見出しからファイルの種類を判定する', () => {
  assert.equal(detectCsvKind(payroll()).kind, 'payroll');
  assert.equal(detectCsvKind(billing()).kind, 'billing');
  assert.equal(detectCsvKind(billing({ social: null })).kind, 'billing');
  assert.equal(detectCsvKind(invoice([['30007001', '31000001', '30000001', 280000]])).kind, 'invoice');
  assert.equal(detectCsvKind('請求No,請求日,売上(課税),売上(非課税),消費税,請求合計額\n1,2026/07/31,1,0,0,1').kind, 'invoiceList');
  assert.equal(detectCsvKind('a,b,c\n1,2,3').kind, 'unknown');
});

test('番号の形から拠点を判定する', () => {
  assert.equal(companyFromId('30001234'), 'matsuyama');
  assert.equal(companyFromId('20011478'), 'osaka');
  assert.equal(companyFromId('10031190'), 'shikoku');
  assert.equal(companyFromId('12252'), 'shikoku');
  assert.equal(companyFromId('テスト社'), null);
  assert.equal(detectCompanyFromCsv(payroll()).company, 'matsuyama');
  assert.equal(detectCompanyFromCsv(payroll('2026/08/14', ['20011478', '20000001'])).company, 'osaka');
  assert.equal(detectCompanyFromCsv(payroll('2026/08/14', ['12252', '9001'])).company, 'shikoku');
});

test('①②③がそろい、すべて合えば止めない。対象年月は①の支払日の前月、行の対象年月もその月にそろえる', () => {
  const p = buildCsvImportPreview(
    [
      f('payroll', '給与計算.csv', payroll()),
      f('billing', '請求支払一覧.csv', billing()),
      f('invoice', '請求_15日締.csv', invoice([['30007001', '31000001', '30000001', 280000]])),
      f('invoice', '請求_末締.csv', invoice([['30007002', '31000002', '30000002', 210000]])),
      list4(),
    ],
    'matsuyama',
    noData
  );
  assert.deepEqual(p.blockers, []);
  assert.equal(p.targetMonth, '2026-07');
  assert.equal(p.detectedCompany, 'matsuyama');
  assert.ok(p.monthBasis.some((b) => b.includes('支払日')));
  // ③は2つを合わせて取り込む(置き換えない)。ファイル名に年月が無くても中身の月になる
  assert.equal(p.rows.invoiceRows?.length, 2);
  assert.ok([...p.rows.invoiceRows!, ...p.rows.billingRows!, ...p.rows.payrollRows!].every((r) => r.targetMonth === '2026-07'));
  assert.deepEqual(p.billingLinkedToInvoice, { linked: 2, total: 2 });
  assert.deepEqual(
    p.files.filter((x) => x.card === 'invoice').map((x) => [x.closing, x.subtotal]),
    [['15日締', 280000], ['末締', 210000]]
  );
  assert.deepEqual(p.confirmations.map((c) => c.id), ['company', 'month', 'closings']);
  assert.ok(p.monthBasis.some((b) => b.includes('④の請求日')));
  assert.ok(p.confirmations[0].label.includes('松山人材'));
  assert.ok(p.confirmations[1].label.includes('2026年7月'));
});

test('選んでいる会社と中身の拠点が違えば止める', () => {
  const p = buildCsvImportPreview([f('payroll', '給与.csv', payroll())], 'shikoku', noData);
  assert.ok(p.blockers.some((b) => b.includes('松山人材') && b.includes('四国人材')));
});

test('ファイル名の年月が中身と違えば止める', () => {
  const p = buildCsvImportPreview([f('payroll', '給与計算202606.csv', payroll())], 'matsuyama', noData);
  assert.ok(p.blockers.some((b) => b.includes('2026年6月') && b.includes('2026年7月')));
});

test('カードと違う種類のファイルは止める', () => {
  const p = buildCsvImportPreview([f('payroll', 'x.csv', billing())], 'matsuyama', noData);
  assert.ok(p.blockers.some((b) => b.includes('②請求支払一覧表印刷CSVのようです')));
});

test('②に社保負担額の列が無ければ止める(四国の「社保他」はよい)', () => {
  const msg = 'スタナビで、出力オプション『社会保険料の～』と『事業主負担額に労災保険～』にチェックを入れて、出し直してください';
  const none = buildCsvImportPreview([f('payroll', 'a.csv', payroll()), f('billing', 'b.csv', billing({ social: null }))], 'matsuyama', noData);
  assert.ok(none.blockers.some((b) => b.includes(msg)));
  const shikoku = buildCsvImportPreview([f('payroll', 'a.csv', payroll()), f('billing', 'b.csv', billing({ social: '社保他' }))], 'matsuyama', noData);
  assert.ok(!shikoku.blockers.some((b) => b.includes(msg)));
});

test('②の支払額が①と合わなければ、月を結び付けられないので止める', () => {
  const p = buildCsvImportPreview([f('payroll', 'a.csv', payroll()), f('billing', 'b.csv', billing({ pay: [1, 2] }))], 'matsuyama', noData);
  assert.ok(p.blockers.some((b) => b.includes('結び付けられません')));
});

test('③が②と合わなければ止め、②の請求Noが③に無ければ締め日の警告を出す', () => {
  const wrong = buildCsvImportPreview(
    [f('payroll', 'a.csv', payroll()), f('billing', 'b.csv', billing()), f('invoice', 'c_末締.csv', invoice([['39999999', '39999999', '30000001', 1]]))],
    'matsuyama',
    noData
  );
  assert.ok(wrong.blockers.some((b) => b.includes('③を②に結び付けられません')));
  const short = buildCsvImportPreview(
    [f('payroll', 'a.csv', payroll()), f('billing', 'b.csv', billing()), f('invoice', 'c_末締.csv', invoice([['30007002', '31000002', '30000002', 210000]])), list4()],
    'matsuyama',
    noData
  );
  assert.deepEqual(short.blockers, []);
  assert.ok(short.warnings.some((w) => w.includes('締め日のファイルが足りない可能性') && w.includes('1件')));
});

const fullSet = () => [
  f('payroll', '給与計算.csv', payroll()),
  f('billing', '請求支払一覧.csv', billing()),
  f('invoice', '請求_末締.csv', invoice([['30007001', '31000001', '30000001', 280000], ['30007002', '31000002', '30000002', 210000]])),
  list4(),
];
const MISSING_MSG =
  '①給与計算書印刷CSV・②請求支払一覧表印刷CSV・③請求書印刷CSV(15日締・20日締・末締)・④請求一覧CSVを、すべて一緒に選んでください。足りないもの: ';

test('①②③がそろっていなければ止める(①だけ・①と③だけ・②と③だけ)', () => {
  const [p1, p2, p3, p4] = fullSet();
  const cases: [PendingCsvFile[], string][] = [
    [[p1], '②請求支払一覧表印刷CSV・③請求書印刷CSV・④請求一覧CSV'],
    [[p1, p3, p4], '②請求支払一覧表印刷CSV'],
    [[p2, p3, p4], '①給与計算書印刷CSV'],
    [[p1, p2, p3], '④請求一覧CSV'],
  ];
  for (const [files, missing] of cases) {
    const p = buildCsvImportPreview(files, 'matsuyama', noData);
    assert.ok(p.blockers.includes(MISSING_MSG + missing), JSON.stringify(p.blockers));
  }
  // ①なしで②③だけのときは、登録済みの①があっても取り込めない(2026-11-26 例外を取りやめ)
  const registered: MonthlyDataState = { ...emptyMonthlyDataState() };
  registered.payrollRows = [
    { targetMonth: '2026-07', staffNo: '30000001', paymentAmount: 200000 },
    { targetMonth: '2026-07', staffNo: '30000002', paymentAmount: 150000 },
  ] as MonthlyDataState['payrollRows'];
  const noPayroll = buildCsvImportPreview([f('billing', '請求支払一覧202607.csv', billing()), p3, p4], 'matsuyama', () => registered);
  assert.ok(noPayroll.blockers.includes(MISSING_MSG + '①給与計算書印刷CSV'));
  assert.equal(noPayroll.targetMonth, '');
  // ①②③がそろえば今までどおり止めない
  assert.deepEqual(buildCsvImportPreview(fullSet(), 'matsuyama', noData).blockers, []);
});

test('登録済みの月は置き換えの警告と確認のチェックを出し、手入力の項目は残ると示す', () => {
  const registered: MonthlyDataState = { ...emptyMonthlyDataState() };
  registered.payrollRows = [{ targetMonth: '2026-07', staffNo: '30000001', paymentAmount: 1 }] as MonthlyDataState['payrollRows'];
  registered.transportExTaxOverrideRows = [{ targetMonth: '2026-07', amount: 1 }] as MonthlyDataState['transportExTaxOverrideRows'];
  const p = buildCsvImportPreview([f('payroll', 'a.csv', payroll())], 'matsuyama', () => registered);
  assert.deepEqual(p.replacesCategories, ['payroll']);
  assert.ok(p.confirmations.some((c) => c.id === 'replace'));
  assert.deepEqual(p.existing.manual, [{ label: '交通費(税抜)の月次上書き', count: 1 }]);
  assert.ok(p.warnings.some((w) => w.includes('この月の①が置き換わります')));
});

test('③のファイル名から締め日を読む', () => {
  assert.equal(closingFromFileName('請求202607_15日締.csv'), '15日締');
  assert.equal(closingFromFileName('請求202607_末締.csv'), '末締');
  assert.equal(closingFromFileName('請求書.csv'), '');
});

test('登録済みの月が手入力の項目だけ(給与・請求のキーが無い)でも落ちない', () => {
  const onlyManual = { transportExTaxOverrideRows: [{ targetMonth: '2026-07', amount: 1 }] } as unknown as MonthlyDataState;
  const p = buildCsvImportPreview(fullSet(), 'matsuyama', () => onlyManual);
  assert.deepEqual(p.blockers, []);
  assert.deepEqual([p.existing.payroll, p.existing.billing, p.existing.invoice], [0, 0, 0]);
  assert.deepEqual(p.replacesCategories, []);
  assert.deepEqual(p.existing.manual, [{ label: '交通費(税抜)の月次上書き', count: 1 }]);
});

test('中身から拠点を判定できなければ止める', () => {
  // 番号の形がどの拠点にも当てはまらない(7桁)
  const p = buildCsvImportPreview([f('payroll', 'a.csv', payroll('2026/08/14', ['9000001', '9000002']))], 'matsuyama', noData);
  assert.equal(p.detectedCompany, null);
  assert.ok(
    p.blockers.includes('CSVの中身(スタッフ番号・クライアント番号・請求Noの形)から拠点を判定できませんでした。取り込まずに、はまさんに連絡してください。')
  );
  assert.ok(!p.warnings.some((w) => w.includes('拠点を判定できませんでした')));
});

// 大阪の形(8桁・2始まり)のダミーで、四国・大阪は①②③だけでよいこと(④は松山だけ必須)
test('大阪・四国は①②③で足り、④は要らない', () => {
  const staff = ['20000001', '20000002'];
  const osakaBilling = billing().replace(/3000(7|0)/g, '2000$1').replace(/3100/g, '2100');
  const osakaInvoice = invoice([['20007001', '21000001', '20000001', 280000], ['20007002', '21000002', '20000002', 210000]]).replace(/30000010/g, '20000010');
  const p = buildCsvImportPreview(
    [f('payroll', 'a.csv', payroll('2026/08/14', staff)), f('billing', 'b.csv', osakaBilling), f('invoice', 'c_末締.csv', osakaInvoice)],
    'osaka',
    noData
  );
  assert.equal(p.detectedCompany, 'osaka');
  assert.deepEqual(p.blockers, []);
  // 大阪には松山の規則(2行のまとめ・③の交通費)を当てない
  assert.equal(p.notes.length, 0);
});

test('④の請求日の月が①と違えば止める', () => {
  const files = fullSet().map((x) => (x.card === 'invoiceList' ? f('invoiceList', '請求一覧.csv', invoiceList('2026/06/30')) : x));
  const p = buildCsvImportPreview(files, 'matsuyama', noData);
  assert.ok(p.blockers.some((b) => b.includes('④の請求日の月(2026年6月)') && b.includes('2026年7月')));
});

test('検算: ①の非課税の支給・④と②③の合計を確かめる', () => {
  const p = buildCsvImportPreview(fullSet(), 'matsuyama', noData);
  const byLabel = (s: string) => p.checks.find((c) => c.label.startsWith(s));
  // ダミーの①は 総支給額−社保合計額−課税対象額 が 10,000円/−40,000円 で、交通費などは読めない → 警告
  assert.equal(byLabel('①の非課税の支給')?.ok, false);
  assert.ok(p.warnings.some((w) => w.includes('給与データの交通費などが読めていない可能性があります(2人)')));
  assert.equal(byLabel('④の請求合計額')?.ok, true);
  assert.ok(byLabel('②の社保負担額'));
});
