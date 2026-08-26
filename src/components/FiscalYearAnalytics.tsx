/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * 決算期 (年間) 集計 & ダッシュボードコンポーネント
 */

import React from 'react';
import {
  DollarSign,
  TrendingUp,
  Users,
  Building,
  Briefcase,
  AlertTriangle,
  Award,
  PieChart as PieIcon,
  BarChart2,
  FileCheck,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
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

export const FiscalYearAnalytics: React.FC<FiscalYearAnalyticsProps> = ({ summary }) => {
  return (
    <div className="space-y-6 mb-8">
      {/* 1. エグゼクティブKPIサマリーカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
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
            {summary.totalPaidLeaveDays}日 (1人当たり{summary.avgPaidLeaveDaysPerStaff}日)
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

      {/* 3. 得意先別実績ランキング */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center space-x-2">
          <Building className="w-4 h-4 text-indigo-600" />
          <span>得意先別 粗利益貢献度順位</span>
        </h3>

        <div className="overflow-x-auto table-scroll">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200 font-bold">
                <th className="py-2 px-3 w-12 text-center">順位</th>
                <th className="py-2 px-3">派遣先企業</th>
                <th className="py-2 px-3 text-right">派遣売上 (税抜)</th>
                <th className="py-2 px-3 text-right">粗利益 (税抜)</th>
                <th className="py-2 px-3 text-center">平均粗利率</th>
                <th className="py-2 px-3 text-right">延べ件数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {summary.clientRankings.map((client, idx) => (
                <tr key={client.clientCode} className="hover:bg-slate-50">
                  <td className="py-2 px-3 text-center font-bold text-slate-500">
                    {idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : idx + 1}
                  </td>
                  <td className="py-2 px-3 font-bold text-slate-800">{client.clientName}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700">
                    ¥{client.totalSales.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-extrabold text-emerald-700">
                    ¥{client.totalGrossProfit.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800">
                      {client.grossMarginRate}%
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-500">
                    {client.staffCount}件
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
