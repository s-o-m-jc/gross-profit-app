/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * 決算期 (年間) 集計 & ダッシュボードコンポーネント
 */

import React, { useMemo, useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users,
  Building,
  Briefcase,
  BarChart2,
  FileCheck,
  ChevronDown,
  ChevronUp,
  UserMinus,
  CalendarClock,
  Table2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Bar,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { FiscalYearSummary } from '../types';

/**
 * ★2026-09-21追加(はまさんのご要望「Y軸の下限を実データに合わせて引き上げて、変化を見やすく
 * してほしい」): 実データの最小値・最大値からYAxisのdomainを計算する。Rechartsの既定
 * (domain未指定時は[0, 'auto'])だと、実データが75〜95のような狭い帯に集中していても
 * 0からの表示になり変化が見えにくいため、実データの範囲にstep刻みで少し余白を持たせた
 * [下限, 上限]を返す(下限は0未満にはしない)。
 */
function computeAxisDomain(values: number[], step: number): [number, number] {
  if (values.length === 0) return [0, step * 10];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const lower = Math.max(0, Math.floor((min - step) / step) * step);
  const upper = Math.ceil((max + step) / step) * step;
  return lower === upper ? [Math.max(0, lower - step), upper + step] : [lower, upper];
}

interface FiscalYearAnalyticsProps {
  summary: FiscalYearSummary;
  /** ★2026-09-20追加(はまさんのご要望「前年対比の追加」): 選択中の決算期の1年前の決算期の
   * サマリー(App.tsx側で同じcalculateFiscalYearSummaryを開始年月だけ1年ずらして計算したもの)。
   * 月次推移グラフ・スタッフ人数グラフで、同じ相対月位置(配列インデックス、必ず12ヶ月分
   * ゼロ埋め済みなので添字を合わせるだけで同月比較になる)の値を破線の参考系列として重ねる。 */
  previousSummary: FiscalYearSummary;
  /** ★2026-09-20追加(はまさんのご要望「スタッフ人数・粗利率のグラフを直近3決算期分で比較
   * できるようにしてほしい」): 選択中の決算期の2年前の決算期のサマリー(previousSummaryと同じ
   * 考え方、開始年月を2年ずらして同じcalculateFiscalYearSummaryで計算したもの)。 */
  previousPreviousSummary: FiscalYearSummary;
}

const DEFAULT_LEAVE_BALANCE_THRESHOLD = 10;
const CLIENT_RANKING_LIMIT = 10;

export const FiscalYearAnalytics: React.FC<FiscalYearAnalyticsProps> = ({
  summary,
  previousSummary,
  previousPreviousSummary,
}) => {
  // 22章タスク3: 得意先別ランキングのベスト/ワースト切替、行クリックでの月次トレンド展開
  const [rankingMode, setRankingMode] = useState<'best' | 'worst'>('best');
  const [expandedClientCode, setExpandedClientCode] = useState<string | null>(null);
  // 22章タスク2: 有給残日数アラートの閾値(年5日の有給取得義務を踏まえ、仮に10日をデフォルトとする)
  const [leaveBalanceThreshold, setLeaveBalanceThreshold] = useState<number>(DEFAULT_LEAVE_BALANCE_THRESHOLD);
  // ★2026-09-18追加(はまさんのご要望): 月次サマリ表の「売上内訳」「給与内訳」「社保他内訳」を
  // それぞれ独立して開閉できるようにする。既定は非表示(集計列のみ表示)で、集計列の見出しを
  // クリックすると該当する内訳列が展開される。
  const [showSalesBreakdown, setShowSalesBreakdown] = useState(false);
  const [showSalaryBreakdown, setShowSalaryBreakdown] = useState(false);
  const [showSocialBreakdown, setShowSocialBreakdown] = useState(false);
  const anyMonthlySummaryBreakdownOpen = showSalesBreakdown || showSalaryBreakdown || showSocialBreakdown;
  // ★2026-09-19修正(表構造の不具合): 月次サマリ表の見出し1段目(常時表示の各列)は元々常に
  // rowSpan={2}にしていたが、内訳がすべて閉じている(anyMonthlySummaryBreakdownOpen===false)場合、
  // 見出し2段目(内訳の個別列名)の<tr>自体を描画しないため、rowSpan=2が「存在しない2段目」を
  // 飛び越えて、HTMLのテーブルグリッド計算上、theadの次に来る実際の<tr>(tbodyの最初のデータ行)
  // まで浸食してしまう(rowSpan/colSpanのグリッド計算はthead/tbodyの区切りを無視し、テーブル
  // 全体を1つの行グリッドとして扱うため)。この結果、内訳が閉じている既定状態で表が丸ごとズレて
  // 見えるバグがあった。内訳が開いている時だけrowSpan=2(2段目が実在するため正しく機能する)、
  // 閉じている時はrowSpan=1(2段目自体が存在しないため、1段の通常ヘッダーとして扱う)にすることで
  // 解消した。

  const rankedClients = useMemo(() => {
    const withData = summary.clientRankings.filter((c) => c.nominalGrossMarginRateDataAvailable);
    const sorted = [...withData].sort((a, b) =>
      rankingMode === 'best'
        ? b.nominalGrossMarginRate - a.nominalGrossMarginRate
        : a.nominalGrossMarginRate - b.nominalGrossMarginRate
    );
    return sorted.slice(0, CLIENT_RANKING_LIMIT);
  }, [summary.clientRankings, rankingMode]);

  const clientsWithoutNominalData = summary.clientRankings.length - summary.clientRankings.filter((c) => c.nominalGrossMarginRateDataAvailable).length;

  const alertedLeaveBalances = useMemo(
    () => summary.staffPaidLeaveBalances.filter((s) => s.paidLeaveRemainingDays >= leaveBalanceThreshold),
    [summary.staffPaidLeaveBalances, leaveBalanceThreshold]
  );

  // ★2026-09-20追加(はまさんのご要望「月次サマリの合計数値表示」): 月次サマリ表の下に、
  // 決算期全体の年間合計行を追加する。値はいずれもFiscalYearSummary(calculateFiscalYearSummary、
  // 既存の決算期集計ロジック)が既に算出済みの全期間合計フィールドをそのまま使う(新しい計算式は
  // 追加していない)。内訳グループ(派遣/交通費(相手企業負担)/休業分補償、給与/休業手当/退職金配賦、
  // 雇保/社保/交通費(自社負担)/駐車場代)についても、FiscalYearSummaryに用意されている同名の
  // 全期間合計フィールドをそのまま使う。「派遣」「給与」「社保他小計」の3つの狭義項目のみ
  // FiscalYearSummaryに直接の全期間合計フィールドが無いため、MonthlyTrend側で既に使っている
  // (types.ts/calculator.tsにコメントで明記済みの)同一の分解式を、月次値の代わりに全期間合計値へ
  // そのまま適用して算出する(新しい計算式ではなく、既存の式の入力を月次→全期間に置き換えただけ)。
  const monthlyTotals = useMemo(() => {
    // 給与総額(狭義、集計シート方式の表示用) = ΣpaymentAmount − ΣsalaryTransport
    // (MonthlyTrend.totalSalaryの定義と同じ式。FiscalYearSummary.totalSalaryは交通費控除前)
    const totalSalaryNarrow = summary.totalSalary - summary.totalTransportSalary;
    return {
      staffCount: summary.activeStaffCount,
      dispatchSales: summary.totalSalesExTax,
      // 派遣(狭義) = 派遣売上 − 交通費(相手企業負担) − 休業分補償 (MonthlyTrend.dispatchと同じ式)
      dispatch: summary.totalSalesExTax - summary.totalTransportBilling - summary.totalLeaveCompensation,
      transportBilling: summary.totalTransportBilling,
      leaveCompensation: summary.totalLeaveCompensation,
      referralSales: summary.totalReferralFee,
      totalSales: summary.totalRevenueExTax,
      totalSalary: totalSalaryNarrow,
      // 給与(狭義) = 給与総額(狭義) − 休業手当 (MonthlyTrend.salaryと同じ式)
      salary: totalSalaryNarrow - summary.totalLeaveAllowance,
      leaveAllowance: summary.totalLeaveAllowance,
      retirementAmount: summary.totalRetirement,
      // ★2026-09-21修正(はまさんの指摘「請求@・支払@の合計欄が意味のない大きな数字になっている」):
      // 請求＠・支払＠は「1件あたり単価」の列であり、月次サマリ表の各月の値(billingUnitPriceSum等)
      // 自体が既に「その月の全契約の単価を単純合計した値」(名目粗利率算出用の中間値)である。
      // これをさらに全期間ぶん合計すると、単価でも合計金額でもない意味を持たない数字になって
      // しまうため、この列の年間合計欄は表示しない(月次粗利明細一覧の「交通費(税抜)」列が
      // 常に「不明」表示になっているのと同じ考え方で、算出しても意味の無い値は表示しない)。
      // 名目粗利率(下記)自体は、この2つの単純合計ではなく、calculator.ts側で全期間の契約データを
      // 対象に正しく算出済みの値(summary.nominalGrossMarginRate)をそのまま使っており、
      // 影響を受けない。
      nominalGrossMarginRate: summary.nominalGrossMarginRate,
      nominalGrossMarginRateDataAvailable: summary.billingUnitPriceDataAvailable,
      // 社保他小計(狭義) = 社保(雇用保険込み) + 交通費(自社負担) + 駐車場代 (MonthlyTrend.socialInsuranceOtherと同じ式)
      socialInsuranceOther: summary.totalSocialInsurance + summary.totalTransportSalary + summary.totalParkingFee,
      employmentInsurance: summary.totalEmploymentInsurance,
      socialInsurance: summary.totalSocialInsurance,
      transportSalary: summary.totalTransportSalary,
      parkingFee: summary.totalParkingFee,
      paidLeaveAmount: summary.totalPaidLeaveAmount,
      grossProfit: summary.totalGrossProfit,
      grossMarginRate: summary.overallGrossMarginRate,
      paidLeaveDays: summary.totalPaidLeaveDays,
      avgPaidLeaveDaysPerStaff: summary.avgPaidLeaveDaysPerStaff,
    };
  }, [summary]);

  // ★2026-09-20追加(はまさんのご要望「グラフに前年対比を追加」): 月次推移グラフで使う、
  // 今期・前期を同じ相対月位置(配列インデックス)で1本にまとめたデータ。
  // summary.monthlyTrends・previousSummary.monthlyTrendsは、calculateFiscalYearSummaryの実装上
  // 必ず指定した月数(12)ぶんゼロ埋め済みの配列を返すため、単純に添字を揃えるだけで
  // 「今期のn番目の月」⇔「前期のn番目の月(=ちょうど1年前の同月)」の対応が取れる。
  // 名目粗利率はデータが無い月に0が入る仕様(nominalGrossMarginRateDataAvailable===false)のため、
  // 折れ線がグラフ上で誤って「0%」に落ち込んで見えないよう、データ無しの月はnullにしてグラフの
  // 該当区間を欠測として扱う(connectNullsで前後の実データ点同士を線で結ぶ)。
  // ★2026-09-20再修正(はまさんのご要望「前年分の名目・実質粗利率も追加してほしい」): 前年の
  // 粗利率2種もあわせて持たせる。
  const chartData = useMemo(() => {
    return summary.monthlyTrends.map((m, i) => {
      const prev = previousSummary.monthlyTrends[i];
      return {
        month: m.month,
        totalSales: m.totalSales,
        grossProfit: m.grossProfit,
        grossMarginRate: m.grossMarginRate,
        nominalGrossMarginRate: m.nominalGrossMarginRateDataAvailable ? m.nominalGrossMarginRate : null,
        staffCount: m.staffCount,
        prevTotalSales: prev ? prev.totalSales : null,
        prevGrossProfit: prev ? prev.grossProfit : null,
        prevGrossMarginRate: prev ? prev.grossMarginRate : null,
        prevNominalGrossMarginRate: prev && prev.nominalGrossMarginRateDataAvailable ? prev.nominalGrossMarginRate : null,
        prevStaffCount: prev ? prev.staffCount : null,
      };
    });
  }, [summary.monthlyTrends, previousSummary.monthlyTrends]);

  // 前期のデータが1件も無い(全月0)場合は、誤解を招く「前年は常に0円/0人だった」という
  // 破線を表示せず、系列自体を出さない(前期データが本当に無いのか、単に未取込なのか
  // 画面からは区別できないため、無い場合は素直に非表示にする)。
  const hasPreviousYearSalesData = previousSummary.monthlyTrends.some((m) => m.totalSales !== 0 || m.grossProfit !== 0);

  // ★2026-09-20追加(はまさんのご要望「スタッフ人数・粗利率のグラフを直近3決算期分の折れ線で
  // 比較できるようにしてほしい」): 今期・前期・前々期を同じ相対月位置で1本にまとめたデータ。
  // X軸ラベルは今期の実際の対象年月("2024-10"等)を使う(前期・前々期は同じ相対位置=ちょうど
  // 1年前・2年前の同月に対応する)。
  const threePeriodData = useMemo(() => {
    return summary.monthlyTrends.map((m, i) => {
      const prev = previousSummary.monthlyTrends[i];
      const prevPrev = previousPreviousSummary.monthlyTrends[i];
      return {
        month: m.month,
        staffCount: m.staffCount,
        prevStaffCount: prev ? prev.staffCount : null,
        prevPrevStaffCount: prevPrev ? prevPrev.staffCount : null,
        grossMarginRate: m.grossMarginRate,
        nominalGrossMarginRate: m.nominalGrossMarginRateDataAvailable ? m.nominalGrossMarginRate : null,
        prevGrossMarginRate: prev ? prev.grossMarginRate : null,
        prevNominalGrossMarginRate: prev && prev.nominalGrossMarginRateDataAvailable ? prev.nominalGrossMarginRate : null,
        prevPrevGrossMarginRate: prevPrev ? prevPrev.grossMarginRate : null,
        prevPrevNominalGrossMarginRate:
          prevPrev && prevPrev.nominalGrossMarginRateDataAvailable ? prevPrev.nominalGrossMarginRate : null,
      };
    });
  }, [summary.monthlyTrends, previousSummary.monthlyTrends, previousPreviousSummary.monthlyTrends]);

  const hasPreviousYearStaffData = previousSummary.monthlyTrends.some((m) => m.staffCount !== 0);
  const hasPreviousPreviousYearStaffData = previousPreviousSummary.monthlyTrends.some((m) => m.staffCount !== 0);
  const hasPreviousYearMarginData = previousSummary.monthlyTrends.some((m) => m.grossMarginRate !== 0 || m.nominalGrossMarginRateDataAvailable);
  const hasPreviousPreviousYearMarginData = previousPreviousSummary.monthlyTrends.some(
    (m) => m.grossMarginRate !== 0 || m.nominalGrossMarginRateDataAvailable
  );

  // ★2026-09-21追加(はまさんのご要望「スタッフ人数グラフのY軸調整・年間平均の追加」):
  // Y軸の下限をデータの実際の分布に合わせるため、0(=データが無い月のゼロ埋め)を除いた
  // 実データのみからdomainを計算する(データが無い期の系列は非表示にしているため、その期の
  // 値は最初から含まれない)。
  const staffCountDomain = useMemo(() => {
    const values: number[] = [];
    threePeriodData.forEach((d) => {
      if (d.staffCount > 0) values.push(d.staffCount);
      if (hasPreviousYearStaffData && d.prevStaffCount) values.push(d.prevStaffCount);
      if (hasPreviousPreviousYearStaffData && d.prevPrevStaffCount) values.push(d.prevPrevStaffCount);
    });
    return computeAxisDomain(values, 5);
  }, [threePeriodData, hasPreviousYearStaffData, hasPreviousPreviousYearStaffData]);

  // 年間平均スタッフ人数(月次サマリのstaffCountを単純に12ヶ月平均したもの。稼働スタッフ総数
  // (activeStaffCount、期間中に1度でも在籍した人数を重複排除した値)とは別の指標であることに
  // 注意。こちらは「月あたり何人体制だったか」の平均値)。
  const avgMonthlyStaffCount = (trends: FiscalYearSummary['monthlyTrends']) => {
    if (trends.length === 0) return 0;
    return Number((trends.reduce((s, m) => s + m.staffCount, 0) / trends.length).toFixed(1));
  };
  const avgStaffCountThis = avgMonthlyStaffCount(summary.monthlyTrends);
  const avgStaffCountPrev = avgMonthlyStaffCount(previousSummary.monthlyTrends);
  const avgStaffCountPrevPrev = avgMonthlyStaffCount(previousPreviousSummary.monthlyTrends);

  // ★2026-09-21追加(はまさんのご要望「粗利率グラフのY軸範囲も実データに合わせて調整」):
  // 月次の名目粗利率(3期分)と、下記Dで参考線として表示する実質粗利率の年間平均(3期分)を
  // 合わせた実データからdomainを計算する。
  const marginRateDomain = useMemo(() => {
    const values: number[] = [];
    threePeriodData.forEach((d) => {
      if (d.nominalGrossMarginRate !== null) values.push(d.nominalGrossMarginRate);
      if (hasPreviousYearMarginData && d.prevNominalGrossMarginRate !== null) values.push(d.prevNominalGrossMarginRate);
      if (hasPreviousPreviousYearMarginData && d.prevPrevNominalGrossMarginRate !== null) {
        values.push(d.prevPrevNominalGrossMarginRate);
      }
    });
    values.push(summary.overallGrossMarginRate);
    if (hasPreviousYearMarginData) values.push(previousSummary.overallGrossMarginRate);
    if (hasPreviousPreviousYearMarginData) values.push(previousPreviousSummary.overallGrossMarginRate);
    return computeAxisDomain(values, 5);
  }, [
    threePeriodData,
    hasPreviousYearMarginData,
    hasPreviousPreviousYearMarginData,
    summary.overallGrossMarginRate,
    previousSummary.overallGrossMarginRate,
    previousPreviousSummary.overallGrossMarginRate,
  ]);

  return (
    <div className="space-y-6 mb-8">
      {/* 1. エグゼクティブKPIサマリーカード
          ★2026-09-02: 「要確認アラート数」カードを削除(分析画面ではなく数値検証&監査アラート画面の役割のため)。
          「総直接原価」カードも削除(この画面の目的は契約金額(売上)と支払(原価)から結果的な粗利がいくらか
          を可視化することであり、原価単体の表示は不要というユーザー判断)。上記2枚削除に伴いカード数が
          9→7枚になったため lg:grid-cols-9 → lg:grid-cols-7 に変更。 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {/* 総売上高 */}
        <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm border border-slate-800">
          <span className="text-[11px] text-slate-400 font-semibold block mb-1">
            総売上高 (税抜)
          </span>
          <div className="text-lg font-extrabold font-mono text-white">
            ¥{summary.totalRevenueExTax.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            派遣: ¥{summary.totalSalesExTax.toLocaleString()} <br />
            紹介: ¥{summary.totalReferralFee.toLocaleString()} <br />
            派遣売上(税込): ¥{summary.totalRevenueIncTax.toLocaleString()}
          </div>
        </div>

        {/* 総粗利益 */}
        <div className="bg-indigo-900 text-white rounded-xl p-4 shadow-sm border border-indigo-800">
          <span className="text-[11px] text-indigo-300 font-semibold block mb-1">
            総粗利益 (税抜)
          </span>
          <div className="text-lg font-extrabold font-mono text-emerald-300">
            ¥{summary.totalGrossProfit.toLocaleString()}
          </div>
          <div className="text-[10px] text-indigo-300 mt-1">
            全体粗利率: <strong className="text-white text-xs">{summary.overallGrossMarginRate}%</strong>
            <br />
            税込換算: ¥{summary.totalGrossProfitIncTax.toLocaleString()}
          </div>
        </div>

        {/* 退職金積立合計 */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <span className="text-[11px] text-slate-500 font-semibold block mb-1">
            退職金配賦合計
          </span>
          <div className="text-base font-bold font-mono text-slate-900">
            ¥{summary.totalRetirement.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">原価項目として減算済</div>
        </div>

        {/* 手入力調整合計 (15章: 休業分補償・休業手当・次月調整。いずれも上のKPIに算入済の内訳表示。
            上段の合計値は「粗利益への影響額」(休業補償・次月調整売上側は+、休業手当・次月調整原価側は
            マイナス寄与)。下段の内訳は各カテゴリの実際の計上額(売上側はプラス=売上増、原価側は
            プラス=原価増をそのまま表示。原価側がマイナス値の場合は原価が減った=粗利にはプラス寄与)。 */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <span className="text-[11px] text-slate-500 font-semibold block mb-1">
            手入力調整合計 (粗利益への影響額)
          </span>
          <div className="text-base font-bold font-mono text-slate-900">
            {(() => {
              const netEffect =
                summary.totalLeaveCompensation -
                summary.totalLeaveAllowance +
                summary.totalNextMonthAdjustmentSales -
                summary.totalNextMonthAdjustmentCost;
              return `${netEffect < 0 ? '−' : ''}¥${Math.abs(netEffect).toLocaleString()}`;
            })()}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">
            休業補償 +¥{summary.totalLeaveCompensation.toLocaleString()} ｜ 休業手当 −¥
            {summary.totalLeaveAllowance.toLocaleString()}
            <br />
            次月調整 売上 {summary.totalNextMonthAdjustmentSales < 0 ? '−' : '+'}¥
            {Math.abs(summary.totalNextMonthAdjustmentSales).toLocaleString()} / 原価{' '}
            {summary.totalNextMonthAdjustmentCost < 0 ? '−' : '+'}¥
            {Math.abs(summary.totalNextMonthAdjustmentCost).toLocaleString()}
          </div>
        </div>

        {/* 有給合計 (参考値・粗利計算には影響しない) */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <span className="text-[11px] text-slate-500 font-semibold block mb-1">
            有給金額 / 日数合計
          </span>
          <div className="text-base font-bold font-mono text-slate-900">
            ¥{summary.totalPaidLeaveAmount.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {summary.totalPaidLeaveDays}日 (1人当たり{summary.avgPaidLeaveDaysPerStaff}日 / ¥
            {summary.avgPaidLeaveAmountPerStaff.toLocaleString()})
            <br />
            取得率(1人当たり平均取得日数):{' '}
            {summary.paidLeaveUtilizationRateDataAvailable ? `${summary.paidLeaveUtilizationRate}日` : 'データなし'}
          </div>
        </div>

        {/* 稼働スタッフ数 */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <span className="text-[11px] text-slate-500 font-semibold block mb-1">
            稼働スタッフ総数
          </span>
          <div className="text-base font-bold font-mono text-slate-900 flex items-center space-x-1">
            <Users className="w-4 h-4 text-indigo-600" />
            <span>{summary.activeStaffCount}名</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            延べ請求: {summary.totalBillingCount}件
          </div>
        </div>

        {/* 離職率 (★2026-08-27追加・22章タスク2) */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <span className="text-[11px] text-slate-500 font-semibold block mb-1">離職率</span>
          <div className="text-base font-bold font-mono text-slate-900 flex items-center space-x-1">
            <UserMinus className="w-4 h-4 text-rose-500" />
            <span>{summary.turnoverRateDataAvailable ? `${summary.turnoverRate}%` : 'データなし'}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            月次の給与CSV在籍有無の推移から算出
          </div>
        </div>
      </div>

      {/* 1.5 月次サマリ (★2026-09-11復活・23章タスクA)
          ★2026-09-02にはこの位置に「大阪人材集計シート方式」の名目指標ブロックがあったが、
          「大阪人材固有の簡易集計方式で他支店とロジックが揃わない」という理由で一度削除した。
          今回、松山・四国からも同様の指標(大阪人材の月別総合計シート「集計」タブと同じ項目)が
          要望されたため、大阪固有ではなく全社共通の指標として復活させた(運用者確認済み)。
          選択中の1社・選択中の決算期の各月について、集計シートと同じ項目を1行ずつ表示する。
          「交通費(税抜)」列は、数式からは他のどの列からも参照されておらず正確な定義を特定できな
          かったため保留(実データファイル到着後に別途対応)。「チェック」「差額」「○×」列は
          Excel側の内部整合性チェック用の列で、このアプリは終始一貫した1つの計算エンジンで
          計算するためズレのリスク自体が無く、対応する概念が無いため表示していない。
          ★2026-09-14修正(はまさんの指摘・大阪の実データで最終確認): 「実質粗利益」列は、当初
          このシート方式専用の別計算(summaryGrossProfit)を用意していたが、実データ検算の結果
          既存のgrossProfit(実額の粗利益計算)と完全に一致することが確認できたため撤回し、
          既存のgrossProfitをそのまま表示するようにした。派遣・交通費(自社負担)・給与・社保等の
          内訳列は、このgrossProfitを表示用に分解したものであり(内訳の合計は必ずgrossProfitと
          一致する、calculator.ts参照)、新しい計算ロジックではない。
          ★2026-09-16修正(はまさんの指摘・「集計」シートヘッダー行との突合): 実質粗利率・有給(日)・
          1人当たり有給日数の3項目が抜けていたため追加(実質粗利率は既存のgrossMarginRate、
          有給(日)は既存のpaidLeaveDaysをそのまま使い、1人当たり有給日数のみ新規フィールドを
          追加)。また列の並び順を「集計」シートのヘッダー行の実際の並びに合わせ、交通費(自社負担)を
          社保の直後(社保他の直前)に移動した。
          ★2026-09-18再修正(はまさんのご要望): 以下2点を反映。
          1. 退職金配賦は末尾の単独「追加項目」列から、「給与内訳」グループに組み込んだ
             (給与内訳が「給与・休業手当・退職金配賦」の3列になり、「給与総額 = 給与+休業手当+
             退職金配賦」という関係になる)。
          2. 「社保他」列を「社保他小計」に改称し、「雇保・社保・交通費(自社負担)」の3列を
             その内訳グループとした。★ただし実際のsocialInsuranceOtherの計算式(calculator.ts)には
             駐車場代(parkingFee)も含まれており、この3列の単純合計と社保他小計の値が一致しない
             月がありうる(駐車場代が発生する月)。はまさんの依頼文言どおり3列のみを内訳として
             表示しているが、この差異は目視確認時にお伝えする。
          さらに、3つの内訳グループ(売上内訳・給与内訳・社保他内訳)を既定で非表示にし、集計列
          (派遣売上/給与総額/社保他小計)の見出しをクリックすると展開/折りたたみできるように
          した(showSalesBreakdown/showSalaryBreakdown/showSocialBreakdown、開閉は独立)。
          折りたたみ時は内訳列自体をDOMから外す(colSpan/非表示ではなく行・列を増減させる)ため、
          複数月を縦に並べて内訳だけをまとめて比較できる。 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="mb-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Table2 className="w-4 h-4 text-indigo-600" />
            <span>月次サマリ ({summary.startMonth} 〜 {summary.endMonth})</span>
          </h3>
          <p className="text-xs text-slate-500">
            大阪人材の月別総合計シート「集計」タブと同じ項目の、選択中の決算期・月別内訳。
            「派遣売上」「給与総額」「社保他小計」の見出しをクリックすると、その内訳列が展開されます。
          </p>
        </div>
        {/* ★2026-09-20修正(はまさんのご要望「合計行の表示位置を他タブと統一」): 以前はtbodyの
            末尾(全12ヶ月の後)に合計行を置いていたが、月次粗利明細一覧・スタッフ給与明細と同じ
            パターン(合計行をthead側に含め、theadごとsticky top-0で画面上部に固定する)に統一した。
            それに伴い、テーブルの外枠もoverflow-x-auto単体からoverflow-auto+max-h-[calc(100vh-80px)]
            (縦スクロールもこの枠内に閉じ込める)に変更している。 */}
        <div className="overflow-auto table-scroll max-h-[calc(100vh-80px)] rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs border-collapse whitespace-nowrap">
            <thead className="sticky top-0 z-20 shadow-sm">
              <tr className={`bg-slate-100 text-slate-700 font-bold ${anyMonthlySummaryBreakdownOpen ? '' : 'border-b border-slate-200'}`}>
                <th className="py-2 px-3 bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>月</th>
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>スタッフ人数</th>
                <th
                  className="py-2 px-3 text-right bg-slate-100 cursor-pointer hover:bg-slate-200 select-none"
                  rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}
                  onClick={() => setShowSalesBreakdown((v) => !v)}
                  title="クリックして内訳(派遣・交通費(相手企業負担)・休業分補償)の表示/非表示を切り替え"
                >
                  <span className="inline-flex items-center justify-end gap-1 w-full">
                    <span>派遣売上</span>
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
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>紹介手数料</th>
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>総売上</th>
                <th
                  className="py-2 px-3 text-right bg-slate-100 cursor-pointer hover:bg-slate-200 select-none"
                  rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}
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
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>請求＠</th>
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>支払＠</th>
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>名目粗利率</th>
                {/* ★2026-09-16追加(はまさんの指摘・「集計」シートヘッダー行との突合): 「交通費(税抜)」列。
                    はまさんが元Excelのセルを直接確認した結果、数式ではなく手入力の固定値であり、
                    このアプリが持つどのデータからも導出できない外部データと判明した(値が交通費
                    (自社負担)と一致する月としない月がある理由もこれで説明がつく)。データの出所が
                    判明するまでは、誤った値を計算して表示するよりも「不明」と明示する方が安全なため、
                    列自体は「集計」シートとの項目一致のため用意しつつ、値は表示しない。 */}
                <th
                  className="py-2 px-3 text-right"
                  rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}
                  title="元Excelでは手入力の固定値(このアプリのデータからは導出不可)。データの出所判明まで「不明」表示にしています"
                >
                  交通費(税抜) <span className="text-amber-500">ⓘ</span>
                </th>
                <th
                  className="py-2 px-3 text-right bg-slate-100 cursor-pointer hover:bg-slate-200 select-none"
                  rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}
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
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>有給金額</th>
                <th className="py-2 px-3 text-right bg-indigo-50/50" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>実質粗利益</th>
                <th className="py-2 px-3 text-right bg-indigo-50/50" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>実質粗利率</th>
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>有給(日)</th>
                <th className="py-2 px-3 text-right bg-slate-100" rowSpan={anyMonthlySummaryBreakdownOpen ? 2 : 1}>1人当たり有給日数</th>
              </tr>
              {/* 2段目: 展開中のグループの個別列名のみ(すべて閉じている場合、この行自体を描画しない) */}
              {anyMonthlySummaryBreakdownOpen && (
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
                          駐車場代が発生する月に内訳合計と社保他小計が一致しなかったため、4列目として
                          追加した。社保+交通費(自社負担)+駐車場代の3項目(雇保を除く)が社保他小計と
                          厳密に一致する(雇保は社保に既に含まれる参考値のため、合計には含めない)。 */}
                      <th className="py-2 px-3 text-right bg-violet-50/60 border-r border-violet-200">駐車場代</th>
                    </>
                  )}
                </tr>
              )}
              {/* 合計行 (★2026-09-20移動: 以前はtbody末尾にあったが、月次粗利明細一覧・スタッフ
                  給与明細と同じパターンに合わせ、theadの一部として画面上部に固定表示するようにした。
                  値の出所・計算式はmonthlyTotals(上記useMemo)のコメント参照。 */}
              <tr className="bg-indigo-50 text-indigo-900 font-extrabold border-b-2 border-indigo-200">
                <td className="py-2 px-3 bg-indigo-50">合計</td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">{monthlyTotals.staffCount}名</td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">¥{monthlyTotals.dispatchSales.toLocaleString()}</td>
                {showSalesBreakdown && (
                  <>
                    <td className="py-2 px-3 text-right font-mono bg-emerald-50/60 border-l border-emerald-200">
                      ¥{monthlyTotals.dispatch.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right font-mono bg-emerald-50/60">
                      ¥{monthlyTotals.transportBilling.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right font-mono bg-emerald-50/60 border-r border-emerald-200">
                      ¥{monthlyTotals.leaveCompensation.toLocaleString()}
                    </td>
                  </>
                )}
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">¥{monthlyTotals.referralSales.toLocaleString()}</td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">¥{monthlyTotals.totalSales.toLocaleString()}</td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">¥{monthlyTotals.totalSalary.toLocaleString()}</td>
                {showSalaryBreakdown && (
                  <>
                    <td className="py-2 px-3 text-right font-mono bg-amber-50/60 border-l border-amber-200">
                      ¥{monthlyTotals.salary.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right font-mono bg-amber-50/60">
                      ¥{monthlyTotals.leaveAllowance.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right font-mono bg-amber-50/60 border-r border-amber-200">
                      ¥{monthlyTotals.retirementAmount.toLocaleString()}
                    </td>
                  </>
                )}
                <td
                  className="py-2 px-3 text-right font-mono bg-indigo-50 text-slate-300"
                  title="請求＠は「1件あたり単価」の列のため、年間合計は意味を持ちません"
                >
                  -
                </td>
                <td
                  className="py-2 px-3 text-right font-mono bg-indigo-50 text-slate-300"
                  title="支払＠は「1件あたり単価」の列のため、年間合計は意味を持ちません"
                >
                  -
                </td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">
                  {monthlyTotals.nominalGrossMarginRateDataAvailable ? `${monthlyTotals.nominalGrossMarginRate}%` : 'データなし'}
                </td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-50 text-slate-400">不明</td>
                <td
                  className="py-2 px-3 text-right font-mono bg-indigo-50"
                  title="社保(雇用保険込み) + 交通費(自社負担) + 駐車場代"
                >
                  ¥{monthlyTotals.socialInsuranceOther.toLocaleString()}
                </td>
                {showSocialBreakdown && (
                  <>
                    <td className="py-2 px-3 text-right font-mono bg-violet-50/60 border-l border-violet-200">
                      ¥{monthlyTotals.employmentInsurance.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right font-mono bg-violet-50/60">
                      ¥{monthlyTotals.socialInsurance.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right font-mono bg-violet-50/60">
                      ¥{monthlyTotals.transportSalary.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right font-mono bg-violet-50/60 border-r border-violet-200">
                      ¥{monthlyTotals.parkingFee.toLocaleString()}
                    </td>
                  </>
                )}
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">¥{monthlyTotals.paidLeaveAmount.toLocaleString()}</td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-100">¥{monthlyTotals.grossProfit.toLocaleString()}</td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-100">{monthlyTotals.grossMarginRate}%</td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">{monthlyTotals.paidLeaveDays}日</td>
                <td className="py-2 px-3 text-right font-mono bg-indigo-50">{monthlyTotals.avgPaidLeaveDaysPerStaff}日</td>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {summary.monthlyTrends.map((m) => (
                <tr key={m.month} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2 px-3 font-semibold text-slate-600">{m.month}</td>
                  <td className="py-2 px-3 text-right font-mono">{m.staffCount}名</td>
                  <td className="py-2 px-3 text-right font-mono">¥{m.dispatchSales.toLocaleString()}</td>
                  {/* 売上内訳 (派遣売上の内訳。ヘッダーのグループ見出し参照) */}
                  {showSalesBreakdown && (
                    <>
                      <td className="py-2 px-3 text-right font-mono bg-emerald-50/30 border-l border-emerald-200">
                        ¥{m.dispatch.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right font-mono bg-emerald-50/30">¥{m.transportBilling.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-mono bg-emerald-50/30 border-r border-emerald-200">
                        ¥{m.leaveCompensation.toLocaleString()}
                      </td>
                    </>
                  )}
                  <td className="py-2 px-3 text-right font-mono">¥{m.referralSales.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold">¥{m.totalSales.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right font-mono">¥{m.totalSalary.toLocaleString()}</td>
                  {/* 給与内訳 (給与総額の内訳。ヘッダーのグループ見出し参照) */}
                  {showSalaryBreakdown && (
                    <>
                      <td className="py-2 px-3 text-right font-mono bg-amber-50/30 border-l border-amber-200">
                        ¥{m.salary.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right font-mono bg-amber-50/30">¥{m.leaveAllowance.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-mono bg-amber-50/30 border-r border-amber-200">
                        ¥{m.retirementAmount.toLocaleString()}
                      </td>
                    </>
                  )}
                  <td className="py-2 px-3 text-right font-mono">¥{m.billingUnitPriceSum.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right font-mono">¥{m.payUnitPriceSum.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right font-mono">
                    {m.nominalGrossMarginRateDataAvailable ? `${m.nominalGrossMarginRate}%` : 'データなし'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">不明</td>
                  <td className="py-2 px-3 text-right font-mono" title="社保(雇用保険込み) + 交通費(自社負担) + 駐車場代">
                    ¥{m.socialInsuranceOther.toLocaleString()}
                  </td>
                  {/* 社保他内訳 (社保他小計の内訳。ヘッダーのグループ見出し参照) */}
                  {showSocialBreakdown && (
                    <>
                      <td className="py-2 px-3 text-right font-mono bg-violet-50/30 border-l border-violet-200">
                        ¥{m.employmentInsurance.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right font-mono bg-violet-50/30">¥{m.socialInsurance.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-mono bg-violet-50/30">¥{m.transportSalary.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-mono bg-violet-50/30 border-r border-violet-200">
                        ¥{m.parkingFee.toLocaleString()}
                      </td>
                    </>
                  )}
                  <td className="py-2 px-3 text-right font-mono">¥{m.paidLeaveAmount.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right font-mono font-extrabold text-emerald-700 bg-indigo-50/30">
                    ¥{m.grossProfit.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 bg-indigo-50/30">
                    {m.grossMarginRate}%
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{m.paidLeaveDays}日</td>
                  <td className="py-2 px-3 text-right font-mono">{m.avgPaidLeaveDaysPerStaff}日</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. 月次推移 Recharts チャート
          ★2026-09-20修正(はまさんのご要望): 1.「直接原価」の棒グラフ系列を削除。2. 前年
          (前決算期)の同月データを、総売上高・実質粗利益それぞれ破線の参考系列として重ねた
          (前期データが1件も無い場合は誤解を招くため系列自体を表示しない)。3. 前年比較用の
          破線は、色を濃く・線を太くして視認性を上げた。
          ★2026-09-21修正(はまさんの指摘「粗利率の折れ線と同居してごちゃごちゃする」): 名目
          粗利率・実質粗利率の折れ線(今期・前年、計4本)を削除し、総売上高・実質粗利益の棒
          グラフ(と前年比較)だけのシンプルな構成に戻した。粗利率は専用グラフ(決算期月次
          粗利率推移)で確認する。
          ★重要(はまさんへの確認事項、前回回答分を再掲): 「粗利益」バーは「名目粗利益」ではなく
          「実質粗利益」に改称している。このアプリには「名目粗利率」(%)は存在するが「名目粗利益」
          (金額)に相当するフィールドは存在しない(以前、名目粗利額という列を独自に計算して
          追加したことがあったが、はまさんが実際のExcelを確認した結果「名目粗利率」のみが実在する
          項目で「名目粗利額」は存在しないとのご指摘を受けて削除した経緯があるため)。このグラフの
          「粗利益」バーの実体は実額ベースの粗利益(=月次サマリ表の「実質粗利益」列と同じ値)の
          ため、「名目粗利益」というラベルを付けると誤ったデータ表示になってしまうと判断し、
          「実質粗利益」のままにしている。 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <BarChart2 className="w-4 h-4 text-indigo-600" />
              <span>決算期月次売上・粗利益推移 ({summary.startMonth} 〜 {summary.endMonth})</span>
            </h3>
            <p className="text-xs text-slate-500">
              月別の総売上高(棒)・実質粗利益(棒)の推移
              {hasPreviousYearSalesData && '。太い破線は前年同月の値'}
              (粗利率は下の「決算期月次粗利率推移」でご確認ください)
            </p>
          </div>
        </div>

        {!hasPreviousYearSalesData && (
          <p className="text-[11px] text-slate-400 mb-2">
            前年(前決算期)分のデータが無いため、前年対比の破線は表示していません。
          </p>
        )}

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(val) => `¥${(val / 10000).toLocaleString()}万`} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value: any, name: any) => {
                  if (value === null || value === undefined) return ['データなし', name];
                  return [`¥${Number(value).toLocaleString()}`, name];
                }}
                contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
              <Bar dataKey="totalSales" name="総売上高" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="grossProfit" name="実質粗利益" fill="#10b981" radius={[4, 4, 0, 0]} />
              {hasPreviousYearSalesData && (
                <>
                  <Line
                    type="monotone"
                    dataKey="prevTotalSales"
                    name="総売上高(前年)"
                    stroke="#3730a3"
                    strokeWidth={2.5}
                    strokeDasharray="8 4"
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="prevGrossProfit"
                    name="実質粗利益(前年)"
                    stroke="#047857"
                    strokeWidth={2.5}
                    strokeDasharray="8 4"
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2.6 スタッフ人数 月次推移 (★2026-09-20新規追加、直近3決算期分の折れ線比較に変更
          (はまさんのご要望「棒グラフ+前年のみ点線比較は見づらいため、今期・前期・前々期を
          折れ線グラフで並べて表示してほしい」)。データが存在する期の分だけ線を描画する。
          ★2026-09-21修正(はまさんのご要望「Y軸調整・年間平均の追加」): Y軸の下限を実データの
          分布に合わせて引き上げ(computeAxisDomain参照)、各期の年間平均(月次の単純平均)を
          グラフ上部にバッジ表示した。 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Users className="w-4 h-4 text-indigo-600" />
              <span>決算期月次スタッフ人数推移 (直近3決算期比較、{summary.startMonth} 〜 {summary.endMonth} = 今期)</span>
            </h3>
            <p className="text-xs text-slate-500">
              月別の稼働スタッフ人数を、今期(実線)・前期(破線)・前々期(点線)の3決算期分並べて比較
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
            月平均(今期): {avgStaffCountThis}名
          </span>
          {hasPreviousYearStaffData && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
              月平均(前期): {avgStaffCountPrev}名
            </span>
          )}
          {hasPreviousPreviousYearStaffData && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              月平均(前々期): {avgStaffCountPrevPrev}名
            </span>
          )}
        </div>

        {!hasPreviousYearStaffData && !hasPreviousPreviousYearStaffData && (
          <p className="text-[11px] text-slate-400 mb-2">
            前期・前々期分のデータが無いため、今期のみ表示しています。
          </p>
        )}

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={threePeriodData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} domain={staffCountDomain} />
              <Tooltip
                formatter={(value: any, name: any) => [value === null || value === undefined ? 'データなし' : `${value}名`, name]}
                contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
              <Line
                type="monotone"
                dataKey="staffCount"
                name="スタッフ人数(今期)"
                stroke="#4f46e5"
                strokeWidth={2.5}
                dot={{ r: 4 }}
              />
              {hasPreviousYearStaffData && (
                <Line
                  type="monotone"
                  dataKey="prevStaffCount"
                  name="スタッフ人数(前期)"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  dot={{ r: 3 }}
                  connectNulls
                />
              )}
              {hasPreviousPreviousYearStaffData && (
                <Line
                  type="monotone"
                  dataKey="prevPrevStaffCount"
                  name="スタッフ人数(前々期)"
                  stroke="#10b981"
                  strokeWidth={1.75}
                  strokeDasharray="2 3"
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2.7 粗利率 月次推移 (★2026-09-20新規追加。はまさんのご要望「スタッフ人数グラフと同じ
          考え方で、名目粗利率・実質粗利率も直近3決算期分の単独の折れ線グラフを新設してほしい」。
          既存の月次推移グラフ(総売上高・粗利益の棒グラフ)とは別の独立したグラフとして追加した)。
          ★2026-09-21修正(はまさんのご要望「一般従業員向けの見える化の観点で、実質粗利率は
          月次の上下動ではなく年間平均の水平線に変更してほしい」): 実質粗利率は有給精算等の
          タイミングで月によって偏りが出やすく、月次の折れ線をそのまま見せると誤解を招くため、
          各決算期の年間平均(summary.overallGrossMarginRate、月次サマリ表・KPIカードと同じ
          既存の正しい計算値。A項で「実質粗利益合計÷総売上合計」が正しいと確認済みのものを
          再利用しており、新しい計算式は追加していない)を示す水平な参考線(ReferenceLine)に
          変更した。名目粗利率は従来通り月ごとの実際の値を折れ線で表示する。月ごとの正確な
          実質粗利率は月次サマリ表(数値)で確認できる。あわせてY軸の範囲も実データに合わせて
          調整した(computeAxisDomain参照)。 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <BarChart2 className="w-4 h-4 text-indigo-600" />
              <span>決算期月次粗利率推移 (直近3決算期比較、{summary.startMonth} 〜 {summary.endMonth} = 今期)</span>
            </h3>
            <p className="text-xs text-slate-500">
              名目粗利率は月別の実際の値(今期実線・前期破線・前々期点線)、実質粗利率は月によって
              偏りが出やすいため各決算期の年間平均を水平線で表示
            </p>
          </div>
        </div>

        {!hasPreviousYearMarginData && !hasPreviousPreviousYearMarginData && (
          <p className="text-[11px] text-slate-400 mb-2">
            前期・前々期分のデータが無いため、今期のみ表示しています。
          </p>
        )}

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={threePeriodData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis unit="%" domain={marginRateDomain} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value: any, name: any) => [value === null || value === undefined ? 'データなし' : `${value}%`, name]}
                contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
              <Line
                type="monotone"
                dataKey="nominalGrossMarginRate"
                name="名目粗利率(今期)"
                stroke="#0ea5e9"
                strokeWidth={2.5}
                dot={{ r: 4 }}
                connectNulls
              />
              {hasPreviousYearMarginData && (
                <Line
                  type="monotone"
                  dataKey="prevNominalGrossMarginRate"
                  name="名目粗利率(前期)"
                  stroke="#0369a1"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  dot={{ r: 3 }}
                  connectNulls
                />
              )}
              {hasPreviousPreviousYearMarginData && (
                <Line
                  type="monotone"
                  dataKey="prevPrevNominalGrossMarginRate"
                  name="名目粗利率(前々期)"
                  stroke="#38bdf8"
                  strokeWidth={1.75}
                  strokeDasharray="2 3"
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              )}
              <ReferenceLine
                y={summary.overallGrossMarginRate}
                stroke="#f59e0b"
                strokeWidth={2.5}
                label={{ value: `実質粗利率(今期)平均 ${summary.overallGrossMarginRate}%`, position: 'insideTopLeft', fontSize: 11, fill: '#b45309' }}
              />
              {hasPreviousYearMarginData && (
                <ReferenceLine
                  y={previousSummary.overallGrossMarginRate}
                  stroke="#d97706"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  label={{
                    value: `実質粗利率(前期)平均 ${previousSummary.overallGrossMarginRate}%`,
                    position: 'insideBottomLeft',
                    fontSize: 11,
                    fill: '#d97706',
                  }}
                />
              )}
              {hasPreviousPreviousYearMarginData && (
                <ReferenceLine
                  y={previousPreviousSummary.overallGrossMarginRate}
                  stroke="#fbbf24"
                  strokeWidth={1.75}
                  strokeDasharray="2 3"
                  label={{
                    value: `実質粗利率(前々期)平均 ${previousPreviousSummary.overallGrossMarginRate}%`,
                    position: 'insideTopRight',
                    fontSize: 11,
                    fill: '#b45309',
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2.5 有給残日数アラート (★2026-08-27追加・22章タスク2)
          ※自社負担コスト(雇用保険・社会保険・交通費)の月次推移グラフは、21-5・22-1で
          スコープ外と確定していたにも関わらず誤って実装されたため、22-7章の修正依頼により削除した。
          個々の月次明細(月次粗利明細一覧)では引き続き社保・交通費の数値を確認できる。 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <CalendarClock className="w-4 h-4 text-amber-500" />
            <span>有給残日数アラート</span>
          </h3>
          <label className="flex items-center space-x-2 text-xs text-slate-600">
            <span>閾値:</span>
            <input
              type="number"
              min={0}
              value={leaveBalanceThreshold}
              onChange={(e) => setLeaveBalanceThreshold(Number(e.target.value) || 0)}
              className="w-16 px-2 py-1 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span>日以上</span>
          </label>
        </div>
        <p className="text-[11px] text-slate-400 mb-3">
          給与CSVの「有給残日数」列(対象期間内で最も新しい対象月の値)が閾値以上のスタッフを表示します。年5日の有給取得義務を踏まえた労務管理目的の参考情報です。
        </p>
        {summary.staffPaidLeaveBalances.length === 0 ? (
          <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg py-3 px-4">
            給与CSVに「有給残日数」列のデータがありません。
          </p>
        ) : alertedLeaveBalances.length === 0 ? (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg py-3 px-4">
            閾値({leaveBalanceThreshold}日以上)に該当するスタッフはいません。
          </p>
        ) : (
          <div className="overflow-x-auto table-scroll">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-amber-50 text-amber-800 border-b border-amber-200 font-bold">
                  <th className="py-2 px-3">スタッフ</th>
                  <th className="py-2 px-3">最新対象月</th>
                  <th className="py-2 px-3 text-right">有給残日数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {alertedLeaveBalances.map((s) => (
                  <tr key={s.staffNo} className="hover:bg-amber-50/40">
                    <td className="py-2 px-3 font-semibold text-slate-800">
                      {s.staffName} <span className="text-slate-400 font-mono text-[10px]">{s.staffNo}</span>
                    </td>
                    <td className="py-2 px-3 text-slate-500">{s.targetMonth}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-amber-700">
                      {s.paidLeaveRemainingDays}日
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. 得意先別 名目粗利率ランキング・トレンド (★2026-08-27拡張・22章タスク3) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Building className="w-4 h-4 text-indigo-600" />
            <span>得意先別 名目粗利率ランキング</span>
          </h3>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
            <button
              onClick={() => setRankingMode('best')}
              className={`inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-bold transition-colors ${
                rankingMode === 'best' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>ベスト{CLIENT_RANKING_LIMIT}</span>
            </button>
            <button
              onClick={() => setRankingMode('worst')}
              className={`inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-bold border-l border-slate-300 transition-colors ${
                rankingMode === 'worst' ? 'bg-rose-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              <span>ワースト{CLIENT_RANKING_LIMIT}</span>
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mb-3">
          ランキング・トレンドは名目粗利率(契約単価の単純合計ベース。1 − 支払＠/請求＠)を基準にしています。
          実質粗利率は休業手当・有給取得等の影響で個々のクライアント単位ではブレが大きいため、この機能では表示しません。
          {clientsWithoutNominalData > 0 &&
            ` (請求書印刷CSV未読込等により名目粗利率を算出できないクライアントが${clientsWithoutNominalData}件、ランキング対象外です)`}
        </p>

        {rankedClients.length === 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-3 px-4">
            名目粗利率を算出できるクライアントがありません(請求書印刷CSVを読み込んでください)。
          </p>
        ) : (
          <div className="overflow-x-auto table-scroll">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold">
                  <th className="py-2 px-3 w-12 text-center">順位</th>
                  <th className="py-2 px-3">派遣先企業</th>
                  <th className="py-2 px-3 text-right">派遣売上 (税抜)</th>
                  <th className="py-2 px-3 text-right">粗利益 (税抜)</th>
                  <th className="py-2 px-3 text-center">名目粗利率</th>
                  <th className="py-2 px-3 text-right">延べ件数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {rankedClients.map((client, idx) => {
                  const expanded = expandedClientCode === client.clientCode;
                  const medal =
                    rankingMode === 'best'
                      ? idx === 0
                        ? '🥇 1'
                        : idx === 1
                        ? '🥈 2'
                        : idx === 2
                        ? '🥉 3'
                        : idx + 1
                      : idx + 1;
                  return (
                    <React.Fragment key={client.clientCode}>
                      <tr
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => setExpandedClientCode(expanded ? null : client.clientCode)}
                      >
                        <td className="py-2 px-3 text-center font-bold text-slate-500">{medal}</td>
                        <td className="py-2 px-3 font-bold text-slate-800 flex items-center space-x-1">
                          <span>{client.clientName}</span>
                          {expanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-700">
                          ¥{client.totalSales.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-extrabold text-emerald-700">
                          ¥{client.totalGrossProfit.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                              rankingMode === 'best' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {client.nominalGrossMarginRate}%
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-500">{client.staffCount}件</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50/60 px-4 py-4">
                            <p className="text-[11px] text-slate-500 mb-2">
                              {client.clientName} の名目粗利率 月次推移 ({summary.startMonth} 〜 {summary.endMonth})
                            </p>
                            <div className="h-48 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                  data={client.monthlyNominalMarginTrend}
                                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                                  <YAxis unit="%" tick={{ fontSize: 10 }} />
                                  <Tooltip
                                    formatter={(value: any, _name: any, item: any) =>
                                      item?.payload?.dataAvailable ? [`${value}%`, '名目粗利率'] : ['データなし', '名目粗利率']
                                    }
                                    contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="nominalGrossMarginRate"
                                    name="名目粗利率"
                                    stroke="#6366f1"
                                    strokeWidth={2}
                                    dot={{ r: 3 }}
                                    connectNulls
                                  />
                                </LineChart>
                              </ResponsiveContainer>
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
    </div>
  );
};
