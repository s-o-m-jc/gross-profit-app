/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * ヘッダーコンポーネント
 */

import React from 'react';
import {
  Calculator,
  FileSpreadsheet,
  Settings,
  HelpCircle,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Calendar,
  LogOut,
  Eye,
  ShieldCheck,
} from 'lucide-react';
import { CompanyConfig, CompanyId } from '../config/companies';
import { UserRole } from '../lib/AuthContext';

interface HeaderProps {
  companyName: string;
  companies: CompanyConfig[];
  selectedCompanyId: CompanyId;
  onCompanyChange: (id: CompanyId) => void;
  /** falseの場合、会社切り替えドロップダウンの代わりに会社名を固定表示する(viewer用) */
  canSwitchCompany: boolean;
  taxRate: number;
  onTaxRateChange: (rate: number) => void;
  fiscalYear: string;
  onFiscalYearChange: (fy: string) => void;
  fiscalYearOptions: { value: string; label: string }[];
  onLoadSampleData: () => void;
  onOpenMCodeGuide: () => void;
  alertCount: number;
  totalBillingCount: number;
  /** adminのみtrue。falseの場合はデータ変更系ボタン(サンプルデータ読込)を無効化する */
  canEdit: boolean;
  userEmail: string | null;
  userRole: UserRole;
  onSignOut: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  companyName,
  companies,
  selectedCompanyId,
  onCompanyChange,
  canSwitchCompany,
  taxRate,
  onTaxRateChange,
  fiscalYear,
  onFiscalYearChange,
  fiscalYearOptions,
  onLoadSampleData,
  onOpenMCodeGuide,
  alertCount,
  totalBillingCount,
  canEdit,
  userEmail,
  userRole,
  onSignOut,
}) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* 左側: タイトル & システム情報 (幅が足りない時はここが縮んで省略表示になる) */}
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-inner flex-shrink-0">
              <Calculator className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2 min-w-0">
                <h1 className="text-lg font-bold tracking-tight text-white truncate">{companyName}</h1>
                <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-900/80 text-indigo-300 border border-indigo-700 flex-shrink-0">
                  Power Query v1.1 互換
                </span>
              </div>
              <p className="hidden sm:block text-xs text-slate-400 truncate">
                給与・請求・印刷CSV自動結合 / 退職金・紹介手数料・交通費月次一致検証
              </p>
            </div>
          </div>

          {/* 中央右: 会社切り替え・決算期切り替え & サンプルデータ読み込み。
              項目数が増えても縮んで文字が縦崩れしないよう、この行だけ横スクロールを許可する。 */}
          <div className="flex items-center space-x-3 min-w-0 overflow-x-auto whitespace-nowrap py-1 [scrollbar-width:thin]">
            <div className="flex items-center space-x-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-indigo-500/40 text-xs flex-shrink-0">
              <Building2 className="w-4 h-4 text-indigo-400 flex-shrink-0" />
              <span className="text-slate-300 font-medium">会社:</span>
              {canSwitchCompany ? (
                <select
                  value={selectedCompanyId}
                  onChange={(e) => onCompanyChange(e.target.value as CompanyId)}
                  className="bg-slate-900 text-slate-100 font-semibold rounded px-2 py-1 text-xs border border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 max-w-[9rem] sm:max-w-none"
                  title="会社ごとにアップロードしたCSVデータは分けて保持されます"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-slate-100 font-semibold px-1" title="閲覧権限のある会社に固定されています">
                  {companies.find((c) => c.id === selectedCompanyId)?.name ?? selectedCompanyId}
                </span>
              )}
            </div>

            <div className="hidden md:flex items-center space-x-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs flex-shrink-0">
              <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="text-slate-300 font-medium">決算期指定:</span>
              <select
                value={fiscalYear}
                onChange={(e) => onFiscalYearChange(e.target.value)}
                className="bg-slate-900 text-slate-100 font-semibold rounded px-2 py-1 text-xs border border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {fiscalYearOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="hidden lg:flex items-center space-x-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs flex-shrink-0">
              <span className="text-slate-400">消費税率:</span>
              <select
                value={taxRate}
                onChange={(e) => onTaxRateChange(Number(e.target.value))}
                className="bg-slate-900 text-slate-100 font-semibold rounded px-2 py-1 text-xs border border-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value={0.1}>10% (標準税率)</option>
                <option value={0.08}>8% (軽減税率等)</option>
                <option value={0.0}>0% (非課税/税抜表示)</option>
              </select>
            </div>

            {/* サンプルデータ読み込みボタン (viewerは閲覧専用のため無効化) */}
            {canEdit && (
              <button
                onClick={onLoadSampleData}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 transition-colors flex-shrink-0"
                title="v1.1仕様書に基づいたテスト用データを一括ロードします"
              >
                <RefreshCw className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                <span className="hidden sm:inline">サンプルデータ読込</span>
              </button>
            )}

            {/* Mコード解説ボタン */}
            <button
              onClick={onOpenMCodeGuide}
              className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex-shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span className="hidden xl:inline">Mコード変換仕様</span>
            </button>

            {/* ログインユーザー情報 & ログアウト */}
            <div className="flex items-center space-x-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs flex-shrink-0">
              {canEdit ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" title="管理者(全社・編集可)" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" title="閲覧専用" />
              )}
              <span className="hidden md:inline text-slate-300 max-w-[10rem] truncate" title={userEmail ?? undefined}>
                {userEmail ?? (canEdit ? '管理者' : '閲覧専用')}
              </span>
              <button
                onClick={onSignOut}
                className="inline-flex items-center space-x-1 px-2 py-1 rounded text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                title="ログアウト"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">ログアウト</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
