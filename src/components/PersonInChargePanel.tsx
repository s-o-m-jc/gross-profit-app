/**
 * 派遣事業 粗利・経理管理システム
 * 担当者(手入力)パネル (★2026-09-11新設、23章タスクB)
 *
 * クライアント(企業)×対象月単位で営業担当者名を手入力・編集できるパネル。
 * 休業分補償等(ManualAdjustmentsPanel)の手入力調整項目と異なり、同じクライアント×対象月の
 * 組み合わせに対しては履歴として複数追加するのではなく、常に1件だけを保つ(上書き編集)。
 * 保存すると、MonthlyCalculationTable(月次粗利明細一覧)の「担当者」列に、その組み合わせに
 * 属する全行へ反映される(calculator.ts参照。取り込み元(現状は松山のみ)の値より優先される)。
 *
 * 会社×対象月ごとにデータを持ち、他の手入力カテゴリと同じくmonthlyData経由でSupabase自動保存・
 * JSONバックアップ/復元の対象に含まれる(App.tsx参照)。
 */

import React, { useMemo, useState } from 'react';
import { UserCog, PlusCircle, Trash2, Pencil } from 'lucide-react';
import { BillingRow, PersonInChargeRow } from '../types';
import { CompanyMonthlyData, MonthlyDataState, listRealMonths } from '../utils/monthlyData';

interface PersonInChargePanelProps {
  companyName: string;
  companyMonths: CompanyMonthlyData;
  onUpsert: (row: PersonInChargeRow) => void;
  onRemove: (row: PersonInChargeRow) => void;
  /** falseの場合(viewer)は入力フォーム・編集/削除ボタンを非表示にし、一覧の閲覧のみ可能にする */
  canEdit: boolean;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

const inputClass =
  'px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full';
const labelClass = 'text-[11px] font-semibold text-slate-500 block mb-1';

export const PersonInChargePanel: React.FC<PersonInChargePanelProps> = ({
  companyName,
  companyMonths,
  onUpsert,
  onRemove,
  canEdit,
}) => {
  const months = listRealMonths(companyMonths);

  // 全月の担当者(手入力)行をフラットに一覧化(月の新しい順)
  const rows = useMemo(
    () =>
      [...months]
        .reverse()
        .flatMap((m) => companyMonths[m]?.personInChargeRows || [])
        .sort((a, b) => b.targetMonth.localeCompare(a.targetMonth) || a.clientName.localeCompare(b.clientName, 'ja')),
    [companyMonths, months]
  );

  // クライアント選択肢: 既存の請求データ(全月)から重複排除した{clientCode, clientName}一覧。
  // 未読込のクライアントも自由入力できるようdatalistで実装する(ManualAdjustmentsPanelと同じ方式)。
  const knownClients = useMemo(() => {
    const map = new Map<string, string>(); // clientName -> clientCode
    Object.values(companyMonths).forEach((m: MonthlyDataState) => {
      (m.billingRows || []).forEach((b: BillingRow) => {
        if (b.clientName) map.set(b.clientName, b.clientCode || '');
      });
    });
    return Array.from(map.entries()).map(([clientName, clientCode]) => ({ clientName, clientCode }));
  }, [companyMonths]);

  const resolveClientCode = (clientName: string): string => {
    const trimmed = clientName.trim();
    const found = knownClients.find((c) => c.clientName === trimmed);
    if (found && found.clientCode) return found.clientCode;
    return `MANUAL_${trimmed}`;
  };

  const [month, setMonth] = useState('');
  const [clientName, setClientName] = useState('');
  const [personInCharge, setPersonInCharge] = useState('');
  const [error, setError] = useState('');
  // 編集中(既存行を上書き保存)の場合、元の行のidを保持する(クライアント名を変えると
  // 別のクライアントコードになりidが変わるため、新規追加として扱われるのは想定通り)
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetForm = () => {
    setMonth('');
    setClientName('');
    setPersonInCharge('');
    setError('');
    setEditingId(null);
  };

  const handleEdit = (row: PersonInChargeRow) => {
    setMonth(row.targetMonth);
    setClientName(row.clientName);
    setPersonInCharge(row.personInCharge);
    setEditingId(row.id);
    setError('');
  };

  const handleSubmit = () => {
    if (!MONTH_PATTERN.test(month)) {
      setError('対象月を入力してください(例: 2026-04)。');
      return;
    }
    if (!clientName.trim()) {
      setError('クライアント名を入力してください。');
      return;
    }
    if (!personInCharge.trim()) {
      setError('担当者名を入力してください。');
      return;
    }
    setError('');
    const clientCode = resolveClientCode(clientName);
    onUpsert({
      id: `${month}_${clientCode}`,
      targetMonth: month,
      clientCode,
      clientName: clientName.trim(),
      personInCharge: personInCharge.trim(),
    });
    resetForm();
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
      <div className="mb-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
          <UserCog className="w-5 h-5 text-indigo-600" />
          <span>担当者 (手入力・{companyName})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          クライアント(企業)×対象月単位で営業担当者を登録します。同じクライアント×対象月への再保存は上書きされます
          (履歴として複数残すものではありません)。保存すると、下の月次粗利明細一覧の「担当者」列に反映されます。
          {companyName.includes('松山') && '松山は「請求支払一覧」シート由来の担当者が自動で入りますが、ここで登録した値があれば常にそちらを優先します。'}
        </p>
      </div>

      {canEdit && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
            <div>
              <label className={labelClass}>対象月</label>
              <input
                type="month"
                data-testid="pic-month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>クライアント名</label>
              <input
                type="text"
                data-testid="pic-client"
                list="person-in-charge-client-list"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="例: トヨタ自動車九州"
                className={inputClass}
              />
              <datalist id="person-in-charge-client-list">
                {knownClients.map((c) => (
                  <option key={c.clientName} value={c.clientName} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelClass}>担当者名</label>
              <input
                type="text"
                data-testid="pic-name"
                value={personInCharge}
                onChange={(e) => setPersonInCharge(e.target.value)}
                placeholder="例: 梶原 雅宏"
                className={inputClass}
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                data-testid="pic-save"
                onClick={handleSubmit}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>{editingId ? '上書き保存' : '保存'}</span>
              </button>
              {editingId && (
                <button
                  onClick={resetForm}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
                >
                  キャンセル
                </button>
              )}
            </div>
          </div>
          {error && <p className="text-[11px] text-rose-600 mb-2">{error}</p>}
        </>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
          まだ担当者の手入力データはありません。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">対象月</th>
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">クライアント</th>
                <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">担当者</th>
                {canEdit && <th className="w-16" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{r.targetMonth}</td>
                  <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{r.clientName}</td>
                  <td className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">{r.personInCharge}</td>
                  {canEdit && (
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleEdit(r)}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        title="この行を編集"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onRemove(r)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                        title="この行を削除(取り込み元の値に戻ります)"
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
