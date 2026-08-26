/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * 数値検証・異常検知監査パネル
 */

import React, { useState } from 'react';
import {
  ShieldAlert,
  AlertOctagon,
  Car,
  Unlink,
  DollarSign,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  TrendingDown,
  Copy,
} from 'lucide-react';
import { GrossProfitResult, AuditAlert } from '../types';

interface AnomalyAuditPanelProps {
  results: GrossProfitResult[];
  lowMarginThreshold: number;
}

export const AnomalyAuditPanel: React.FC<AnomalyAuditPanelProps> = ({
  results,
  lowMarginThreshold,
}) => {
  const [activeTab, setActiveTab] = useState<
    'transport' | 'margin' | 'unmatched' | 'retirement' | 'duplicate'
  >('transport');

  // カテゴリ別アラート抽出
  // 請求データソースに交通費情報が無い場合(請求支払一覧CSVのみ等)は、突合結果が全件「請求漏れ」化してしまい
  // 意味を持たないため、要確認対象から除外する
  const transportDataMissing = results.length > 0 && results.every((r) => !r.transportDataAvailable);
  const transportMismatches = results.filter((r) => r.transportDiff !== 0 && r.transportDataAvailable);
  // 休業分補償・休業手当・次月調整(15章)の手入力行は、請求額0円のためgrossProfitRateが
  // 常に0%(計算上の便宜値)になる。個々の契約の低粗利判定とは性質が異なるため対象外にする。
  const lowMarginItems = results.filter((r) => r.grossProfitRate < lowMarginThreshold && !r.manualEntryType);
  const unmatchedItems = results.filter((r) =>
    r.alerts.some((a) => a.type === 'UNMATCHED_PAYROLL' || a.type === 'UNMATCHED_BILLING')
  );
  const retirementAlerts = results.filter((r) =>
    r.alerts.some((a) => a.type === 'RETIREMENT_MISSING')
  );
  // 20日締等の重複統合ログ・同月複数契約検知・社保負担額の検算差異 (暫定ルール/未実装の按分に関わるため要目視確認)
  const duplicateOrMismatchItems = results.filter((r) =>
    r.alerts.some(
      (a) =>
        a.type === 'DUPLICATE_MERGED' ||
        a.type === 'SOCIAL_INSURANCE_MISMATCH' ||
        a.type === 'MULTI_CONTRACT_SAME_MONTH'
    )
  );

  const totalAlertCount =
    transportMismatches.length +
    lowMarginItems.length +
    unmatchedItems.length +
    retirementAlerts.length +
    duplicateOrMismatchItems.length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-8">
      <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-amber-500 text-white rounded-lg shadow-sm">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">月次数値検証 & 経理監査アラート</h2>
            <p className="text-xs text-slate-500">
              給与・請求の不整合、交通費請求漏れ、退職金未設定、低粗利案件を自動抽出
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {totalAlertCount === 0 ? (
            <span className="inline-flex items-center space-x-1 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold">
              <CheckCircle2 className="w-4 h-4" />
              <span>全件検証完了: 異常なし</span>
            </span>
          ) : (
            <span className="inline-flex items-center space-x-1 px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-full text-xs font-bold">
              <AlertOctagon className="w-4 h-4 text-amber-600" />
              <span>要確認項目: {totalAlertCount}件</span>
            </span>
          )}
        </div>
      </div>

      {/* サブタブ */}
      <div className="flex space-x-2 mb-4 overflow-x-auto border-b border-slate-200">
        <button
          onClick={() => setActiveTab('transport')}
          className={`flex items-center space-x-2 py-2 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'transport'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Car className="w-4 h-4" />
          <span>交通費不一致 ({transportDataMissing ? '対象外' : transportMismatches.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('margin')}
          className={`flex items-center space-x-2 py-2 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'margin'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <TrendingDown className="w-4 h-4" />
          <span>低粗利・赤字 ({lowMarginItems.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('unmatched')}
          className={`flex items-center space-x-2 py-2 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'unmatched'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Unlink className="w-4 h-4" />
          <span>キー不一致・未紐付け ({unmatchedItems.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('retirement')}
          className={`flex items-center space-x-2 py-2 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'retirement'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>退職金未設定 ({retirementAlerts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('duplicate')}
          className={`flex items-center space-x-2 py-2 px-3 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'duplicate'
              ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Copy className="w-4 h-4" />
          <span>重複統合・按分・社保差異 ({duplicateOrMismatchItems.length})</span>
        </button>
      </div>

      {/* タブコンテンツ */}
      <div className="bg-slate-50/50 rounded-lg p-4 border border-slate-200 min-h-[160px]">
        {/* 1. 交通費不一致 */}
        {activeTab === 'transport' && (
          <div>
            <p className="text-xs text-slate-600 mb-3 font-medium">
              給与側交通費支給額（実費）と、請求側交通費（派遣先請求）の月次差額を検出しています。
            </p>

            {transportDataMissing ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-3 px-4 leading-relaxed">
                読み込んだ請求データに交通費情報が含まれていないため、交通費突合は判定できません
                （請求支払一覧表印刷CSVには交通費列が無いことがあります）。
                突合するには、請求側交通費を含む請求書印刷CSV等を別途読み込んでください。
              </p>
            ) : transportMismatches.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                交通費の不一致データはありません（全件一致）
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {transportMismatches.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="font-bold text-slate-600">{item.targetMonth}</span>
                      <span className="font-bold text-slate-900">{item.staffName} ({item.staffNo})</span>
                      <span className="text-slate-500">[{item.clientName}]</span>
                    </div>

                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <span className="text-[11px] text-slate-500 block">
                          給与支給: ¥{item.salaryTransport.toLocaleString()} / 請求: ¥{item.billingTransport.toLocaleString()}
                        </span>
                      </div>

                      <span
                        className={`font-bold px-2.5 py-1 rounded-md text-xs ${
                          item.transportDiff > 0
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-blue-100 text-blue-800 border border-blue-300'
                        }`}
                      >
                        {item.transportDiff > 0
                          ? `請求漏れ +¥${item.transportDiff.toLocaleString()}`
                          : `過剰請求 -¥${Math.abs(item.transportDiff).toLocaleString()}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. 低粗利・赤字 */}
        {activeTab === 'margin' && (
          <div>
            <p className="text-xs text-slate-600 mb-3 font-medium">
              粗利率が閾値 ({lowMarginThreshold}%) 未満または赤字案件を自動警告しています。
            </p>

            {lowMarginItems.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                低粗利・赤字案件はありません
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {lowMarginItems.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg border flex items-center justify-between text-xs ${
                      item.grossProfitExTax < 0
                        ? 'bg-rose-50 border-rose-200'
                        : 'bg-amber-50 border-amber-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className="font-bold text-slate-700">{item.targetMonth}</span>
                      <span className="font-bold text-slate-900">{item.staffName} ({item.staffNo})</span>
                      <span className="text-slate-600">[{item.clientName}]</span>
                    </div>

                    <div className="flex items-center space-x-4">
                      <span className="font-mono text-slate-700">
                        請求: ¥{item.billingAmountExTax.toLocaleString()} / 粗利: ¥{item.grossProfitExTax.toLocaleString()}
                      </span>

                      <span
                        className={`font-bold px-2.5 py-1 rounded-md text-xs ${
                          item.grossProfitExTax < 0
                            ? 'bg-rose-600 text-white'
                            : 'bg-amber-500 text-white'
                        }`}
                      >
                        {item.grossProfitRate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. キー不一致・未紐付け */}
        {activeTab === 'unmatched' && (
          <div>
            <p className="text-xs text-slate-600 mb-3 font-medium">
              給与CSVのみ存在（請求入力漏れ）または請求CSVのみ存在（給与入力漏れ）の不整合を検出。
            </p>

            {unmatchedItems.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                キー不一致データはありません（完全一致）
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {unmatchedItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white p-3 rounded-lg border border-rose-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-700 mr-2">{item.targetMonth}</span>
                      <span className="font-bold text-slate-900">{item.staffName} ({item.staffNo})</span>
                    </div>

                    <div className="text-rose-700 font-semibold text-xs">
                      {item.alerts.map((a) => a.message).join(' / ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 4. 退職金未設定 */}
        {activeTab === 'retirement' && (
          <div>
            <p className="text-xs text-slate-600 mb-3 font-medium">
              140時間以上稼働にもかかわらず、退職金配賦額が 0円 になっている可能性のあるスタッフ。
            </p>

            {retirementAlerts.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                退職金未設定の警告項目はありません
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {retirementAlerts.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white p-3 rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-700 mr-2">{item.targetMonth}</span>
                      <span className="font-bold text-slate-900">{item.staffName} ({item.staffNo})</span>
                    </div>

                    <span className="text-slate-600 text-xs">
                      {item.alerts.find((a) => a.type === 'RETIREMENT_MISSING')?.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 5. 重複統合・按分・社保差異 (暫定ルール/未実装の按分ロジックに関わる項目の透明化用) */}
        {activeTab === 'duplicate' && (
          <div>
            <p className="text-xs text-slate-600 mb-3 font-medium">
              20日締等による重複行の統合ログ、同月に同一スタッフが複数クライアントへ派遣されている場合の
              駐車場代・退職金の重複計上リスク（按分ロジック未実装のため注意喚起のみ）、
              請求CSV／給与CSV間の社保負担額の検算差異をまとめています。
              判定キー・按分・二重控除有無は運用者未確定の暫定ルールのため、内容を必ず目視確認してください。
            </p>

            {duplicateOrMismatchItems.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                重複統合・複数契約・社保差異のデータはありません
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {duplicateOrMismatchItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white p-3 rounded-lg border border-slate-200 text-xs"
                  >
                    <div className="flex items-center space-x-3 mb-1">
                      <span className="font-bold text-slate-600">{item.targetMonth}</span>
                      <span className="font-bold text-slate-900">{item.staffName} ({item.staffNo})</span>
                      <span className="text-slate-500">[{item.clientName}]</span>
                    </div>
                    <div className="space-y-1">
                      {item.alerts
                        .filter(
                          (a) =>
                            a.type === 'DUPLICATE_MERGED' ||
                            a.type === 'SOCIAL_INSURANCE_MISMATCH' ||
                            a.type === 'MULTI_CONTRACT_SAME_MONTH'
                        )
                        .map((a, idx) => (
                          <div
                            key={idx}
                            className={`text-[11px] ${
                              a.type === 'DUPLICATE_MERGED'
                                ? 'text-indigo-700'
                                : a.type === 'MULTI_CONTRACT_SAME_MONTH'
                                ? 'text-rose-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {a.message}
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
