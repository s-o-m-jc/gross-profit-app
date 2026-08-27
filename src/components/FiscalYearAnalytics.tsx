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
  AlertTriangle,
  Award,
  BarChart2,
  FileCheck,
  ChevronDown,
  ChevronUp,
  UserMinus,
  CalendarClock,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { FiscalYearSummary } from '../types';

interface FiscalYearAnalyticsProps {
  summary: FiscalYearSummary;
}

const DEFAULT_LEAVE_BALANCE_THRESHOLD = 10;
const CLIENT_RANKING_LIMIT = 10;

export const FiscalYearAnalytics: React.FC<FiscalYearAnalyticsProps> = ({ summary }) => {
  // 22章タスク3: 得意先別ランキングのベスト/ワースト切替、行クリックでの月次トレンド展開
  const [rankingMode, setRankingMode] = useState<'best' | 'worst'>('best');
  const [expandedClientCode, setExpandedClientCode] = useState<string | null>(null);
  // 22章タスク2: 有給残日数アラートの閾値(年5日の有給取得義務を踏まえ、仮に10日をデフォルトとする)
  const [leaveBalanceThreshold, setLeaveBalanceThreshold] = useState<number>(DEFAULT_LEAVE_BALANCE_THRESHOLD);

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

  return (
    <div className="space-y-6 mb-8">
      {/* 1. エグゼクティブKPIサマリーカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-3">
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

        {/* 総原価 */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <span className="text-[11px] text-slate-500 font-semibold block mb-1">
            総直接原価
          </span>
          <div className="text-base font-bold font-mono text-slate-900">
            ¥{summary.totalCostExTax.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            給与: ¥{summary.totalSalary.toLocaleString()} <br />
            社保: ¥{summary.totalSocialInsurance.toLocaleString()}
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

        {/* 監査要確認件数 */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
          <span className="text-[11px] text-slate-500 font-semibold block mb-1">
            要確認アラート数
          </span>
          <div className={`text-base font-bold font-mono flex items-center space-x-1 ${
            summary.alertCount > 0 ? 'text-amber-600' : 'text-emerald-600'
          }`}>
            <AlertTriangle className="w-4 h-4" />
            <span>{summary.alertCount}件</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1">不整合・交通費差額</div>
        </div>
      </div>

      {/* 1.5 名目指標 (請求＠・支払＠・名目粗利率) - 大阪人材の集計シートと同一定義の参考指標。
          契約・給与行ごとの単価を単純合計(SUM)しているだけで、稼働時間・契約規模による重み付けは
          行っていない「名目」値。実額ベースで正確な「全体粗利率」(上のKPIカード)とは別の指標。 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
        <div className="flex items-center space-x-2 mb-3">
          <Award className="w-4 h-4 text-amber-500" />
          <div>
            <h3 className="text-sm font-bold text-slate-800">名目指標 (大阪人材集計シート方式)</h3>
            <p className="text-[11px] text-slate-400">
              契約・給与行ごとの単価を単純合計した参考値。稼働時間・契約規模による重み付けはしていません
              (実額ベースの正確な粗利率は上の「全体粗利率」を参照してください)。
            </p>
          </div>
        </div>

        {!summary.billingUnitPriceDataAvailable && !summary.payUnitPriceDataAvailable ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg py-3 px-4 leading-relaxed">
            請求書印刷CSV(時間内−単価列)・給与CSV(時間内時間列)がいずれも未読込のため、名目指標は算出できません。
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <span className="text-[11px] text-slate-500 font-semibold block mb-1">請求＠ (契約単価合計)</span>
              {summary.billingUnitPriceDataAvailable ? (
                <div className="text-base font-bold font-mono text-slate-900">
                  ¥{Math.round(summary.totalBillingUnitPrice).toLocaleString()}
                </div>
              ) : (
                <div className="text-xs text-slate-400">データなし (請求書印刷CSV未読込)</div>
              )}
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <span className="text-[11px] text-slate-500 font-semibold block mb-1">支払＠ (支払単価合計)</span>
              {summary.payUnitPriceDataAvailable ? (
                <div className="text-base font-bold font-mono text-slate-900">
                  ¥{Math.round(summary.totalPayUnitPrice).toLocaleString()}
                  <span className="text-[10px] text-slate-400 font-sans font-normal ml-1">(円未満四捨五入)</span>
                </div>
              ) : (
                <div className="text-xs text-slate-400">データなし (給与CSVに時間内時間列なし)</div>
              )}
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <span className="text-[11px] text-slate-500 font-semibold block mb-1">名目粗利率</span>
              {summary.billingUnitPriceDataAvailable && summary.payUnitPriceDataAvailable ? (
                <div className="text-base font-bold font-mono text-indigo-700">
                  {summary.nominalGrossMarginRate}%
                </div>
              ) : (
                <div className="text-xs text-slate-400">算出不可</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. 月次推移 Recharts チャート */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <BarChart2 className="w-4 h-4 text-indigo-600" />
              <span>決算期月次売上・原価・粗利益推移 ({summary.startMonth} 〜 {summary.endMonth})</span>
            </h3>
            <p className="text-xs text-slate-500">
              月別の売上高(棒)、原価(棒)、粗利益(棒)、および粗利率(折れ線)の推移
            </p>
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={summary.monthlyTrends} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                tickFormatter={(val) => `¥${(val / 10000).toLocaleString()}万`}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                unit="%"
                domain={[0, 40]}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value: any, name: any) => {
                  if (name === '粗利率') return [`${value}%`, name];
                  return [`¥${Number(value).toLocaleString()}`, name];
                }}
                contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
              <Bar yAxisId="left" dataKey="totalSales" name="総売上高" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="cost" name="直接原価" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="grossProfit" name="粗利益" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="grossMarginRate"
                name="粗利率"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={{ r: 4 }}
              />
            </ComposedChart>
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
