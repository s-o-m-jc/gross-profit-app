/**
 * 派遣事業 粗利・経理管理システム
 * 「スタッフ給与明細」ビュー (★2026-08-27新設、22章タスク1)
 *
 * 目的: このアプリの計算結果をもとに実際にスタッフへの給与支払いを行うため、給与支給額の
 * 内訳(有給金額分・交通費分など)を正確に把握できるようにする。既存の「月次粗利明細一覧」
 * (クライアント×スタッフ契約単位)とは別に、スタッフ単位の明細を表示する。
 *
 * 給与計算CSV(76列)の内訳項目を、大阪人材の月別総合計シートの集計項目の考え方を踏襲した
 * 分かりやすいカテゴリ(勤怠/給与(課税)/給与(非課税)/有給/控除/支給額)に整理して表示する。
 * 列のグルーピングはcsvParser.tsの列マッピングに準拠し、実データに無い項目は作らない。
 *
 * ★2026-08-27改修(22-6・22-7章): 当初は1人1行のアコーディオン形式(常時展開しないと内訳が
 * 見えない)だったが、「毎月250人超の全員をひと通り見比べて異常がないか確認する」という
 * 実際の給与支払い業務の使い方に対して一覧性が低いという運用者フィードバックを受け、
 * 「一覧テーブル(主要な小計を列表示)＋行クリックで詳細内訳を展開」の2段階構成に変更した。
 * 詳細内訳の内容・ロジック自体は変更していない(表示のきっかけをアコーディオンから
 * テーブル行クリックに変えただけ)。
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, User, ChevronDown, ChevronUp } from 'lucide-react';
import { PayrollRow } from '../types';

interface StaffPayrollDetailProps {
  payrollRows: PayrollRow[];
}

const yen = (v: number | undefined) => `¥${(v ?? 0).toLocaleString()}`;

interface FieldSpec {
  label: string;
  value: string;
}

interface CategorySpec {
  title: string;
  accent: string;
  fields: FieldSpec[];
}

function buildCategories(p: PayrollRow): CategorySpec[] {
  return [
    {
      title: '勤怠',
      accent: 'border-slate-200',
      fields: [
        { label: '出勤日数', value: `${p.workDays ?? 0}日` },
        { label: '欠勤日数', value: `${p.absenceDays ?? 0}日` },
        { label: '休出日数', value: `${p.holidayWorkDays ?? 0}日` },
        { label: '遅早日数', value: `${p.lateEarlyDays ?? 0}日` },
        { label: '特別休暇日数', value: `${p.specialLeaveDays ?? 0}日` },
        { label: 'その他休暇日数 (休暇２〜４)', value: `${p.otherLeaveDays ?? 0}日` },
      ],
    },
    {
      title: '給与 (課税)',
      accent: 'border-indigo-200',
      fields: [
        { label: '時間内', value: yen(p.regularAmount) },
        { label: '時間外', value: yen(p.overtimeAmount) },
        { label: '深夜内', value: yen(p.nightAmount) },
        { label: '深夜外', value: yen(p.nightOvertimeAmount) },
        { label: '休日出', value: yen(p.holidayWorkAmount) },
        { label: 'その他時間外手当', value: yen(p.otherOvertimeAllowance) },
        { label: '休暇手当', value: yen(p.leaveAllowance) },
        { label: '欠勤休業手当', value: yen(p.absenceLeaveAllowance) },
        { label: '特休手当', value: yen(p.specialLeaveAllowance) },
        { label: '研修手当', value: yen(p.trainingAllowance) },
        { label: '福祉手当', value: yen(p.welfareAllowance) },
        { label: '有休手当', value: yen(p.paidLeaveAllowance2) },
        { label: '課税他 (課税他８〜１０合計)', value: yen(p.taxableOtherAllowances) },
      ],
    },
    {
      title: '給与 (非課税)',
      accent: 'border-emerald-200',
      fields: [
        { label: '交通費 (交通費1+2合算)', value: yen(p.salaryTransport) },
        { label: '交通費課税', value: yen(p.transportTaxable) },
        { label: '通信費', value: yen(p.commsAllowance) },
        { label: '非課税他 (非課税他３〜４合計)', value: yen(p.nonTaxableOtherAllowances) },
        { label: '立替金 (粗利計算には影響しません)', value: yen(p.reimbursement) },
      ],
    },
    {
      title: '有給',
      accent: 'border-amber-200',
      fields: [
        { label: '有給日数', value: `${p.paidLeaveDays}日` },
        { label: '有給手当 (金額・総支給額に内包済み)', value: yen(p.paidLeaveAllowance) },
        { label: '有給残日数', value: `${p.paidLeaveRemainingDays ?? 0}日` },
      ],
    },
    {
      title: '控除',
      accent: 'border-rose-200',
      fields: [
        { label: '健康保険', value: yen(p.healthInsurance) },
        { label: '介護保険', value: yen(p.nursingInsurance) },
        { label: '厚生年金', value: yen(p.pensionInsurance) },
        { label: '厚生年金基金', value: yen(p.pensionFund) },
        { label: '雇用保険', value: yen(p.employmentInsurance) },
        { label: '社保合計額', value: yen(p.socialInsurance) },
        { label: '所得税', value: yen(p.incomeTax) },
        { label: '住民税', value: yen(p.residentTax) },
        { label: '遅早控除', value: yen(p.lateEarlyDeduction) },
        { label: '欠勤控除', value: yen(p.absenceDeduction) },
        { label: '休暇控除', value: yen(p.leaveDeduction) },
        { label: '昼食代', value: yen(p.lunchFee) },
        { label: '健康診断料', value: yen(p.healthCheckFee) },
        { label: 'クリーニング代', value: yen(p.cleaningFee) },
        { label: '仮払精算', value: yen(p.advancePaymentSettlement) },
      ],
    },
    {
      title: '支給額',
      accent: 'border-slate-900',
      fields: [
        { label: '総支給額', value: yen(p.paymentAmount) },
        { label: '総控除額', value: yen(p.totalDeduction) },
        { label: '差引支給額 (実際の振込額)', value: yen(p.netPayment) },
      ],
    },
  ];
}

/** 一覧テーブルの列に表示する主要小計。既存の集計ロジック(csvParser.ts由来の値)からそのまま算出し、新規の計算ロジックは追加しない。 */
function computeSummary(p: PayrollRow) {
  const taxableSalary =
    (p.regularAmount ?? 0) +
    (p.overtimeAmount ?? 0) +
    (p.nightAmount ?? 0) +
    (p.nightOvertimeAmount ?? 0) +
    (p.holidayWorkAmount ?? 0) +
    (p.otherOvertimeAllowance ?? 0) +
    (p.leaveAllowance ?? 0) +
    (p.absenceLeaveAllowance ?? 0) +
    (p.specialLeaveAllowance ?? 0) +
    (p.trainingAllowance ?? 0) +
    (p.welfareAllowance ?? 0) +
    (p.paidLeaveAllowance2 ?? 0) +
    (p.taxableOtherAllowances ?? 0);
  const nonTaxableSalary =
    (p.salaryTransport ?? 0) + (p.transportTaxable ?? 0) + (p.commsAllowance ?? 0) + (p.nonTaxableOtherAllowances ?? 0);
  return {
    workDays: p.workDays ?? 0,
    paidLeaveDays: p.paidLeaveDays ?? 0,
    taxableSalary,
    nonTaxableSalary,
    paidLeaveAllowance: p.paidLeaveAllowance ?? 0,
    socialInsurance: p.socialInsurance ?? 0,
    netPayment: p.netPayment || p.paymentAmount,
  };
}

