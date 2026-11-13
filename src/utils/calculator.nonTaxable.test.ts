/**
 * 非課税の請求(立替金・相殺・休業手当など)に消費税を掛けない税込換算の回帰テスト。
 * 実行: npm test
 *
 * 2026-11-12: 税込の請求額を「税抜 × 1.1」で計算していたため、請求額に含まれる立替金(請求書の非課税欄)にも
 * 税が掛かっていた。業務ルール(はまさん確認): 立替金は請求・支払とも消費税を加算しない。請求する交通費は
 * 税込とみなして割り戻した額を他の請求額と合算して消費税を計算する。自社負担の交通費は請求しない。
 * 実データ例: 大阪2025-10 土井 惠利奈さん(新幹線代立替 29,374円)、松山2025-02 STNet(立替金 8,150円)、
 * 潮冷熱(駐車料等の相殺 −4,150円)、四国2023-11 日本和装(休業手当 238,000円)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGrossProfit, toIncTax } from './calculator';
import { parseInvoicePrintCsv, parsePayrollCsv } from './csvParser';
import {
  assignNonTaxableToBillingRows,
  markOsakaPassThroughReimbursements,
  readMatsuyamaNonTaxableSales,
  readShikokuMiscIncomeSales,
} from './excelImport';
import type { BillingRow, InvoicePrintRow, PayrollRow } from '../types';

const M = '2025-10';

const billing = (staffNo: string, orderNo: string, amount: number, p: Partial<BillingRow> = {}): BillingRow => ({
  billingNo: `B${staffNo}`,
  targetMonth: M,
  staffNo,
  staffName: `スタッフ${staffNo}`,
  clientCode: 'C1',
  clientName: '派遣先',
  orderNo,
  orderName: `受注${orderNo}`,
  billingAmountExTax: amount,
  paymentAmount: 0,
  socialInsuranceBilling: 0,
  paidLeaveDaysUsed: 0,
  billingTransport: 0,
  referralFee: 0,
  workHours: 0,
  unitPrice: 0,
  ...p,
});

const invoice = (p: Partial<InvoicePrintRow>): InvoicePrintRow => ({
  billingNo: '',
  targetMonth: M,
  invoiceIssueDate: '',
  paymentDueDate: '',
  printStatus: '印刷済',
  sentStatus: '送付済',
  unitPrice: 0,
  ...p,
});

const payroll = (staffNo: string, p: Partial<PayrollRow> = {}): PayrollRow =>
  ({ targetMonth: M, staffNo, staffName: staffNo, paymentAmount: 0, socialInsurance: 0, employmentInsurance: 0, parkingFee: 0, salaryTransport: 0, ...p }) as PayrollRow;

const incTaxOf = (results: ReturnType<typeof calculateGrossProfit>, staffNo: string) => {
  const r = results.find((x) => x.staffNo === staffNo);
  assert.ok(r, `staff ${staffNo} not found`);
  return r.billingAmountIncTax;
};

test('toIncTax: 課税分にだけ税を掛け、非課税分は同額で足す', () => {
  assert.equal(toIncTax(351451, 29374, 0.1), Math.round(322077 * 1.1) + 29374); // 383,659
  assert.equal(toIncTax(100000, 0, 0.1), 110000);
  assert.equal(toIncTax(475530, -4150, 0.1), Math.round(479680 * 1.1) - 4150); // 相殺(マイナス)
  assert.equal(toIncTax(59360, 59360, 0.1), 59360); // 休業手当だけの請求
});

test('請求行の非課税の額には税を掛けない(粗利の税込も同じ額だけ変わる)', () => {
  const r = calculateGrossProfit([], [billing('1', 'O1', 351451, { nonTaxableAmount: 29374 }), billing('2', 'O2', 100000)]);
  assert.equal(incTaxOf(r, '1'), 383659);
  assert.equal(incTaxOf(r, '2'), 110000);
});

test('大阪: 請求データに無ければ請求書行(受注番号で結合)の非課税欄で補う', () => {
  const billings = [billing('20011', '22890114', 351451)];
  const invoices = [invoice({ orderNo: '22890114', staffNo: '20011', nonTaxableAmount: 29374 })];
  assert.equal(incTaxOf(calculateGrossProfit([], billings, invoices), '20011'), 383659);
});

test('締日で分かれた同じ受注の重複行でも、請求書行の非課税欄は1回だけ数える', () => {
  const billings = [billing('3', 'O3', 150000), billing('3', 'O3', 50000)];
  const invoices = [invoice({ orderNo: 'O3', staffNo: '3', nonTaxableAmount: -13860 })];
  const r = calculateGrossProfit([], billings, invoices);
  assert.equal(r.length, 1);
  assert.equal(incTaxOf(r, '3'), Math.round((200000 + 13860) * 1.1) - 13860);
});

test('請求書の非課税欄の列(全角数字・全角ハイフン)を合計して読む', () => {
  const csv = [
    '請求番号,受注番号,スタッフ番号,交通費－金額,非課税１－金額,非課税２－金額,小計',
    '20001,22890114,20011,0,29374,0,351451',
    '20002,22890115,20012,2545,0,0,160845',
  ].join('\n');
  const rows = parseInvoicePrintCsv(csv, '請求書印刷202510.csv');
  assert.equal(rows[0].nonTaxableAmount, 29374);
  assert.equal(rows[1].nonTaxableAmount, 0);
  assert.equal(rows[1].transportAmount, 2545);
  // 非課税欄の無い請求書CSVでは未設定のまま(請求データ側の値・0を使う)
  assert.equal(parseInvoicePrintCsv('請求番号,受注番号\n1,2', 'x202510.csv')[0].nonTaxableAmount, undefined);
});

test('松山: 売上ＣＳＶからの非課税の売上をクライアント別に合計し、立替金が同額のスタッフの行に付ける', () => {
  const aoa = [
    ['売上CSVから'],
    ['ｸﾗｲｱﾝﾄ番号', '請求先部署番号', 'ｸﾗｲｱﾝﾄ名を手入力', 'シート名', '請求日', '請求No', '売上(課税)', '売上(非課税)', '消費税', '請求合計額'],
    ['', '', '', '', '数式入っている→', '', '#REF!', '#REF!', '#REF!', '#REF!'],
    [30000019, 1, '株式会社ＳＴＮｅｔ', '', '', 30004300, 419578, 8150, 41957, 469685],
    [30000076, 1, '潮冷熱株式会社', '', '', 30004301, 300000, -2000, 30000, 328000],
    [30000076, 2, '潮冷熱株式会社', '', '', 30004302, 179680, -2150, 17968, 195498],
    [30000002, 1, '今治造船株式會社', '', '', 30004303, 311854, 0, 31185, 343039],
  ];
  const amounts = readMatsuyamaNonTaxableSales(aoa);
  assert.deepEqual(
    amounts.map((a) => [a.clientCode, a.amount]),
    [['30000019', 8150], ['30000076', -4150]]
  );
  const billings = [
    billing('A', 'O1', 200000, { clientCode: '30000019' }),
    billing('近藤', 'O2', 227728, { clientCode: '30000019' }),
    billing('B', 'O3', 300000, { clientCode: '30000076' }),
    billing('C', 'O4', 175530, { clientCode: '30000076' }),
  ];
  const warnings: string[] = [];
  const out = assignNonTaxableToBillingRows(
    billings,
    [payroll('近藤', { reimbursement: 8150 })],
    amounts.map((a) => ({ ...a, match: (b: BillingRow) => b.clientCode === a.clientCode })),
    warnings
  );
  assert.deepEqual(out.map((b) => b.nonTaxableAmount), [undefined, 8150, -4150, undefined]);
  assert.deepEqual(warnings, []);
  assert.equal(billings[1].nonTaxableAmount, undefined); // 元の配列は変えない
});

test('四国: 売上計上表の雑収入(不課税)を取引先名別に読む(2つの見出しの書式)', () => {
  const oldFormat = [
    ['ｸﾗｲｱﾝﾄ名', '非課税欄', '請求合計額', '売上計上額\n通勤交通費込み', '立替金', '地代家賃等相殺', '雑収入（不課税）', '消費税計算差異', 'その他税込み'],
    ['日本和装ホールディングス株式会社', 238000, 238000, 238000, '', '', 238000, '', ''],
    ['株式会社ＳＴＮｅｔ', 9100, 400000, 400000, 9100, '', '', '', ''],
    ['カツヤマキカイ株式会社', 0, 200000, 200000, '', -5000, '', '', ''],
  ];
  assert.deepEqual(
    readShikokuMiscIncomeSales(oldFormat).map((a) => [a.clientName, a.amount]),
    [['日本和装ホールディングス株式会社', 238000]]
  );
  const newFormat = [
    ['ｸﾗｲｱﾝﾄ名', '非課税欄', '請求合計額', '売上計上額\n通勤交通費込み', '立替金\n\n直接入力', '地代家賃他相殺', '休業手当等雑収入\n（不課税）', 'その他\n税込み'],
    ['国立大学法人香川大学', 100000, 500000, 500000, '', '', 60000, ''],
    ['国立大学法人香川大学', 0, 300000, 300000, '', '', 40000, ''],
  ];
  assert.deepEqual(
    readShikokuMiscIncomeSales(newFormat).map((a) => [a.clientName, a.amount]),
    [['国立大学法人香川大学', 100000]]
  );
});

// ---------------------------------------------------------------------------
// 2026-11-12(はまさんの決定): 立替金は売上に含めない。売上・支払の両方から除き、粗利は変えない。
// 休業分補償(手入力)は非課税。
// ---------------------------------------------------------------------------

test('立替金は売上・支払の両方から除き、粗利(税抜・税込)は1円も変わらない', () => {
  // 松山2025-02 STNet 近藤 江梨圭さんの形: 請求額・支払額とも立替金8,150円を含み、給与の立替金も8,150円
  const base = billing('近藤', 'O1', 427728, { paymentAmount: 202005, socialInsuranceBilling: 30000, nonTaxableAmount: 8150 });
  const p = payroll('近藤', { paymentAmount: 202005, reimbursement: 8150 });
  const [before] = calculateGrossProfit([p], [base]);
  const [after] = calculateGrossProfit([p], [{ ...base, reimbursementAmount: 8150 }]);
  assert.equal(after.billingAmountExTax, 427728 - 8150);
  assert.equal(after.paymentAmount, 202005 - 8150);
  assert.equal(after.reimbursementAmount, 8150);
  // 立替金は非課税欄の内数。除いた後の課税分 419,578円にだけ税が掛かる
  assert.equal(after.billingAmountIncTax, Math.round(419578 * 1.1));
  assert.equal(after.grossProfitExTax, before.grossProfitExTax);
  assert.equal(after.totalCostExTax, before.totalCostExTax - 8150);
  // 税込の粗利は、以前(非課税で売上に含めていた)と同じ。税込売上・支払が同額ずつ減るだけ
  assert.equal(after.grossProfitIncTax, before.grossProfitIncTax);
  // 雇保(会社負担の表示用)は請求データの支払額そのままで按分する(立替金を除いても変わらない)
  assert.equal(after.employmentInsurance, before.employmentInsurance);
});

test('立替金を除いても支払額の不一致チェックは請求データの支払額のまま(警告が出ない・消えない)', () => {
  const has = (r: ReturnType<typeof calculateGrossProfit>[number]) => r.alerts.some((a) => a.type === 'PAYMENT_MISMATCH');
  // 給与の立替金と同額を除いた: 請求の支払額=総支給額なので警告なし
  const ok = calculateGrossProfit(
    [payroll('A', { paymentAmount: 202005, reimbursement: 8150 })],
    [billing('A', 'O1', 427728, { paymentAmount: 202005, nonTaxableAmount: 8150, reimbursementAmount: 8150 })]
  )[0];
  assert.ok(!has(ok));
  // 大阪2025-10 土井さんの形: 新幹線代を給与の「交通費」で支給(立替金の欄は0)。請求の支払額=総支給額なので警告なし
  const doi = calculateGrossProfit(
    [payroll('D', { paymentAmount: 322954, reimbursement: 0 })],
    [billing('D', 'O2', 351451, { paymentAmount: 322954, nonTaxableAmount: 29374, reimbursementAmount: 29374 })]
  )[0];
  assert.ok(!has(doi));
  assert.equal(doi.paymentAmount, 322954 - 29374);
  // 本当に違う場合は今までどおり警告する
  const ng = calculateGrossProfit(
    [payroll('B', { paymentAmount: 43230 })],
    [billing('B', 'O3', 70000, { paymentAmount: 53465, nonTaxableAmount: 1000, reimbursementAmount: 1000 })]
  )[0];
  assert.ok(has(ng));
});

test('大阪: 請求書の備考に「立替」「寸志」とある非課税欄を立替金にする(休業手当・相殺は売上に残す)', () => {
  const csv = [
    '請求番号,受注番号,スタッフ番号,非課税１－金額,備考１,備考2',
    '1,22890114,20011478,29374,10/30　新幹線代立替分,',
    '2,24170324,20008174,50000,交通費2800円（内税）,宮﨑スタッフへの寸志支給',
    '3,24420126,20007443,59360,10月分　休業手当,',
    '4,22155101,20012948,-13860,森下奈々スタッフ　制服代相殺,',
  ].join('\n');
  const rows = parseInvoicePrintCsv(csv, '請求書印刷202510.csv');
  assert.deepEqual(rows.map((r) => r.reimbursementAmount), [29374, 50000, undefined, undefined]);
  // 請求書行から請求データへ補われる
  const [r] = calculateGrossProfit(
    [payroll('20011478', { paymentAmount: 322954 })],
    [billing('20011478', '22890114', 351451, { paymentAmount: 322954 })],
    [rows[0]]
  );
  assert.equal(r.billingAmountExTax, 351451 - 29374);
  assert.equal(r.billingAmountIncTax, Math.round(322077 * 1.1));
  assert.equal(r.grossProfitExTax, 351451 - 322954);
});

test('松山: 売上計上表の「立替金」列のプラスの額だけを立替金にし、給与の立替金が同額で支払額に入っている行に付ける', () => {
  const salesCsv = [
    ['ｸﾗｲｱﾝﾄ番号', '請求先部署番号', 'ｸﾗｲｱﾝﾄ名を手入力', 'シート名', '請求日', '請求No', '売上(課税)', '売上(非課税)', '消費税', '請求合計額'],
    [30000019, 1, '株式会社ＳＴＮｅｔ', '', '', 1, 419578, 8150, 41957, 469685],
    [30000076, 1, '潮冷熱株式会社', '', '', 2, 479680, -4150, 47968, 523498],
    [30000301, 1, '株式会社伊予鉄髙島屋', '', '', 3, 291349, 10000, 29134, 330483],
  ];
  const salesBook = [
    ['売上計上表'],
    ['ｸﾗｲｱﾝﾄ名', '売上\n(非課税欄)', '請求合計額', '売上計上額\n通勤交通費込み', '立替金等と\n非課税との差異', '立替金', 'その他', '通勤\n交通費', '外税交通費\n（税込）', '雑収入\n（不課税）'],
    ['株式会社ＳＴＮｅｔ', 8150, 469685, 469685, 0, 8150],
    ['潮冷熱株式会社', -4150, 523498, 527648, 0, -4150],
    ['株式会社伊予鉄髙島屋', 10000, 330483, 330483, 0, '', '', 10000],
  ];
  const amounts = readMatsuyamaNonTaxableSales(salesCsv, salesBook);
  assert.deepEqual(
    amounts.map((a) => [a.clientCode, a.amount, a.reimbursement]),
    [['30000019', 8150, 8150], ['30000076', -4150, undefined], ['30000301', 10000, undefined]]
  );
  const billings = [
    billing('近藤', 'O1', 427728, { clientCode: '30000019', paymentAmount: 202005 }),
    billing('白石', 'O2', 475530, { clientCode: '30000076', paymentAmount: 300000 }),
    billing('渡邉', 'O3', 301349, { clientCode: '30000301', paymentAmount: 231843 }),
  ];
  const payrolls = [
    payroll('近藤', { paymentAmount: 202005, reimbursement: 8150 }),
    payroll('白石', { paymentAmount: 300000 }),
    // 2023-10 渡邉 千賀さん: 給与の立替金10,000円だが、請求は「通勤交通費」(立替金ではない)なので除かない
    payroll('渡邉', { paymentAmount: 231843, reimbursement: 10000 }),
  ];
  const warnings: string[] = [];
  const out = assignNonTaxableToBillingRows(
    billings,
    payrolls,
    amounts.map((a) => ({ ...a, match: (b: BillingRow) => b.clientCode === a.clientCode })),
    warnings
  );
  assert.deepEqual(out.map((b) => [b.nonTaxableAmount, b.reimbursementAmount]), [[8150, 8150], [-4150, undefined], [10000, undefined]]);
  assert.deepEqual(warnings, []);
  // 給与の立替金が支払額に入っていない(請求の支払額≠総支給額)なら除かず警告
  const w2: string[] = [];
  const out2 = assignNonTaxableToBillingRows(
    [billings[0]],
    [payroll('近藤', { paymentAmount: 210155, reimbursement: 8150 })],
    [{ ...amounts[0], match: () => true }],
    w2
  );
  assert.equal(out2[0].reimbursementAmount, undefined);
  assert.equal(w2.length, 1);
});

test('休業分補償(手入力)は非課税: 税込も同額', () => {
  const [r] = calculateGrossProfit([], [], [], [], 0.1, [
    { id: 'L1', targetMonth: M, staffNo: '1', clientCode: 'C1', clientName: '派遣先', amount: 59360, memo: '' } as any,
  ]);
  assert.equal(r.billingAmountExTax, 59360);
  assert.equal(r.billingAmountIncTax, 59360);
  assert.equal(r.grossProfitIncTax, 59360);
});

// ---------------------------------------------------------------------------
// 2026-11-13(はまさんの決定): 大阪の寸志も立替金と同じく売上・支払から除く。給与の交通費の枠で支払った立替金は
// 交通費の表示から除く(土井 惠利奈さん2025-10の新幹線代)。
// ---------------------------------------------------------------------------

test('給与計算書印刷: 2つ目の「交通費」列(交通費2の枠)の額をtransport2Amountに持つ', () => {
  const csv = ['スタッフ番号,氏名,総支給額,交通費,交通費', '20011478,土井 惠利奈,322954,21080,29374'].join('\n');
  const [p] = parsePayrollCsv(csv, '給与202510.csv');
  assert.equal(p.salaryTransport, 50454);
  assert.equal(p.transport2Amount, 29374);
});

test('大阪: 請求書の非課税欄と給与の交通費2の枠が同額なら立替金(2024-08の寸志は備考に記載なし)', () => {
  const inv = (staffNo: string, nonTaxableAmount: number) => invoice({ orderNo: `O${staffNo}`, staffNo, nonTaxableAmount });
  const out = markOsakaPassThroughReimbursements(
    [inv('宮﨑', 50000), inv('福永', 50000), inv('中矢', 59360), inv('森下', -13860), inv('別人', 6600)],
    [
      payroll('宮﨑', { salaryTransport: 52800, transport2Amount: 50000 }),
      payroll('福永', { salaryTransport: 53920, transport2Amount: 50000 }),
      payroll('中矢', { paymentAmount: 59360 }), // 休業手当の欄で支払い
      payroll('森下', { salaryTransport: -4620, transport2Amount: -13860 }), // 制服代の相殺(マイナス)は対象外
      payroll('別人', { transport2Amount: 5282 }), // 額が違う
    ]
  );
  assert.deepEqual(out.map((i) => i.reimbursementAmount), [50000, 50000, undefined, undefined, undefined]);
});

test('土井さんの形: 交通費の枠で支払った立替金は交通費から除き、給与総額・社保他小計がずれない。粗利は不変', () => {
  const p = payroll('20011478', { paymentAmount: 322954, salaryTransport: 50454, transport2Amount: 29374 });
  const b = billing('20011478', '22890114', 351451, { paymentAmount: 322954, socialInsuranceBilling: 38000, billingTransport: 19164 });
  const [before] = calculateGrossProfit([p], [b]);
  const [after] = calculateGrossProfit([p], [{ ...b, nonTaxableAmount: 29374, reimbursementAmount: 29374 }]);
  // 表示の給与総額 = 支払額 − 交通費 − 駐車場代(MonthlyCalculationTable)。立替金を除く前と同じ272,500円
  const salary = (r: typeof after) => r.paymentAmount - r.salaryTransport - r.parkingFee;
  assert.equal(salary(after), salary(before));
  assert.equal(salary(after), 272500);
  assert.equal(after.salaryTransport, 21080); // 交通費(自社負担)は本当の交通費だけ
  assert.equal(after.grossProfitExTax, before.grossProfitExTax);
  // 交通費の突合も本当の交通費で行う(新幹線代のせいで不一致にならない)
  assert.ok(!after.alerts.some((a) => a.type === 'TRANSPORT_MISMATCH' && a.message.includes('29,374')));
});

test('給与の立替金の欄で支払った立替金(松山)は交通費を変えない', () => {
  const p = payroll('近藤', { paymentAmount: 202005, reimbursement: 8150, salaryTransport: 12000 });
  const [r] = calculateGrossProfit([p], [billing('近藤', 'O1', 427728, { paymentAmount: 202005, nonTaxableAmount: 8150, reimbursementAmount: 8150 })]);
  assert.equal(r.salaryTransport, 12000);
});
