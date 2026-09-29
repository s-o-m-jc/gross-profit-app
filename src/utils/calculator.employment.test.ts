/**
 * 雇保(会社負担の計算値)と行ごとの交通費(税抜)のテスト(npm test)。
 * 2026-09-29: 社保他内訳の「雇保」に本人負担(給与からの控除額)が表示されていた不具合の修正と、
 * 交通費(税抜)を行ごとの値(大阪・松山=請求交通費、四国=給与の支給交通費)で持つ変更の再発防止。
 * 実データ例: 大阪2024-06 浅田 香奈代さん(総支給262,932円、本人の雇用保険1,578円、社保負担額41,809円、
 * 元Excelの雇保 (給与+交通費)×0.95% = 2,497.854)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGrossProfit } from './calculator';
import type { BillingRow, PayrollRow } from '../types';

const billing = (month: string, staffNo: string, orderNo: string, paymentAmount: number, socialInsuranceBilling: number, billingTransport = 0): BillingRow => ({
  billingNo: `B${orderNo}`, targetMonth: month, staffNo, staffName: staffNo, clientCode: 'C', clientName: 'C', orderNo, orderName: orderNo,
  billingAmountExTax: 400000, paymentAmount, socialInsuranceBilling, paidLeaveDaysUsed: 0, billingTransport, referralFee: 0, workHours: 0, unitPrice: 0,
});
const payroll = (month: string, staffNo: string, p: Partial<PayrollRow>) =>
  ({ targetMonth: month, staffNo, staffName: staffNo, paymentAmount: 0, socialInsurance: 0, employmentInsurance: 0, parkingFee: 0, salaryTransport: 0, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 0, regularHours: 0, ...p }) as PayrollRow;

test('雇保は会社負担(支払額×事業主料率)。社保負担額と粗利は変わらない', () => {
  const [r] = calculateGrossProfit(
    [payroll('2024-06', 'S1', { paymentAmount: 262932, employmentInsurance: 1578, salaryTransport: 19020 })],
    [billing('2024-06', 'S1', 'O1', 262932, 41809)]
  );
  assert.equal(r.employmentInsurance, 2498); // 262,932 × 0.95% = 2,497.854 → 2,498
  assert.equal(r.socialInsurance, 41809); // 粗利計算に使う社保負担額(会社負担)はそのまま
  assert.equal(r.socialInsurance - r.employmentInsurance, 39311); // 画面の「社保」= 元Excelの社保 39,311.146
  assert.equal(r.grossProfitExTax, 400000 - 262932 - 41809);
});

test('料率は2025-04から0.9%', () => {
  const [r] = calculateGrossProfit([payroll('2025-06', 'S1', { employmentInsurance: 1800 })], [billing('2025-06', 'S1', 'O1', 326908, 48137)]);
  assert.equal(r.employmentInsurance, 2942); // 元Excel(2025-06): ROUND(326,908 × 0.009) = 2,942
});

test('本人の雇用保険が0円(未加入)、または給与データが無い場合は雇保0円', () => {
  const res = calculateGrossProfit(
    [payroll('2024-06', 'S1', { employmentInsurance: 0 })],
    [billing('2024-06', 'S1', 'O1', 123200, 0), billing('2024-06', 'S2', 'O2', 100000, 0)]
  );
  assert.equal(res.find((r) => r.staffNo === 'S1')!.employmentInsurance, 0);
  assert.equal(res.find((r) => r.staffNo === 'S2')!.employmentInsurance, 0);
});

test('交通費(税抜)の行ごとの値: billing=請求交通費、payroll=支給交通費をスタッフ×月の最初の行にだけ', () => {
  const payrolls = [payroll('2024-01', 'S1', { paidTransport: 8040 })];
  const billings = [billing('2024-01', 'S1', 'O1', 100000, 0, 500), billing('2024-01', 'S1', 'O2', 50000, 0, 300)];
  const byBilling = calculateGrossProfit(payrolls, billings);
  assert.deepEqual(byBilling.map((r) => r.transportExTax), [500, 300]);
  const byPayroll = calculateGrossProfit(payrolls, billings, [], [], 0.1, [], [], [], [], [], 'payroll');
  assert.deepEqual(byPayroll.map((r) => r.transportExTax).sort(), [0, 8040]);
});

test('支給交通費(paidTransport)が無い給与データはsalaryTransportを使う(給与CSVで取り込んだ月)', () => {
  const res = calculateGrossProfit([payroll('2023-10', 'S1', { salaryTransport: 4000 })], [billing('2023-10', 'S1', 'O1', 100000, 0)], [], [], 0.1, [], [], [], [], [], 'payroll');
  assert.equal(res[0].transportExTax, 4000);
});

test('雇保の対象額は給与データの雇用保険対象額(同月複数契約は支払額の比で按分)', () => {
  // 実データ例: 2024-10 山本 涼子さん。元Excelは (給与+交通費−5,048)×0.95% と対象外の額を手で差し引いていた
  const [r] = calculateGrossProfit([payroll('2024-10', 'S1', { employmentInsurance: 1460, employmentInsuranceBase: 243374 })], [billing('2024-10', 'S1', 'O1', 248422, 40000)]);
  assert.equal(r.employmentInsurance, Math.round(243374 * 0.0095));
  const two = calculateGrossProfit([payroll('2024-10', 'S2', { employmentInsurance: 900, employmentInsuranceBase: 150000 })], [billing('2024-10', 'S2', 'A', 100000, 20000), billing('2024-10', 'S2', 'B', 60000, 10000)]);
  assert.deepEqual(two.map((r) => r.employmentInsurance).sort((a, b) => a - b), [Math.round(56250 * 0.0095), Math.round(93750 * 0.0095)]);
});

test('雇保は社保負担額を超えない(雇用保険のみ加入で社保負担額=雇保のスタッフ)', () => {
  const [r] = calculateGrossProfit([payroll('2023-09', 'S1', { employmentInsurance: 897 })], [billing('2023-09', 'S1', 'O1', 149600, 1421)]);
  assert.equal(r.employmentInsurance, 1421); // 149,600 × 0.95% = 1,421.2 → 1,421(上限=社保負担額)
  assert.equal(r.socialInsurance - r.employmentInsurance, 0);
});
