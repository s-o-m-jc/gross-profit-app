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
 *
 * ★2026-08-27再改修(22-10・22-11章修正6): 一覧テーブルの列構成を運用者フィードバックに
 * より変更(出勤日数/有給日数/労働時間(合計)/時間内時間/時間外時間/休出時間/給与(課税)計/
 * 給与(非課税/交通費)計/立替金/研修手当/社保合計額/控除額計/差引支給額)。有給金額列は
 * 一覧テーブルからは削除したが、行クリックで開く詳細内訳の「有給」カテゴリからは削除していない。
 * また対象月の選択状態は、月次粗利明細一覧タブと共有するためApp.tsx(AppShell)側で
 * 一元管理する状態に変更した(修正5。selectedMonth/onSelectedMonthChangeをpropsで受け取る)。
 *
 * ★2026-08-27再々改修(22-19〜22-21章修正11・12): 列構成を再度変更(出勤日数/有給日数/
 * 労働時間(合計)/時間内時間/時間外時間/休出時間/交通費/立替金/研修手当/総支給額/
 * 社保合計額/控除額計/差引支給額)。「給与(課税)計」を削除し代わりに生CSVの「総支給額」を
 * 使用、「給与(非課税/交通費)計」は計算内容そのままで列名のみ「交通費」に変更した。
 * あわせて一覧上部の集計を、主要4項目のKPIカードから、★派遣明細202410.xlsm(未払計上表
 * シート)の合計行を踏襲した「一覧テーブルの全13列について列ごとの合計を出す合計行」形式に
 * 拡充した(表内、ヘッダー直下に固定表示)。
 */

