/**
 * 派遣事業 粗利・経理管理システム
 * 月次粗利明細一覧の「交通費(税抜)」合計行の表示値 (★2026-09-29追加)
 *
 * 交通費(税抜)は対象月ごとの手入力上書き値(TransportExTaxOverrideRow、3社共通・定義は会社ごとに
 * 異なる。config/transportExTax.ts参照)で、スタッフ別の値は持たない。そのため一覧では個別行は
 * 「—」とし、合計行にだけ登録値を出す(はまさんの決定済み、2026-09-29)。
 * - 検索・絞り込み中: 表示中の行と合わない数字を出さないよう「—」
 * - 対象月(1ヶ月表示なら選択月、年間表示なら決算期12ヶ月)に登録値が1件も無い: 「不明」
 * - それ以外: 登録済み月の合計(年間表示で一部の月しか無い場合は月数を併記する)
 */

import { TransportExTaxOverrideRow } from '../types';

export type TransportExTaxTotal =
  | { kind: 'filtered' }
  | { kind: 'unknown' }
  | { kind: 'value'; amount: number; monthsWithData: number; monthsInScope: number };

export function computeTransportExTaxTotal(
  overrides: TransportExTaxOverrideRow[],
  scopeMonths: string[],
  isFiltered: boolean
): TransportExTaxTotal {
  if (isFiltered) return { kind: 'filtered' };
  const byMonth = new Map<string, number>();
  overrides.forEach((r) => byMonth.set(r.targetMonth, r.amount));
  const months = scopeMonths.filter((m) => byMonth.has(m));
  if (months.length === 0) return { kind: 'unknown' };
  return {
    kind: 'value',
    amount: months.reduce((sum, m) => sum + (byMonth.get(m) || 0), 0),
    monthsWithData: months.length,
    monthsInScope: scopeMonths.length,
  };
}

/** 合計行のセルに出す文字列 */
export function formatTransportExTaxTotal(t: TransportExTaxTotal): string {
  if (t.kind === 'filtered') return '—';
  if (t.kind === 'unknown') return '不明';
  const base = `¥${t.amount.toLocaleString()}`;
  return t.monthsWithData < t.monthsInScope ? `${base} (${t.monthsWithData}/${t.monthsInScope}ヶ月分)` : base;
}
