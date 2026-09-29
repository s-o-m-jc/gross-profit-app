/**
 * 交通費(税抜)の月次値・月次粗利明細一覧の合計行の表示値のテスト(npm test)。
 * 2026-09-29: 合計行が常に「不明」固定だった不具合、および「交通費(税抜)=売上内訳の交通費(四国は支給交通費)」
 * として行の合計で自動集計し、手入力はイレギュラーな月の上書きに限る方針への変更の再発防止。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEffectiveTransportExTaxRows, computeTransportExTaxTotal, formatTransportExTaxTotal } from './transportExTaxDisplay';
import { emptyMonthlyDataState, type CompanyMonthlyData } from './monthlyData';
import type { GrossProfitResult, TransportExTaxOverrideRow } from '../types';

const ov = (targetMonth: string, amount: number): TransportExTaxOverrideRow => ({ id: targetMonth, targetMonth, amount });
const row = (targetMonth: string, transportExTax: number) => ({ targetMonth, transportExTax }) as unknown as GrossProfitResult;

const months = (): CompanyMonthlyData => ({
  '2024-12': { ...emptyMonthlyDataState() }, // 手入力なし → 行の合計
  '2025-01': { ...emptyMonthlyDataState(), transportExTaxOverrideRows: [ov('2025-01', 150000)] }, // 手入力あり → 手入力優先
  '2026-04': { ...emptyMonthlyDataState() }, // 行の交通費がすべて0 → 不明
  '2022-10': { ...emptyMonthlyDataState(), transportExTaxOverrideRows: [ov('2022-10', 1913268)] }, // 行が無い月の手入力
});
const results = [row('2024-12', 194619), row('2024-12', 4364), row('2025-01', 153681), row('2026-04', 0), row('2026-04', 0)];

test('月次値: 行の合計で自動集計、手入力がある月は手入力、交通費データが無い月は出さない', () => {
  const eff = buildEffectiveTransportExTaxRows(months(), results);
  assert.deepEqual(eff.map((r) => [r.targetMonth, r.amount, r.source]), [
    ['2022-10', 1913268, 'manual'],
    ['2024-12', 198983, 'auto'],
    ['2025-01', 150000, 'manual'],
  ]);
});

test('合計行(1ヶ月表示): 自動集計はそのまま、手入力は「(手入力)」、データ無しは「不明」', () => {
  const eff = buildEffectiveTransportExTaxRows(months(), results);
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(eff, ['2024-12'], null)), '¥198,983');
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(eff, ['2025-01'], null)), '¥150,000 (手入力)');
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(eff, ['2026-04'], null)), '不明');
});

test('合計行(年間表示): 値のある月の合計、欠けている月数と手入力の月数を併記', () => {
  const eff = buildEffectiveTransportExTaxRows(months(), results);
  const t = computeTransportExTaxTotal(eff, ['2024-12', '2025-01', '2025-02'], null);
  assert.deepEqual(t, { kind: 'value', amount: 348983, monthsWithData: 2, monthsInScope: 3, manualMonths: 1 });
  assert.equal(formatTransportExTaxTotal(t), '¥348,983 (2/3ヶ月分・うち手入力1ヶ月)');
});

test('合計行(検索・絞り込み中): 表示中の行の合計', () => {
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal([], ['2024-12'], 4364)), '¥4,364');
});

test('決算期の範囲外の月は合計に含めない', () => {
  const eff = [ov('2025-09', 100), ov('2026-09', 999999)].map((r) => ({ ...r, source: 'auto' as const }));
  assert.equal(formatTransportExTaxTotal(computeTransportExTaxTotal(eff, ['2025-09'], null)), '¥100');
});
