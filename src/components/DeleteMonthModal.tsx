/**
 * 派遣事業 粗利・経理管理システム
 * 1ヶ月単位のデータ削除モーダル
 *
 * ★2026-09-27追加(はまさんのご要望「取込みミスがあった際、管理者自身がその都度対応できるよう、
 * データ管理画面に会社・対象年月を指定して1ヶ月分だけ削除できる機能を追加してほしい」):
 * 誤操作で意図しないデータを消してしまわないよう、以下の安全策を組み込んでいる。
 * 1. 削除ボタンを押す前に、削除対象(会社名・対象年月・カテゴリ別件数)を明確に表示する。
 * 2. 対象年月をテキスト入力させ、入力値が完全一致した場合のみ削除ボタンが有効になる
 *    (type-to-confirm方式)。
 * 3. 削除実行の直前に、対象データ(この1ヶ月分)を自動でJSONファイルとしてダウンロードする
 *    (downloadMonthBackupFile、保存先は常にはまさんのPCのダウンロードフォルダ=リポジトリ外)。
 * 4. 削除完了後、削除件数とバックアップファイル名を画面に表示する。
 * 5. 削除処理自体(deleteCompanyMonth)は指定した会社・対象月のみを対象とし、他の月・他社の
 *    データには一切触れない(App.tsx側の既存の自動保存effectがSupabase側との差分同期を行う
 *    ため、この画面から直接Supabaseを操作するコードは書いていない)。
 */

import React, { useState } from 'react';
import { X, Trash2, AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { MonthlyDataState } from '../utils/monthlyData';
import { downloadMonthBackupFile } from '../utils/backupFile';

interface DeleteMonthModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
  targetMonth: string;
  /** 削除実行後、親のcompanyMonthsから対象月が消えることでundefinedになりうる
   * (詳細はコンポーネント本体のinitialMonthDataのコメント参照)。 */
  monthData: MonthlyDataState | undefined;
  onConfirmDelete: (month: string) => void;
}

const CATEGORY_LABELS: { key: keyof MonthlyDataState; label: string }[] = [
  { key: 'payrollRows', label: '給与' },
  { key: 'billingRows', label: '請求' },
  { key: 'invoiceRows', label: '請求書印刷' },
  { key: 'retirementRows', label: '退職金' },
  { key: 'leaveCompensationRows', label: '休業分補償' },
  { key: 'leaveAllowanceRows', label: '休業手当' },
  { key: 'nextMonthAdjustmentRows', label: '次月調整' },
  { key: 'paidLeaveOverrideRows', label: '有給(手入力)' },
  { key: 'personInChargeRows', label: '担当者(手入力)' },
  { key: 'referralFeeRows', label: '紹介手数料(手入力)' },
];

export const DeleteMonthModal: React.FC<DeleteMonthModalProps> = ({
  isOpen,
  onClose,
  companyId,
  companyName,
  targetMonth,
  monthData,
  onConfirmDelete,
}) => {
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<{ totalCount: number; backupFileName: string } | null>(null);
  // ★2026-09-27追加: 削除実行後、親コンポーネントのcompanyMonthsから対象月が消えることで
  // monthDataがundefinedになるタイミングがある(このモーダル自体はまだ開いたまま「削除完了」
  // 画面を表示している間)。件数表示が削除実行後も壊れないよう、モーダルが開いた時点の
  // monthDataを1度だけ捕捉しておく(遅延初期化。以後、親から渡されるmonthDataの変化を
  // 追いかけない)。
  const [initialMonthData] = useState(monthData);

  if (!isOpen) return null;

  const counts = CATEGORY_LABELS.map((c) => ({ ...c, count: initialMonthData?.[c.key]?.length || 0 }));
  const totalCount = counts.reduce((s, c) => s + c.count, 0);
  const isMatch = confirmText.trim() === targetMonth;

  const handleClose = () => {
    setConfirmText('');
    setResult(null);
    onClose();
  };

  const handleDelete = () => {
    if (!isMatch || !initialMonthData) return;
    // 削除実行の直前に、この1ヶ月分だけを自動バックアップする(安全策3)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const backupFileName = `派遣事業粗利経理システム_削除前バックアップ_${companyName}_${targetMonth}_${stamp}.json`;
    downloadMonthBackupFile(companyId, companyName, targetMonth, initialMonthData);
    onConfirmDelete(targetMonth);
    setResult({ totalCount, backupFileName });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-rose-700 text-white p-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Trash2 className="w-5 h-5" />
            <h2 className="text-sm font-bold">1ヶ月分のデータを削除</h2>
          </div>
          <button onClick={handleClose} className="p-1 text-rose-200 hover:text-white rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {result ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center space-x-1.5 text-emerald-700 font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>削除が完了しました</span>
              </div>
              <p className="text-slate-700">
                {companyName} / {targetMonth} のデータ <strong>{result.totalCount}件</strong> を削除しました。
              </p>
              <div className="flex items-start space-x-1.5 text-slate-600 bg-white rounded-lg border border-slate-200 p-2">
                <Download className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-indigo-500" />
                <span>
                  削除前のバックアップをダウンロードしました:
                  <br />
                  <span className="font-mono text-[10px] break-all">{result.backupFileName}</span>
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 space-y-1">
                <div className="flex items-center space-x-1.5 text-rose-700 font-bold">
                  <AlertTriangle className="w-4 h-4" />
                  <span>この操作は元に戻せません</span>
                </div>
                <p className="text-slate-700">
                  以下のデータを削除します。他の対象月・他社のデータには一切影響しません。
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">会社</span>
                  <span className="font-bold text-slate-900">{companyName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-semibold">対象年月</span>
                  <span className="font-bold text-slate-900 font-mono">{targetMonth}</span>
                </div>
                <div className="border-t border-slate-200 pt-2">
                  <span className="text-slate-500 font-semibold block mb-1">削除される件数(合計{totalCount}件)</span>
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {counts
                      .filter((c) => c.count > 0)
                      .map((c) => (
                        <li key={c.key} className="flex items-center justify-between text-slate-700">
                          <span>{c.label}</span>
                          <span className="font-mono font-bold">{c.count}件</span>
                        </li>
                      ))}
                    {counts.every((c) => c.count === 0) && <li className="text-slate-400">(データはありません)</li>}
                  </ul>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  確認のため、対象年月「<span className="font-mono text-rose-700">{targetMonth}</span>」を入力してください
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={targetMonth}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </div>
            </>
          )}
        </div>

        <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-end space-x-2">
          <button
            onClick={handleClose}
            className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-white"
          >
            {result ? '閉じる' : 'キャンセル'}
          </button>
          {!result && (
            <button
              onClick={handleDelete}
              disabled={!isMatch || !initialMonthData}
              className="px-4 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1.5 shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>この内容で削除する</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
