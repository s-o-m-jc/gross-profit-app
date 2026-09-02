/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * 月次粗利明細テーブルコンポーネント
 *
 * ★2026-08-26改修:
 * - 表示範囲を「月ごと」「年間(決算期)」で切り替えられるようにし、既定値も「全期間一括表示」から
 *   「直近の対象月のみ」に変更した(全対象月を一度に表示すると確認しづらいという要望への対応)。
 * - 監査ステータス列は、実際に対応が必要な重要度(warning/error)のアラートだけで判定するよう修正
 *   (info severityの参考ログまで「要確認」に数えてしまい、ほぼ全件が要確認になっていた不具合の修正。
 *    詳細はcalculator.tsのhasActionableAlerts参照)。
 * - ヘッダーの消費税率設定を「請求額」「粗利益」に反映する税抜/税込表示切替を追加。
 */

import React, { useState, useMemo } from 'react';
import {
  Search,
  AlertTriangle,
  CheckCircle,
  ArrowUpDown,
  FileSpreadsheet,
  Building,
  User,
  CalendarDays,
  CalendarRange,
} from 'lucide-react';
import { GrossProfitResult } from '../types';
import { hasActionableAlerts, countActionableAlerts } from '../utils/calculator';

interface MonthlyCalculationTableProps {
  results: GrossProfitResult[];
  taxRate: number;
  lowMarginThreshold: number;
  /** ★2026-09-01追加: viewer(閲覧専用)権限ではCSVエクスポートボタン自体を出さない(20-2章の既知バグ修正) */
  canExportCsv: boolean;
  onExportCsv: () => void;
  /** 選択中の決算期に属する対象年月一覧("YYYY-MM"×12)。「年間(決算期)」表示切替で使用 */
  fiscalYearMonths: string[];
  /** 選択中の決算期のラベル(ヘッダーの決算期セレクタと同一の表示文字列) */
  fiscalYearLabel: string;
  /** 選択中の対象年月("YYYY-MM"または"ALL")。★2026-08-27(22-11章修正5):
   * 「スタッフ給与明細」タブと状態を共有するため、App.tsx(AppShell)側で一元管理する。 */
  selectedMonth: string;
  onSelectedMonthChange: (month: string) => void;
}

type ViewScope = 'month' | 'fiscalYear';
type AmountDisplay = 'exTax' | 'incTax';

