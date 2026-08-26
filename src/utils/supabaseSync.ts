/**
 * 派遣事業 粗利・経理管理システム
 * Supabase (monthly_dataテーブル) との読み込み/書き込み
 *
 * データはSupabaseをメインの保存先とする。会社×対象月ごとに1行(state列にJSONBで
 * MonthlyDataState全体を保持)というテーブル設計(supabase/migrations参照)に合わせて、
 * 会社単位で「今のmonthlyData[companyId]の内容に一致するようテーブル側を置き換える」
 * (差分のupsert + 不要になった月の削除)方式で同期する。
 *
 * RLSにより、viewerロールでの書き込み系呼び出し(upsert/delete)はDB側で拒否される
 * (UI側でも編集系操作自体を非表示/無効化しているため、通常は呼び出されない想定)。
 */

import { supabase } from '../lib/supabaseClient';
import { CompanyId, COMPANIES } from '../config/companies';
import {
  AppMonthlyData,
  CompanyMonthlyData,
  MonthlyDataState,
  emptyMonthlyDataState,
  initialAppMonthlyData,
} from './monthlyData';

interface MonthlyDataRow {
  company_id: string;
  target_month: string;
  state: Partial<MonthlyDataState> | null;
}

/** DBから取得したstate(JSONB)を、欠けているカテゴリ配列を空配列で補いながら正規化する */
function normalizeState(state: Partial<MonthlyDataState> | null | undefined): MonthlyDataState {
  const base = emptyMonthlyDataState();
  if (!state) return base;
  return {
    payrollRows: state.payrollRows || [],
    billingRows: state.billingRows || [],
    invoiceRows: state.invoiceRows || [],
    retirementRows: state.retirementRows || [],
    leaveCompensationRows: state.leaveCompensationRows || [],
    leaveAllowanceRows: state.leaveAllowanceRows || [],
    nextMonthAdjustmentRows: state.nextMonthAdjustmentRows || [],
  };
}

/**
 * 指定した会社群(admin: 全社 / viewer: 自社のみ)のmonthly_dataを全件取得し、
 * AppMonthlyData形式(会社ID→対象月→MonthlyDataState)に組み立てる。
 * 未指定の会社(viewerから見た他社)はキーごと空のまま返す。
 */
export async function fetchMonthlyDataForCompanies(companyIds: CompanyId[]): Promise<AppMonthlyData> {
  const result = initialAppMonthlyData();
  if (companyIds.length === 0) return result;

  const { data, error } = await supabase
    .from('monthly_data')
    .select('company_id, target_month, state')
    .in('company_id', companyIds);

  if (error) {
    throw new Error(`Supabaseからのデータ読込に失敗しました: ${error.message}`);
  }

  (data as MonthlyDataRow[] | null)?.forEach((row) => {
    const companyId = row.company_id as CompanyId;
    if (!COMPANIES.some((c) => c.id === companyId)) return;
    result[companyId] = {
      ...result[companyId],
      [row.target_month]: normalizeState(row.state),
    };
  });

  return result;
}

/**
 * 1社分の月別データ(companyMonths)を、Supabase側の内容と一致するように同期する。
 * - companyMonthsに存在する月: upsert(内容を置き換え)
 * - Supabase側にのみ存在する月(companyMonthsから削除された月): delete
 * 「データをクリア」やファイルからの読込(全社上書き)でも、この関数1つで整合が取れる。
 */
export async function replaceCompanyMonthlyData(
  companyId: CompanyId,
  companyMonths: CompanyMonthlyData
): Promise<void> {
  const months = Object.keys(companyMonths);

  if (months.length > 0) {
    const rows = months.map((month) => ({
      company_id: companyId,
      target_month: month,
      state: companyMonths[month],
    }));
    const { error } = await supabase
      .from('monthly_data')
      .upsert(rows, { onConflict: 'company_id,target_month' });
    if (error) {
      throw new Error(`Supabaseへの保存に失敗しました(${companyId}): ${error.message}`);
    }
  }

  const { data: existing, error: selectError } = await supabase
    .from('monthly_data')
    .select('target_month')
    .eq('company_id', companyId);
  if (selectError) {
    throw new Error(`Supabaseの既存データ確認に失敗しました(${companyId}): ${selectError.message}`);
  }

  const monthSet = new Set(months);
  const toDelete = (existing || [])
    .map((r) => r.target_month as string)
    .filter((m) => !monthSet.has(m));

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('monthly_data')
      .delete()
      .eq('company_id', companyId)
      .in('target_month', toDelete);
    if (deleteError) {
      throw new Error(`Supabase上の不要データ削除に失敗しました(${companyId}): ${deleteError.message}`);
    }
  }
}
