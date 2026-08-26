/**
 * 派遣事業 粗利・経理管理システム
 * 手入力調整パネル (要件整理ドキュメント15章)
 *
 * 退職金(CSVアップロード)とは別に、CSVに存在しない3つの手入力項目を1件ずつ追加/削除できる
 * フォーム+一覧を提供する:
 *   1. 休業分補償 (売上側) : 対象月・クライアント・スタッフNo・金額・備考 → 派遣売上に加算
 *   2. 休業手当   (原価側) : 対象月・スタッフNo・金額・備考 → 給与総額(原価)に加算
 *      (給与計算CSV由来の「欠勤休業手当」列とは別物。自動転記はしない)
 *   3. 次月調整   (汎用)   : 対象月・スタッフNo・区分(売上側/原価側)・金額(符号付き)・備考
 *
 * 会社×対象月ごとにデータを持ち、他の手入力カテゴリと同じくmonthlyData経由でIndexedDB自動保存・
 * JSONバックアップ/復元の対象に含まれる(App.tsx参照)。
 */

import React, { useMemo, useState } from 'react';
import { Edit3, Umbrella, Wallet, ArrowLeftRight, PlusCircle, Trash2 } from 'lucide-react';
import { LeaveCompensationRow, LeaveAllowanceRow, NextMonthAdjustmentRow } from '../types';
import { CompanyMonthlyData, MonthlyDataState, listRealMonths } from '../utils/monthlyData';

interface ManualAdjustmentsPanelProps {
  companyName: string;
  companyMonths: CompanyMonthlyData;
  onAddLeaveCompensation: (row: LeaveCompensationRow) => void;
  onRemoveLeaveCompensation: (row: LeaveCompensationRow) => void;
  onAddLeaveAllowance: (row: LeaveAllowanceRow) => void;
  onRemoveLeaveAllowance: (row: LeaveAllowanceRow) => void;
  onAddNextMonthAdjustment: (row: NextMonthAdjustmentRow) => void;
  onRemoveNextMonthAdjustment: (row: NextMonthAdjustmentRow) => void;
  /** falseの場合(viewer)は入力フォーム・削除ボタンを非表示にし、一覧の閲覧のみ可能にする */
  canEdit: boolean;
}

type TabKey = 'leaveCompensation' | 'leaveAllowance' | 'nextMonthAdjustment';

/** ブラウザ環境依存のcrypto.randomUUIDが無い場合のフォールバック込みID発行 */
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

