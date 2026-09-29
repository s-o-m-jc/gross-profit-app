/**
 * 月次粗利明細一覧「交通費(税抜)」合計行の表示値のテスト(npm test)。
 * 2026-09-29: 登録済みの月次値があるのに合計行が常に「不明」固定だった不具合の再発防止。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTransportExTaxTotal, formatTransportExTaxTotal } from './transportExTaxDisplay';
import type { TransportExTaxOverrideRow } from '../types';

const ov = (targetMonth: string, amount: number): TransportExTaxOverrideRow => ({ id: targetMonth, targetMonth, amount });
const rows = [ov('2025-09', 197865), ov('2025-10', 219628), ov('2025-11', 247372)];

test('1ヶ月表示: 選択月の登録値をそのまま出す', () => {
  const t = computeTransportExTaxTotal(rows, ['2025-10'], false);
  assert.deepEqual(t, { kind: 'value', amount: 219628, monthsWithData: 1, monthsInScope: 1 });
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
  assert.deepEqual(t, { kind: 'value', amount: 197865 + 219628 + 247372, monthsWithData: 3, monthsInScope: 4 });
  assert.equal(formatTransportExTaxTotal(t), '¥664,865 (3/4ヶ月分)');
});

test('決算期の範囲外の月の登録値は合計に含めない', () => {
  const t = computeTransportExTaxTotal([...rows, ov('2026-09', 999999)], ['2025-09', '2025-10', '2025-11'], false);
  assert.equal(formatTransportExTaxTotal(t), '¥664,865');
});
