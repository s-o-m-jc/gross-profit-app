/**
 * 四国の勤怠明細票(未払計上表)から、売上実績一覧表で取り込んだ給与行へ勤怠を補う処理のテスト(npm test)。
 * 2026-10-01: 勤怠明細票を取り込むと「データが1件も抽出できませんでした」になる不具合への対応。
 * 金額・支払＠は既存の値のまま、日数・時間・基本給だけが入ることを確認する。
 * 実データ例: 四国2024-06 村松 海音さん(支払167,186円、社保他29,129円、支払＠1,215円、支給交通費−30円、
 * 未払計上表は出勤18日・有給1日・時間内134.5時間・基本163,418円、社保は本人負担28,256円)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeShikokuAttendanceDetail } from './excelImport';
import { calculateGrossProfit } from './calculator';
import type { BillingRow, PayrollRow } from '../types';

const SUMMARY_REMARKS = '過去実績Excel(売上実績一覧表)取込み: 給与の時間内訳データなし(支払＠を単価として直接反映)';
const M = '2024-06';

const summaryRow = (staffNo: string, p: Partial<PayrollRow> = {}) =>
  ({
    targetMonth: M, staffNo, staffName: staffNo, paymentAmount: 167186, socialInsurance: 29129, employmentInsurance: 0, parkingFee: 0,
    salaryTransport: 0, paidTransport: -30, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 1215, regularHours: 1, remarks: SUMMARY_REMARKS, ...p,
  }) as PayrollRow;
const attendanceRow = (staffNo: string, p: Partial<PayrollRow> = {}) =>
  ({
    targetMonth: M, staffNo, staffName: staffNo, paymentAmount: 176299, socialInsurance: 28256, employmentInsurance: 1058, parkingFee: 500,
    salaryTransport: -30, paidTransport: -30, paidLeaveAllowance: 9113, paidLeaveDays: 1, regularAmount: 163418, regularHours: 134.5,
    workDays: 18, overtimeHours: 2.5, ...p,
  }) as PayrollRow;
const billing = (staffNo: string): BillingRow => ({
  billingNo: `B${staffNo}`, targetMonth: M, staffNo, staffName: staffNo, clientCode: 'C', clientName: 'C', orderNo: `B${staffNo}`, orderName: '',
  billingAmountExTax: 244972, paymentAmount: 167186, socialInsuranceBilling: 29129, paidLeaveDaysUsed: 0, billingTransport: 0, referralFee: 0, workHours: 0, unitPrice: 1780,
});

test('勤怠(日数・時間)と基本給だけが入り、金額・支払＠は既存の値のまま', () => {
  const r = mergeShikokuAttendanceDetail([summaryRow('12600')], [attendanceRow('12600')], M);
  assert.equal(r.mergedCount, 1);
  const p = r.payrollRows[0];
  assert.equal(p.workDays, 18);
  assert.equal(p.paidLeaveDays, 1);
  assert.equal(p.regularHours, 134.5);
  assert.equal(p.overtimeHours, 2.5);
  assert.equal(p.regularAmount, 163418);
  assert.equal(p.payUnitPrice, 1215); // 補完前の regularAmount ÷ regularHours
  assert.equal(p.paymentAmount, 167186);
  assert.equal(p.socialInsurance, 29129);
  assert.equal(p.employmentInsurance, 0);
  assert.equal(p.parkingFee, 0);
  assert.equal(p.salaryTransport, 0);
  assert.equal(p.paidTransport, -30);
  assert.equal(p.paidLeaveAllowance, 0);
});

test('補完の前後で粗利・支払＠・交通費(税抜)が変わらない', () => {
  const before = [summaryRow('12600')];
  const after = mergeShikokuAttendanceDetail(before, [attendanceRow('12600')], M).payrollRows;
  const calc = (rows: PayrollRow[]) =>
    calculateGrossProfit(rows, [billing('12600')], [], [], undefined, [], [], [], [], [], 'payroll')[0];
  const a = calc(before);
  const b = calc(after);
  assert.equal(b.grossProfitExTax, a.grossProfitExTax);
  assert.equal(b.payUnitPrice, 1215);
  assert.equal(b.transportExTax, -30);
  assert.equal(b.socialInsurance, a.socialInsurance);
  assert.equal(b.paidLeaveDays, 1);
});

test('売上実績一覧表以外から取り込んだ行(既に勤怠あり)は変えない', () => {
  const detailed = attendanceRow('100', { remarks: undefined });
  const r = mergeShikokuAttendanceDetail([detailed], [attendanceRow('100', { workDays: 99 })], M);
  assert.equal(r.mergedCount, 0);
  assert.equal(r.payrollRows[0], detailed);
});

test('未払計上表にしかいないスタッフは追加せず警告、他の月の行は触らない', () => {
  const other = summaryRow('12600', { targetMonth: '2024-05' });
  const r = mergeShikokuAttendanceDetail([summaryRow('12600'), other], [attendanceRow('12600'), attendanceRow('999')], M);
  assert.equal(r.payrollRows.length, 2);
  assert.equal(r.payrollRows[1], other);
  assert.ok(r.warnings.some((w) => w.includes('999') && w.includes('追加しなかった')));
});