export const StaffPayrollDetail: React.FC<StaffPayrollDetailProps> = ({ payrollRows }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const availableMonths = useMemo(
    () => Array.from(new Set(payrollRows.map((p) => p.targetMonth))).sort(),
    [payrollRows]
  );

  // 初回にデータが揃った時点で1度だけ、直近の対象月を既定選択にする(全件一括表示を避けるため)
  const didAutoSelectMonth = useRef(false);
  useEffect(() => {
    if (!didAutoSelectMonth.current && availableMonths.length > 0) {
      setSelectedMonth(availableMonths[availableMonths.length - 1]);
      didAutoSelectMonth.current = true;
    }
  }, [availableMonths]);

  const filteredRows = useMemo(() => {
    return payrollRows
      .filter((p) => {
        if (selectedMonth !== 'ALL' && p.targetMonth !== selectedMonth) return false;
        if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          const match =
            p.staffName.toLowerCase().includes(q) ||
            p.staffNo.toLowerCase().includes(q) ||
            (p.staffNameKana || '').toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => (a.targetMonth === b.targetMonth ? a.staffNo.localeCompare(b.staffNo) : b.targetMonth.localeCompare(a.targetMonth)));
  }, [payrollRows, searchQuery, selectedMonth]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
      {/* 制御ツールバー */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="スタッフ名・No で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
          >
            <option value="ALL">全対象年月 ({payrollRows.length}件)</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-slate-500">
          表示: <strong className="text-slate-800 font-bold">{filteredRows.length}</strong> / {payrollRows.length} 件
          <span className="ml-2 text-slate-400">(行をクリックすると詳細内訳が開きます)</span>
        </span>
      </div>

      {filteredRows.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          該当する給与データが見つかりません。給与計算CSVを読み込んでください。
        </div>
      ) : (
        <div className="overflow-x-auto table-scroll">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                <th className="py-3 px-3 w-6"></th>
                <th className="py-3 px-3">スタッフ</th>
                <th className="py-3 px-3">対象月</th>
                <th className="py-3 px-3 text-right">出勤日数</th>
                <th className="py-3 px-3 text-right">有給日数</th>
                <th className="py-3 px-3 text-right">給与(課税)計</th>
                <th className="py-3 px-3 text-right">給与(非課税/交通費)計</th>
                <th className="py-3 px-3 text-right">有給金額</th>
                <th className="py-3 px-3 text-right">社保合計額</th>
                <th className="py-3 px-3 text-right bg-indigo-50/50">差引支給額</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
              {filteredRows.map((p) => {
                const id = `${p.targetMonth}_${p.staffNo}`;
                const expanded = expandedIds.has(id);
                const s = computeSummary(p);
                return (
                  <React.Fragment key={id}>
                    <tr onClick={() => toggleExpand(id)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                      <td className="py-2.5 px-3 text-slate-400">
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <div>
                            <div className="font-bold text-slate-900">{p.staffName}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{p.staffNo}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-600 whitespace-nowrap">{p.targetMonth}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{s.workDays}日</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{s.paidLeaveDays}日</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.taxableSalary)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.nonTaxableSalary)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.paidLeaveAllowance)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.socialInsurance)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-extrabold text-slate-900 bg-indigo-50/30">
                        {yen(s.netPayment)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={10} className="bg-slate-50/60 px-4 py-4">
                          {p.remarks && <p className="text-[11px] text-slate-400 mb-2">{p.remarks}</p>}
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {buildCategories(p).map((cat) => (
                              <div key={cat.title} className={`rounded-lg border ${cat.accent} bg-white p-3`}>
                                <h4 className="text-xs font-bold text-slate-700 mb-2">{cat.title}</h4>
                                <dl className="space-y-1">
                                  {cat.fields.map((f) => (
                                    <div key={f.label} className="flex items-center justify-between text-[11px]">
                                      <dt className="text-slate-500">{f.label}</dt>
                                      <dd className="font-mono font-semibold text-slate-800">{f.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
