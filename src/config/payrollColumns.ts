/**
 * 派遣事業 粗利・経理管理システム
 * 給与計算書印刷CSV(①)の交通費の列(拠点ごと) (★2026-11-26追加)
 *
 * スタナビの給与計算書印刷CSVは3拠点とも76列で並びは同じだが、手当の枠の見出しが拠点ごとに違う。
 * 交通費は31列目と46列目の枠: 大阪・四国は2つとも「交通費」(今までの読み方で読める)、松山は31列目「交通費」・46列目「非課税他１」。
 * 松山のCSVでは46列目が読めず、2026-07の給与の交通費(471,099円・67件)が0円になっていた。
 * undefinedの拠点は今までの読み方(csvParser.tsのparsePayrollCsv)。CSVの取込み(確認画面)でだけ使い、過去実績Excel取込みには使わない。
 */
import type { CompanyId } from './companies';
import type { PayrollTransportColumns } from '../utils/csvParser';

export const PAYROLL_TRANSPORT_COLUMNS: Record<CompanyId, PayrollTransportColumns | undefined> = {
  shikoku: undefined,
  osaka: undefined,
  matsuyama: { first: ['交通費', '交通費1'], second: ['非課税他1', '交通費2'] },
};
