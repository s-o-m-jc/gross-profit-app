/**
 * 派遣事業 粗利・経理管理システム
 * 紹介手数料 手入力パネル
 *
 * ★2026-09-19追加(はまさんの指摘): 「紹介手数料」は現状、csvParser.ts(候補列名「紹介手数料」
 * 「紹介料」)がCSV由来で読み取る仕組みが既にあるが、実データでは3社とも該当列が実質存在せず
 * 常に0になっている(過去実績Excelにも列が無い)。今後の月次CSVアップロードでも同様に情報が
 * 含まれない見込みのため、RetirementPanel.tsx(退職金配賦)と全く同じ設計(対象月・スタッフNo・
 * 金額を1件ずつ手入力、CSV取込は行わない)で手入力できるようにした。データは他のカテゴリと
 * 同じくmonthlyData経由でSupabase保存・IndexedDBキャッシュ・JSONバックアップの対象に含まれる
 * (App.tsx参照)。手入力値はCSV由来の値(現状は常に0)に加算される(calculator.ts参照)。
 */

import React, { useMemo, useState } from 'react';
import { Handshake, PlusCircle, Trash2 } from 'lucide-react';
import { ReferralFeeRow } from '../types';
import { CompanyMonthlyData, listRealMonths } from '../utils/monthlyData';

interface ReferralFeePanelProps {
  companyName: string;
  companyMonths: CompanyMonthlyData;
  onAdd: (row: ReferralFeeRow) => void;
  onRemove: (row: ReferralFeeRow) => void;
  /** falseの場合(viewer)は入力フォーム・削除ボタンを非表示にし、一覧の閲覧のみ可能にする */
  canEdit: boolean;
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const inputClass =
  'px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full';
const labelClass = 'text-[11px] font-semibold text-slate-500 block mb-1';

export const ReferralFeePanel: React.FC<ReferralFeePanelProps> = ({
  companyName,
  companyMonths,
  onAdd,
  onRemove,
  canEdit,
}) => {
  const months = listRealMonths(companyMonths);
  const rows = useMemo(
    () =>
      [...months]
        .reverse()
        .flatMap((m) => companyMonths[m]?.referralFeeRows || [])
        .sort((a, b) => b.targetMonth.localeCompare(a.targetMonth)),
    [companyMonths, months]
  );

  const [month, setMonth] = useState('');
  const [staffNo, setStaffNo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');

  const handleAddSubmit = () => {
    const amountNum = Number(amount);
    if (!MONTH_PATTERN.test(month)) {
      setError('対象月を入力してください(例: 2026-04)。');
      return;
    }
    if (!staffNo.trim()) {
      setError('スタッフNoを入力してください。');
      return;
    }
    if (amount.trim() === '' || Number.isNaN(amountNum)) {
      setError('紹介手数料額を数値で入力してください。');
      return;
    }
    setError('');
    onAdd({
      id: generateId('REF'),
      targetMonth: month,
      staffNo: staffNo.trim(),
      amount: amountNum,
      memo: memo.trim() || undefined,
    });
    setStaffNo('');
    setAmount('');
    setMemo('');
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
      <div className="mb-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
          <Handshake className="w-5 h-5 text-indigo-600" />
          <span>紹介手数料 ({companyName})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          対象月・スタッフNo・紹介手数料額を1件ずつ手入力します(CSV取込は行いません)。粗利非算入・総売上算入という既存の扱いのまま反映されます。
        </p>
      </div>

      {canEdit && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
            <div>
              <label className={labelClass}>対象月</label>
              <input
                type="month"
                data-testid="ref-month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>スタッフNo</label>
              <input
                type="text"
                data-testid="ref-staff"
                value={staffNo}
                onChange={(e) => setStaffNo(e.target.value)}
                placeholder="例: S1001"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>紹介手数料額</label>
              <input
                type="number"
                data-testid="ref-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="例: 150000"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>備考(任意)</label>
              <input
                type="text"
                data-testid="ref-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="例: 西日本鉄道・臨時紹介分"
                className={inputClass}
              />
            </div>
          </div>
          {error && <p className="text-[11px] text-rose-600 mb-2">{error}</p>}
          <button
            data-testid="ref-add"
            onClick={handleAddSubmit}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors mb-4"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>紹介手数料を追加</span>
          </button>
        </>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
          まだ紹介手数料の手入力データはありません。
        </p>
      ) : (
        <div className="overflow-x-auto table-scroll">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">対象月</th>
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">スタッフNo</th>
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">紹介手数料額</th>
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">備考</th>
                {canEdit && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{r.targetMonth}</td>
                  <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{r.staffNo}</td>
                  <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">
                    ¥{r.amount.toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{r.memo || '-'}</td>
                  {canEdit && (
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => onRemove(r)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                        title="この行を削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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
