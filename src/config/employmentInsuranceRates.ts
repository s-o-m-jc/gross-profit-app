/**
 * 派遣事業 粗利・経理管理システム
 * 雇用保険料率(事業主負担分、一般の事業) (★2026-09-29追加)
 *
 * 社保他内訳の「雇保」列は、会社負担の雇用保険を「(支払額(総支給) − 休業手当) × 料率」で計算して表示する
 * (大阪の元Excel「契約別売上実績表」の雇保列の数式 (給与+交通費)×料率 と同じ。給与=支払額−休業手当−交通費
 * なので交通費は打ち消し合う)。元Excelは2025-03まで0.0095、2025-04から0.009を使っており、法定料率の改定と一致する。
 * 料率が改定されたら、この表に適用開始月と料率を1行追加するだけでよい。
 */

export const EMPLOYMENT_INSURANCE_EMPLOYER_RATES: { from: string; rate: number }[] = [
  { from: '2022-10', rate: 0.0085 },
  { from: '2023-04', rate: 0.0095 },
  { from: '2025-04', rate: 0.009 },
  // ★2026-11-26追加(はまさんの決定): 令和8年度(2026-04〜)の雇用保険料率、一般の事業の事業主負担8.5/1000(厚生労働省)。
  // 松山2026-07の社保負担額(②)でも、雇用保険に入っていない人の会社分が総支給の0.3%(労災のみ)、入っている人が1.15%で、0.85%と合う。
  { from: '2026-04', rate: 0.0085 },
];

/** 対象年月("YYYY-MM")に適用される事業主負担の雇用保険料率 */
export function employerEmploymentInsuranceRate(targetMonth: string): number {
  let rate = EMPLOYMENT_INSURANCE_EMPLOYER_RATES[0].rate;
  for (const r of EMPLOYMENT_INSURANCE_EMPLOYER_RATES) if (targetMonth >= r.from) rate = r.rate;
  return rate;
}