export const MonthlyCalculationTable: React.FC<MonthlyCalculationTableProps> = ({
  results,
  taxRate,
  lowMarginThreshold,
  canExportCsv,
  onExportCsv,
  fiscalYearMonths,
  fiscalYearLabel,
  selectedMonth,
  onSelectedMonthChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewScope, setViewScope] = useState<ViewScope>('month');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [amountDisplay, setAmountDisplay] = useState<AmountDisplay>('exTax');
  const [sortField, setSortField] = useState<keyof GrossProfitResult>('targetMonth');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // 対象年月ユニークリスト
  const availableMonths = useMemo(() => {
    const months = Array.from(new Set(results.map((r) => r.targetMonth))).sort();
    return months;
  }, [results]);

  const fiscalYearMonthSet = useMemo(() => new Set(fiscalYearMonths), [fiscalYearMonths]);

  // フィルタリング処理
  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      // 表示範囲フィルタ: 月ごと(選択した1ヶ月 or 全期間) / 年間(決算期、選択中の決算期の12ヶ月分)
      if (viewScope === 'fiscalYear') {
        if (!fiscalYearMonthSet.has(item.targetMonth)) return false;
      } else if (selectedMonth !== 'ALL' && item.targetMonth !== selectedMonth) {
        return false;
      }

      // 検索クエリ (スタッフ名, スタッフNo, 派遣先名, 請求No)
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const match =
          item.staffName.toLowerCase().includes(q) ||
          item.staffNo.toLowerCase().includes(q) ||
          item.clientName.toLowerCase().includes(q) ||
          item.billingNo.toLowerCase().includes(q);
        if (!match) return false;
      }

      // 特殊フィルタ
      if (filterType === 'ALERTS_ONLY' && !hasActionableAlerts(item.alerts)) return false;
      if (filterType === 'TRANSPORT_MISMATCH' && (item.transportDiff === 0 || !item.transportDataAvailable)) return false;
      if (filterType === 'NEGATIVE' && item.grossProfitExTax >= 0) return false;
      if (filterType === 'LOW_MARGIN' && (item.grossProfitRate >= lowMarginThreshold || item.grossProfitExTax < 0)) return false;
      if (filterType === 'REFERRAL' && item.referralFee <= 0) return false;

      return true;
    }).sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string') {
        const res = (valA as string).localeCompare((valB as string) || '');
        return sortDirection === 'asc' ? res : -res;
      }
      if (typeof valA === 'number') {
        const res = (valA as number) - ((valB as number) || 0);
        return sortDirection === 'asc' ? res : -res;
      }
      return 0;
    });
  }, [results, searchQuery, viewScope, selectedMonth, fiscalYearMonthSet, filterType, sortField, sortDirection, lowMarginThreshold]);

  const handleSort = (field: keyof GrossProfitResult) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const billingAmountLabel = amountDisplay === 'incTax' ? `請求額 (税込 ${Math.round(taxRate * 100)}%)` : '請求額 (税抜)';
  const grossProfitLabel = amountDisplay === 'incTax' ? `粗利益 (税込 ${Math.round(taxRate * 100)}%)` : '粗利益 (税抜)';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
      {/* テーブル制御ツールバー */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
        {/* 1段目: 表示範囲切り替え(月ごと / 年間・決算期) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500">表示範囲:</span>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
            <button
              onClick={() => setViewScope('month')}
              className={`inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-bold transition-colors ${
                viewScope === 'month' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>月ごと</span>
            </button>
            <button
              onClick={() => setViewScope('fiscalYear')}
              className={`inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-bold border-l border-slate-300 transition-colors ${
                viewScope === 'fiscalYear' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5" />
              <span>年間(決算期)</span>
            </button>
          </div>

          {viewScope === 'month' ? (
            <select
              value={selectedMonth}
              onChange={(e) => onSelectedMonthChange(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              <option value="ALL">全対象年月 ({results.length}件)</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <span className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-700">
              {fiscalYearLabel}
            </span>
          )}
        </div>

        {/* 2段目: 検索・状態フィルタ・税抜税込切替・件数・エクスポート */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* 検索ボックス */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="スタッフ名・No・派遣先・請求No..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* 状態別フィルタ */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              <option value="ALL">すべて表示</option>
              <option value="ALERTS_ONLY">⚠️ 要確認・警告のみ</option>
              <option value="TRANSPORT_MISMATCH">🚗 交通費不一致のみ</option>
              <option value="NEGATIVE">🔴 赤字案件のみ</option>
              <option value="LOW_MARGIN">🟡 低粗利 (&lt;{lowMarginThreshold}%)</option>
              <option value="REFERRAL">💼 紹介手数料あり</option>
            </select>

            {/* 税抜/税込表示切替 */}
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden" title="ヘッダーの消費税率設定を「請求額」「粗利益」列に反映します">
              <button
                onClick={() => setAmountDisplay('exTax')}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                  amountDisplay === 'exTax' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                税抜表示
              </button>
              <button
                onClick={() => setAmountDisplay('incTax')}
                className={`px-3 py-1.5 text-xs font-bold border-l border-slate-300 transition-colors ${
                  amountDisplay === 'incTax' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                税込表示
              </button>
            </div>
          </div>

          {/* 右側: エクスポートボタン & 件数表示 */}
          <div className="flex items-center space-x-3">
            <span className="text-xs text-slate-500">
              表示: <strong className="text-slate-800 font-bold">{filteredResults.length}</strong> / {results.length} 件
            </span>

            {canExportCsv && (
              <button
                onClick={onExportCsv}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>CSVエクスポート</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* メインテーブル (table-scroll: 常時視認できる横スクロールバーをマウス操作用に表示) */}
      <div className="overflow-x-auto table-scroll">
        <table className="min-w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
              <th className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={() => handleSort('targetMonth')}>
                年月 <ArrowUpDown className="inline w-3 h-3 text-slate-400 ml-0.5" />
              </th>
              <th className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={() => handleSort('billingNo')}>
                請求No
              </th>
              <th className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={() => handleSort('staffName')}>
                スタッフ
              </th>
              <th className="py-3 px-3 whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={() => handleSort('clientName')}>
                派遣先企業
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right cursor-pointer hover:bg-slate-200" onClick={() => handleSort('billingAmountExTax')}>
                {billingAmountLabel}
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right cursor-pointer hover:bg-slate-200" onClick={() => handleSort('paymentAmount')}>
                給与支給額
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right cursor-pointer hover:bg-slate-200" onClick={() => handleSort('socialInsurance')}>
                社保等原価
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right cursor-pointer hover:bg-slate-200" onClick={() => handleSort('retirementAmount')}>
                退職金配賦
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right cursor-pointer hover:bg-slate-200" onClick={() => handleSort('paidLeaveAllowance')} title="給与CSV由来の参考値。粗利計算には影響しません">
                有給 (手当/日数)
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right bg-amber-50/50" title="粗利非算入・売上算入。消費税計算の対象外(既存仕様のまま)">
                紹介料 <span className="text-amber-600">ⓘ</span>
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right cursor-pointer hover:bg-slate-200 bg-indigo-50/50" onClick={() => handleSort('grossProfitExTax')}>
                {grossProfitLabel}
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-center cursor-pointer hover:bg-slate-200 bg-indigo-50/50" onClick={() => handleSort('grossProfitRate')}>
                粗利率
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('transportDiff')}>
                交通費突合
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-center">監査ステータス</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
            {filteredResults.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-12 text-center text-slate-400">
                  該当する計算結果データが見つかりません。CSVデータを読み込んでください。
                </td>
              </tr>
            ) : (
              filteredResults.map((row) => {
                const isNegative = row.grossProfitExTax < 0;
                const isLowMargin = row.grossProfitRate < lowMarginThreshold && !isNegative;
                // 粗利計算に実際に使われるのは社保負担額(請求CSV由来)+駐車場代のみ。
                // 雇用保険は社保負担額に含まれている想定の参考値のため合計には含めない(要検算タブ参照)
                const socialAndOtherCost = row.socialInsurance + row.parkingFee;
                const displayBillingAmount = amountDisplay === 'incTax' ? row.billingAmountIncTax : row.billingAmountExTax;
                const displayGrossProfit = amountDisplay === 'incTax' ? row.grossProfitIncTax : row.grossProfitExTax;
                const actionableAlertCount = countActionableAlerts(row.alerts);

                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      isNegative
                        ? 'bg-rose-50/40'
                        : isLowMargin
                        ? 'bg-amber-50/30'
                        : row.transportDiff !== 0
                        ? 'bg-blue-50/20'
                        : ''
                    }`}
                  >
                    <td className="py-2.5 px-3 font-semibold text-slate-600 whitespace-nowrap">
                      {row.targetMonth}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 text-[11px] whitespace-nowrap">
                      {row.billingNo}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center space-x-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <div>
                          <div className="font-bold text-slate-900 flex items-center space-x-1">
                            <span>{row.staffName}</span>
                            {row.mergedRowCount > 1 && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200"
                                title={`20日締等で${row.mergedRowCount}件の請求行を統合（受注番号: ${row.mergedOrderNos.join(' / ')}）`}
                              >
                                統合×{row.mergedRowCount}
                              </span>
                            )}
                            {row.manualEntryType && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-100 text-violet-700 border border-violet-200"
                                title={`手入力行(${row.billingNo})${row.manualEntryMemo ? ` ｜ 備考: ${row.manualEntryMemo}` : ''}`}
                              >
                                手入力
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{row.staffNo}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap max-w-[160px] truncate" title={row.clientName}>
                      <div className="flex items-center space-x-1">
                        <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-semibold text-slate-700">{row.clientName}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                      ¥{displayBillingAmount.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 whitespace-nowrap">
                      ¥{row.paymentAmount.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap" title={`社保負担額(請求CSV由来): ¥${row.socialInsurance.toLocaleString()}, 駐車場: ¥${row.parkingFee.toLocaleString()} ｜ 雇用保険(参考・給与CSV由来、社保負担額に含まれる想定のため合計には非算入): ¥${row.employmentInsurance.toLocaleString()}`}>
                      ¥{socialAndOtherCost.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                      ¥{row.retirementAmount.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                      ¥{row.paidLeaveAllowance.toLocaleString()} <span className="text-slate-400">/ {row.paidLeaveDays}日</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono bg-amber-50/40 text-amber-800 font-semibold whitespace-nowrap">
                      {row.referralFee > 0 ? `¥${row.referralFee.toLocaleString()}` : '-'}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-extrabold whitespace-nowrap bg-indigo-50/30 ${
                        isNegative ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      ¥{displayGrossProfit.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap bg-indigo-50/30">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          isNegative
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : isLowMargin
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}
                      >
                        {row.grossProfitRate}%
                      </span>
                    </td>

                    {/* 交通費突合 */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {!row.transportDataAvailable ? (
                        <span
                          className="text-[11px] font-medium text-slate-400"
                          title="このデータソースには請求側交通費の情報が含まれていません(請求書印刷CSV等を追加読込してください)"
                        >
                          対象外（交通費データなし）
                        </span>
                      ) : row.transportDiff === 0 ? (
                        <span className="text-[11px] font-semibold text-emerald-600 flex items-center justify-center space-x-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>一致 (¥{row.salaryTransport.toLocaleString()})</span>
                        </span>
                      ) : (
                        <div className="text-[10px] text-center" title={`給与支給: ¥${row.salaryTransport.toLocaleString()} / 請求: ¥${row.billingTransport.toLocaleString()}`}>
                          <span
                            className={`inline-block font-bold px-1.5 py-0.5 rounded ${
                              row.transportDiff > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {row.transportDiff > 0
                              ? `請求漏れ +¥${row.transportDiff.toLocaleString()}`
                              : `過剰請求 -¥${Math.abs(row.transportDiff).toLocaleString()}`}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* 監査ステータス (★2026-08-26修正: info severityは含めず、warning/errorのみで判定) */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {actionableAlertCount === 0 ? (
                        <span className="inline-flex items-center space-x-1 text-emerald-600 text-[11px] font-medium">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>正常</span>
                        </span>
                      ) : (
                        <div className="flex items-center justify-center space-x-1" title={row.alerts.map((a) => a.message).join(' / ')}>
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <span className="font-bold text-amber-700 text-[11px]">
                            要確認 ({actionableAlertCount})
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
