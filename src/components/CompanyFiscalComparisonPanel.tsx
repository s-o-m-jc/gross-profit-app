/**
 * 派遣事業 粗利・経理管理システム
 * 決算期(年間)集計の全拠点比較パネル(2026-10-09追加)
 *
 * 「決算期(年間)の集計・グラフ画面は、権限に関わらず全員が全拠点分を閲覧できる」の実装。
 * 自分が普段は閲覧できない拠点(general・accounting)の生データは一切取得せず、
 * get_fiscal_year_summary() (SECURITY DEFINER関数、fiscal_year_summary_cacheから
 * 集計済みの数値のみを返す)経由で3社分を取得して並べる。
 *
 * ★スコープについて: 選択中の会社の詳細な内訳・グラフ(FiscalYearAnalytics本体)は
 * 従来通り選択中の1社分のみ表示する。この比較パネルは「3社の主要な数値を並べて見える」
 * という最小限のスコープで実装しており、他拠点を選んでFiscalYearAnalytics本体の
 * 詳細を丸ごと切り替える機能までは今回は実装していない(必要であれば追加可能)。
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { COMPANIES } from '../config/companies';
import { FiscalYearSummary } from '../types';

interface CompanyFiscalComparisonPanelProps {
  fiscalYear: string; // 'YYYY-MM'(決算期の開始年月。開始年だけを使う)
}

type Row = { companyId: string; companyName: string; summary: FiscalYearSummary | null };

export const CompanyFiscalComparisonPanel: React.FC<CompanyFiscalComparisonPanelProps> = ({ fiscalYear }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fiscalYearInt = parseInt(fiscalYear.split('-')[0], 10);
    if (!Number.isFinite(fiscalYearInt)) return;
    let cancelled = false;
    setRows(null);
    setError('');
    (async () => {
      const results = await Promise.all(
        COMPANIES.map(async (c) => {
          const { data, error: rpcError } = await supabase.rpc('get_fiscal_year_summary', {
            p_company_id: c.id,
            p_fiscal_year: fiscalYearInt,
          });
          if (rpcError) throw rpcError;
          return { companyId: c.id, companyName: c.name, summary: (data as FiscalYearSummary | null) ?? null };
        })
      );
      if (!cancelled) setRows(results);
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [fiscalYear]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
      <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-3">
        <Scale className="w-4 h-4 text-indigo-600" />
        全拠点比較(決算期集計、ロールに関わらず全拠点を表示)
      </h2>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {!rows && !error && (
        <div className="flex items-center text-xs text-slate-400 py-4">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          読み込み中...
        </div>
      )}
      {rows && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1.5 pr-3">拠点</th>
                <th className="py-1.5 pr-3 text-right">総売上高</th>
                <th className="py-1.5 pr-3 text-right">総粗利益</th>
                <th className="py-1.5 pr-3 text-right">全体粗利率</th>
                <th className="py-1.5 pr-3 text-right">在籍スタッフ数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.companyId} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 font-bold text-slate-700">{r.companyName}</td>
                  {r.summary ? (
                    <>
                      <td className="py-1.5 pr-3 text-right font-mono">¥{r.summary.totalRevenueExTax.toLocaleString()}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">¥{r.summary.totalGrossProfit.toLocaleString()}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{r.summary.overallGrossMarginRate}%</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{r.summary.activeStaffCount}名</td>
                    </>
                  ) : (
                    <td colSpan={4} className="py-1.5 text-slate-400">
                      この拠点を閲覧した人がまだいないため、集計値がありません(その拠点の閲覧権限を持つ人が一度この画面を開くと表示されます)。
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
