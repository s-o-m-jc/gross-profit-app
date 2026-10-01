/**
 * 社保負担額の差異・交通費不一致アラートのテスト(npm test)。
 * 2026-10-01: 監査アラートの見直し。以前は契約の行ごとに「給与の社保合計+雇用保険(本人負担、雇用保険を二重計上)」
 * 「税込の支給交通費 vs 税抜の請求交通費」と比べていたため、大阪862件・松山96件の社保差異、
 * 大阪1,308件・松山2,580件の交通費不一致のほぼすべてが見かけ上の差だった。
 * 実データ例: 大阪 則永 明美さん(恵和テック) 支給8,160円・請求7,418円(=8,160÷1.1)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGrossProfit } from './calculator';
import type { BillingRow, PayrollRow } from '../types';

const M = '2024-06';
const billing = (staffNo: string, orderNo: string, p: Partial<BillingRow> = {}): BillingRow => ({
  billingNo: `B${orderNo}`, targetMonth: M, staffNo, staffName: staffNo, clientCode: 'C', clientName: 'C', orderNo, orderName: orderNo,
  billingAmountExTax: 300000, paymentAmount: 200000, socialInsuranceBilling: 0, paidLeaveDaysUsed: 0, billingTransport: 0, referralFee: 0, workHours: 0, unitPrice: 0, ...p,
});
const payroll = (staffNo: string, p: Partial<PayrollRow>) =>
  ({ targetMonth: M, staffNo, staffName: staffNo, paymentAmount: 200000, socialInsurance: 0, employmentInsurance: 0, parkingFee: 0, salaryTransport: 0, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 0, regularHours: 0, ...p }) as PayrollRow;
const has = (r: any, type: string) => r.alerts.some((a: any) => a.type === type);
const calc = (p: PayrollRow[], b: BillingRow[], rates: any[] = []) =>
  calculateGrossProfit(p, b, [], [], 0.1, [], [], [], [], [], 'billing', rates);

test('社保: 会社負担(本人の健保・年金 + 会社の雇用保険)と一致すればアラートなし', () => {
  // 本人: 健保10,000+年金18,300+雇用保険1,200 = 社保合計29,500。会社の雇用保険 200,000×0.95% = 1,900
  const p = payroll('1', { socialInsurance: 29500, employmentInsurance: 1200 });
  const ok = calc([p], [billing('1', 'o1', { socialInsuranceBilling: 28300 + 1900 })]);
  assert.equal(has(ok[0], 'SOCIAL_INSURANCE_MISMATCH'), false);
  // 入社月分を翌月にまとめて控除した月(本人分が2ヶ月分)は差として残る
  const ng = calc([payroll('1', { socialInsurance: 28300 * 2 + 1200, employmentInsurance: 1200 })], [billing('1', 'o1', { socialInsuranceBilling: 30200 })]);
  assert.equal(has(ng[0], 'SOCIAL_INSURANCE_MISMATCH'), true);
});

test('社保: 松山は労災保険料(総支給×率)を含めて比べる', () => {
  const p = payroll('1', { socialInsurance: 29500, employmentInsurance: 1200 });
  const b = [billing('1', 'o1', { socialInsuranceBilling: 28300 + 1900 + 600 })];
  assert.equal(has(calc([p], b)[0], 'SOCIAL_INSURANCE_MISMATCH'), true);
  assert.equal(has(calc([p], b, [{ from: '2000-01', rate: 0.003 }])[0], 'SOCIAL_INSURANCE_MISMATCH'), false);
});

test('社保・交通費: 同月複数契約はスタッフ合計で比べ、アラートは最初の行だけ', () => {
  const p = payroll('1', { socialInsurance: 29500, employmentInsurance: 1200, salaryTransport: 11000 });
  const r = calc([p], [
    billing('1', 'o1', { socialInsuranceBilling: 15000, billingTransport: 6000 }),
    billing('1', 'o2', { socialInsuranceBilling: 15200, billingTransport: 4000 }),
  ]);
  assert.equal(r.filter((x) => has(x, 'SOCIAL_INSURANCE_MISMATCH')).length, 0);
  assert.equal(r.filter((x) => has(x, 'TRANSPORT_MISMATCH')).length, 0);
  assert.deepEqual(r.map((x) => x.transportDiff), [0, 0]);
});

test('交通費: 税抜換算(支給÷1.1)または支給額そのものの請求は一致、それ以外は最初の行に差額', () => {
  assert.equal(calc([payroll('1', { salaryTransport: 8160 })], [billing('1', 'o1', { billingTransport: 7418 })])[0].transportDiff, 0);
  assert.equal(calc([payroll('1', { salaryTransport: 2000 })], [billing('1', 'o1', { billingTransport: 2000 })])[0].transportDiff, 0);
  const r = calc([payroll('1', { salaryTransport: 9500 })], [billing('1', 'o1', { billingTransport: 8273 })])[0];
  assert.equal(r.transportDiff, 363); // 9,500÷1.1=8,636 − 8,273
  assert.equal(r.transportStatus, 'UNDER_BILLED');
});

test('交通費: 一度も交通費を請求していない契約は対象外(NOT_BILLED_CONTRACT)', () => {
  const p = [payroll('1', { salaryTransport: 5000 }), { ...payroll('1', { salaryTransport: 5000 }), targetMonth: '2024-07' }];
  const r = calc(p, [billing('1', 'o1'), { ...billing('1', 'o2'), targetMonth: '2024-07' }, billing('2', 'o3', { billingTransport: 1000 })]);
  const staff1 = r.filter((x) => x.staffNo === '1');
  assert.ok(staff1.every((x) => x.transportStatus === 'NOT_BILLED_CONTRACT' && x.transportDiff === 0 && !has(x, 'TRANSPORT_MISMATCH')));
});

test('交通費: 他の月は請求している契約で、この月だけ請求0なら請求漏れ疑い', () => {
  const p = [payroll('1', { salaryTransport: 2700 }), { ...payroll('1', { salaryTransport: 2700 }), targetMonth: '2024-07' }];
  const r = calc(p, [billing('1', 'o1', { billingTransport: 2455 }), { ...billing('1', 'o2'), targetMonth: '2024-07' }]);
  const jul = r.find((x) => x.targetMonth === '2024-07')!;
  assert.equal(jul.transportDiff, 2455);
  assert.equal(has(jul, 'TRANSPORT_MISMATCH'), true);
});
