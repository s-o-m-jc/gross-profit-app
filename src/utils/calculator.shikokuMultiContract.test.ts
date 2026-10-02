/**
 * 四国の売上実績一覧表で、同月に複数契約があるスタッフの支払＠・交通費(税抜)の契約ごとの値のテスト(npm test)。
 * 2026-10-02: はまさんの指摘。実データ例: 四国2024-05 多田羅 麻美さん(太陽サカコー 支払＠1,200円・支払の内交通費600円、
 * 大陽工機 支払＠1,100円・320円。給与行は1行で支払＠1,100円(最後の契約)、支給交通費920円)。
 * 以前は両契約とも支払＠1,100円、交通費は太陽サカコーに920円・大陽工機に0円になっていた。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGrossProfit } from './calculator';
import { mergeShikokuAttendanceDetail } from './excelImport';
import type { BillingRow, PayrollRow } from '../types';

const M = '2024-05';
const REMARKS = '過去実績Excel(売上実績一覧表)取込み: 給与の時間内訳データなし(支払＠を単価として直接反映)';

const payroll = (p: Partial<PayrollRow> = {}) =>
  ({
    targetMonth: M, staffNo: '10929', staffName: '多田羅麻美', paymentAmount: 113370, socialInsurance: 27005, employmentInsurance: 0,
    parkingFee: 0, salaryTransport: 0, paidTransport: 920, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 0, regularHours: 0,
    payUnitPrice: 1100, remarks: REMARKS, ...p,
  }) as PayrollRow;
const billing = (no: string, client: string, pay: number, payUnitPrice: number | undefined, paidTransport: number | undefined): BillingRow => ({
  billingNo: no, targetMonth: M, staffNo: '10929', staffName: '多田羅麻美', clientCode: client, clientName: client, orderNo: no, orderName: '',
  billingAmountExTax: 100000, paymentAmount: pay, socialInsuranceBilling: 0, paidLeaveDaysUsed: 0, billingTransport: 0, referralFee: 0,
  workHours: 0, unitPrice: 1750, payUnitPrice, paidTransport,
});
const calc = (payrolls: PayrollRow[], billings: BillingRow[]) =>
  calculateGrossProfit(payrolls, billings, [], [], undefined, [], [], [], [], [], 'payroll').sort((a, b) => a.billingNo.localeCompare(b.billingNo));

test('契約ごとの支払＠と交通費(目安の合計が支給交通費と一致する場合はそのまま)', () => {
  const r = calc([payroll()], [billing('S1', '太陽サカコー', 96000, 1200, 600), billing('S2', '大陽工機', 17370, 1100, 320)]);
  assert.deepEqual(r.map((x) => x.payUnitPrice), [1200, 1100]);
  assert.deepEqual(r.map((x) => x.transportExTax), [600, 320]);
});

test('目安の合計が支給交通費と違う場合は支給交通費を目安の比で按分(合計は支給交通費)', () => {
  // 実データ例: 2026-06 鎌田醤油 0円・レクザム 2,800円(契約上の額)、支給交通費1,600円
  const r = calc([payroll({ paidTransport: 1600 })], [billing('S1', '鎌田醤油', 0, 0, 0), billing('S2', 'レクザム', 60650, 1300, 2800)]);
  assert.deepEqual(r.map((x) => x.transportExTax), [0, 1600]);
  const r2 = calc([payroll({ paidTransport: 1000 })], [billing('S1', 'A', 1, 1, 100), billing('S2', 'B', 1, 1, 200)]);
  assert.deepEqual(r2.map((x) => x.transportExTax), [333, 667]);
});

test('目安が無い取込み元(給与CSV等)は従来どおり支払＠は給与データ、交通費は最初の行に全額', () => {
  const r = calc([payroll()], [billing('S1', 'A', 96000, undefined, undefined), billing('S2', 'B', 17370, undefined, undefined)]);
  assert.deepEqual(r.map((x) => x.payUnitPrice), [1100, 1100]);
  assert.deepEqual(r.map((x) => x.transportExTax), [920, 0]);
});

test('勤怠明細票の補完で控除の内訳が入り、本人負担の社保・雇用保険は表示専用の項目に入る(計算用の項目は不変)', () => {
  const attendance = {
    ...payroll(), paymentAmount: 113370, socialInsurance: 26375, employmentInsurance: 680, salaryTransport: 920, regularAmount: 112450,
    regularHours: 95, workDays: 12, healthInsurance: 8780, nursingInsurance: 1360, pensionInsurance: 15555, residentTax: 2500, totalDeduction: 28875,
    remarks: '',
  } as PayrollRow;
  const p = mergeShikokuAttendanceDetail([payroll()], [attendance], M).payrollRows[0];
  assert.equal(p.healthInsurance, 8780);
  assert.equal(p.nursingInsurance, 1360);
  assert.equal(p.pensionInsurance, 15555);
  assert.equal(p.residentTax, 2500);
  assert.equal(p.totalDeduction, 28875);
  assert.equal(p.personalSocialInsurance, 26375);
  assert.equal(p.personalEmploymentInsurance, 680);
  assert.equal(p.socialInsurance, 27005);
  assert.equal(p.employmentInsurance, 0);
  assert.equal(p.salaryTransport, 0);
  assert.equal(p.paidTransport, 920);
  assert.equal(p.payUnitPrice, 1100);
});
