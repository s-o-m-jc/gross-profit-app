/**
 * 請求書印刷データ(大阪は「請求書（スタナビ）」シート)と請求データの結合の回帰テスト。
 * 実行: npm test
 *
 * 2026-09-29: 大阪の全データを元Excelと突合した結果、請求＠の約3割・請求交通費の約3.5割が
 * 不一致だった不具合(合算請求で請求Noが複数スタッフに共有され、Mapの後勝ちで別スタッフの単価を
 * 拾っていた/請求支払シートに交通費列が無く請求交通費が常に0だった)の再発防止。
 * 実データ例(2024-06 大和冷機工業 請求No 20004975、アサヒ衛陶 浅田 香奈代さん)を元にしている。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGrossProfit } from './calculator';
import type { BillingRow, InvoicePrintRow, PayrollRow } from '../types';

const M = '2024-06';

const billing = (staffNo: string, orderNo: string, billingNo: string, amount: number, transport = 0): BillingRow => ({
  billingNo,
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
  billingTransport: transport,
  referralFee: 0,
  workHours: 0,
  unitPrice: 0,
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

const byStaff = (results: ReturnType<typeof calculateGrossProfit>, staffNo: string) => {
  const r = results.find((x) => x.staffNo === staffNo);
  assert.ok(r, `staff ${staffNo} not found`);
  return r;
};

test('合算請求(1つの請求Noに複数スタッフ)でも受注番号で各スタッフ自身の請求＠を取る', () => {
  const billings = [
    billing('20006502', '22274202', '20004975', 304920),
    billing('20008036', '22272305', '20004975', 123200),
    billing('20012201', '22274001', '20004975', 105600),
  ];
  const invoices = [
    invoice({ billingNo: '20004975', orderNo: '22274202', staffNo: '20006502', unitPrice: 1980 }),
    invoice({ billingNo: '20004975', orderNo: '22272305', staffNo: '20008036', unitPrice: 2200 }),
    invoice({ billingNo: '20004975', orderNo: '22274001', staffNo: '20012201', unitPrice: 2200 }),
  ];
  const results = calculateGrossProfit([], billings, invoices);
  assert.equal(byStaff(results, '20006502').billingUnitPrice, 1980);
  assert.equal(byStaff(results, '20008036').billingUnitPrice, 2200);
});

test('受注番号が無い場合は請求No+スタッフ番号で結合し、曖昧な請求Noだけの結合はしない', () => {
  const b1 = { ...billing('S1', '', 'B1', 100000) };
  const b2 = { ...billing('S2', '', 'B1', 100000) };
  const invoices = [
    invoice({ billingNo: 'B1', staffNo: 'S1', unitPrice: 1500 }),
    invoice({ billingNo: 'B1', unitPrice: 9999 }), // スタッフ番号も受注番号も無い行(どのスタッフか特定できない)
  ];
  const results = calculateGrossProfit([], [b1, b2], invoices);
  assert.equal(byStaff(results, 'S1').billingUnitPrice, 1500);
  assert.equal(byStaff(results, 'S2').billingUnitPrice, 0);
});

test('請求Noがその月に1件しか無ければ請求Noだけで結合する(従来の請求書印刷CSV)', () => {
  const results = calculateGrossProfit([], [billing('S1', '', 'B9', 100000)], [invoice({ billingNo: 'B9', unitPrice: 1700 })]);
  assert.equal(byStaff(results, 'S1').billingUnitPrice, 1700);
});

test('請求データに交通費が無ければ請求書行の交通費(税抜)で補う。請求データ側の値があればそちらを優先', () => {
  const billings = [
    billing('20010672', '22631111', '20004967', 351416),
    billing('S2', 'O2', 'B2', 200000, 5000),
  ];
  const invoices = [
    invoice({ billingNo: '20004967', orderNo: '22631111', staffNo: '20010672', unitPrice: 2000, transportAmount: 17291 }),
    invoice({ billingNo: 'B2', orderNo: 'O2', staffNo: 'S2', unitPrice: 1800, transportAmount: 7777 }),
  ];
  const results = calculateGrossProfit([], billings, invoices);
  assert.equal(byStaff(results, '20010672').billingTransport, 17291);
  assert.equal(byStaff(results, 'S2').billingTransport, 5000);
});

test('支払＠は円単位に丸める(時間の実数換算による端数を出さない)', () => {
  const payroll = {
    targetMonth: M,
    staffNo: '20010672',
    staffName: '浅田 香奈代',
    regularAmount: 231289,
    regularHours: 6.600694444444445 * 24,
  } as unknown as PayrollRow;
  const results = calculateGrossProfit([payroll], [billing('20010672', '22631111', '20004967', 351416)], []);
  assert.equal(byStaff(results, '20010672').payUnitPrice, 1460);
});
