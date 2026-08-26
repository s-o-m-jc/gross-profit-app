/**
 * 派遣事業 粗利・経理管理システム
 * 変更履歴(自動バックアップ)パネル
 *
 * ★2026-08-26追加: Supabase Pro機能の自動バックアップは有料のため、無料プランの範囲内で
 * 完結する「DBトリガーによる変更履歴」方式を採用した(supabase/migrations/
 * 20260826130000_change_history.sql)。monthly_dataへのUPDATE/DELETEのたびに変更前の内容が
 * monthly_data_historyへ自動的に複製される。このパネルはその履歴を閲覧するための
 * 読み取り専用UI(adminのみ表示・RLSでもadminのみ参照可)。DBへの直接リストア機能は
 * フェーズ1のスコープ外のため、必要な内容はJSONダウンロードして手動で確認・復元する。
 */

import React, { useEffect, useState } from 'react';
import { History, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { CompanyId } from '../config/companies';
import { fetchChangeHistory, ChangeHistoryEntry } from '../utils/supabaseSync';

interface ChangeHistoryPanelProps {
  companyId: CompanyId;
  companyName: string;
}

function downloadHistoryEntryAsJson(entry: ChangeHistoryEntry, companyName: string) {
  const payload = {
    company: companyName,
    targetMonth: entry.targetMonth,
    operation: entry.operation,
    changedAt: entry.changedAt,
    state: entry.state,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = entry.changedAt.slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `変更履歴_${companyName}_${entry.targetMonth}_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ChangeHistoryPanel: React.FC<ChangeHistoryPanelProps> = ({ companyId, companyName }) => {
  const [entries, setEntries] = useState<ChangeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChangeHistory(companyId, 20);
      setEntries(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, companyId]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <History className="w-5 h-5 text-indigo-600" />
            <span>変更履歴 (自動バックアップ・{companyName})</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            データが上書き・削除されるたびに、変更前の内容がSupabase側で自動的に記録されます(無料プラン対応の変更履歴方式)。
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
        >
          <span>{expanded ? '閉じる' : '履歴を表示'}</span>
        </button>
      </div>

      {expanded && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-slate-400">直近20件を新しい順に表示</span>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center space-x-1 text-[11px] text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              <span>再読込</span>
            </button>
          </div>

          {error && (
            <div className="flex items-start space-x-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 mb-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
              まだこの会社の変更履歴はありません(データが一度も上書き・削除されていません)。
            </p>
          )}

          {entries.length > 0 && (
            <div className="overflow-x-auto table-scroll">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">変更日時</th>
                    <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">対象月</th>
                    <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">操作</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="py-1.5 pr-3 font-mono text-slate-600 whitespace-nowrap">
                        {new Date(entry.changedAt).toLocaleString('ja-JP')}
                      </td>
                      <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{entry.targetMonth}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            entry.operation === 'DELETE' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {entry.operation === 'DELETE' ? '削除前' : '上書き前'}
                        </span>
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          onClick={() => downloadHistoryEntryAsJson(entry, companyName)}
                          className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                          title="この時点の内容をJSONでダウンロード"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
