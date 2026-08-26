/**
 * Excel(Power Query) 粗利・経理管理ブック現行実装仕様書 (v1.1)
 * Mコード(Power Query) と TypeScript 変換リファレンス
 */

import { MCodeMapping } from '../types';

export const POWER_QUERY_M_MAPPINGS: MCodeMapping[] = [
  {
    stepName: '1. ソースCSVの読み込みとヘッダープロモート (Csv.Document & PromoteHeaders)',
    mCodeSnippet: `Source = Csv.Document(File.Contents("C:\\Dispatch\\Salary.csv"), [Delimiter=",", Encoding=932]),
# "Promoted Headers" = Table.PromoteHeaders(Source, [PromoteAllScalars=true])`,
    typescriptEquivalent: `// PapaParseによるブラウザ直接ストリーミング解析
const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
// 自動でオブジェクト配列化 & 日本語列名のゆらぎ吸収
const targetMonth = normalizeMonth(row['対象年月']);`,
    explanation: 'Power Queryのファイル絶対パス参照およびSJIS(Encoding=932)依存を、ブラウザ完結のPapaParseおよび列名正規化エンジンに置換し、OS非依存化を図っています。',
  },
  {
    stepName: '2. ネスト結合 (Table.NestedJoin - 給与と請求の結合)',
    mCodeSnippet: `#"Merged Queries" = Table.NestedJoin(
    BillingTable, {"対象年月", "スタッフNo"},
    PayrollTable, {"対象年月", "スタッフNo"},
    "PayrollData", JoinKind.LeftOuter
)`,
    typescriptEquivalent: `// Mapオブジェクトを用いた高速キー検索 O(N+M)
const payrollMap = new Map<string, PayrollRow>();
payrolls.forEach(p => payrollMap.set(\`\${p.targetMonth}_\${p.staffNo}\`, p));

billings.forEach(billing => {
  const payroll = payrollMap.get(\`\${billing.targetMonth}_\${billing.staffNo}\`);
  ...
});`,
    explanation: 'Power QueryのLeftOuter結合をTypeScriptのMapデータ構造で完全再編。大容量データ（1万件超）でもミリ秒単位で突合処理が完了します。',
  },
  {
    stepName: '3. 仕様書 v1.1 粗利益（税抜）計算カスタム列追加 (Table.AddColumn)',
    mCodeSnippet: `#"Added GrossProfit" = Table.AddColumn(#"Expanded", "GrossProfit", each 
    [請求金額] - [給与支給総額] - [社保会社負担額] - [雇用保険会社負担額] - [駐車場代] - [退職金配賦額]
)`,
    typescriptEquivalent: `const grossProfitExTax =
  billingAmountExTax -
  paymentAmount -
  socialInsurance -
  employmentInsurance -
  parkingFee -
  retirementAmount;`,
    explanation: '仕様書 v1.1 に定義された原価減算式をそのまま適用。紹介手数料は個別の派遣粗利計算からは非算入（減算しない）とする原則を厳密に順守します。',
  },
  {
    stepName: '4. 交通費月次金額一致検証 (Transport Match Verification)',
    mCodeSnippet: `#"Added TransportDiff" = Table.AddColumn(#"PriorStep", "TransportDiff", each 
    [給与交通費] - [請求交通費]
),
#"Added AlertFlag" = Table.AddColumn(#"PriorStep2", "AlertFlag", each 
    if [TransportDiff] <> 0 then "要確認" else "正常"
)`,
    typescriptEquivalent: `const transportDiff = salaryTransport - billing.billingTransport;
if (transportDiff !== 0) {
  alerts.push({
    type: 'TRANSPORT_MISMATCH',
    severity: 'warning',
    message: transportDiff > 0 ? '請求漏れ疑い' : '過剰請求疑い'
  });
}`,
    explanation: '給与で支給した実費交通費と、派遣先に請求した交通費の差額を毎月自動検知。請求漏れ（利益圧迫）や過剰請求リスクを防ぎます。',
  },
  {
    stepName: '5. 紹介手数料の総売上算入処理 (Referral Fee Accounting)',
    mCodeSnippet: `#"Added TotalRevenue" = Table.AddColumn(#"PriorStep", "TotalRevenue", each 
    [請求金額] + [紹介手数料]
)`,
    typescriptEquivalent: `const totalRevenueExTax = totalSalesExTax + totalReferralFee;
// 個別粗利益には非算入だが、決算期・全社サマリーの総売上高には加算`,
    explanation: '人材紹介等の紹介手数料は、労働原価が発生しないため個別の派遣粗利率を歪めないよう粗利非算入とし、全社決算期の総売上高に合算します。',
  },
];