export const ManualAdjustmentsPanel: React.FC<ManualAdjustmentsPanelProps> = ({
  companyName,
  companyMonths,
  onAddLeaveCompensation,
  onRemoveLeaveCompensation,
  onAddLeaveAllowance,
  onRemoveLeaveAllowance,
  onAddNextMonthAdjustment,
  onRemoveNextMonthAdjustment,
  canEdit,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('leaveCompensation');

  const months = listRealMonths(companyMonths);

  // 選択中の会社・全月分の手入力行をフラットに一覧化(月の新しい順に並べて直近の入力を見やすくする)
  const leaveCompensationRows = useMemo(
    () =>
      [...months]
        .reverse()
        .flatMap((m) => companyMonths[m]?.leaveCompensationRows || [])
        .sort((a, b) => b.targetMonth.localeCompare(a.targetMonth)),
    [companyMonths, months]
  );
  const leaveAllowanceRows = useMemo(
    () =>
      [...months]
        .reverse()
        .flatMap((m) => companyMonths[m]?.leaveAllowanceRows || [])
        .sort((a, b) => b.targetMonth.localeCompare(a.targetMonth)),
    [companyMonths, months]
  );
  const nextMonthAdjustmentRows = useMemo(
    () =>
      [...months]
        .reverse()
        .flatMap((m) => companyMonths[m]?.nextMonthAdjustmentRows || [])
        .sort((a, b) => b.targetMonth.localeCompare(a.targetMonth)),
    [companyMonths, months]
  );

  // 休業分補償のクライアント選択肢: 既存の請求データ(全月)から重複排除した{clientCode, clientName}一覧。
  // 既存のクライアント選択と同様の形式(=読み込み済みデータから選ぶ)にしつつ、未読込のクライアントも
  // 自由入力できるようdatalistで実装する。
  const knownClients = useMemo(() => {
    const map = new Map<string, string>(); // clientName -> clientCode
    Object.values(companyMonths).forEach((m: MonthlyDataState) => {
      (m.billingRows || []).forEach((b) => {
        if (b.clientName) map.set(b.clientName, b.clientCode || '');
      });
      (m.leaveCompensationRows || []).forEach((lc) => {
        if (lc.clientName) map.set(lc.clientName, lc.clientCode || '');
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

  // ---- 休業分補償 フォーム状態 ----
  const [lcMonth, setLcMonth] = useState('');
  const [lcClientName, setLcClientName] = useState('');
  const [lcStaffNo, setLcStaffNo] = useState('');
  const [lcAmount, setLcAmount] = useState('');
  const [lcMemo, setLcMemo] = useState('');
  const [lcError, setLcError] = useState('');

  const handleAddLeaveCompensationSubmit = () => {
    const amount = Number(lcAmount);
    if (!MONTH_PATTERN.test(lcMonth)) {
      setLcError('対象月を入力してください(例: 2026-04)。');
      return;
    }
    if (!lcClientName.trim()) {
      setLcError('クライアント名を入力してください。');
      return;
    }
    if (!lcStaffNo.trim()) {
      setLcError('スタッフNoを入力してください。');
      return;
    }
    if (lcAmount.trim() === '' || Number.isNaN(amount)) {
      setLcError('金額を数値で入力してください。');
      return;
    }
    setLcError('');
    onAddLeaveCompensation({
      id: generateId('LC'),
      targetMonth: lcMonth,
      clientCode: resolveClientCode(lcClientName),
      clientName: lcClientName.trim(),
      staffNo: lcStaffNo.trim(),
      amount,
      memo: lcMemo.trim() || undefined,
    });
    setLcStaffNo('');
    setLcAmount('');
    setLcMemo('');
  };

  // ---- 休業手当 フォーム状態 ----
  const [laMonth, setLaMonth] = useState('');
  const [laStaffNo, setLaStaffNo] = useState('');
  const [laAmount, setLaAmount] = useState('');
  const [laMemo, setLaMemo] = useState('');
  const [laError, setLaError] = useState('');

  const handleAddLeaveAllowanceSubmit = () => {
    const amount = Number(laAmount);
    if (!MONTH_PATTERN.test(laMonth)) {
      setLaError('対象月を入力してください(例: 2026-04)。');
      return;
    }
    if (!laStaffNo.trim()) {
      setLaError('スタッフNoを入力してください。');
      return;
    }
    if (laAmount.trim() === '' || Number.isNaN(amount)) {
      setLaError('金額を数値で入力してください。');
      return;
    }
    setLaError('');
    onAddLeaveAllowance({
      id: generateId('LA'),
      targetMonth: laMonth,
      staffNo: laStaffNo.trim(),
      amount,
      memo: laMemo.trim() || undefined,
    });
    setLaStaffNo('');
    setLaAmount('');
    setLaMemo('');
  };

  // ---- 次月調整 フォーム状態 ----
  const [njMonth, setNjMonth] = useState('');
  const [njStaffNo, setNjStaffNo] = useState('');
  const [njSide, setNjSide] = useState<'SALES' | 'COST'>('SALES');
  const [njAmount, setNjAmount] = useState('');
  const [njMemo, setNjMemo] = useState('');
  const [njError, setNjError] = useState('');

  const handleAddNextMonthAdjustmentSubmit = () => {
    const amount = Number(njAmount);
    if (!MONTH_PATTERN.test(njMonth)) {
      setNjError('対象月を入力してください(例: 2026-04)。');
      return;
    }
    if (!njStaffNo.trim()) {
      setNjError('スタッフNoを入力してください。');
      return;
    }
    if (njAmount.trim() === '' || Number.isNaN(amount)) {
      setNjError('金額を数値で入力してください(マイナスも入力可)。');
      return;
    }
    setNjError('');
    onAddNextMonthAdjustment({
      id: generateId('NJ'),
      targetMonth: njMonth,
      staffNo: njStaffNo.trim(),
      side: njSide,
      amount,
      memo: njMemo.trim() || undefined,
    });
    setNjStaffNo('');
    setNjAmount('');
    setNjMemo('');
  };

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; count: number }[] = [
    {
      key: 'leaveCompensation',
      label: '休業分補償(売上側)',
      icon: <Umbrella className="w-3.5 h-3.5" />,
      count: leaveCompensationRows.length,
    },
    {
      key: 'leaveAllowance',
      label: '休業手当(原価側)',
      icon: <Wallet className="w-3.5 h-3.5" />,
      count: leaveAllowanceRows.length,
    },
    {
      key: 'nextMonthAdjustment',
      label: '次月調整',
      icon: <ArrowLeftRight className="w-3.5 h-3.5" />,
      count: nextMonthAdjustmentRows.length,
    },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
      <div className="mb-3">
        <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
          <Edit3 className="w-5 h-5 text-indigo-600" />
          <span>手入力調整 ({companyName})</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          休業分補償・休業手当・次月調整を1件ずつ入力します。退職金と同じく会社×対象月ごとにデータを持ち、
          自動保存・バックアップの対象に含まれます。
        </p>
      </div>

      {/* サブタブ */}
      <div className="flex flex-wrap gap-2 mb-4 border-b border-slate-200 pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            data-testid={`tab-${t.key}`}
            onClick={() => setActiveTab(t.key)}
            className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              activeTab === t.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                activeTab === t.key ? 'bg-white/20' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* 1. 休業分補償 */}
      {activeTab === 'leaveCompensation' && (
        <div>
          {canEdit && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-2">
                <div>
                  <label className={labelClass}>対象月</label>
                  <input
                    type="month"
                    data-testid="lc-month"
                    value={lcMonth}
                    onChange={(e) => setLcMonth(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>クライアント名</label>
                  <input
                    type="text"
                    data-testid="lc-client"
                    list="manual-adj-client-list"
                    value={lcClientName}
                    onChange={(e) => setLcClientName(e.target.value)}
                    placeholder="例: トヨタ自動車九州"
                    className={inputClass}
                  />
                  <datalist id="manual-adj-client-list">
                    {knownClients.map((c) => (
                      <option key={c.clientName} value={c.clientName} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className={labelClass}>スタッフNo</label>
                  <input
                    type="text"
                    data-testid="lc-staff"
                    value={lcStaffNo}
                    onChange={(e) => setLcStaffNo(e.target.value)}
                    placeholder="例: S1001"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>金額</label>
                  <input
                    type="number"
                    data-testid="lc-amount"
                    value={lcAmount}
                    onChange={(e) => setLcAmount(e.target.value)}
                    placeholder="例: 50000"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>備考(任意)</label>
                  <input
                    type="text"
                    data-testid="lc-memo"
                    value={lcMemo}
                    onChange={(e) => setLcMemo(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              {lcError && <p className="text-[11px] text-rose-600 mb-2">{lcError}</p>}
              <button
                data-testid="lc-add"
                onClick={handleAddLeaveCompensationSubmit}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors mb-4"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>休業分補償を追加(派遣売上に加算)</span>
              </button>
            </>
          )}

          <ManualEntryTable
            columns={['対象月', 'クライアント', 'スタッフNo', '金額', '備考']}
            rows={leaveCompensationRows.map((r) => ({
              key: r.id,
              cells: [r.targetMonth, r.clientName, r.staffNo, `¥${r.amount.toLocaleString()}`, r.memo || '-'],
              onRemove: canEdit ? () => onRemoveLeaveCompensation(r) : undefined,
            }))}
            emptyMessage="まだ休業分補償の手入力データはありません。"
          />
        </div>
      )}

      {/* 2. 休業手当 */}
      {activeTab === 'leaveAllowance' && (
        <div>
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            給与計算CSV(未払計上表)由来の「欠勤休業手当」列とは別の手入力項目です。混同しないようご注意ください
            (自動転記は行われません)。
          </p>
          {canEdit && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
                <div>
                  <label className={labelClass}>対象月</label>
                  <input
                    type="month"
                    data-testid="la-month"
                    value={laMonth}
                    onChange={(e) => setLaMonth(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>スタッフNo</label>
                  <input
                    type="text"
                    data-testid="la-staff"
                    value={laStaffNo}
                    onChange={(e) => setLaStaffNo(e.target.value)}
                    placeholder="例: S1001"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>金額</label>
                  <input
                    type="number"
                    data-testid="la-amount"
                    value={laAmount}
                    onChange={(e) => setLaAmount(e.target.value)}
                    placeholder="例: 30000"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>備考(任意)</label>
                  <input
                    type="text"
                    data-testid="la-memo"
                    value={laMemo}
                    onChange={(e) => setLaMemo(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              {laError && <p className="text-[11px] text-rose-600 mb-2">{laError}</p>}
              <button
                data-testid="la-add"
                onClick={handleAddLeaveAllowanceSubmit}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors mb-4"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>休業手当を追加(給与総額に加算)</span>
              </button>
            </>
          )}

          <ManualEntryTable
            columns={['対象月', 'スタッフNo', '金額', '備考']}
            rows={leaveAllowanceRows.map((r) => ({
              key: r.id,
              cells: [r.targetMonth, r.staffNo, `¥${r.amount.toLocaleString()}`, r.memo || '-'],
              onRemove: canEdit ? () => onRemoveLeaveAllowance(r) : undefined,
            }))}
            emptyMessage="まだ休業手当の手入力データはありません。"
          />
        </div>
      )}

      {/* 3. 次月調整 */}
      {activeTab === 'nextMonthAdjustment' && (
        <div>
          {canEdit && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-2">
                <div>
                  <label className={labelClass}>対象月</label>
                  <input
                    type="month"
                    data-testid="nj-month"
                    value={njMonth}
                    onChange={(e) => setNjMonth(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>スタッフNo</label>
                  <input
                    type="text"
                    data-testid="nj-staff"
                    value={njStaffNo}
                    onChange={(e) => setNjStaffNo(e.target.value)}
                    placeholder="例: S1001"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>区分</label>
                  <select
                    value={njSide}
                    data-testid="nj-side"
                    onChange={(e) => setNjSide(e.target.value as 'SALES' | 'COST')}
                    className={inputClass}
                  >
                    <option value="SALES">売上側 (派遣売上に加算)</option>
                    <option value="COST">原価側 (給与総額に加算)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>金額(マイナス可)</label>
                  <input
                    type="number"
                    data-testid="nj-amount"
                    value={njAmount}
                    onChange={(e) => setNjAmount(e.target.value)}
                    placeholder="例: -10000"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>備考(任意)</label>
                  <input
                    type="text"
                    data-testid="nj-memo"
                    value={njMemo}
                    onChange={(e) => setNjMemo(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              {njError && <p className="text-[11px] text-rose-600 mb-2">{njError}</p>}
              <button
                data-testid="nj-add"
                onClick={handleAddNextMonthAdjustmentSubmit}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors mb-4"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>次月調整を追加</span>
              </button>
            </>
          )}

          <ManualEntryTable
            columns={['対象月', 'スタッフNo', '区分', '金額', '備考']}
            rows={nextMonthAdjustmentRows.map((r) => ({
              key: r.id,
              cells: [
                r.targetMonth,
                r.staffNo,
                r.side === 'SALES' ? '売上側' : '原価側',
                `${r.amount < 0 ? '-' : ''}¥${Math.abs(r.amount).toLocaleString()}`,
                r.memo || '-',
              ],
              onRemove: canEdit ? () => onRemoveNextMonthAdjustment(r) : undefined,
            }))}
            emptyMessage="まだ次月調整の手入力データはありません。"
          />
        </div>
      )}
    </div>
  );
};

interface ManualEntryTableProps {
  columns: string[];
  // onRemove未指定(viewer)の場合は削除列自体を表示しない(閲覧専用)
  rows: { key: string; cells: React.ReactNode[]; onRemove?: () => void }[];
  emptyMessage: string;
}

const ManualEntryTable: React.FC<ManualEntryTableProps> = ({ columns, rows, emptyMessage }) => {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
        {emptyMessage}
      </p>
    );
  }

  const showRemoveColumn = rows.some((r) => r.onRemove);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            {columns.map((c) => (
              <th key={c} className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">
                {c}
              </th>
            ))}
            {showRemoveColumn && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
              {row.cells.map((cell, i) => (
                <td key={i} className="py-1.5 pr-3 font-medium text-slate-700 whitespace-nowrap">
                  {cell}
                </td>
              ))}
              {showRemoveColumn && (
                <td className="py-1.5 text-right">
                  {row.onRemove && (
                    <button
                      onClick={row.onRemove}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                      title="この行を削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
