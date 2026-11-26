/**
 * 松山のCSV直接取込みの規則のテスト(npm test)。ダミーのCSV・行だけを使う(実データは使わない)。
 * 2026-11-26: ①の交通費の列(拠点ごと)、③の交通費+課税１、受注が分かれた契約のまとめ、立替金、④の請求書ごとの消費税。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayrollCsv, parseInvoicePrintCsv } from './csvParser';
import { PAYROLL_TRANSPORT_COLUMNS } from '../config/payrollColumns';
import { parseInvoiceListCsv, applyMatsuyamaCsvRules, normalizeDate } from './matsuyamaCsvImport';
import { calculateGrossProfit } from './calculator';
import { BillingRow, InvoicePrintRow, PayrollRow } from '../types';

const head = (cols: string[]) => cols.join(',');

test('①の交通費: 松山は31列目「交通費」+46列目「非課税他１」を読む。設定の無い拠点は今までの読み方のまま', () => {
  const matsuyama = `${head(['スタッフ番号', '総支給額', '交通費', '課税他２', '非課税他１', '非課税他２', '立替金', '支払日'])}\n30000001,210000,1000,0,5000,0,0,2026/08/14\n`;
  const [m] = parsePayrollCsv(matsuyama, 'a.csv', { transportColumns: PAYROLL_TRANSPORT_COLUMNS.matsuyama });
  assert.equal(m.salaryTransport, 6000);
  assert.equal(m.paidTransport, 6000);
  assert.equal(m.transport2Amount, 5000);
  // 設定を渡さない(今までの読み方)と「非課税他１」は読まない
  assert.equal(parsePayrollCsv(matsuyama, 'a.csv')[0].salaryTransport, 1000);
  // 大阪・四国の形(「交通費」が2つ)は設定が無いので、今までどおり2つを合計する
  assert.equal(PAYROLL_TRANSPORT_COLUMNS.osaka, undefined);
  assert.equal(PAYROLL_TRANSPORT_COLUMNS.shikoku, undefined);
  const osaka = `${head(['スタッフ番号', '総支給額', '交通費', '駐車場代', '交通費課税', '交通費', '通信費', '支払日'])}\n20000001,210000,1000,0,0,3000,0,2026/08/14\n`;
  const [o] = parsePayrollCsv(osaka, 'b.csv', { transportColumns: PAYROLL_TRANSPORT_COLUMNS.osaka });
  assert.equal(o.salaryTransport, 4000);
  assert.equal(o.transport2Amount, 3000);
  // 松山のExcel(未払計上表の見出し「交通費1」「交通費2」)も、設定の候補で同じ値になる
  const excelStyle = `${head(['スタッフ番号', '総支給額', '交通費1', '交通費課税', '交通費2', '支給日'])}\n30000001,210000,0,0,5000,2026/08/14\n`;
  assert.equal(parsePayrollCsv(excelStyle, 'c.csv', { transportColumns: PAYROLL_TRANSPORT_COLUMNS.matsuyama })[0].salaryTransport, 5000);
  assert.equal(parsePayrollCsv(excelStyle, 'c.csv')[0].salaryTransport, 5000);
});

test('①の交通費の列が見つからないとき、「交通費課税」を交通費として読まない', () => {
  const csv = `${head(['スタッフ番号', '総支給額', '交通費課税', '支払日'])}\n30000001,210000,7000,2026/08/14\n`;
  assert.equal(parsePayrollCsv(csv, 'a.csv')[0].salaryTransport, 0);
});

test('③の課税１－金額と小計を読む', () => {
  const csv = `${head(['クライアント番号', '受注番号', 'スタッフ番号', '時間内－単価', '交通費－金額', '課税１－金額', '非課税１－金額', '小計', '請求番号'])}\n30000010,31000001,30000001,2000,100,613,0,160713,30007001\n`;
  const [i] = parseInvoicePrintCsv(csv, 'x.csv');
  assert.equal(i.taxable1Amount, 613);
  assert.equal(i.subtotal, 160713);
  assert.equal(i.transportAmount, 100);
});

test('④請求一覧CSVを読む(請求日はスラッシュ・ハイフン・Excelのシリアル値)', () => {
  const csv = `${head(['ｸﾗｲｱﾝﾄ番号', '請求先部署番号', 'クライアント名', '請求先部署名', '請求日', '請求No', '売上(課税)', '売上(非課税)', '消費税', '請求合計額'])}
30000010,1,A,B,2026/07/31,30007001,1000,-10,100,1090
,,,,,,,,,
`;
  const rows = parseInvoiceListCsv(csv);
  assert.deepEqual(rows, [
    { billingNo: '30007001', invoiceDate: '2026-07-31', taxableAmount: 1000, nonTaxableAmount: -10, consumptionTax: 100, totalAmount: 1090 },
  ]);
  assert.equal(normalizeDate('2026-7-5'), '2026-07-05');
  assert.equal(normalizeDate(46234), '2026-07-31');
});

const bill = (o: Partial<BillingRow>): BillingRow =>
  ({
    billingNo: '30007001',
    targetMonth: '2026-07',
    staffNo: '30000001',
    staffName: 'テスト',
    clientCode: '30000010',
    clientName: 'テスト社',
    orderNo: '31000001',
    orderName: '事務',
    billingAmountExTax: 0,
    paymentAmount: 0,
    socialInsuranceBilling: 0,
    paidLeaveDaysUsed: 0,
    billingTransport: 0,
    referralFee: 0,
    workHours: 0,
    unitPrice: 0,
    ...o,
  }) as BillingRow;
const inv = (o: Partial<InvoicePrintRow>): InvoicePrintRow =>
  ({ billingNo: '30007001', targetMonth: '2026-07', invoiceIssueDate: '', paymentDueDate: '', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 1900, ...o }) as InvoicePrintRow;
const pay = (o: Partial<PayrollRow>): PayrollRow => ({ targetMonth: '2026-07', staffNo: '30000001', paymentAmount: 0, socialInsurance: 0, ...o }) as PayrollRow;

test('受注番号が分かれた同じ契約(支払額のある行が1つ)を1行にまとめ、交通費は③の交通費+課税１の合計', () => {
  const billings = [
    bill({ orderNo: '31000001', orderName: '事務', billingAmountExTax: 108142, paymentAmount: 0 }),
    bill({ orderNo: '31000002', orderName: '事務(新)', billingAmountExTax: 180737, paymentAmount: 239462, socialInsuranceBilling: 30000, paidLeaveDaysUsed: 1.5 }),
  ];
  const invoices = [
    inv({ orderNo: '31000001', staffNo: '30000001', transportAmount: 2455, taxable1Amount: 0, nonTaxableAmount: 0 }),
    inv({ orderNo: '31000002', staffNo: '30000001', transportAmount: 0, taxable1Amount: 613, nonTaxableAmount: 0 }),
  ];
  const r = applyMatsuyamaCsvRules([pay({ paymentAmount: 239462 })], billings, invoices);
  assert.equal(r.billingRows.length, 1);
  const [b] = r.billingRows;
  assert.equal(b.orderNo, '31000002'); // 支払額のある行の受注番号を残す
  assert.equal(b.orderName, '事務(新)');
  assert.equal(b.billingAmountExTax, 288879);
  assert.equal(b.paymentAmount, 239462);
  assert.equal(b.socialInsuranceBilling, 30000);
  assert.equal(b.paidLeaveDaysUsed, 1.5);
  assert.equal(b.billingTransport, 2455 + 613);
  assert.deepEqual(r.mergedGroups, [{ staffNo: '30000001', billingNo: '30007001', orderNos: ['31000001', '31000002'] }]);
  // ③の交通費も、課税１を含めた額にする
  assert.deepEqual(r.invoiceRows.map((i) => i.transportAmount), [2455, 613]);
});

test('支払額のある行が2つ以上なら、まとめない', () => {
  const billings = [
    bill({ orderNo: '31000001', billingAmountExTax: 100, paymentAmount: 50 }),
    bill({ orderNo: '31000002', billingAmountExTax: 200, paymentAmount: 80 }),
  ];
  const r = applyMatsuyamaCsvRules([], billings, []);
  assert.equal(r.billingRows.length, 2);
  assert.equal(r.mergedGroups.length, 0);
});

test('立替金: ①の立替金の欄と同額の③の非課税だけを立替金にし、①の交通費の枠とは比べない', () => {
  const invoices = [
    inv({ orderNo: '31000001', staffNo: '30000001', nonTaxableAmount: 5000 }),
    inv({ billingNo: '30007002', orderNo: '31000002', staffNo: '30000002', nonTaxableAmount: 4000 }),
  ];
  const billings = [
    bill({ orderNo: '31000001', billingAmountExTax: 105000, paymentAmount: 80000 }),
    bill({ billingNo: '30007002', staffNo: '30000002', orderNo: '31000002', billingAmountExTax: 104000, paymentAmount: 80000 }),
  ];
  const payrolls = [
    pay({ staffNo: '30000001', reimbursement: 5000 }),
    // 交通費の枠(非課税他１)が同額でも、立替金にはしない
    pay({ staffNo: '30000002', reimbursement: 0, salaryTransport: 4000, transport2Amount: 4000 }),
  ];
  const r = applyMatsuyamaCsvRules(payrolls, billings, invoices);
  assert.deepEqual(
    r.billingRows.map((b) => [b.nonTaxableAmount, b.reimbursementAmount]),
    [[5000, 5000], [4000, undefined]]
  );
});

test('④の請求書ごとの消費税を、課税額の比で行に分ける(端数は課税額が一番大きい行)。④が無ければ税込額は付けない', () => {
  const billings = [
    bill({ staffNo: '30000001', orderNo: '31000001', billingAmountExTax: 100001 }),
    bill({ staffNo: '30000002', orderNo: '31000002', billingAmountExTax: 200002 }),
    bill({ staffNo: '30000003', orderNo: '31000003', billingAmountExTax: 50000 }),
  ];
  const invoices = [
    inv({ orderNo: '31000001', nonTaxableAmount: 0 }),
    inv({ orderNo: '31000002', nonTaxableAmount: -3970 }),
    inv({ orderNo: '31000003', nonTaxableAmount: 0 }),
  ];
  // 課税額(請求額−非課税): 100,001 / 203,972 / 50,000(合計353,973)。消費税は④の実額35,375(小計から計算した額35,397より少ない例)
  const list = [{ billingNo: '30007001', invoiceDate: '2026-07-31', taxableAmount: 353973, nonTaxableAmount: -3970, consumptionTax: 35375, totalAmount: 385378 }];
  const r = applyMatsuyamaCsvRules([], billings, invoices, list);
  const taxes = r.billingRows.map((b) => (b.billingAmountIncTax || 0) - b.billingAmountExTax);
  assert.equal(taxes.reduce((s, v) => s + v, 0), 35375);
  const floors = [100001, 203972, 50000].map((t) => Math.floor((35375 * t) / 353973));
  assert.deepEqual(taxes, [floors[0], 35375 - floors[0] - floors[2], floors[2]]);
  // 請求行の税込額の合計 = ④の請求合計額
  assert.equal(r.billingRows.reduce((s, b) => s + (b.billingAmountIncTax || 0), 0), 385378);
  // 計算(calculator.ts)はこの税込額をそのまま使う
  const results = calculateGrossProfit([], r.billingRows, r.invoiceRows);
  assert.equal(results.reduce((s, x) => s + x.billingAmountIncTax, 0), 385378);
  // ④が無ければ税込額は付けない(今までの計算)
  assert.ok(applyMatsuyamaCsvRules([], billings, invoices).billingRows.every((b) => b.billingAmountIncTax === undefined));
  // ④に無い請求書は警告して今までの計算
  const other = applyMatsuyamaCsvRules([], billings, invoices, [{ ...list[0], billingNo: '39999999' }]);
  assert.ok(other.warnings.some((w) => w.includes('30007001')));
  assert.ok(other.billingRows.every((b) => b.billingAmountIncTax === undefined));
});

test('立替金のある行の税込額は、立替金を除いた額にする(売上から除くため)', () => {
  const r = applyMatsuyamaCsvRules(
    [pay({ reimbursement: 5000 })],
    [bill({ orderNo: '31000001', billingAmountExTax: 105000, paymentAmount: 85000 })],
    [inv({ orderNo: '31000001', nonTaxableAmount: 5000 })],
    [{ billingNo: '30007001', invoiceDate: '2026-07-31', taxableAmount: 100000, nonTaxableAmount: 5000, consumptionTax: 10000, totalAmount: 115000 }]
  );
  const [res] = calculateGrossProfit([pay({ paymentAmount: 85000, reimbursement: 5000 })], r.billingRows, r.invoiceRows);
  assert.equal(res.billingAmountExTax, 100000);
  assert.equal(res.billingAmountIncTax, 110000);
  assert.equal(res.paymentAmount, 80000);
});

test('計算: 同じ契約の重複行をまとめるとき、税込額を持つ行は税込額も合計する(持たない行は今までどおり)', () => {
  const rows = [
    bill({ orderNo: '31000001', orderName: '事務', billingAmountExTax: 1000, billingAmountIncTax: 1099 }),
    bill({ orderNo: '31000002', orderName: '事務', billingAmountExTax: 2000, billingAmountIncTax: 2199 }),
  ];
  assert.equal(calculateGrossProfit([], rows)[0].billingAmountIncTax, 3298);
  const plain = rows.map(({ billingAmountIncTax: _x, ...r }) => r as BillingRow);
  assert.equal(calculateGrossProfit([], plain)[0].billingAmountIncTax, 3300);
});
