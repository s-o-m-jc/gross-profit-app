/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * 月次粗利明細テーブルコンポーネント
 *
 * ★2026-08-26改修:
 * - 表示範囲を「月ごと」「年間(決算期)」で切り替えられるようにし、既定値も「全期間一括表示」から
 *   「直近の対象月のみ」に変更した(全対象月を一度に表示すると確認しづらいという要望への対応)。
 * - 監査ステータス列は、実際に対応が必要な重要度(warning/error)のアラートだけで判定するよう修正
 *   (info severityの参考ログまで「要確認」に数えてしまい、ほぼ全件が要確認になっていた不具合の修正。
 *    詳細はcalculator.tsのhasActionableAlerts参照)。
 * - ヘッダーの消費税率設定を「請求額」「粗利益」に反映する税抜/税込表示切替を追加。
 */

import React, { useState, useMemo } from 'react';
import {
  Search,
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  Building,
  User,
  Users,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { GrossProfitResult } from '../types';
import { hasActionableAlerts, countActionableAlerts } from '../utils/calculator';

/**
 * ★2026-09-18追加(はまさんのご要望「月次粗利明細一覧を月次サマリ表と同じ項目・グループ構成に
 * してほしい」): 月次サマリ表(FiscalYearAnalytics.tsx)がcalculator.tsの月次集計ループ内で
 * 行っている内訳分解(派遣/休業分補償/給与/休業手当/社保他 等)を、1行(1契約/1スタッフ)単位で
 * 再現するための純粋関数。集計ロジック自体はcalculator.ts側と同一で、ここでは「月次合計の
 * 代わりに1行分だけ計算する」だけであり、新しい計算式は追加していない
 * (calculator.tsのmonthlyMap.forEach内の対応するコメントも参照)。
 *
 * ★2026-09-19修正(はまさんの指摘「総売上・派遣売上は税抜税込トグルに連動するのに、内訳
 * (派遣・交通費(相手企業負担)・休業分補償)が常に税抜固定で、税込表示時に内訳合計と総額が
 * 一致しない」): 売上系の内訳(dispatch/billingTransport/leaveCompensationAmount)は、税抜・
 * 税込の両方をあらかじめ計算して返すようにした。billingTransport(請求交通費)・
 * leaveCompensationAmount(休業分補償)は、税抜側は既存値をそのまま使い、税込側は
 * Math.round(値 × (1+taxRate))で換算する(calculator.tsのbillingAmountIncTax算出と同じ式)。
 * dispatch(派遣)は「総額(表示中の税抜/税込) − 交通費(相手企業負担) − 休業分補償」の残差
 * として求めることで、税抜表示・税込表示どちらでも内訳3列の合計が必ず表示中の総額(派遣売上)と
 * 一致するようにしている(個別に税込換算して端数丸め誤差が生じるのを避けるため)。
 */
function computeRowBreakdown(row: GrossProfitResult, taxRate: number) {
  const isLeaveCompensation = row.manualEntryType === 'LEAVE_COMPENSATION';
  const isLeaveAllowance = row.manualEntryType === 'LEAVE_ALLOWANCE';

  const billingTransportExTax = row.billingTransport;
  const billingTransportIncTax = Math.round(row.billingTransport * (1 + taxRate));
  const leaveCompensationAmountExTax = isLeaveCompensation ? row.billingAmountExTax : 0;
  const leaveCompensationAmountIncTax = isLeaveCompensation ? row.billingAmountIncTax : 0;
  // 派遣 = 請求額(表示中の税抜/税込) − 請求交通費(同) − 休業分補償(同)の残差
  // (休業分補償の合成行はdispatch=0扱い。calculator.tsのdispatch算出と同じロジック)
  const dispatchExTax = isLeaveCompensation ? 0 : row.billingAmountExTax - billingTransportExTax;
  const dispatchIncTax = isLeaveCompensation ? 0 : row.billingAmountIncTax - billingTransportIncTax;

  // 給与総額(Excel方式) = 給与支給総額 − 給与交通費支給額
  const totalSalaryRow = row.paymentAmount - row.salaryTransport;
  const leaveAllowanceAmount = isLeaveAllowance ? row.paymentAmount : 0;
  // 給与 = 給与総額(Excel方式) − 休業手当
  const salary = totalSalaryRow - leaveAllowanceAmount;
  // 社保他小計 = 社保(雇用保険込み) + 交通費(自社負担) + 駐車場代
  const socialInsuranceOther = row.socialInsurance + row.salaryTransport + row.parkingFee;
  return {
    billingTransportExTax,
    billingTransportIncTax,
    leaveCompensationAmountExTax,
    leaveCompensationAmountIncTax,
    dispatchExTax,
    dispatchIncTax,
    totalSalaryRow,
    salary,
    leaveAllowanceAmount,
    socialInsuranceOther,
  };
}

interface MonthlyCalculationTableProps {
  results: GrossProfitResult[];
  taxRate: number;
  lowMarginThreshold: number;
  /** ★2026-09-01追加: viewer(閲覧専用)権限ではCSVエクスポートボタン自体を出さない(20-2章の既知バグ修正) */
  canExportCsv: boolean;
  onExportCsv: () => void;
  /** 選択中の決算期に属する対象年月一覧("YYYY-MM"×12)。「年間(決算期)」表示切替で使用 */
  fiscalYearMonths: string[];
  /** 選択中の決算期のラベル(ヘッダーの決算期セレクタと同一の表示文字列) */
  fiscalYearLabel: string;
  /** 選択中の対象年月("YYYY-MM")。★2026-08-27(22-11章修正5):
   * 「スタッフ給与明細」タブと状態を共有するため、App.tsx(AppShell)側で一元管理する。
   * ★2026-09-20修正: 「全月(ALL)」という特殊値は廃止し、常に選択中の決算期内の具体的な
   * 1ヶ月を指す(App.tsx側で常に有効な値を保つよう自動選択される)。 */
  selectedMonth: string;
  onSelectedMonthChange: (month: string) => void;
}

type ViewScope = 'month' | 'fiscalYear';
type AmountDisplay = 'exTax' | 'incTax';

export const MonthlyCalculationTable: React.FC<MonthlyCalculationTableProps> = ({
  results,
  taxRate,
  lowMarginThreshold,
  canExportCsv,
  onExportCsv,
  fiscalYearMonths,
  fiscalYearLabel,
  selectedMonth,
  onSelectedMonthChange,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewScope, setViewScope] = useState<ViewScope>('month');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [amountDisplay, setAmountDisplay] = useState<AmountDisplay>('exTax');
  // ★2026-09-18追加(はまさんのご要望): 月次サマリ表と同じ、売上内訳・給与内訳・社保他内訳の
  // 開閉状態(既定は非表示、集計列見出しクリックで独立して開閉)。FiscalYearAnalytics.tsxと
  // 同じ設計。
  const [showSalesBreakdown, setShowSalesBreakdown] = useState(false);
  const [showSalaryBreakdown, setShowSalaryBreakdown] = useState(false);
  const [showSocialBreakdown, setShowSocialBreakdown] = useState(false);
  const anyBreakdownOpen = showSalesBreakdown || showSalaryBreakdown || showSocialBreakdown;
  // ★2026-09-19修正(はまさんの指摘「合計行がズレて表示される」): 見出し1段目(常時表示の各列)を
  // 常にrowSpan={2}にしていたが、内訳がすべて閉じている(anyBreakdownOpen===false)場合、
  // 見出し2段目(内訳の個別列名)の<tr>自体を描画しないため、rowSpan=2が「存在しない2段目」を
  // 飛び越えて、theadの次に来る実際の<tr>(下の合計行)まで浸食してしまっていた(rowSpan/colSpanの
  // テーブルグリッド計算はthead内の<tr>の区切りを無視し、theadを1つの行グリッドとして扱うため)。
  // この結果、既定状態(内訳をどれも開いていない状態)で合計行の各セルが本来の列位置から
  // 大きくズレて表示されるバグがあった。内訳が開いている時だけrowSpan=2(2段目が実在するため
  // 正しく機能する)、閉じている時はrowSpan=1(2段目自体が存在しないため、1段の通常ヘッダーとして
  // 扱う)にすることで解消した。

  const fiscalYearMonthSet = useMemo(() => new Set(fiscalYearMonths), [fiscalYearMonths]);

  // 対象年月プルダウンの選択肢一覧。
  // ★2026-09-20修正(はまさんの指摘「対象年月プルダウンが決算期と連動していない」): 以前は
  // resultsに含まれる全期間の月をそのまま列挙していたため、データが存在する全期間(何年分も)が
  // 一つの長いリストになってしまっていた。画面上部の「決算期指定」と同じ範囲(fiscalYearMonths、
  // App.tsx側でbuildFiscalYearOptions/getFiscalYearMonthsから計算)をそのまま選択肢にする
  // (常にちょうど12ヶ月ぶん。データが無い月を選んでも単に0件表示になるだけで、決算期という
  // 範囲自体は固定・自明なため、resultsから動的に組み立てる必要が無くなった)。
  // ★2026-09-20再修正(はまさんの指摘「『全月』選択肢を削除してほしい。全期間表示は決算期
  // (年間)集計画面の役割」): 「全対象年月(ALL)」という選択肢を廃止し、必ず具体的な1ヶ月を
  // 選ぶ形にした(決算期全体をまとめて見たい場合は、既存の「年間(決算期)」表示切替を使う)。
  const availableMonths = fiscalYearMonths;

  // フィルタリング処理
  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      // 表示範囲フィルタ: 月ごと(選択した1ヶ月) / 年間(決算期、選択中の決算期の12ヶ月分)
      if (!fiscalYearMonthSet.has(item.targetMonth)) return false;
      if (viewScope === 'month' && item.targetMonth !== selectedMonth) {
        return false;
      }

      // 検索クエリ (スタッフ名, スタッフNo, 派遣先名, 請求No)
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const match =
          item.staffName.toLowerCase().includes(q) ||
          item.staffNo.toLowerCase().includes(q) ||
          item.clientName.toLowerCase().includes(q) ||
          item.billingNo.toLowerCase().includes(q);
        if (!match) return false;
      }

      // 特殊フィルタ
      if (filterType === 'ALERTS_ONLY' && !hasActionableAlerts(item.alerts)) return false;
      if (filterType === 'TRANSPORT_MISMATCH' && (item.transportDiff === 0 || !item.transportDataAvailable)) return false;
      if (filterType === 'NEGATIVE' && item.grossProfitExTax >= 0) return false;
      if (filterType === 'LOW_MARGIN' && (item.grossProfitRate >= lowMarginThreshold || item.grossProfitExTax < 0)) return false;
      if (filterType === 'REFERRAL' && item.referralFee <= 0) return false;

      return true;
    });
    // ★2026-09-19修正(はまさんの指摘「内訳の開閉トグル用見出し以外をクリックすると意図せず
    // ソートが発動する」): 以前はここで列見出しクリックによる並べ替え(sortField/sortDirection)を
    // 行っていたが、その機能自体を撤去した(開閉トグル用の見出し(派遣売上/給与総額/社保他小計)の
    // クリックは引き続き内訳の表示/非表示のみを行う)。並び順はresults(calculator.tsの
    // calculateGrossProfitが対象月→スタッフNoの順で返す、既にソート済みの配列)の順序をそのまま
    // 使う。
  }, [results, searchQuery, viewScope, selectedMonth, fiscalYearMonthSet, filterType, lowMarginThreshold]);

  // ★2026-09-18修正(はまさんのご要望「月次サマリ表と同じ項目名にしてほしい」):
  // 「請求額」→「派遣売上」、「粗利益」→「実質粗利益」に列名を統一(計算内容・税抜税込切替の
  // 挙動自体は変更なし)。
  const dispatchSalesLabel = amountDisplay === 'incTax' ? `派遣売上 (税込 ${Math.round(taxRate * 100)}%)` : '派遣売上 (税抜)';
  const grossProfitLabel = amountDisplay === 'incTax' ? `実質粗利益 (税込 ${Math.round(taxRate * 100)}%)` : '実質粗利益 (税抜)';

  // ★2026-09-18追加(はまさんのご要望「スタッフ給与明細と同様の合計行を追加してほしい」):
  // 表示中(フィルタ適用後)の全行について、列ごとの合計値をまとめておく。売上内訳・給与内訳・
  // 社保他内訳の各項目もcomputeRowBreakdownで1行ずつ計算し合算する(新しい計算式ではなく、
  // calculator.tsの月次集計と同じロジックを1行ずつ適用しているだけ)。
  const totals = useMemo(() => {
    const acc = {
      billingAmountExTax: 0,
      billingAmountIncTax: 0,
      referralFee: 0,
      dispatchExTax: 0,
      dispatchIncTax: 0,
      billingTransportExTax: 0,
      billingTransportIncTax: 0,
      leaveCompensationAmountExTax: 0,
      leaveCompensationAmountIncTax: 0,
      totalSalaryRow: 0,
      salary: 0,
      leaveAllowanceAmount: 0,
      retirementAmount: 0,
      billingUnitPrice: 0,
      payUnitPrice: 0,
      employmentInsurance: 0,
      socialInsurance: 0,
      salaryTransport: 0,
      parkingFee: 0,
      socialInsuranceOther: 0,
      paidLeaveAllowance: 0,
      paidLeaveDays: 0,
      grossProfitExTax: 0,
      grossProfitIncTax: 0,
      actionableAlertCount: 0,
    };
    filteredResults.forEach((row) => {
      // ★2026-09-19修正: 内訳(dispatch/billingTransport/leaveCompensation)は税抜・税込両方を
      // 合算しておき、amountDisplayに応じてレンダリング時に選択する(合計行自体はamountDisplay
      // の変更ごとに再計算不要なつくりにするため。taxRateはpropsで固定値のため依存配列も安定)。
      const b = computeRowBreakdown(row, taxRate);
      acc.billingAmountExTax += row.billingAmountExTax;
      acc.billingAmountIncTax += row.billingAmountIncTax;
      acc.referralFee += row.referralFee;
      acc.dispatchExTax += b.dispatchExTax;
      acc.dispatchIncTax += b.dispatchIncTax;
      acc.billingTransportExTax += b.billingTransportExTax;
      acc.billingTransportIncTax += b.billingTransportIncTax;
      acc.leaveCompensationAmountExTax += b.leaveCompensationAmountExTax;
      acc.leaveCompensationAmountIncTax += b.leaveCompensationAmountIncTax;
      acc.totalSalaryRow += b.totalSalaryRow;
      acc.salary += b.salary;
      acc.leaveAllowanceAmount += b.leaveAllowanceAmount;
      acc.retirementAmount += row.retirementAmount;
      acc.billingUnitPrice += row.billingUnitPrice;
      acc.payUnitPrice += row.payUnitPrice;
      acc.employmentInsurance += row.employmentInsurance;
      acc.socialInsurance += row.socialInsurance;
      acc.salaryTransport += row.salaryTransport;
      acc.parkingFee += row.parkingFee;
      acc.socialInsuranceOther += b.socialInsuranceOther;
      acc.paidLeaveAllowance += row.paidLeaveAllowance;
      acc.paidLeaveDays += row.paidLeaveDays;
      acc.grossProfitExTax += row.grossProfitExTax;
      acc.grossProfitIncTax += row.grossProfitIncTax;
      acc.actionableAlertCount += countActionableAlerts(row.alerts);
    });
    const nominalGrossMarginRateDataAvailable = acc.billingUnitPrice > 0;
    const nominalGrossMarginRate = acc.billingUnitPrice > 0
      ? Number(((1 - acc.payUnitPrice / acc.billingUnitPrice) * 100).toFixed(2))
      : 0;
    // 実質粗利率(合計) = 実質粗利益(税抜)合計 ÷ 派遣売上(税抜)合計 × 100。個々の行のgrossProfitRate
    // (常に税抜ベース)と同じ考え方で、税込表示切替に関わらず税抜ベースで算出する。
    const grossMarginRate = acc.billingAmountExTax > 0
      ? Number(((acc.grossProfitExTax / acc.billingAmountExTax) * 100).toFixed(2))
      : 0;
    return { count: filteredResults.length, ...acc, nominalGrossMarginRateDataAvailable, nominalGrossMarginRate, grossMarginRate };
  }, [filteredResults, taxRate]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
      {/* テーブル制御ツールバー */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
        {/* 1段目: 表示範囲切り替え(月ごと / 年間・決算期) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500">表示範囲:</span>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
            <button
              onClick={() => setViewScope('month')}
              className={`inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-bold transition-colors ${
                viewScope === 'month' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>月ごと</span>
            </button>
            <button
              onClick={() => setViewScope('fiscalYear')}
              className={`inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-bold border-l border-slate-300 transition-colors ${
                viewScope === 'fiscalYear' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5" />
              <span>年間(決算期)</span>
            </button>
          </div>

          {viewScope === 'month' ? (
            <select
              value={selectedMonth}
              onChange={(e) => onSelectedMonthChange(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <span className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-700">
              {fiscalYearLabel}
            </span>
          )}
        </div>

        {/* 2段目: 検索・状態フィルタ・税抜税込切替・件数・エクスポート */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* 検索ボックス */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="スタッフ名・No・派遣先・請求No..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* 状態別フィルタ */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            >
              <option value="ALL">すべて表示</option>
              <option value="ALERTS_ONLY">⚠️ 要確認・警告のみ</option>
              <option value="TRANSPORT_MISMATCH">🚗 交通費不一致のみ</option>
              <option value="NEGATIVE">🔴 赤字案件のみ</option>
              <option value="LOW_MARGIN">🟡 低粗利 (&lt;{lowMarginThreshold}%)</option>
              <option value="REFERRAL">💼 紹介手数料あり</option>
            </select>

            {/* 税抜/税込表示切替 */}
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden" title="ヘッダーの消費税率設定を「派遣売上」「実質粗利益」列に反映します">
              <button
                onClick={() => setAmountDisplay('exTax')}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                  amountDisplay === 'exTax' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                税抜表示
              </button>
              <button
                onClick={() => setAmountDisplay('incTax')}
                className={`px-3 py-1.5 text-xs font-bold border-l border-slate-300 transition-colors ${
                  amountDisplay === 'incTax' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                税込表示
              </button>
            </div>
          </div>

          {/* 右側: エクスポートボタン & 件数表示 */}
          <div className="flex items-center space-x-3">
            <span className="text-xs text-slate-500">
              表示: <strong className="text-slate-800 font-bold">{filteredResults.length}</strong> / {results.length} 件
            </span>

            {canExportCsv && (
              <button
                onClick={onExportCsv}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>CSVエクスポート</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* メインテーブル (table-scroll: 常時視認できる横スクロールバーをマウス操作用に表示)
          ★2026-09-02追加(同日、65vh→calc(100vh-80px)に再調整): テーブルの縦横スクロールを
          この枠(overflow-auto + max-h-[calc(100vh-80px)])の
          内側に閉じ込め、横スクロールバーが行数によらず常に画面内(枠の下端)に表示され続ける
          ようにした(スタッフ給与明細と同様の対応)。それに伴いtheadをsticky top-0で固定し、
          背景も半透明(bg-slate-100/80)のままだと固定時に本文が透けるため不透明にした。 */}
      <div className="overflow-auto table-scroll max-h-[calc(100vh-80px)] rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-xs border-collapse">
          {/* ★2026-09-18変更(はまさんのご要望「月次粗利明細一覧を月次サマリ表と同じ項目・
              グループ構成にしてほしい」): 派遣売上/給与総額/社保他小計まわりの項目・グループ構成・
              クリック展開の挙動を、月次サマリ表(FiscalYearAnalytics.tsx)と統一した。
              「スタッフ人数」「1人当たり有給日数」は契約単位では常に1名/月次サマリと同じ値に
              なり意味を持たないため除外している(はまさんの指示通り)。
              年月・請求No・スタッフ・派遣先企業(識別用)、交通費突合・監査ステータス(監査用)、
              担当者は月次サマリ表には無い列だが、1行=1契約/1スタッフの明細表としてどの行か
              分からなくなってしまうため残している(要相談点として別途お伝えします)。
              内訳の計算はcomputeRowBreakdown()(このファイル冒頭)を参照。社保他小計の内訳は
              雇保・社保・交通費(自社負担)・駐車場代の4列(★2026-09-19追加: 当初3列だったが、
              駐車場代が発生する行で内訳合計と社保他小計が一致しない問題があったため4列目を追加)。
              雇保は社保に既に含まれる参考列のため合計には含めず、社保+交通費(自社負担)+
              駐車場代の3項目が社保他小計と厳密に一致する。
              thead内に合計行(sticky、★2026-09-18追加)も追加し、theadごとsticky top-0で
              画面上部に固定する(スタッフ給与明細の合計行と同じ方式)。
              ★2026-09-19修正(はまさんの指摘): 以前は列見出しクリックで並べ替えできたが、
              内訳の開閉トグル用見出し(派遣売上/給与総額/社保他小計)以外のクリックで意図せず
              ソートが発動してしまうとの指摘を受け、列見出しクリックによる並べ替え機能自体を
              撤去した(開閉トグル用見出しのクリックは、引き続き内訳の表示/非表示のみを行う)。 */}
          <thead className="sticky top-0 z-20 shadow-sm">
            <tr className={`bg-slate-100 text-slate-700 font-bold ${anyBreakdownOpen ? '' : 'border-b border-slate-200'}`}>
              <th className="py-3 px-3 whitespace-nowrap bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                年月
              </th>
              <th className="py-3 px-3 whitespace-nowrap bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                請求No
              </th>
              <th className="py-3 px-3 whitespace-nowrap bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                スタッフ
              </th>
              <th className="py-3 px-3 whitespace-nowrap bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                派遣先企業
              </th>
              <th
                className="py-3 px-3 whitespace-nowrap text-right cursor-pointer bg-slate-100 hover:bg-slate-200 select-none"
                rowSpan={anyBreakdownOpen ? 2 : 1}
                onClick={() => setShowSalesBreakdown((v) => !v)}
                title="クリックして内訳(派遣・交通費(相手企業負担)・休業分補償)の表示/非表示を切り替え(内訳は税抜/税込表示に連動します)"
              >
                <span className="inline-flex items-center justify-end gap-1 w-full">
                  <span>{dispatchSalesLabel}</span>
                  {showSalesBreakdown ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
                </span>
              </th>
              {showSalesBreakdown && (
                <th
                  className="py-1.5 px-3 text-center bg-emerald-50 border-l border-r border-emerald-200 text-emerald-800 font-extrabold"
                  colSpan={3}
                  title="派遣売上 = 派遣 + 交通費(相手企業負担) + 休業分補償"
                >
                  売上内訳
                </th>
              )}
              <th className="py-3 px-3 whitespace-nowrap text-right bg-amber-50/50" rowSpan={anyBreakdownOpen ? 2 : 1} title="粗利非算入・売上算入。消費税計算の対象外(既存仕様のまま)">
                紹介手数料 <span className="text-amber-600">ⓘ</span>
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>総売上</th>
              <th
                className="py-3 px-3 whitespace-nowrap text-right cursor-pointer bg-slate-100 hover:bg-slate-200 select-none"
                rowSpan={anyBreakdownOpen ? 2 : 1}
                onClick={() => setShowSalaryBreakdown((v) => !v)}
                title="クリックして内訳(給与・休業手当・退職金配賦)の表示/非表示を切り替え"
              >
                <span className="inline-flex items-center justify-end gap-1 w-full">
                  <span>給与総額</span>
                  {showSalaryBreakdown ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
                </span>
              </th>
              {showSalaryBreakdown && (
                <th
                  className="py-1.5 px-3 text-center bg-amber-50 border-l border-r border-amber-200 text-amber-800 font-extrabold"
                  colSpan={3}
                  title="給与総額 = 給与 + 休業手当 + 退職金配賦"
                >
                  給与内訳
                </th>
              )}
              <th className="py-3 px-3 whitespace-nowrap text-right bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                請求＠
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                支払＠
              </th>
              {/* ★2026-09-15追加(23章「集計」シート方式の名目指標を行レベルにも拡張)。
                  ★2026-09-16修正(はまさんの指摘): 「名目粗利額」列は元データ(大阪の契約別売上
                  実績表シート)に存在しない独自追加だったため削除し、実在する「名目粗利率」のみ残す。 */}
              <th
                className="py-3 px-3 whitespace-nowrap text-center bg-sky-50/50"
                rowSpan={anyBreakdownOpen ? 2 : 1}
                title="1−支払＠/請求＠。大阪人材の集計シート方式による名目上の粗利率です。請求書印刷CSV未読込・未紐付けの行は「データなし」になります"
              >
                名目粗利率 <span className="text-sky-600">ⓘ</span>
              </th>
              <th
                className="py-3 px-3 whitespace-nowrap text-right bg-slate-100"
                rowSpan={anyBreakdownOpen ? 2 : 1}
                title="元Excelでは手入力の固定値(このアプリのデータからは導出不可)。データの出所判明まで「不明」表示にしています"
              >
                交通費(税抜) <span className="text-amber-500">ⓘ</span>
              </th>
              <th
                className="py-3 px-3 whitespace-nowrap text-right cursor-pointer bg-slate-100 hover:bg-slate-200 select-none"
                rowSpan={anyBreakdownOpen ? 2 : 1}
                onClick={() => setShowSocialBreakdown((v) => !v)}
                title="クリックして内訳(雇保・社保・交通費(自社負担)・駐車場代)の表示/非表示を切り替え。雇保は社保に含まれる参考値のため、社保+交通費(自社負担)+駐車場代の3項目が社保他小計と一致します"
              >
                <span className="inline-flex items-center justify-end gap-1 w-full">
                  <span>社保他小計</span>
                  {showSocialBreakdown ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
                </span>
              </th>
              {showSocialBreakdown && (
                <th
                  className="py-1.5 px-3 text-center bg-violet-50 border-l border-r border-violet-200 text-violet-800 font-extrabold"
                  colSpan={4}
                  title="社保他小計 = 社保(雇用保険込み) + 交通費(自社負担) + 駐車場代(雇保は社保に含まれる参考列のため合計には含みません)"
                >
                  社保他内訳
                </th>
              )}
              <th className="py-3 px-3 whitespace-nowrap text-right bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1} title="給与CSV由来の参考値。粗利計算には影響しません">
                有給金額
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right bg-indigo-50/50" rowSpan={anyBreakdownOpen ? 2 : 1}>
                {grossProfitLabel}
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-center bg-indigo-50/50" rowSpan={anyBreakdownOpen ? 2 : 1}>
                実質粗利率
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-right bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                有給(日)
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-center bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                交通費突合
              </th>
              <th className="py-3 px-3 whitespace-nowrap text-center bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>監査ステータス</th>
              {/* ★2026-09-11追加(23章タスクB「担当者」列復活)。クライアント×対象月単位の担当者。
                  手入力(PersonInChargePanel)があればそちらを優先し、なければ取り込み元
                  (現状は松山のみ)の値を表示する(calculator.ts参照)。未設定の場合は「-」表示。
                  ★2026-09-17修正(はまさんの指摘): 先頭付近(派遣先企業の直後)から表の最後尾へ
                  移動した(当時はソート用の項目だったため。★2026-09-19: 列見出しクリックでの
                  並べ替え機能自体を撤去したため、現在はソート目的ではないが、位置はそのまま
                  維持している)。 */}
              <th className="py-3 px-3 whitespace-nowrap bg-slate-100" rowSpan={anyBreakdownOpen ? 2 : 1}>
                担当者
              </th>
            </tr>
            {/* 2段目: 展開中のグループの個別列名のみ(すべて閉じている場合、この行自体を描画しない) */}
            {anyBreakdownOpen && (
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                {showSalesBreakdown && (
                  <>
                    <th className="py-2 px-3 text-right bg-emerald-50/60 border-l border-emerald-200">派遣</th>
                    <th className="py-2 px-3 text-right bg-emerald-50/60">交通費(相手企業負担)</th>
                    <th className="py-2 px-3 text-right bg-emerald-50/60 border-r border-emerald-200">休業分補償</th>
                  </>
                )}
                {showSalaryBreakdown && (
                  <>
                    <th className="py-2 px-3 text-right bg-amber-50/60 border-l border-amber-200">給与</th>
                    <th className="py-2 px-3 text-right bg-amber-50/60">休業手当</th>
                    <th className="py-2 px-3 text-right bg-amber-50/60 border-r border-amber-200">退職金配賦</th>
                  </>
                )}
                {showSocialBreakdown && (
                  <>
                    <th
                      className="py-2 px-3 text-right bg-violet-50/60 border-l border-violet-200"
                      title="参考値(給与CSV由来)。「社保」に既に含まれているため、社保他小計の合計には加算していません"
                    >
                      雇保 <span className="text-slate-400">ⓘ</span>
                    </th>
                    <th className="py-2 px-3 text-right bg-violet-50/60" title="請求CSV由来の社保負担額(雇用保険を含んだ金額)">
                      社保
                    </th>
                    <th className="py-2 px-3 text-right bg-violet-50/60">交通費(自社負担)</th>
                    {/* ★2026-09-18追加(はまさんの指摘): 雇保・社保・交通費(自社負担)の3列だけでは
                        駐車場代が発生する行に内訳合計と社保他小計が一致しなかったため、4列目として
                        追加した。社保+交通費(自社負担)+駐車場代の3項目(雇保を除く)が社保他小計と
                        厳密に一致する(雇保は社保に既に含まれる参考値のため、合計には含めない)。 */}
                    <th className="py-2 px-3 text-right bg-violet-50/60 border-r border-violet-200">駐車場代</th>
                  </>
                )}
              </tr>
            )}
            {/* 合計行 (★2026-09-18追加、はまさんのご要望「スタッフ給与明細と同様の合計行を
                追加してほしい」): 表示中(フィルタ適用後)の全行の列ごとの合計値。theadの一部
                なので、上のヘッダー行(1〜2段)と一緒にsticky top-0で画面上部に固定される。
                ★2026-09-19修正(はまさんの指摘「有給(日)列の背景が抜けて後ろの数字が透けて
                見える。247.5と日が2行に折り返される」): 従来、行の背景色(bg-indigo-50)を
                <tr>だけに指定し、個々の<td>には明示的な背景色を付けていなかった(border-collapse
                テーブルではセル側に背景が無い場合、行の背景が透けて見えるのが仕様上の期待動作
                だが、この合計行はsticky theadの一部として横スクロール枠の右端・縦スクロール
                バー付近に来るため、ブラウザの再描画境界でこのフォールバックが効かず背景が
                透過して見える不具合があった)。すべての<td>に明示的な背景色(区間の強調色が
                無いセルはbg-indigo-50)を指定し、行の背景頼みをやめた。あわせて全セルに
                whitespace-nowrapを付け(有給(日)セルに付いていなかったため「247.5」「日」が
                2行に折り返されていた)、数値が折り返されないようにした。 */}
            <tr className="bg-indigo-50 text-indigo-900 font-extrabold border-b-2 border-indigo-200">
              <td className="py-2.5 px-3 bg-indigo-50"></td>
              <td className="py-2.5 px-3 bg-indigo-50"></td>
              <td className="py-2.5 px-3 bg-indigo-50 whitespace-nowrap">
                <div className="flex items-center space-x-1.5">
                  <Users className="w-3.5 h-3.5 text-indigo-600" />
                  <span>合計 ({totals.count}件)</span>
                </div>
              </td>
              <td className="py-2.5 px-3 bg-indigo-50"></td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 whitespace-nowrap">
                ¥{(amountDisplay === 'incTax' ? totals.billingAmountIncTax : totals.billingAmountExTax).toLocaleString()}
              </td>
              {showSalesBreakdown && (
                <>
                  <td className="py-2.5 px-3 text-right font-mono bg-emerald-50/40 whitespace-nowrap">
                    ¥{(amountDisplay === 'incTax' ? totals.dispatchIncTax : totals.dispatchExTax).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono bg-emerald-50/40 whitespace-nowrap">
                    ¥{(amountDisplay === 'incTax' ? totals.billingTransportIncTax : totals.billingTransportExTax).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono bg-emerald-50/40 whitespace-nowrap">
                    ¥{(amountDisplay === 'incTax' ? totals.leaveCompensationAmountIncTax : totals.leaveCompensationAmountExTax).toLocaleString()}
                  </td>
                </>
              )}
              <td className="py-2.5 px-3 text-right font-mono bg-amber-50/60 whitespace-nowrap">¥{totals.referralFee.toLocaleString()}</td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 whitespace-nowrap">
                ¥{((amountDisplay === 'incTax' ? totals.billingAmountIncTax : totals.billingAmountExTax) + totals.referralFee).toLocaleString()}
              </td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 whitespace-nowrap">¥{totals.totalSalaryRow.toLocaleString()}</td>
              {showSalaryBreakdown && (
                <>
                  <td className="py-2.5 px-3 text-right font-mono bg-amber-50/40 whitespace-nowrap">¥{totals.salary.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono bg-amber-50/40 whitespace-nowrap">¥{totals.leaveAllowanceAmount.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono bg-amber-50/40 whitespace-nowrap">¥{totals.retirementAmount.toLocaleString()}</td>
                </>
              )}
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 whitespace-nowrap">¥{totals.billingUnitPrice.toLocaleString()}</td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 whitespace-nowrap">¥{totals.payUnitPrice.toLocaleString()}</td>
              <td className="py-2.5 px-3 text-right font-mono bg-sky-50/60 whitespace-nowrap">
                {totals.nominalGrossMarginRateDataAvailable ? `${totals.nominalGrossMarginRate}%` : 'データなし'}
              </td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 text-slate-400 whitespace-nowrap">不明</td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 whitespace-nowrap">¥{totals.socialInsuranceOther.toLocaleString()}</td>
              {showSocialBreakdown && (
                <>
                  <td className="py-2.5 px-3 text-right font-mono bg-violet-50/40 whitespace-nowrap">¥{totals.employmentInsurance.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono bg-violet-50/40 whitespace-nowrap">¥{totals.socialInsurance.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono bg-violet-50/40 whitespace-nowrap">¥{totals.salaryTransport.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-right font-mono bg-violet-50/40 whitespace-nowrap">¥{totals.parkingFee.toLocaleString()}</td>
                </>
              )}
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 whitespace-nowrap">
                ¥{totals.paidLeaveAllowance.toLocaleString()}
              </td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-100 whitespace-nowrap">
                ¥{(amountDisplay === 'incTax' ? totals.grossProfitIncTax : totals.grossProfitExTax).toLocaleString()}
              </td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-100 whitespace-nowrap">{totals.grossMarginRate}%</td>
              <td className="py-2.5 px-3 text-right font-mono bg-indigo-50 whitespace-nowrap">{totals.paidLeaveDays}日</td>
              <td className="py-2.5 px-3 text-center font-mono bg-indigo-50 text-slate-400 whitespace-nowrap">-</td>
              <td className="py-2.5 px-3 text-center font-mono bg-indigo-50 whitespace-nowrap">
                {totals.actionableAlertCount === 0 ? '正常' : `要確認 ${totals.actionableAlertCount}件`}
              </td>
              <td className="py-2.5 px-3 bg-indigo-50"></td>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
            {filteredResults.length === 0 ? (
              <tr>
                <td
                  colSpan={20 + (showSalesBreakdown ? 3 : 0) + (showSalaryBreakdown ? 3 : 0) + (showSocialBreakdown ? 4 : 0)}
                  className="py-12 text-center text-slate-400"
                >
                  該当する計算結果データが見つかりません。CSVデータを読み込んでください。
                </td>
              </tr>
            ) : (
              filteredResults.map((row) => {
                const isNegative = row.grossProfitExTax < 0;
                const isLowMargin = row.grossProfitRate < lowMarginThreshold && !isNegative;
                const displayBillingAmount = amountDisplay === 'incTax' ? row.billingAmountIncTax : row.billingAmountExTax;
                const displayGrossProfit = amountDisplay === 'incTax' ? row.grossProfitIncTax : row.grossProfitExTax;
                const actionableAlertCount = countActionableAlerts(row.alerts);
                const breakdown = computeRowBreakdown(row, taxRate);
                // ★2026-09-19追加: 売上内訳(派遣/交通費(相手企業負担)/休業分補償)は、税抜/税込
                // 表示切替(amountDisplay)に連動させ、常に「派遣売上」の表示中の値と一致するようにする
                const dispatchDisplay = amountDisplay === 'incTax' ? breakdown.dispatchIncTax : breakdown.dispatchExTax;
                const billingTransportDisplay = amountDisplay === 'incTax' ? breakdown.billingTransportIncTax : breakdown.billingTransportExTax;
                const leaveCompensationAmountDisplay = amountDisplay === 'incTax' ? breakdown.leaveCompensationAmountIncTax : breakdown.leaveCompensationAmountExTax;

                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      isNegative
                        ? 'bg-rose-50/40'
                        : isLowMargin
                        ? 'bg-amber-50/30'
                        : row.transportDiff !== 0
                        ? 'bg-blue-50/20'
                        : ''
                    }`}
                  >
                    <td className="py-2.5 px-3 font-semibold text-slate-600 whitespace-nowrap">
                      {row.targetMonth}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 text-[11px] whitespace-nowrap">
                      {row.billingNo}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center space-x-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <div>
                          <div className="font-bold text-slate-900 flex items-center space-x-1">
                            <span>{row.staffName}</span>
                            {row.mergedRowCount > 1 && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200"
                                title={`20日締等で${row.mergedRowCount}件の請求行を統合（受注番号: ${row.mergedOrderNos.join(' / ')}）`}
                              >
                                統合×{row.mergedRowCount}
                              </span>
                            )}
                            {row.manualEntryType && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-100 text-violet-700 border border-violet-200"
                                title={`手入力行(${row.billingNo})${row.manualEntryMemo ? ` ｜ 備考: ${row.manualEntryMemo}` : ''}`}
                              >
                                手入力
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{row.staffNo}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap max-w-[160px] truncate" title={row.clientName}>
                      <div className="flex items-center space-x-1">
                        <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-semibold text-slate-700">{row.clientName}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                      ¥{displayBillingAmount.toLocaleString()}
                    </td>
                    {/* 売上内訳 (派遣売上の内訳。ヘッダーのグループ見出し参照) */}
                    {showSalesBreakdown && (
                      <>
                        <td className="py-2.5 px-3 text-right font-mono bg-emerald-50/30 border-l border-emerald-200">
                          ¥{dispatchDisplay.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono bg-emerald-50/30">¥{billingTransportDisplay.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono bg-emerald-50/30 border-r border-emerald-200">
                          ¥{leaveCompensationAmountDisplay.toLocaleString()}
                        </td>
                      </>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono bg-amber-50/40 text-amber-800 font-semibold whitespace-nowrap">
                      {row.referralFee > 0 ? `¥${row.referralFee.toLocaleString()}` : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 whitespace-nowrap">
                      ¥{(displayBillingAmount + row.referralFee).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 whitespace-nowrap">
                      ¥{breakdown.totalSalaryRow.toLocaleString()}
                    </td>
                    {/* 給与内訳 (給与総額の内訳。ヘッダーのグループ見出し参照) */}
                    {showSalaryBreakdown && (
                      <>
                        <td className="py-2.5 px-3 text-right font-mono bg-amber-50/30 border-l border-amber-200">
                          ¥{breakdown.salary.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono bg-amber-50/30">¥{breakdown.leaveAllowanceAmount.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono bg-amber-50/30 border-r border-amber-200">
                          ¥{row.retirementAmount.toLocaleString()}
                        </td>
                      </>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                      ¥{row.billingUnitPrice.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                      ¥{row.payUnitPrice.toLocaleString()}
                    </td>
                    {/* 名目粗利率 (★2026-09-15追加。ヘッダーのツールチップ参照) */}
                    <td className="py-2.5 px-3 text-center font-mono text-sky-800 bg-sky-50/30 whitespace-nowrap">
                      {row.nominalGrossMarginRateDataAvailable ? (
                        `${row.nominalGrossMarginRate}%`
                      ) : (
                        <span className="text-slate-300">データなし</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">不明</td>
                    <td
                      className="py-2.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap"
                      title={`社保負担額(請求CSV由来): ¥${row.socialInsurance.toLocaleString()}, 交通費(自社負担): ¥${row.salaryTransport.toLocaleString()}, 駐車場: ¥${row.parkingFee.toLocaleString()} ｜ 雇用保険(参考・給与CSV由来、社保負担額に含まれる想定のため合計には非算入): ¥${row.employmentInsurance.toLocaleString()}`}
                    >
                      ¥{breakdown.socialInsuranceOther.toLocaleString()}
                    </td>
                    {/* 社保他内訳 (社保他小計の内訳。ヘッダーのグループ見出し参照) */}
                    {showSocialBreakdown && (
                      <>
                        <td className="py-2.5 px-3 text-right font-mono bg-violet-50/30 border-l border-violet-200">
                          ¥{row.employmentInsurance.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono bg-violet-50/30">¥{row.socialInsurance.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono bg-violet-50/30">¥{row.salaryTransport.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right font-mono bg-violet-50/30 border-r border-violet-200">
                          ¥{row.parkingFee.toLocaleString()}
                        </td>
                      </>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                      ¥{row.paidLeaveAllowance.toLocaleString()}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-extrabold whitespace-nowrap bg-indigo-50/30 ${
                        isNegative ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      ¥{displayGrossProfit.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap bg-indigo-50/30">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          isNegative
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : isLowMargin
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}
                      >
                        {row.grossProfitRate}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                      {row.paidLeaveDays}日
                    </td>

                    {/* 交通費突合 */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {!row.transportDataAvailable ? (
                        <span
                          className="text-[11px] font-medium text-slate-400"
                          title="このデータソースには請求側交通費の情報が含まれていません(請求書印刷CSV等を追加読込してください)"
                        >
                          対象外（交通費データなし）
                        </span>
                      ) : row.transportDiff === 0 ? (
                        <span className="text-[11px] font-semibold text-emerald-600 flex items-center justify-center space-x-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>一致 (¥{row.salaryTransport.toLocaleString()})</span>
                        </span>
                      ) : (
                        <div className="text-[10px] text-center" title={`給与支給: ¥${row.salaryTransport.toLocaleString()} / 請求: ¥${row.billingTransport.toLocaleString()}`}>
                          <span
                            className={`inline-block font-bold px-1.5 py-0.5 rounded ${
                              row.transportDiff > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {row.transportDiff > 0
                              ? `請求漏れ +¥${row.transportDiff.toLocaleString()}`
                              : `過剰請求 -¥${Math.abs(row.transportDiff).toLocaleString()}`}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* 監査ステータス (★2026-08-26修正: info severityは含めず、warning/errorのみで判定) */}
                    <td className="py-2.5 px-3 text-center whitespace-nowrap">
                      {actionableAlertCount === 0 ? (
                        <span className="inline-flex items-center space-x-1 text-emerald-600 text-[11px] font-medium">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>正常</span>
                        </span>
                      ) : (
                        <div className="flex items-center justify-center space-x-1" title={row.alerts.map((a) => a.message).join(' / ')}>
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <span className="font-bold text-amber-700 text-[11px]">
                            要確認 ({actionableAlertCount})
                          </span>
                        </div>
                      )}
                    </td>
                    {/* 担当者 (★2026-09-17修正: 表の最後尾に配置。ヘッダー参照) */}
                    <td className="py-2.5 px-3 whitespace-nowrap text-slate-600">
                      {row.personInCharge || <span className="text-slate-300">-</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
