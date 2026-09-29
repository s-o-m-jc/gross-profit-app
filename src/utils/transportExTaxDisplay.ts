/**
 * 派遣事業 粗利・経理管理システム
 * 交通費(税抜)の月次値と、月次粗利明細一覧の合計行の表示値
 *
 * ★2026-09-29(はまさんの決定済み): 交通費(税抜)は、各行の値(GrossProfitResult.transportExTax。大阪・松山=請求交通費、
 * 四国=給与の支給交通費。config/transportExTax.ts参照)を月ごとに合計して自動集計する。手入力
 * (TransportExTaxOverrideRow)は、データが無い月・イレギュラーな月の上書きにだけ使い、ある月は手入力を優先する。
 * 以前(同日の途中まで)は「月単位の手入力値のみ」「個別行は—」という設計だったが、交通費(税抜)は売上内訳の交通費
 * (四国は給与の支給交通費)と同じものと判明したため改めた。
 *
 * 合計行:
 * - 検索・絞り込み中: 表示中の行の合計
 * - それ以外: 対象月(1ヶ月表示なら選択月、年間表示なら決算期12ヶ月)の月次値の合計。値のある月が1つも無ければ
 *   「不明」、一部の月しか無ければ月数を、手入力の月を含めば「(手入力)」を併記する
 */

import { GrossProfitResult, TransportExTaxOverrideRow } from '../types';
import { CompanyMonthlyData } from './monthlyData';

/** 実際に表示・集計に使う交通費(税抜)の月次値。sourceで手入力か自動集計かを区別する */
export interface EffectiveTransportExTaxRow extends TransportExTaxOverrideRow {
  source: 'manual' | 'auto';
}

/**
 * 月ごとの交通費(税抜)を組み立てる。手入力がある月は手入力、無い月は各行のtransportExTaxの合計。
 * 行の値がすべて0(またはデータ自体が無い)月は、交通費データが無いものとして自動集計しない(=「不明」)。
 * 交通費の項目自体を持たない取込み元(例: 大阪2026-04〜08の請求書行、四国の売上実績一覧表由来で支給交通費を
 * 補っていない月)を0円と誤表示しないため。
 */
export function buildEffectiveTransportExTaxRows(
  companyMonths: CompanyMonthlyData,
  results: GrossProfitResult[]
): EffectiveTransportExTaxRow[] {
  const autoByMonth = new Map<string, number>();
  results.forEach((r) => {
    if (r.transportExTax) autoByMonth.set(r.targetMonth, (autoByMonth.get(r.targetMonth) || 0) + r.transportExTax);
  });
  const months = new Set([...Object.keys(companyMonths), ...autoByMonth.keys()]);
  const out: EffectiveTransportExTaxRow[] = [];
  [...months].sort().forEach((month) => {
    const manual = (companyMonths[month]?.transportExTaxOverrideRows || []).find((r) => r.targetMonth === month);
    if (manual) {
      out.push({ ...manual, source: 'manual' });
      return;
    }
    const auto = autoByMonth.get(month);
    if (auto === undefined) return;
    out.push({ id: month, targetMonth: month, amount: auto, source: 'auto' });
  });
  return out;
}

export type TransportExTaxTotal =
  | { kind: 'filtered'; amount: number }
  | { kind: 'unknown' }
  | { kind: 'value'; amount: number; monthsWithData: number; monthsInScope: number; manualMonths: number };

/**
 * @param visibleRowsSum 検索・絞り込み中なら表示中の行のtransportExTaxの合計、絞り込み無しならnull
 */
export function computeTransportExTaxTotal(
  effective: (TransportExTaxOverrideRow & { source?: 'manual' | 'auto' })[],
  scopeMonths: string[],
  visibleRowsSum: number | null
): TransportExTaxTotal {
  if (visibleRowsSum !== null) return { kind: 'filtered', amount: visibleRowsSum };
  const byMonth = new Map<string, number>();
  const manualSet = new Set<string>();
  effective.forEach((r) => {
    byMonth.set(r.targetMonth, r.amount);
    if (r.source === 'manual') manualSet.add(r.targetMonth);
  });
  const months = scopeMonths.filter((m) => byMonth.has(m));
  if (months.length === 0) return { kind: 'unknown' };
  return {
    kind: 'value',
    amount: months.reduce((sum, m) => sum + (byMonth.get(m) || 0), 0),
    monthsWithData: months.length,
    monthsInScope: scopeMonths.length,
    manualMonths: months.filter((m) => manualSet.has(m)).length,
  };
}

/** 合計行のセルに出す文字列 */
export function formatTransportExTaxTotal(t: TransportExTaxTotal): string {
  if (t.kind === 'filtered') return `¥${t.amount.toLocaleString()}`;
  if (t.kind === 'unknown') return '不明';
  const notes: string[] = [];
  if (t.monthsWithData < t.monthsInScope) notes.push(`${t.monthsWithData}/${t.monthsInScope}ヶ月分`);
  if (t.manualMonths > 0) notes.push(t.monthsInScope === 1 ? '手入力' : `うち手入力${t.manualMonths}ヶ月`);
  return `¥${t.amount.toLocaleString()}` + (notes.length ? ` (${notes.join('・')})` : '');
}
