/**
 * 派遣事業 粗利・経理管理システム
 * 退職金配賦 手入力パネル
 *
 * ★2026-08-26: 「④退職金・調整CSV」アップロードカードを廃止し、休業分補償・休業手当等と
 * 同様の手入力フォーム形式に変更した(実運用ではCSVでの取込を行わず、対象月・スタッフNo・
 * 退職金配賦額を1件ずつ手入力する運用のため)。データは他のカテゴリと同じくmonthlyData経由で
 * Supabase保存・IndexedDBキャッシュ・JSONバックアップの対象に含まれる(App.tsx参照)。
 */

import React, { useMemo, useState } from 'react';
import { Briefcase, PlusCircle, Trash2 } from 'lucide-react';
import { RetirementRow } from '../types';
import { CompanyMonthlyData, listRealMonths } from '../utils/monthlyData';

interface RetirementPanelProps {
  companyName: string;
  companyMonths: CompanyMonthlyData;
  onAdd: (row: RetirementRow) => void;
  onRemove: (row: RetirementRow) => void;
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

export const RetirementPanel: React.FC<RetirementPanelProps> = ({
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
        .flatMap((m) => companyMonths[m]?.retirementRows || [])
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
      setError('退職金配賦額を数値で入力してください。');
      return;
    }
    setError('');
    onAdd({
      id: generateId('RET'),
      targetMonth: month,
      staffNo: staffNo.trim(),
      retirementAmount: amountNum,
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
          <Briefcase className="w-5 h-5 text-indigo-600" />
          <span>退職金配賦 ({companyName})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          対象月・スタッフNo・退職金配賦額を1件ずつ手入力します(CSV取込は行いません)。
        </p>
      </div>

      {canEdit && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
            <div>
              <label className={labelClass}>対象月</label>
              <input
                type="month"
                data-testid="ret-month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>スタッフNo</label>
              <input
                type="text"
                data-testid="ret-staff"
                value={staffNo}
                onChange={(e) => setStaffNo(e.target.value)}
                placeholder="例: S1001"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>退職金配賦額</label>
              <input
                type="number"
                data-testid="ret-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="例: 12000"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>備考(任意)</label>
              <input
                type="text"
                data-testid="ret-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="例: 毎月定額積立配賦"
                className={inputClass}
              />
            </div>
          </div>
          {error && <p className="text-[11px] text-rose-600 mb-2">{error}</p>}
          <button
            data-testid="ret-add"
            onClick={handleAddSubmit}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors mb-4"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>退職金配賦を追加</span>
          </button>
        </>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
          まだ退職金配賦の手入力データはありません。
        </p>
      ) : (
        <div className="overflow-x-auto table-scroll">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">対象月</th>
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">スタッフNo</th>
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">退職金配賦額</th>
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
                    ¥{r.retirementAmount.toLocaleString()}
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
