/**
 * 松山の請求＠・支払＠(請求支払一覧の副表)と、再発防止のアラート(支払額の不一致・単価の急変)のテスト(npm test)。
 * 2026-10-06: はまさんの指摘。松山2026-02 田中 亜莉紗さんの請求＠が別スタッフの行の1,600円になっていた(正しくは2,000円)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatsuyamaUnitPrices } from './excelImport';
import { calculateGrossProfit } from './calculator';
import type { BillingRow, PayrollRow } from '../types';

const bill = (staffNo: string, clientCode: string, p: Partial<BillingRow> = {}): BillingRow => ({
  billingNo: `B${staffNo}${clientCode}`, targetMonth: '2026-02', staffNo, staffName: staffNo, clientCode, clientName: clientCode, orderNo: `O${staffNo}`, orderName: '',
  billingAmountExTax: 69500, paymentAmount: 53465, socialInsuranceBilling: 642, paidLeaveDaysUsed: 0, billingTransport: 0, referralFee: 0, workHours: 0, unitPrice: 0, ...p,
});

// 請求支払一覧の16行目以降(左の請求一覧と右の副表は行が対応しない)
const HEADER = ['請求No', 'クライアント番号', 'スタッフNo', '請求額', '', 'ｸﾗｲｱﾝﾄ番号', 'スタッフ番号', '請求単価', '日数', '請求交通費', '', 'ｸﾗｲｱﾝﾄ番号', 'スタッフ番号', '支給単価'];
const aoa = [
  HEADER,
  ['30006645', '30000193', '30003658', 69500, '', '30000182', '30003065', 1600, 16, 0, '', '30000005', '30003113', 1300],
  ['30006730', '30000424', '30003426', 220291, '', '30000193', '30003658', 2000, 5, 0, '', '30000193', '30003658', 1180],
  ['', '', '', '', '', '30000001', '30000009', 1700, 10, 0, '', '30000001', '30000009', 1100],
  ['', '', '', '', '', '30000001', '30000009', 1800, 10, 0, '', '30000001', '30000009', 1200],
];

test('請求＠・支払＠は副表を(クライアント番号, スタッフ番号)で引く(同じ行の値は使わない)', () => {
  const [r] = applyMatsuyamaUnitPrices(aoa, [bill('30003658', '30000193', { unitPrice: 1600 })], []);
  assert.equal(r.unitPrice, 2000);
  assert.equal(r.payUnitPrice, 1180);
});

test('月の途中で単価が変わった契約は請求＠を日数で加重平均、支払＠は給与データのまま(undefined)', () => {
  const [r] = applyMatsuyamaUnitPrices(aoa, [bill('30000009', '30000001')], []);
  assert.equal(r.unitPrice, 1750);
  assert.equal(r.payUnitPrice, undefined);
});

test('副表に無い契約は0(不明)にして警告', () => {
  const w: string[] = [];
  const [r] = applyMatsuyamaUnitPrices(aoa, [bill('99999999', '30000193', { unitPrice: 1600 })], w);
  assert.equal(r.unitPrice, 0);
  assert.equal(w.length, 1);
});

const payroll = (p: Partial<PayrollRow> = {}) =>
  ({
    targetMonth: '2026-02', staffNo: 'S', staffName: 'S', paymentAmount: 43230, socialInsurance: 238, employmentInsurance: 238, parkingFee: 0,
    salaryTransport: 2225, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 41005, regularHours: 34.75, ...p,
  }) as PayrollRow;
const calc = (payrolls: PayrollRow[], billings: BillingRow[]) => calculateGrossProfit(payrolls, billings, [], [], undefined, [], [], [], [], [], 'billing');
const has = (r: { alerts: { type: string }[] }, t: string) => r.alerts.some((a) => a.type === t);

test('請求データの支払額と給与の総支給額の不一致に警告(立替金を除いて一致すれば警告しない)', () => {
  // 田中さん: 請求データの支払額53,465円(交通費満額12,460円) / 総支給43,230円(交通費は日割り2,225円)
  assert.ok(has(calc([payroll()], [bill('S', 'C')])[0], 'PAYMENT_MISMATCH'));
  // 山地さん(四国2023-10): 総支給277,771円に立替金9,100円、請求データの支払額は除いた268,671円
  const p = payroll({ paymentAmount: 277771, reimbursement: 9100 });
  assert.ok(!has(calc([p], [bill('S', 'C', { paymentAmount: 268671 })])[0], 'PAYMENT_MISMATCH'));
  assert.ok(!has(calc([payroll()], [bill('S', 'C', { paymentAmount: 43230 })])[0], 'PAYMENT_MISMATCH'));
});

test('契約の請求＠・支払＠が前の月から10%超変わったら警告', () => {
  const p1 = payroll({ targetMonth: '2026-01', paymentAmount: 43230 });
  const p2 = payroll({ paymentAmount: 43230 });
  const b1 = bill('S', 'C', { targetMonth: '2026-01', billingNo: 'B1', paymentAmount: 43230, unitPrice: 2000 });
  const r = calc([p1, p2], [b1, bill('S', 'C', { billingNo: 'B2', paymentAmount: 43230, unitPrice: 1600 })]);
  assert.ok(has(r.find((x) => x.targetMonth === '2026-02')!, 'UNIT_PRICE_CHANGE'));
  const r2 = calc([p1, p2], [b1, bill('S', 'C', { billingNo: 'B2', paymentAmount: 43230, unitPrice: 2100 })]);
  assert.ok(!r2.some((x) => has(x, 'UNIT_PRICE_CHANGE')));
});
