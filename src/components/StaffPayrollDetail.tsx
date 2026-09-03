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
import { Search, User, Users, ChevronDown, ChevronUp, AlertTriangle, Plus, Trash2, PenLine } from 'lucide-react';
import { PayrollRow, PaidLeaveOverrideRow } from '../types';
import { hasLegacyPayrollRows } from '../utils/monthlyData';

interface StaffPayrollDetailProps {
  payrollRows: PayrollRow[];
  /** 選択中の対象年月("YYYY-MM"または"ALL")。月次粗利明細一覧タブと状態を共有する。 */
  selectedMonth: string;
  onSelectedMonthChange: (month: string) => void;
  // ★2026-09-02追加(スタッフ給与明細バグ報告): 有給(手入力)。前月集計漏れ等でCSV由来の
  // 有給日数・有給金額が実態とズレている場合に、詳細画面から追加できる補正行。
  paidLeaveOverrideRows: PaidLeaveOverrideRow[];
  onAddPaidLeaveOverride: (row: PaidLeaveOverrideRow) => void;
  onRemovePaidLeaveOverride: (row: PaidLeaveOverrideRow) => void;
  /** 編集権限(admin)がある場合のみ、有給(手入力)の追加/削除UIを表示する */
  canEdit: boolean;
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

// ★2026-09-02追加(スタッフ給与明細バグ報告): 有給(手入力)の当該スタッフ・当該月分の合計
// (追加する日数・金額の合算。マイナス値の補正も含む)。CSV由来の値に「加算」する形で使う。
interface PaidLeaveOverrideTotal {
  days: number;
  amount: number;
  count: number;
}

function buildCategories(p: PayrollRow, override: PaidLeaveOverrideTotal): CategorySpec[] {
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
        // ★2026-09-02修正(スタッフ給与明細バグ報告): 中身はp.regularAmount(基本給)。
        // 実列名はファイル形式により「基本」または「時間内」(csvParser.ts参照)だが、
        // いずれも意味は同じ基本給のため、表示ラベルは実態に合わせて「基本給」に統一。
        { label: '基本給', value: yen(p.regularAmount) },
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
        { label: '有休手当 (上の「有給」欄の有給手当に合算表示)', value: yen(p.paidLeaveAllowance2) },
        { label: '課税他 (課税他８〜１０合計)', value: yen(p.taxableOtherAllowances) },
      ],
    },
    {
      title: '給与 (非課税)',
      accent: 'border-emerald-200',
      // ★2026-09-02修正(スタッフ給与明細バグ報告「交通費が支給額を超えている」): 一覧テーブルの
      // 「交通費」列が通信費・非課税他まで合算していたため実態より大きく見えていた不具合を修正。
      // 一覧の「交通費」列は交通費1+2・交通費課税のみ、通信費・非課税他は「通信費・非課税他」列に
      // 分離した(computeSummary参照)。ここでの内訳表示自体は変更していない。
      fields: [
        { label: '交通費 (交通費1+2合算、一覧の「交通費」列に集計)', value: yen(p.salaryTransport) },
        { label: '交通費課税 (一覧の「交通費」列に集計)', value: yen(p.transportTaxable) },
        { label: '通信費 (一覧の「通信費・非課税他」列に集計)', value: yen(p.commsAllowance) },
        {
          label: '非課税他 (非課税他３〜４合計、一覧の「通信費・非課税他」列に集計)',
          value: yen(p.nonTaxableOtherAllowances),
        },
        { label: '立替金 (粗利計算には影響しません)', value: yen(p.reimbursement) },
      ],
    },
    {
      title: '有給',
      accent: 'border-amber-200',
      fields: [
        {
          label: override.days !== 0 ? `有給日数 (CSV${p.paidLeaveDays}日 + 手入力${override.days > 0 ? '+' : ''}${override.days}日)` : '有給日数',
          value: `${(p.paidLeaveDays ?? 0) + override.days}日`,
        },
        // ★2026-09-02修正(スタッフ給与明細バグ報告): 前月集計漏れの手入力等で「有休手当」列に
        // 金額が計上されているケースがあり、「有給手当」だけを見ると有給1日分の金額が0円に
        // 見えてしまう不具合があった。「有休」表記も有給として扱い、両方を合算して表示する。
        // さらに下の「有給(手入力)」で追加した補正分もここに合算する。
        {
          label:
            override.amount !== 0
              ? `有給手当 (「有休手当」+手入力${override.amount > 0 ? '+' : ''}¥${override.amount.toLocaleString()}含む、総支給額に内包済み)`
              : '有給手当 (「有休手当」含む、金額・総支給額に内包済み)',
          value: yen((p.paidLeaveAllowance ?? 0) + (p.paidLeaveAllowance2 ?? 0) + override.amount),
        },
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
        // ★2026-09-02修正(スタッフ給与明細バグ報告「有給が増えれば支給額が上がるはずです」):
        // 従来は有給(手入力)の金額が「有給」カードの表示にしか反映されず、総支給額・差引支給額
        // (実際の振込額)には一切影響しない不具合があった。手入力の金額分をここでも加算する。
        {
          label:
            override.amount !== 0
              ? `総支給額 (CSV¥${(p.paymentAmount ?? 0).toLocaleString()} + 有給手入力${override.amount > 0 ? '+' : ''}¥${override.amount.toLocaleString()})`
              : '総支給額',
          value: yen((p.paymentAmount ?? 0) + override.amount),
        },
        { label: '総控除額', value: yen(p.totalDeduction) },
        // ★2026-09-02修正(スタッフ給与明細バグ報告): CSVの「差引支給額」列をそのまま表示すると
        // 「総支給額−総控除額」と一致しないケースが報告されたため、常にこの2項目の差として
        // 計算し直して表示するようにした(内訳の整合性を優先)。あわせて有給(手入力)の金額分も
        // 総支給額側に反映されるため、自動的にここにも反映される。
        {
          label: '差引支給額 (実際の振込額 = 総支給額−総控除額)',
          value: yen((p.paymentAmount ?? 0) + override.amount - (p.totalDeduction ?? 0)),
        },
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
 * ★2026-09-02修正(スタッフ給与明細バグ報告「交通費が支給額を超えている」): 「交通費」列が
 * 交通費1+2・交通費課税だけでなく、実際には交通費と無関係の「通信費」「非課税他(3〜4)」も
 * 合算していたため、実際の交通費(実データ調査: 253名合計で交通費1だけで約16.6万円)よりも
 * 大きく見える(実データ調査: 非課税他だけで100万円超のケースを確認)状態になっていた。
 * 「交通費」は交通費1+2・交通費課税のみに変更し、通信費・非課税他は別列「通信費・非課税他」に
 * 分離して、それぞれの内訳が正しく見えるようにした。
 * ★2026-09-02修正(スタッフ給与明細バグ報告「有給が増えれば支給額が上がるはずです」): 有給
 * (手入力)は当初、日数のみをpaidLeaveDays列に合算し、金額側はbuildCategories側の「有給」
 * カード表示にしか反映しておらず、一覧の総支給額・差引支給額列や合計行には一切影響しない
 * (見た目上は補正されたように見えても、実際の振込額の計算には入っていない)という設計の
 * 抜けがあった。overrideDays(数値)だけでなくoverride全体(日数+金額)を受け取り、金額分は
 * paymentAmount・netPaymentの計算にも加算するようにした。
 */
function computeSummary(p: PayrollRow, override: PaidLeaveOverrideTotal = { days: 0, amount: 0, count: 0 }) {
  // 交通費 (交通費1+2・交通費課税のみ。通信費・非課税他は下記の別項目に分離)
  const transportSummary = (p.salaryTransport ?? 0) + (p.transportTaxable ?? 0);
  // 通信費・非課税他 (交通費とは別カテゴリの非課税手当。以前は「交通費」に混入していた)
  const otherNonTaxable = (p.commsAllowance ?? 0) + (p.nonTaxableOtherAllowances ?? 0);
  // 労働時間(合計) = 時間内時間・時間外時間・深夜内時間・深夜外時間・休日出時間・その他時間外(時間)の合算
  const totalWorkHours =
    (p.regularHours ?? 0) +
    (p.overtimeHours ?? 0) +
    (p.nightHours ?? 0) +
    (p.nightOvertimeHours ?? 0) +
    (p.holidayWorkHours ?? 0) +
    (p.otherOvertimeHours ?? 0);
  // ★2026-09-02追加(スタッフ給与明細バグ報告「有給が増えれば支給額が上がるはずです」):
  // 有給(手入力)の金額分を総支給額に加算した値。差引支給額もこれを基準に計算し直す。
  const paymentAmountWithOverride = (p.paymentAmount ?? 0) + override.amount;
  return {
    workDays: p.workDays ?? 0,
    // ★2026-09-02追加(スタッフ給与明細バグ報告): 有給(手入力)の追加日数分をCSV由来の値に合算。
    // 一覧テーブルの「有給日数」列・合計行の両方に自動的に反映される。
    paidLeaveDays: (p.paidLeaveDays ?? 0) + override.days,
    totalWorkHours,
    regularHours: p.regularHours ?? 0,
    // ★2026-09-02追加: 基本給(実列名「基本」)。従来一覧テーブルに金額が出ていなかった項目。
    regularAmount: p.regularAmount ?? 0,
    overtimeHours: p.overtimeHours ?? 0,
    holidayWorkHours: p.holidayWorkHours ?? 0,
    transportSummary,
    otherNonTaxable,
    reimbursement: p.reimbursement ?? 0,
    trainingAllowance: p.trainingAllowance ?? 0,
    paymentAmount: paymentAmountWithOverride,
    socialInsurance: p.socialInsurance ?? 0,
    totalDeduction: p.totalDeduction ?? 0,
    // ★2026-09-02修正(スタッフ給与明細バグ報告): 以前はCSVの「差引支給額」列(p.netPayment)を
    // そのまま使い、0円等で欠けている場合のみ総支給額にフォールバックしていたが、
    // 「総支給額−総控除額」と一致しないケースが報告されたため、常にこの2項目の差として
    // 計算し直すようにした(詳細内訳の「支給額」カテゴリと同じロジックに統一)。
    // ★2026-09-02追加修正: 有給(手入力)の金額分(paymentAmountWithOverride)も反映する。
    netPayment: paymentAmountWithOverride - (p.totalDeduction ?? 0),
  };
}

const hours = (v: number) => `${v.toFixed(1)}h`;

/**
 * ★2026-09-02追加(スタッフ給与明細バグ報告): 有給(手入力)の追加/一覧/削除UI。
 * 詳細内訳(展開部分)の中に、他のカテゴリカードと並べて表示する。
 * CSVの値を書き換えるのではなく「追加分」として記録し、上の「有給」カード(buildCategories)へ
 * 自動的に合算表示される。canEdit=falseの場合は追加/削除ボタンを隠し、閲覧のみにする。
 */
const PaidLeaveOverrideEditor: React.FC<{
  targetMonth: string;
  staffNo: string;
  staffName: string;
  overrides: PaidLeaveOverrideRow[];
  canEdit: boolean;
  onAdd: (row: PaidLeaveOverrideRow) => void;
  onRemove: (row: PaidLeaveOverrideRow) => void;
}> = ({ targetMonth, staffNo, staffName, overrides, canEdit, onAdd, onRemove }) => {
  const [showForm, setShowForm] = useState(false);
  const [days, setDays] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const handleAdd = () => {
    const d = days.trim() === '' ? NaN : Number(days);
    const a = amount.trim() === '' ? NaN : Number(amount);
    if (isNaN(d) && isNaN(a)) return; // 日数・金額どちらも未入力なら何もしない
    onAdd({
      id: `PLO_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      targetMonth,
      staffNo,
      staffName,
      days: isNaN(d) ? undefined : d,
      amount: isNaN(a) ? undefined : a,
      memo: memo.trim() || undefined,
    });
    setDays('');
    setAmount('');
    setMemo('');
    setShowForm(false);
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-3 md:col-span-2 xl:col-span-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1">
          <PenLine className="w-3.5 h-3.5" />
          <span>有給 (手入力補正)</span>
        </h4>
        {canEdit && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>追加</span>
          </button>
        )}
      </div>
      <p className="text-[10px] text-amber-700/80 mb-2">
        前月集計漏れ等でCSV由来の有給日数・有給手当が実態とズレている場合に、追加分(マイナス値なら減算)を記録できます。上の「有給」カードの日数・金額に自動的に合算されます。
      </p>
      {overrides.length === 0 ? (
        <p className="text-[11px] text-slate-400 mb-2">追加の記録はありません。</p>
      ) : (
        <ul className="space-y-1 mb-2">
          {overrides.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between text-[11px] bg-white rounded px-2 py-1 border border-amber-200"
            >
              <span className="text-slate-600">
                {o.days ? `${o.days > 0 ? '+' : ''}${o.days}日 ` : ''}
                {o.amount ? `${o.amount > 0 ? '+' : ''}¥${o.amount.toLocaleString()} ` : ''}
                {o.memo && <span className="text-slate-400">({o.memo})</span>}
              </span>
              {canEdit && (
                <button onClick={() => onRemove(o)} className="text-rose-500 hover:text-rose-700 shrink-0 ml-2">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && showForm && (
        <div className="flex flex-wrap items-end gap-2 bg-white rounded p-2 border border-amber-200">
          <label className="text-[10px] text-slate-500">
            日数
            <input
              type="number"
              step="0.5"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="block w-20 mt-0.5 px-2 py-1 border border-slate-300 rounded text-xs"
              placeholder="例: 1"
            />
          </label>
          <label className="text-[10px] text-slate-500">
            金額(円)
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="block w-24 mt-0.5 px-2 py-1 border border-slate-300 rounded text-xs"
              placeholder="例: 8000"
            />
          </label>
          <label className="text-[10px] text-slate-500 flex-1 min-w-[120px]">
            備考
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="block w-full mt-0.5 px-2 py-1 border border-slate-300 rounded text-xs"
              placeholder="例: 10月分集計漏れ"
            />
          </label>
          <button
            onClick={handleAdd}
            className="px-3 py-1.5 bg-amber-600 text-white text-xs font-bold rounded hover:bg-amber-700"
          >
            保存
          </button>
          <button
            onClick={() => setShowForm(false)}
            className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
          >
            キャンセル
          </button>
        </div>
      )}
    </div>
  );
};

// ★2026-09-02追加(スタッフ給与明細バグ報告「検索がしやすくなるためソート機能をつけてほしい」):
// 一覧テーブルの列見出しクリックでソートできるようにする。列は一覧テーブルの列構成
// (スタッフ/対象月 + computeSummary()が返す13項目)とそのまま対応させる。
type SortKey =
  | 'staffName'
  | 'targetMonth'
  | 'workDays'
  | 'paidLeaveDays'
  | 'totalWorkHours'
  | 'regularHours'
  | 'regularAmount'
  | 'overtimeHours'
  | 'holidayWorkHours'
  | 'transportSummary'
  | 'otherNonTaxable'
  | 'reimbursement'
  | 'trainingAllowance'
  | 'paymentAmount'
  | 'socialInsurance'
  | 'totalDeduction'
  | 'netPayment';

export const StaffPayrollDetail: React.FC<StaffPayrollDetailProps> = ({
  payrollRows,
  selectedMonth,
  onSelectedMonthChange,
  paidLeaveOverrideRows,
  onAddPaidLeaveOverride,
  onRemovePaidLeaveOverride,
  canEdit,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // ★2026-09-02追加(スタッフ給与明細バグ報告): 有給(手入力)を「対象月_スタッフNo」で
  // 引けるようにまとめておく。1人・1ヶ月に複数件追加できる(履歴として残す)ため、配列で保持する。
  const overridesByKey = useMemo(() => {
    const map = new Map<string, PaidLeaveOverrideRow[]>();
    paidLeaveOverrideRows.forEach((r) => {
      const key = `${r.targetMonth}_${r.staffNo}`;
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    });
    return map;
  }, [paidLeaveOverrideRows]);

  const getOverrideTotal = (targetMonth: string, staffNo: string): PaidLeaveOverrideTotal => {
    const rows = overridesByKey.get(`${targetMonth}_${staffNo}`) || [];
    return rows.reduce(
      (acc, r) => ({
        days: acc.days + (r.days ?? 0),
        amount: acc.amount + (r.amount ?? 0),
        count: acc.count + 1,
      }),
      { days: 0, amount: 0, count: 0 }
    );
  };
  // 既定は従来通り「対象月の新しい順、同月内はスタッフNo順」。列見出しクリックで変更できる。
  const [sortKey, setSortKey] = useState<SortKey>('targetMonth');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // ソート可能な列見出しセルを描画する共通ヘルパー。クリックで昇順⇔降順をトグルし、
  // 現在ソート中の列にだけ矢印アイコンを表示する。
  const renderSortTh = (label: string, key: SortKey, alignRight = true, extraClass = '') => {
    const active = sortKey === key;
    return (
      <th
        className={`py-3 px-3 whitespace-nowrap cursor-pointer select-none hover:bg-slate-200/70 transition-colors ${
          alignRight ? 'text-right' : ''
        } ${extraClass}`}
        onClick={() => handleSort(key)}
      >
        <span className={`inline-flex items-center gap-0.5 ${alignRight ? 'flex-row-reverse' : ''}`}>
          <span>{label}</span>
          {active &&
            (sortDir === 'asc' ? (
              <ChevronUp className="w-3 h-3 text-indigo-600" />
            ) : (
              <ChevronDown className="w-3 h-3 text-indigo-600" />
            ))}
        </span>
      </th>
    );
  };

  const availableMonths = useMemo(
    () => Array.from(new Set(payrollRows.map((p) => p.targetMonth))).sort(),
    [payrollRows]
  );

  const filteredRows = useMemo(() => {
    return payrollRows.filter((p) => {
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
    });
  }, [payrollRows, searchQuery, selectedMonth]);

  // 表示行 + 一覧列の値をあらかじめまとめて計算しておき、ソート・描画の両方で使い回す。
  // ★2026-09-02修正: 有給(手入力)の追加日数・金額を、一覧の「有給日数」「総支給額」
  // 「差引支給額」列・合計行にも反映させるため、override全体をcomputeSummaryに渡す。
  const displayRows = useMemo(
    () =>
      filteredRows.map((p) => ({
        p,
        s: computeSummary(p, getOverrideTotal(p.targetMonth, p.staffNo)),
      })),
    [filteredRows, overridesByKey]
  );

  const sortedRows = useMemo(() => {
    const withIndex = displayRows.map((row, idx) => ({ row, idx }));
    withIndex.sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case 'staffName':
          cmp = a.row.p.staffName.localeCompare(b.row.p.staffName, 'ja');
          break;
        case 'targetMonth':
          cmp = a.row.p.targetMonth.localeCompare(b.row.p.targetMonth);
          break;
        default:
          cmp = a.row.s[sortKey] - b.row.s[sortKey];
          break;
      }
      if (cmp === 0) {
        // タイブレーク: 対象月(新しい順) → スタッフNo順 (従来の既定ソートを踏襲)
        cmp = a.row.p.targetMonth === b.row.p.targetMonth
          ? a.row.p.staffNo.localeCompare(b.row.p.staffNo)
          : b.row.p.targetMonth.localeCompare(a.row.p.targetMonth);
        return cmp;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return withIndex.map((w) => w.row);
  }, [displayRows, sortKey, sortDir]);

  // ★2026-08-27追加(22-14章修正8)・拡充(22-20/22-21章修正12): 一覧テーブル上部の集計セクション。
  // 表示中(フィルタ適用後)の行を対象に、既存の値をそのまま合算するだけで新規の計算ロジックは追加しない。
  // 当初は主要4項目のみのKPIカードだったが、★派遣明細202410.xlsm(未払計上表シート)の
  // 合計行に合わせ、一覧テーブルの13列すべてについて列ごとの合計を出す「合計行」形式に拡充した。
  const totals = useMemo(() => {
    const staffCount = new Set(displayRows.map(({ p }) => p.staffNo)).size;
    const acc = {
      workDays: 0,
      paidLeaveDays: 0,
      totalWorkHours: 0,
      regularHours: 0,
      regularAmount: 0,
      overtimeHours: 0,
      holidayWorkHours: 0,
      transportSummary: 0,
      otherNonTaxable: 0,
      reimbursement: 0,
      trainingAllowance: 0,
      paymentAmount: 0,
      socialInsurance: 0,
      totalDeduction: 0,
      netPayment: 0,
    };
    displayRows.forEach(({ s }) => {
      acc.workDays += s.workDays;
      acc.paidLeaveDays += s.paidLeaveDays;
      acc.totalWorkHours += s.totalWorkHours;
      acc.regularHours += s.regularHours;
      acc.regularAmount += s.regularAmount;
      acc.overtimeHours += s.overtimeHours;
      acc.holidayWorkHours += s.holidayWorkHours;
      acc.transportSummary += s.transportSummary;
      acc.otherNonTaxable += s.otherNonTaxable;
      acc.reimbursement += s.reimbursement;
      acc.trainingAllowance += s.trainingAllowance;
      acc.paymentAmount += s.paymentAmount;
      acc.socialInsurance += s.socialInsurance;
      acc.totalDeduction += s.totalDeduction;
      acc.netPayment += s.netPayment;
    });
    return { staffCount, ...acc };
  }, [displayRows]);

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
        <div className="overflow-auto table-scroll max-h-[calc(100vh-80px)] rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs border-collapse">
            {/* ★2026-08-27追加(22-22/22-23章修正13、2026-09-02再修正): 列見出し・合計行を
                sticky指定で常に見える状態にする。以前はページ全体の縦スクロールを基準に
                top-16(Header.tsx分オフセット)で固定していたが、195件超などテーブルの行数が
                多いと横スクロールバーがテーブル最下部(全行の下)に付いてしまい、そこまで
                スクロールしないと使えないという問題があった。そのため、テーブルの縦横スクロール
                自体をこの枠(overflow-auto + max-h-[calc(100vh-80px)]、2026-09-02同日65vhから
                再調整)の内側に閉じ込め、横スクロールバーが
                常に画面内(枠の下端)に表示され続けるようにした。それに伴い、theadのstickyは
                ページ基準のtop-16から、この枠を基準としたtop-0に変更した。thead内の2行
                (見出し行・合計行)はまとめてsticky化される(スタック順はDOM順のまま)。背景を
                半透明のままにすると固定時にスクロール中の本文が透けるため、不透明色にしている。 */}
            <thead className="sticky top-0 z-20 shadow-sm">
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="py-3 px-3 whitespace-nowrap w-6"></th>
                {renderSortTh('スタッフ', 'staffName', false)}
                {renderSortTh('対象月', 'targetMonth', false)}
                {renderSortTh('出勤日数', 'workDays')}
                {renderSortTh('有給日数', 'paidLeaveDays')}
                {renderSortTh('労働時間(合計)', 'totalWorkHours')}
                {renderSortTh('時間内時間', 'regularHours')}
                {renderSortTh('基本給', 'regularAmount')}
                {renderSortTh('時間外時間', 'overtimeHours')}
                {renderSortTh('休出時間', 'holidayWorkHours')}
                {renderSortTh('交通費', 'transportSummary')}
                {renderSortTh('通信費・非課税他', 'otherNonTaxable')}
                {renderSortTh('立替金', 'reimbursement')}
                {renderSortTh('研修手当', 'trainingAllowance')}
                {renderSortTh('総支給額', 'paymentAmount')}
                {renderSortTh('社保合計額', 'socialInsurance')}
                {renderSortTh('控除額計', 'totalDeduction')}
                {renderSortTh('差引支給額', 'netPayment', true, 'bg-indigo-100/70')}
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
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.regularAmount)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{hours(totals.overtimeHours)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{hours(totals.holidayWorkHours)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.transportSummary)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.otherNonTaxable)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.reimbursement)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.trainingAllowance)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.paymentAmount)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.socialInsurance)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{yen(totals.totalDeduction)}</td>
                <td className="py-2.5 px-3 text-right font-mono bg-indigo-100">{yen(totals.netPayment)}</td>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
              {sortedRows.map(({ p, s }) => {
                const id = `${p.targetMonth}_${p.staffNo}`;
                const expanded = expandedIds.has(id);
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
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.regularAmount)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">{hours(s.overtimeHours)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">{hours(s.holidayWorkHours)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{yen(s.transportSummary)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">{yen(s.otherNonTaxable)}</td>
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
                        <td colSpan={18} className="bg-slate-50/60 px-4 py-4">
                          {p.remarks && <p className="text-[11px] text-slate-400 mb-2">{p.remarks}</p>}
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {buildCategories(p, getOverrideTotal(p.targetMonth, p.staffNo)).map((cat) => (
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
                            {/* ★2026-09-02追加(スタッフ給与明細バグ報告): 有給(手入力)の追加/一覧/削除UI */}
                            <PaidLeaveOverrideEditor
                              targetMonth={p.targetMonth}
                              staffNo={p.staffNo}
                              staffName={p.staffName}
                              overrides={overridesByKey.get(`${p.targetMonth}_${p.staffNo}`) || []}
                              canEdit={canEdit}
                              onAdd={onAddPaidLeaveOverride}
                              onRemove={onRemovePaidLeaveOverride}
                            />
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
