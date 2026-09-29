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
 * ★2026-09-29追加: 大阪は手入力が無い月を請求書の交通費合計で自動補完する(buildEffectiveTransportExTaxRows)。
 * 自動計算の月を含む場合は「(自動)」「(うち自動nヶ月)」を併記する。
 */

import { TransportExTaxOverrideRow } from '../types';
import { CompanyMonthlyData } from './monthlyData';

/** 実際に表示・集計に使う交通費(税抜)の月次値。sourceで手入力か自動計算かを区別する */
export interface EffectiveTransportExTaxRow extends TransportExTaxOverrideRow {
  source: 'manual' | 'auto';
}

/**
 * ★2026-09-29追加(はまさんの決定済み): 月ごとの交通費(税抜)を組み立てる。手入力(transportExTaxOverrideRows)が
 * ある月は常に手入力を使い、無い月はautoFromInvoice(config/transportExTax.ts、大阪のみtrue)の場合に限り、
 * その月の請求書行(invoiceRows)のtransportAmount(請求書シートの「交通費－金額」、税抜)の合計で補完する。
 * transportAmountの項目自体を持つ請求書行が1件も無い月(項目追加前に取り込んだ月、請求書データが無い月)は
 * 0円と誤計算しないよう補完しない(=「不明」のまま)。
 */
export function buildEffectiveTransportExTaxRows(
  companyMonths: CompanyMonthlyData,
  autoFromInvoice: boolean
): EffectiveTransportExTaxRow[] {
  const out: EffectiveTransportExTaxRow[] = [];
  Object.keys(companyMonths).sort().forEach((month) => {
    const state = companyMonths[month];
    const manual = (state?.transportExTaxOverrideRows || []).find((r) => r.targetMonth === month);
    if (manual) {
      out.push({ ...manual, source: 'manual' });
      return;
    }
    if (!autoFromInvoice) return;
    const withField = (state?.invoiceRows || []).filter((r) => r.transportAmount !== undefined);
    if (withField.length === 0) return;
    out.push({
      id: month,
      targetMonth: month,
      amount: withField.reduce((sum, r) => sum + (r.transportAmount || 0), 0),
      memo: '自動計算(請求書の交通費合計)',
      source: 'auto',
    });
  });
  return out;
}

export type TransportExTaxTotal =
  | { kind: 'filtered' }
  | { kind: 'unknown' }
  | { kind: 'value'; amount: number; monthsWithData: number; monthsInScope: number; autoMonths: number };

export function computeTransportExTaxTotal(
  overrides: (TransportExTaxOverrideRow & { source?: 'manual' | 'auto' })[],
  scopeMonths: string[],
  isFiltered: boolean
): TransportExTaxTotal {
  if (isFiltered) return { kind: 'filtered' };
  const byMonth = new Map<string, number>();
  const autoSet = new Set<string>();
  overrides.forEach((r) => {
    byMonth.set(r.targetMonth, r.amount);
    if (r.source === 'auto') autoSet.add(r.targetMonth);
  });
  const months = scopeMonths.filter((m) => byMonth.has(m));
  if (months.length === 0) return { kind: 'unknown' };
  return {
    kind: 'value',
    amount: months.reduce((sum, m) => sum + (byMonth.get(m) || 0), 0),
    monthsWithData: months.length,
    monthsInScope: scopeMonths.length,
    autoMonths: months.filter((m) => autoSet.has(m)).length,
  };
}

/** 合計行のセルに出す文字列 */
export function formatTransportExTaxTotal(t: TransportExTaxTotal): string {
  if (t.kind === 'filtered') return '—';
  if (t.kind === 'unknown') return '不明';
  const notes: string[] = [];
  if (t.monthsWithData < t.monthsInScope) notes.push(`${t.monthsWithData}/${t.monthsInScope}ヶ月分`);
  if (t.autoMonths > 0) notes.push(t.monthsInScope === 1 ? '自動' : `うち自動${t.autoMonths}ヶ月`);
  return `¥${t.amount.toLocaleString()}` + (notes.length ? ` (${notes.join('・')})` : '');
}
