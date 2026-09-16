/**
 * 派遣事業 粗利・経理管理システム
 * データ管理パネル: 選択中の会社について、どの対象月のデータが読み込み済みかを一覧表示し、
 * プロジェクトデータ(全社・全月)のファイル保存/読込を行う。
 */

import React, { useRef } from 'react';
import { Database, Save, Upload, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { CompanyMonthlyData, listRealMonths, hasLegacyPayrollRows } from '../utils/monthlyData';

interface MonthlyDataPanelProps {
  companyName: string;
  companyMonths: CompanyMonthlyData;
  onSaveToFile: () => void;
  onLoadFromFile: (file: File) => void;
  /** falseの場合(viewer)は「ファイルから読込」(上書き操作)を非表示にする。閲覧・エクスポートは可能。 */
  canEdit: boolean;
  /** ★2026-09-20追加(はまさんの指摘「月一覧が決算期と連動していない」): 選択中の決算期に
   * 属する対象年月一覧("YYYY-MM"×12)。画面上部の「決算期指定」と同じ値をApp.tsx(AppShell)側
   * から渡してもらい、月一覧をその決算期の月だけに絞り込む(データが存在する全期間ではなく)。 */
  fiscalYearMonths: string[];
  /** 選択中の決算期のラベル(月一覧の見出し脇に「◯◯年◯月期の月のみ表示中」等の説明表示用) */
  fiscalYearLabel: string;
}

const CATEGORY_COLUMNS: {
  key:
    | 'payrollRows'
    | 'billingRows'
    | 'invoiceRows'
    | 'retirementRows'
    | 'leaveCompensationRows'
    | 'leaveAllowanceRows'
    | 'nextMonthAdjustmentRows'
    | 'paidLeaveOverrideRows'
    | 'personInChargeRows'
    | 'referralFeeRows';
  label: string;
}[] = [
  { key: 'payrollRows', label: '給与' },
  { key: 'billingRows', label: '請求' },
  { key: 'invoiceRows', label: '請求書印刷' },
  { key: 'retirementRows', label: '退職金' },
  { key: 'leaveCompensationRows', label: '休業分補償' },
  { key: 'leaveAllowanceRows', label: '休業手当' },
  { key: 'nextMonthAdjustmentRows', label: '次月調整' },
  // ★2026-09-02追加(スタッフ給与明細バグ報告): 有給(手入力)。他の手入力カテゴリと同じく
  // ここでも月ごとの件数を確認できるようにする。
  { key: 'paidLeaveOverrideRows', label: '有給(手入力)' },
  // ★2026-09-11追加(23章タスクB「担当者」列復活): 担当者(手入力)。
  { key: 'personInChargeRows', label: '担当者(手入力)' },
  // ★2026-09-19追加(はまさんの指摘): 紹介手数料(手入力)。
  { key: 'referralFeeRows', label: '紹介手数料(手入力)' },
];

const CountBadge: React.FC<{ count: number }> = ({ count }) =>
  count > 0 ? (
    <span className="inline-flex items-center space-x-1 text-emerald-700 text-[11px] font-bold">
      <CheckCircle2 className="w-3 h-3" />
      <span>{count}件</span>
    </span>
  ) : (
    <span className="inline-flex items-center space-x-1 text-slate-300 text-[11px]">
      <XCircle className="w-3 h-3" />
      <span>―</span>
    </span>
  );

export const MonthlyDataPanel: React.FC<MonthlyDataPanelProps> = ({
  companyName,
  companyMonths,
  onSaveToFile,
  onLoadFromFile,
  canEdit,
  fiscalYearMonths,
  fiscalYearLabel,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ★2026-09-20修正(はまさんの指摘「月一覧が決算期と連動していない」): 以前はこの会社に
  // 存在する全期間の月をそのまま列挙していたため、データが存在する全期間(何年分も)が
  // 一つの長い一覧になってしまっていた。画面上部の「決算期指定」と同じ範囲(fiscalYearMonths)
  // に絞り込む。
  const fiscalYearMonthSet = new Set(fiscalYearMonths);
  const months = listRealMonths(companyMonths).filter((m) => fiscalYearMonthSet.has(m));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Database className="w-5 h-5 text-indigo-600" />
            <span>データ管理 ({companyName})</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            月ごとに読み込み済みのCSVデータ一覧(選択中の決算期「{fiscalYearLabel}」の月のみ表示)。ブラウザに自動保存され、リロードしても保持されます。
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onSaveToFile}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors"
            title="全社・全月のデータをJSONファイルとして保存します(PCの乗り換え・ブラウザ変更時にお使いください)"
          >
            <Save className="w-3.5 h-3.5" />
            <span>データをファイルに保存</span>
          </button>
          {canEdit && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onLoadFromFile(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                title="保存済みのバックアップJSONファイルから、全社・全月のデータを復元します"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>ファイルから読込</span>
              </button>
            </>
          )}
        </div>
      </div>

      {months.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
          選択中の決算期「{fiscalYearLabel}」にはまだこの会社のデータが読み込まれていません。
          下のエリアからCSVをアップロードするか、画面上部の「決算期指定」を切り替えてご確認ください。
        </p>
      ) : (
        <div className="overflow-x-auto table-scroll">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="text-left py-1.5 pr-3 font-semibold">対象月</th>
                {CATEGORY_COLUMNS.map((c) => (
                  <th key={c.key} className="text-left py-1.5 pr-3 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((month) => {
                const payrollRows = companyMonths[month]?.payrollRows || [];
                const isLegacyPayroll = hasLegacyPayrollRows(payrollRows);
                return (
                  <tr key={month} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 pr-3 font-bold text-slate-800 whitespace-nowrap">{month}</td>
                    {CATEGORY_COLUMNS.map((c) => (
                      <td key={c.key} className="py-1.5 pr-3">
                        <div className="flex items-center space-x-1">
                          <CountBadge count={companyMonths[month]?.[c.key]?.length || 0} />
                          {c.key === 'payrollRows' && isLegacyPayroll && (
                            <span
                              title="以前のバージョンで取り込まれた旧形式のデータのため、出勤日数等の詳細項目を保持していません。正しく表示するには、この月の給与データCSVを再アップロードしてください。"
                              className="inline-flex items-center text-amber-500"
                            >
                              <AlertTriangle className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