import React, { useState, useMemo } from 'react';
import { Search, User, Users, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { PayrollRow } from '../types';
import { hasLegacyPayrollRows } from '../utils/monthlyData';

interface StaffPayrollDetailProps {
  payrollRows: PayrollRow[];
  /** 選択中の対象年月("YYYY-MM"または"ALL")。月次粗利明細一覧タブと状態を共有する。 */
  selectedMonth: string;
  onSelectedMonthChange: (month: string) => void;
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

/**
 * 一覧テーブルの列に表示する主要小計。既存で保持済みのCSV由来項目の単純合算のみで、
 * 新規の計算ロジックは追加しない。
 * ★2026-08-27改修(22-11章修正6): 運用者フィードバックにより列構成を変更。
 * 有給日数は0.5日刻みの実データがそのまま出るよう丸めない。
 * ★2026-08-27再改修(22-19章修正11): 「給与(課税)計」列を削除し「総支給額」(p.paymentAmount
 * をそのまま使用)に置き換え、「給与(非課税/交通費)計」は同じ計算のまま列名のみ「交通費」に変更。
 * taxableSalaryはどの列にも使われなくなったため削除した。
 */
function computeSummary(p: PayrollRow) {
  // 交通費(列名変更前の「給与(非課税/交通費)計」と同一の計算。中身は変更しない)
  const transportSummary =
    (p.salaryTransport ?? 0) + (p.transportTaxable ?? 0) + (p.commsAllowance ?? 0) + (p.nonTaxableOtherAllowances ?? 0);
  // 労働時間(合計) = 時間内時間・時間外時間・深夜内時間・深夜外時間・休日出時間・その他時間外(時間)の合算
  const totalWorkHours =
    (p.regularHours ?? 0) +
    (p.overtimeHours ?? 0) +
    (p.nightHours ?? 0) +
    (p.nightOvertimeHours ?? 0) +
    (p.holidayWorkHours ?? 0) +
    (p.otherOvertimeHours ?? 0);
  return {
    workDays: p.workDays ?? 0,
    paidLeaveDays: p.paidLeaveDays ?? 0,
    totalWorkHours,
    regularHours: p.regularHours ?? 0,
    overtimeHours: p.overtimeHours ?? 0,
    holidayWorkHours: p.holidayWorkHours ?? 0,
    transportSummary,
    reimbursement: p.reimbursement ?? 0,
    trainingAllowance: p.trainingAllowance ?? 0,
    paymentAmount: p.paymentAmount ?? 0,
    socialInsurance: p.socialInsurance ?? 0,
    totalDeduction: p.totalDeduction ?? 0,
    netPayment: p.netPayment || p.paymentAmount,
  };
}

const hours = (v: number) => `${v.toFixed(1)}h`;

export const StaffPayrollDetail: React.FC<StaffPayrollDetailProps> = ({
  payrollRows,
  selectedMonth,
  onSelectedMonthChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const availableMonths = useMemo(
    () => Array.from(new Set(payrollRows.map((p) => p.targetMonth))).sort(),
    [payrollRows]
  );

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

  // ★2026-08-27追加(22-14章修正8)・拡充(22-20/22-21章修正12): 一覧テーブル上部の集計セクション。
  // 表示中(フィルタ適用後)の行を対象に、既存の値をそのまま合算するだけで新規の計算ロジックは追加しない。
  // 当初は主要4項目のみのKPIカードだったが、★派遣明細202410.xlsm(未払計上表シート)の
  // 合計行に合わせ、一覧テーブルの13列すべてについて列ごとの合計を出す「合計行」形式に拡充した。
  const totals = useMemo(() => {
    const staffCount = new Set(filteredRows.map((p) => p.staffNo)).size;
    const acc = {
      workDays: 0,
      paidLeaveDays: 0,
      totalWorkHours: 0,
      regularHours: 0,
      overtimeHours: 0,
      holidayWorkHours: 0,
      transportSummary: 0,
      reimbursement: 0,
      trainingAllowance: 0,
      paymentAmount: 0,
      socialInsurance: 0,
      totalDeduction: 0,
      netPayment: 0,
    };
    filteredRows.forEach((p) => {
      const s = computeSummary(p);
      acc.workDays += s.workDays;
      acc.paidLeaveDays += s.paidLeaveDays;
      acc.totalWorkHours += s.totalWorkHours;
      acc.regularHours += s.regularHours;
      acc.overtimeHours += s.overtimeHours;
      acc.holidayWorkHours += s.holidayWorkHours;
      acc.transportSummary += s.transportSummary;
      acc.reimbursement += s.reimbursement;
      acc.trainingAllowance += s.trainingAllowance;
      acc.paymentAmount += s.paymentAmount;
      acc.socialInsurance += s.socialInsurance;
      acc.totalDeduction += s.totalDeduction;
      acc.netPayment += s.netPayment;
    });
    return { staffCount, ...acc };
  }, [filteredRows]);

  // ★2026-08-27追加(22-16・22-17章): 表示中の行に、型拡張前に保存された旧形式のデータ
  // (出勤日数等のフィールド自体を持たない)が含まれる場合、原因不明のまま0表示になるのを
  // 避けるため案内バナーを表示する。解消するには該当月のCSVを再アップロードする必要がある。
  const showLegacyDataWarning = useMemo(() => hasLegacyPayrollRows(filteredRows), [filteredRows]);

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
            onChange={(e) => onSelectedMonthChange(e.target.value)}
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

      {/* 旧形式データの案内バナー (★2026-08-27追加・22-16/22-17章) */}
      {showLegacyDataWarning && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start space-x-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            表示中のデータの一部は、出勤日数等の項目が追加される前のバージョンで取り込まれた旧形式のため、それらの項目が0表示になっています。正しく表示するには、「データ管理」タブで対象月を確認のうえ、該当月の給与データCSVを再アップロードしてください。
          </span>
        </div>
      )}

      {filteredRows.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          該当する給与データが見つかりません。給与計算CSVを読み込んでください。
        </div>
      ) : (
        <div className="overflow-auto table-scroll max-h-[calc(100vh-260px)] rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs border-collapse">
            {/* ★2026-08-27追加(22-22/22-23章修正13、2026-09-02再修正): 列見出し・合計行を
                sticky指定で常に見える状態にする。以前はページ全体の縦スクロールを基準に
                top-16(Header.tsx分オフセット)で固定していたが、195件超などテーブルの行数が
                多いと横スクロールバーがテーブル最下部(全行の下)に付いてしまい、そこまで
                スクロールしないと使えないという問題があった。そのため、テーブルの縦横スクロール
                自体をこの枠(overflow-auto + max-h-[calc(100vh-260px)]、2026-09-02同日65vhから
                再調整)の内側に閉じ込め、横スクロールバーが
                常に画面内(枠の下端)に表示され続けるようにした。それに伴い、theadのstickyは
                ページ基準のtop-16から、この枠を基準としたtop-0に変更した。thead内の2行
                (見出し行・合計行)はまとめてsticky化される(スタック順はDOM順のまま)。背景を
                半透明のままにすると固定時にスクロール中の本文が透けるため、不透明色にしている。 */}
            <thead className="sticky top-0 z-20 shadow-sm">
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="py-3 px-3 whitespace-nowrap w-6"></th>
                <th className="py-3 px-3 whitespace-nowrap">スタッフ</th>
                <th className="py-3 px-3 whitespace-nowrap">対象月</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">出勤日数</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">有給日数</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">労働時間(合計)</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">時間内時間</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">時間外時間</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">休出時間</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">交通費</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">立替金</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">研修手当</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">総支給額</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">社保合計額</th>
                <th className="py-3 px-3 whitespace-nowrap text-right">控除額計</th>
                <th className="py-3 px-3 whitespace-nowrap text-right bg-indigo-100/70">差引支給額</th>
              </tr>
              {/* 合計行 (★2026-08-27追加・22-20/22-21章修正12): 表示中(フィルタ適用後)の
                  全スタッフ分について、右側の各列と同じ並びで列ごとの合計値を表示する。
                  ★派遣明細202410.xlsm(未払計上表シート)の合計行(9〜10行目)を踏襲。 */}
              <tr className="bg-indigo-50 text-indigo-900 font-extrabold border-b-2 border-indigo-200">
                <td className="py-2.5 px-3"></td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <div className="flex items-center space-x-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-600" />
                    <span>合計 ({totals.staffCount}名)</span>
                  </div>
                </td>
                <td className="py-2.5 px-3"></td>
                <td className="py-2.5 px-3 text-right font-mono">{totals.workDays}日</td>
                <td className="py-2.5 px-3 text-right font-mono">{totals.paidLeaveDays}日</td>
                <td className="py-2.5 px-3 text-right font-mono">{hours(totals.totalWorkHours)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{hours(totals.regularHours)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{hours(totals.overtimeHours)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{hours(totals.holidayWorkHours)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.transportSummary)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.reimbursement)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.trainingAllowance)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.paymentAmount)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.socialInsurance)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.totalDeduction)}</td>
                <td className="py-2.5 px-3 text-right font-mono bg-indigo-100">{yen(totals.netPayment)}</td>
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
                            <div className="font-bold text-slate-900 flex items-center space-x-1">
                              <span>{p.staffName}</span>
                              {p.staffCategory && (
                                <span className="text-[9px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded px-1 py-0.5">
                                  {p.staffCategory}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">{p.staffNo}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-600 whitespace-nowrap">{p.targetMonth}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{s.workDays}日</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{s.paidLeaveDays}日</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{hours(s.totalWorkHours)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">{hours(s.regularHours)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">{hours(s.overtimeHours)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">{hours(s.holidayWorkHours)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.transportSummary)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">{yen(s.reimbursement)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">{yen(s.trainingAllowance)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.paymentAmount)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.socialInsurance)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.totalDeduction)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-extrabold text-slate-900 bg-indigo-50/30">
                        {yen(s.netPayment)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={16} className="bg-slate-50/60 px-4 py-4">
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
