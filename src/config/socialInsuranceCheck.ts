/**
 * 派遣事業 粗利・経理管理システム
 * 社保負担額の検算(SOCIAL_INSURANCE_MISMATCHアラート)用の設定 (★2026-10-01追加)
 *
 * 請求データの「社保負担額」は会社負担で、大阪は「本人の健保・介護・年金 + 会社負担の雇用保険」、
 * 松山はさらに労災保険料(総支給 × 労災保険率)を含む(2026-10-01、本番データで確認: 松山は各月の
 * 社保加入者の大半がこの式と1円以内で一致。率は2026-04まで0.3%、2026-05から0.25%)。
 * 四国は、未払計上表から取り込んだ月(2023-10・2024-02・2024-03)の「社保他」が、本人の健保・年金+会社の雇用保険より
 * 総支給の約0.204%多い(労災保険料等と推定。1円単位では一致しないため0.2%の近似値。アラートの許容差500円の範囲で使う)。
 * 四国の売上実績一覧表由来の給与データは、社保に会社負担(社保他)そのものが入っているため、この率は使わない(calculator.ts)。
 * 率が変わったら、適用開始月(請求データの対象月)と率を1行追加する。
 */
import type { CompanyId } from './companies';

export type WorkersCompRate = { from: string; rate: number };

export const WORKERS_COMP_RATES_IN_SOCIAL_INSURANCE: Record<CompanyId, WorkersCompRate[]> = {
  osaka: [],
  shikoku: [{ from: '2000-01', rate: 0.002 }],
  matsuyama: [
    { from: '2000-01', rate: 0.003 },
    { from: '2026-05', rate: 0.0025 },
  ],
};

/** 対象年月に適用される労災保険率(社保負担額に含まれない会社は0) */
export function workersCompRate(rates: WorkersCompRate[], targetMonth: string): number {
  let rate = 0;
  for (const r of rates) if (targetMonth >= r.from) rate = r.rate;
  return rate;
}
