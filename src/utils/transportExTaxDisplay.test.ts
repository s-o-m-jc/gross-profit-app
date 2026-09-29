/**
 * 月次粗利明細一覧「交通費(税抜)」合計行の表示値のテスト(npm test)。
 * 2026-09-29: 登録済みの月次値があるのに合計行が常に「不明」固定だった不具合の再発防止。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEffectiveTransportExTaxRows, computeTransportExTaxTotal, formatTransportExTaxTotal } from './transportExTaxDisplay';
import { emptyMonthlyDataState, type CompanyMonthlyData } from './monthlyData';
import type { InvoicePrintRow, TransportExTaxOverrideRow } from '../types';

const ov = (targetMonth: string, amount: number): TransportExTaxOverrideRow => ({ id: targetMonth, targetMonth, amount });
const rows = [ov('2025-09', 197865), ov('2025-10', 219628), ov('2025-11', 247372)];

test('1ヶ月表示: 選択月の登録値をそのまま出す', () => {
  const t = computeTransportExTaxTotal(rows, ['2025-10'], false);
  assert.deepEqual(t, { kind: 'value', amount: 219628, monthsWithData: 1, monthsInScope: 1, autoMonths: 0 });
  assert.equal(formatTransportExTaxTotal(t), '¥219,628');
});

test('登録値が無い月は「不明」', () => {
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(rows, ['2025-12'], false)), '不明');
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal([], ['2025-10'], false)), '不明');
});

test('検索・絞り込み中は「—」(表示中の行と合わない月全体の値を出さない)', () => {
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(rows, ['2025-10'], true)), '—');
});

test('年間表示: 登録済み月だけを合計し、欠けている月があれば月数を併記', () => {
  const fy = ['2025-09', '2025-10', '2025-11', '2025-12'];
  const t = computeTransportExTaxTotal(rows, fy, false);
  assert.deepEqual(t, { kind: 'value', amount: 197865 + 219628 + 247372, monthsWithData: 3, monthsInScope: 4, autoMonths: 0 });
  assert.equal(formatTransportExTaxTotal(t), '¥664,865 (3/4ヶ月分)');
});

test('決算期の範囲外の月の登録値は合計に含めない', () => {
  const t = computeTransportExTaxTotal([...rows, ov('2026-09', 999999)], ['2025-09', '2025-10', '2025-11'], false);
  assert.equal(formatTransportExTaxTotal(t), '¥664,865');
});

// ---- ★2026-09-29追加: 大阪の自動補完(手入力優先、無い月は請求書の交通費合計) ----
const inv = (transportAmount?: number): InvoicePrintRow => ({
  billingNo: 'B', targetMonth: '', invoiceIssueDate: '', paymentDueDate: '', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 0,
  ...(transportAmount === undefined ? {} : { transportAmount }),
});
const months = (): CompanyMonthlyData => ({
  // 手入力あり + 請求書あり → 手入力を優先
  '2024-12': { ...emptyMonthlyDataState(), transportExTaxOverrideRows: [ov('2024-12', 194619)], invoiceRows: [inv(190255), inv(4364), inv(4364)] },
  // 手入力なし + 請求書(交通費項目あり) → 自動計算
  '2023-07': { ...emptyMonthlyDataState(), invoiceRows: [inv(286000), inv(370), inv(0)] },
  // 手入力なし + 請求書(交通費項目なし=項目追加前に取込み) → 補完しない
  '2026-04': { ...emptyMonthlyDataState(), invoiceRows: [inv(), inv()] },
});

test('自動補完あり(大阪): 手入力優先、無い月は請求書の交通費合計、交通費項目の無い月は補完しない', () => {
  const rows = buildEffectiveTransportExTaxRows(months(), true);
  assert.deepEqual(rows.map((r) => [r.targetMonth, r.amount, r.source]), [
    ['2023-07', 286370, 'auto'],
    ['2024-12', 194619, 'manual'],
  ]);
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(rows, ['2023-07'], false)), '¥286,370 (自動)');
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(rows, ['2024-12'], false)), '¥194,619');
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(rows, ['2026-04'], false)), '不明');
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(rows, ['2023-07', '2024-12', '2026-04'], false)), '¥480,989 (2/3ヶ月分・うち自動1ヶ月)');
});

test('自動補完なし(松山・四国): 手入力の月だけ', () => {
  const rows = buildEffectiveTransportExTaxRows(months(), false);
  assert.deepEqual(rows.map((r) => [r.targetMonth, r.amount, r.source]), [['2024-12', 194619, 'manual']]);
});
