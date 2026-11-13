/**
 * 派遣事業 粗利・経理管理システム
 * Supabase (monthly_dataテーブル) との読み込み/書き込み
 *
 * ★2026-11-13: monthly_dataの読み込み・保存は src/utils/saveSync.ts に移した(変わった月だけを、読み込んだときの
 * updated_at と同じときだけ書く方式)。以前ここにあった replaceCompanyMonthlyData(変更のあった会社の全月を上書きし、
 * 画面に無い月を削除する)は、古いタブの保存でDB補正が巻き戻る・増えた月が消える原因だったため削除した。
 * このファイルには変更履歴(monthly_data_history)の参照だけが残っている。
 */

import { supabase } from '../lib/supabaseClient';
import { CompanyId } from '../config/companies';
import { MonthlyDataState } from './monthlyData';

export interface ChangeHistoryEntry {
  id: string;
  targetMonth: string;
  operation: 'UPDATE' | 'DELETE';
  changedAt: string;
  state: Partial<MonthlyDataState> | null;
}

/**
 * 変更履歴(自動バックアップ)を新しい順に取得する。monthly_data_historyはDBトリガーが
 * 自動的に記録するテーブルで、adminロールのみ参照可能(RLS)。参照のみで復元操作は行わない
 * (フェーズ1スコープ外。必要なJSONはダウンロードして手動で確認・復元する運用を想定)。
 */
export async function fetchChangeHistory(companyId: CompanyId, limit: number = 20): Promise<ChangeHistoryEntry[]> {
  const { data, error } = await supabase
    .from('monthly_data_history')
    .select('id, target_month, operation, changed_at, state')
    .eq('company_id', companyId)
    .order('changed_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`変更履歴の取得に失敗しました: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id as string,
    targetMonth: row.target_month as string,
    operation: row.operation as 'UPDATE' | 'DELETE',
    changedAt: row.changed_at as string,
    state: row.state as Partial<MonthlyDataState> | null,
  }));
}
