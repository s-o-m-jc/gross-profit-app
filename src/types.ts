/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * データ型定義ファイル
 */

// 給与CSVレコード (未払計上表 / 給与計算書印刷CSV)
export interface PayrollRow {
  targetMonth: string;         // 対象年月 (例: '2026-04')。実データでは列がなく、支給日の前月(末締翌月15日払い)から算出
  staffNo: string;             // スタッフNo (例: 'S1001')
  staffName: string;           // スタッフ氏名
  paymentAmount: number;       // 給与支給総額 (基本給・残業・各種手当。有給手当込み)
  socialInsurance: number;     // 社保会社負担額 (健康保険+介護保険+厚生年金+雇用保険の合計相当)
  employmentInsurance: number; // 雇用保険会社負担額 (参考値。粗利計算では社保負担額に含まれる想定で二重控除しない)
  parkingFee: number;          // 駐車場代 (自社負担分)
  salaryTransport: number;     // 給与側交通費支給額 (交通費1+交通費2の暫定合算・要最終確認)
  paidLeaveAllowance: number;  // 有給手当 (総支給額に内包済み。参考表示・検算用)
  paidLeaveDays: number;       // 有給日数
  // 支払＠(支払単価)算出用。運用者確認・実データ検算済み: 賃金台帳CSVは給与計算CSVと
  // 列構成が完全に同一のため、このCSVから直接取得できる(新規CSV取り込み不要)。
  regularAmount: number;       // 基本給 (実列名は「基本」(過去実績Excel取込)または「時間内」(通常の月次CSV)。ファイル形式により異なる。2026-09-02確認)
  regularHours: number;        // 時間内時間 - 通常時間帯の稼働時間(10進数に変換済み。"164:30"→164.5)
  payDate?: string;            // 支給日 (対象年月算出のソース)
  remarks?: string;            // 備考

  // ★2026-08-27追加(22章タスク1「スタッフ給与明細」ビュー向け)。
  // 給与計算CSV(未払計上表、全76列。2-1章参照)のうち、粗利計算には使わないが
  // 実際の給与支払い確認に必要な内訳項目。実データにない項目は作らない方針(22-2章)のため、
  // いずれも実CSVの列(2-1章の列名一覧)に1:1対応する(複数の枝番列は合算して1項目にまとめた
  // ものがあり、その場合はコメントで明記している)。すべて未読込データとの後方互換のため
  // オプショナルにしている(未指定時は0/未設定として扱う)。

  // --- 属性・区分 ---
  staffNameKana?: string;          // スタッフ氏名カナ
  staffCategory?: string;          // スタッフ区分 (稼働中/退職等。離職率算出に使用)

  // --- 勤怠(日数) ---
  workDays?: number;               // 出勤日数
  absenceDays?: number;            // 欠勤日数
  holidayWorkDays?: number;        // 休出日数
  lateEarlyDays?: number;          // 遅早日数
  specialLeaveDays?: number;       // 特別休暇日数
  otherLeaveDays?: number;         // 休暇２日数・休暇３日数・休暇４日数の合計 (いずれも稀にしか使われない休暇区分のため合算)
  paidLeaveRemainingDays?: number; // 有給残日数 (有給残日数アラートに使用)

  // --- 勤怠(時間) ---
  overtimeHours?: number;          // 時間外時間
  nightHours?: number;             // 深夜内時間
  nightOvertimeHours?: number;     // 深夜外時間
  holidayWorkHours?: number;       // 休日出時間
  otherOvertimeHours?: number;     // その他時間外(時間)
  paidLeaveHours?: number;         // 有給時間
  lateEarlyHours?: number;         // 遅早(時間)
  paidLeaveRemainingHours?: number;// 有給残時間

  // --- 給与(課税・手当金額) ---
  overtimeAmount?: number;         // 時間外(金額)
  nightAmount?: number;            // 深夜内(金額)
  nightOvertimeAmount?: number;    // 深夜外(金額)
  holidayWorkAmount?: number;      // 休日出(金額)
  otherOvertimeAllowance?: number; // その他時間外手当
  leaveAllowance?: number;         // 休暇手当
  absenceLeaveAllowance?: number;  // 欠勤休業手当 (CSV由来の参考値。手入力の「休業手当」(LeaveAllowanceRow)とは別物)
  specialLeaveAllowance?: number;  // 特休手当
  trainingAllowance?: number;      // 研修手当
  welfareAllowance?: number;       // 福祉手当
  paidLeaveAllowance2?: number;    // 有休手当 (「有給手当」列とは別に存在する実列)
  taxableOtherAllowances?: number; // 課税他８・課税他９・課税他１０の合計

  // --- 給与(非課税) ---
  transportTaxable?: number;         // 交通費課税
  commsAllowance?: number;           // 通信費
  nonTaxableOtherAllowances?: number;// 非課税他３・非課税他４の合計
  reimbursement?: number;            // 立替金 (粗利計算には影響しない。15章参照)

  // --- 控除 ---
  lateEarlyDeduction?: number;       // 遅早控除
  absenceDeduction?: number;         // 欠勤控除
  leaveDeduction?: number;           // 休暇控除
  employmentInsuranceBase?: number;  // 雇用保険対象額
  healthInsurance?: number;          // 健康保険
  nursingInsurance?: number;         // 介護保険
  pensionInsurance?: number;         // 厚生年金
  pensionFund?: number;              // 厚生年金基金
  taxableIncomeBase?: number;        // 課税対象額
  incomeTax?: number;                // 所得税
  yearEndAdjustment?: number;        // 年調過不足額
  residentTax?: number;              // 住民税
  lunchFee?: number;                 // 昼食代
  healthCheckFee?: number;           // 健康診断料
  cleaningFee?: number;              // クリーニング代
  advancePaymentSettlement?: number; // 仮払精算
  totalDeduction?: number;           // 総控除額

  // --- 支給額 ---
  netPayment?: number;               // 差引支給額
}

// 請求CSVレコード (請求支払一覧表印刷CSV)
export interface BillingRow {
  billingNo: string;           // 請求No (例: 'B202604-001')
  targetMonth: string;         // 対象年月。実データでは列がなく、ファイル名から抽出
  staffNo: string;             // スタッフNo
  staffName: string;           // スタッフ氏名
  clientCode: string;          // 派遣先(クライアント)企業コード
  clientName: string;          // 派遣先(クライアント)企業名
  orderNo: string;             // 受注番号 (契約単位。20日締では同一契約が複数行に分かれることがある)
  orderName: string;           // 受注名称
  billingAmountExTax: number;  // 請求額 (税抜)
  billingAmountIncTax?: number;// 請求金額 (税込)
  paymentAmount: number;       // 支払額 (このCSV自体が契約単位で正しく配分済みの値を持つ。給与CSVとの突合は不要)
  socialInsuranceBilling: number; // 社保負担額 (このCSV由来。事業主負担分の労災保険等を含む可能性あり)
  paidLeaveDaysUsed: number;   // 有給使用日数 (契約単位)
  billingTransport: number;    // 請求側交通費 (請求書印刷CSV等の別ソースでのみ入る想定。0のことが多い)
  referralFee: number;         // 紹介手数料 (粗利非算入・売上算入)
  workHours: number;           // 請求稼働時間 (このCSVには存在しないことが多く0になりうる)
  unitPrice: number;           // 契約時間単価 (同上、0になりうる)
}

// 請求書印刷CSVレコード
export interface InvoicePrintRow {
  billingNo: string;           // 請求No (請求番号)
  // 対象年月。請求支払一覧CSVと同じく、このCSV自体には列が無くファイル名に由来する
  // (例: 請求書印刷202410_15日締.csv。11-2章のルールを踏襲。★2026-08-21追加:
  // 複数月データ蓄積アーキテクチャで月バケツに分けるために必要になった)。
  targetMonth: string;
  invoiceIssueDate: string;    // 発行日
  paymentDueDate: string;      // 振込予定日
  printStatus: '印刷済' | '未印刷' | '再発行'; // 印刷ステータス
  sentStatus: '送付済' | '未送付';            // 送付ステータス
  // 契約(受注)単位の請求単価(「時間内−単価」列)。大阪人材の集計シート「請求＠」算出に使用する
  // (要件整理ドキュメント参照。実データで確認済み: 請求支払一覧CSVには単価列が無く、
  // このCSV側にのみ「時間内−単価」等の単価列が存在する)。
  unitPrice: number;
}

// 退職金データレコード (★2026-08-26: CSV取込から手入力フォームに変更。休業分補償等と同じく
// 1件ずつ追加/削除する手入力方式のため、一覧表示・削除操作用にidを持つ)
export interface RetirementRow {
  id: string;                  // ユニーク識別子 (手入力行の一覧表示・削除用)
  targetMonth: string;         // 対象年月
  staffNo: string;             // スタッフNo
  retirementAmount: number;    // 退職金配賦額 (毎月分)
  memo?: string;
}

// 休業分補償データレコード (手入力・売上側。派遣先都合等による休業期間の売上補償を派遣売上に加算する)
export interface LeaveCompensationRow {
  id: string;                  // ユニーク識別子 (手入力行の一覧表示・削除用)
  targetMonth: string;         // 対象年月
  clientCode: string;          // 派遣先(クライアント)企業コード。既存の請求データと同じ会社を選んだ場合はそのコード、
                                // 未知のクライアント名を入力した場合は名称から生成した擬似コードを入れる
  clientName: string;          // 派遣先(クライアント)企業名
  staffNo: string;             // スタッフNo
  amount: number;               // 休業分補償額 (対象月・クライアントの派遣売上に加算)
  memo?: string;                 // 備考
}

// 休業手当データレコード (手入力・原価側。給与総額(原価)に加算する。
// 給与計算CSV(未払計上表)由来の「欠勤休業手当」列とは別物であり、自動転記は行わない)
export interface LeaveAllowanceRow {
  id: string;                  // ユニーク識別子
  targetMonth: string;         // 対象年月
  staffNo: string;             // スタッフNo
  amount: number;               // 休業手当額 (対象月の給与総額(原価)に加算)
  memo?: string;                 // 備考
}

// ★2026-09-02追加(スタッフ給与明細バグ報告)。有給(手入力)データレコード。
// 給与CSV由来の有給日数・有給手当が、前月分の集計漏れ等の理由で実態とズレている場合に、
// スタッフ給与明細の詳細画面から1件ずつ追加できる手動補正。CSVの値を書き換えるのではなく、
// 「追加分」としてCSV由来の値に加算する(取込データの再現性・追跡可能性を保つため)。
// マイナス値を入れれば減算(取り過ぎの補正)にも使える。
export interface PaidLeaveOverrideRow {
  id: string;                  // ユニーク識別子 (手入力行の一覧表示・削除用)
  targetMonth: string;         // 対象年月
  staffNo: string;             // スタッフNo
  staffName?: string;          // スタッフ氏名 (入力時点の表示用参考情報)
  days?: number;                // 追加する有給日数 (マイナス可)
  amount?: number;               // 追加する有給金額 (円。マイナス可)
  memo?: string;                 // 備考 (例: 「前月10月分の集計漏れ」)
}

// 次月調整データレコード (手入力・汎用の符号付き調整項目。区分に応じて売上側/原価側どちらかに加算する)
export interface NextMonthAdjustmentRow {
  id: string;                  // ユニーク識別子
  targetMonth: string;         // 対象年月
  staffNo: string;             // スタッフNo
  side: 'SALES' | 'COST';      // 区分: SALES=売上側(派遣売上に加算) / COST=原価側(給与総額に加算)
  amount: number;                // 調整額 (符号付き。マイナス値を入力するとその分減算される)
  memo?: string;                 // 備考
}

// 粗利計算結果レコード (1請求/1スタッフ行単位)
export interface GrossProfitResult {
  id: string;                  // ユニーク識別子
  targetMonth: string;         // 対象年月
  billingNo: string;           // 請求No
  staffNo: string;             // スタッフNo
  staffName: string;           // スタッフ氏名
  clientCode: string;          // 派遣先コード
  clientName: string;          // 派遣先名

  // 請求項目
  billingAmountExTax: number;  // 請求金額(税抜)
  billingAmountIncTax: number; // 請求金額(税込)
  billingTransport: number;    // 請求交通費
  referralFee: number;         // 紹介手数料 (粗利非算入だが総売上に算入)

  // 原価項目
  paymentAmount: number;       // 給料支給額
  socialInsurance: number;     // 社保会社負担額
  employmentInsurance: number; // 雇用保険会社負担額
  parkingFee: number;          // 駐車場料金
  retirementAmount: number;    // 退職金配賦額
  salaryTransport: number;     // 給与交通費支給額

  // 原価小計 (社保+駐車場+退職金+給与)
  totalCostExTax: number;

  // 有給 (給与CSV由来の参考値。粗利計算には影響しない)
  paidLeaveAllowance: number;  // 有給手当
  paidLeaveDays: number;       // 有給日数

  // 20日締重複統合の記録
  mergedRowCount: number;      // 統合された請求行数 (1なら統合なし)
  mergedOrderNos: string[];    // 統合元の受注番号一覧

  // 粗利益計算項目
  // 粗利益（税抜）＝ 請求額(税抜) − 支払額(請求CSV由来) − 社保負担額(請求CSV由来) − 駐車場料金 − 退職金
  grossProfitExTax: number;
  grossProfitIncTax: number;   // 税込想定粗利
  grossProfitRate: number;     // 粗利率 (%) = 粗利益 / 請求額(税抜) * 100

  // 交通費一致検証 (月次金額一致検証)
  transportDiff: number;       // 給与交通費 - 請求交通費
  transportStatus: 'MATCH' | 'UNDER_BILLED' | 'OVER_BILLED'; // 一致 / 請求漏れ / 過剰請求
  // 請求支払一覧CSVには交通費列が無く、常に0になる場合がある(6章参照)。
  // データセット全体で請求側交通費が1件も入っていない場合はfalseとし、突合結果を「参考外」として扱う。
  transportDataAvailable: boolean;

  // 監査アラートフラグ
  alerts: AuditAlert[];

  // 印刷データ紐付け状態
  invoicePrintStatus?: 'MATCHED' | 'NOT_PRINTED' | 'MISSING_INVOICE';
  paymentDueDate?: string;

  // 請求書印刷CSV由来の契約単価(「時間内−単価」)。請求書印刷CSV未読込 or 未紐付けの場合は0。
  // 決算期集計の「請求＠」(totalBillingUnitPrice)の元データ。
  billingUnitPrice: number;

  // 給与CSV由来の支払単価(支払＠) = 時間内(金額) ÷ 時間内時間。時間内時間が0または
  // 給与データ未紐付けの場合は0(この場合SUM集計上は寄与しないので実質除外扱いになる)。
  // 同一スタッフが同月に複数契約(複数GrossProfitResult行)を持つ場合、この値は各行に
  // 同額がそのまま入る(請求＠と異なり、支払単価は契約ではなくスタッフに紐づく値のため。
  // 大阪人材の集計シートも同様の単純合算方式で、按分は行っていない)。
  payUnitPrice: number;

  // 休業分補償・休業手当・次月調整(15章)の手入力行を、通常の請求行と区別するためのタグ。
  // これらは請求CSV由来の行ではなく、対象月・クライアント(または対象月のみ)単位で
  // 派遣売上または給与総額(原価)にそのまま加算するための合成行として1行ずつ追加される。
  // 通常の請求/未紐付け給与行にはundefined。
  manualEntryType?:
    | 'LEAVE_COMPENSATION'            // 休業分補償 (売上側)
    | 'LEAVE_ALLOWANCE'                // 休業手当 (原価側)
    | 'NEXT_MONTH_ADJUSTMENT_SALES'    // 次月調整・売上側
    | 'NEXT_MONTH_ADJUSTMENT_COST';    // 次月調整・原価側
  manualEntryMemo?: string;    // 手入力行の備考 (入力時に任意入力した内容)
}

// アラート型
export interface AuditAlert {
  type:
    | 'TRANSPORT_MISMATCH'
    | 'LOW_MARGIN'
    | 'UNMATCHED_PAYROLL'
    | 'UNMATCHED_BILLING'
    | 'RETIREMENT_MISSING'
    | 'DUPLICATE_MERGED'
    | 'SOCIAL_INSURANCE_MISMATCH'
    | 'MULTI_CONTRACT_SAME_MONTH';
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// 決算期別集計サマリー
export interface FiscalYearSummary {
  fiscalYear: number;          // 決算期 (例: 2026年度)
  startMonth: string;          // 開始年月 ('2026-04')
  endMonth: string;            // 終了年月 ('2027-03')
  
  totalSalesExTax: number;     // 派遣売上高 (税抜)
  totalReferralFee: number;    // 紹介手数料合計
  totalRevenueExTax: number;   // 総売上高 (派遣売上 + 紹介手数料)
  
  totalSalary: number;         // 給与総額
  totalSocialInsurance: number;// 社保会社負担合計
  totalEmploymentInsurance: number; // 雇用保険合計
  totalParkingFee: number;     // 駐車場代合計
  totalRetirement: number;     // 退職金合計
  totalCostExTax: number;      // 総原価 (非算入除く)

  // 15章: 手入力調整項目の合計 (いずれもtotalSalesExTax/totalSalary/totalGrossProfitに
  // 既に算入済みの内訳であり、監査・検算用の参考表示として別出しする)
  totalLeaveCompensation: number;        // 休業分補償合計 (売上側・派遣売上に加算済み)
  totalLeaveAllowance: number;           // 休業手当合計 (原価側・給与総額に加算済み。CSV由来の「欠勤休業手当」とは別物)
  totalNextMonthAdjustmentSales: number; // 次月調整合計・売上側 (符号付き)
  totalNextMonthAdjustmentCost: number;  // 次月調整合計・原価側 (符号付き)

  totalGrossProfit: number;    // 総粗利益 (税抜)
  // ★2026-08-26追加: 消費税率設定(ヘッダーの「消費税率」)を反映した税込ベースの集計値。
  // 課税対象は売上側(請求額)のみで、給与・社保・駐車場代・退職金等の原価項目は不課税のため
  // 税率を掛けない(GrossProfitResult.grossProfitIncTaxの計算方針と同じ。詳細はcalculator.ts参照)。
  totalGrossProfitIncTax: number; // 総粗利益 (税込)
  totalRevenueIncTax: number;     // 派遣売上高 (税込。請求額の税込換算のみ。紹介手数料は含まない)
  overallGrossMarginRate: number; // 全体粗利率 (%)

  totalTransportSalary: number;   // 給与交通費総額
  totalTransportBilling: number;  // 請求交通費総額
  totalTransportDiff: number;     // 交通費差額

  totalPaidLeaveAmount: number;   // 有給金額合計 (スタッフ×月で重複排除して集計)
  totalPaidLeaveDays: number;     // 有給日数合計 (同上)
  avgPaidLeaveDaysPerStaff: number; // 1人当たり有給日数

  // 請求＠ (大阪人材の集計シートと同一の定義。契約ごとの請求単価の単純合計であり、
  // 稼働時間・契約規模での重み付けは行わない。実データ検証で大阪人材シートの値と
  // 誤差0で一致することを確認済み。請求書印刷CSV未読込の場合は0になる)
  totalBillingUnitPrice: number;
  // 請求書印刷CSVが1件も読み込まれていない(=請求単価データが1件もない)場合はfalse。
  // UI側で0円と「データなし」を区別するために使う。
  billingUnitPriceDataAvailable: boolean;

  // 支払＠ (大阪人材の集計シートと同一の定義。給与行ごとに算出した支払単価
  // [時間内(金額)÷時間内時間] の単純合計。時間内時間が0のスタッフは寄与0として
  // 自動的に除外される。請求＠と同じ「名目」方式で、稼働時間による重み付けはしない)
  totalPayUnitPrice: number;
  // 給与CSVに時間内時間データが1件も無い(=支払単価が1件も算出できない)場合はfalse。
  payUnitPriceDataAvailable: boolean;

  // 名目粗利率(%) = 1 - 支払＠/請求＠ (大阪人材の集計シートK列と同一定義)。
  // 実質粗利率(overallGrossMarginRate、実額ベース)とは異なる指標である点に注意。
  // 請求＠が0の場合は0。
  nominalGrossMarginRate: number;

  activeStaffCount: number;    // 稼働スタッフ数
  totalBillingCount: number;   // 総請求件数
  alertCount: number;          // 要確認アラート総数

  // ★2026-08-27追加(22章タスク2)。有給金額の1人当たり平均(有給日数の1人当たり平均=
  // avgPaidLeaveDaysPerStaffは既存)。
  avgPaidLeaveAmountPerStaff: number;

  // 有給取得率(%) = 対象期間に取得した有給日数の合計 ÷ (取得日数合計 + 期末時点の有給残日数合計) × 100。
  // 給与CSVに「有給残日数」列が1件も無い場合は算出不可(0・falseを返す)。
  paidLeaveUtilizationRate: number;
  paidLeaveUtilizationRateDataAvailable: boolean;

  // 有給残日数アラート用: スタッフごとの直近(対象期間内で最も新しい対象月)の有給残日数一覧。
  // 閾値でのフィルタ・表示はUI側(FiscalYearAnalytics)で行う。
  staffPaidLeaveBalances: { staffNo: string; staffName: string; targetMonth: string; paidLeaveRemainingDays: number }[];

  // 離職率(%): 給与CSVの「スタッフ区分」列の月次推移から算出。ある月に存在した(在籍していた)
  // スタッフNoが、翌月以降のデータで見られなくなった割合の対象期間内平均。
  // データが連続する2ヶ月分に満たない、またはスタッフ区分列が1件も無い場合は算出不可。
  turnoverRate: number;
  turnoverRateDataAvailable: boolean;

  monthlyTrends: MonthlyTrend[];// 月次推移データ
  clientRankings: ClientRanking[]; // 得意先別実績
}

// 月次推移グラフ用
export interface MonthlyTrend {
  month: string;               // 対象年月 ('2026-04')
  dispatchSales: number;       // 派遣売上
  referralSales: number;       // 紹介手数料
  totalSales: number;          // 総売上
  cost: number;                // 原価
  grossProfit: number;         // 粗利
  grossMarginRate: number;     // 粗利率 (%)
  transportDiff: number;       // 交通費差額
  paidLeaveAmount: number;     // 有給金額 (スタッフ×月で重複排除)
  paidLeaveDays: number;       // 有給日数 (同上)
  billingUnitPriceSum: number; // 請求＠ (当月の契約ごとの請求単価の単純合計。FiscalYearSummary.totalBillingUnitPrice参照)
  payUnitPriceSum: number;     // 支払＠ (当月の給与行ごとの支払単価の単純合計。FiscalYearSummary.totalPayUnitPrice参照)
  alertCount: number;          // アラート数

  // ★2026-08-27追加(22章タスク2): 自社負担コスト(雇用保険・社会保険・交通費)の月次推移グラフ用内訳
  socialInsurance: number;     // 社保負担額 (当月合計)
  employmentInsurance: number; // 雇用保険会社負担額 (当月合計・参考値)
  transportSalary: number;     // 給与交通費支給額 (当月合計・自社負担分)
}

// 得意先別順位
export interface ClientRanking {
  clientCode: string;
  clientName: string;
  totalSales: number;
  totalGrossProfit: number;
  grossMarginRate: number;   // 実額ベースの粗利率(=totalGrossProfit/totalSales)。参考値。
  staffCount: number;

  // ★2026-08-27追加(22章タスク3)。クライアント別ランキング・トレンドは、休業手当・有給取得等の
  // 影響でブレの大きい実質粗利率(grossMarginRate)ではなく、契約単価の単純合計から算出する
  // 名目粗利率(大阪人材集計シート方式。FiscalYearSummary.nominalGrossMarginRateと同一定義)を
  // 基準に使う(運用者確認・21-5章参照)。
  nominalGrossMarginRate: number;
  nominalGrossMarginRateDataAvailable: boolean; // 請求書印刷CSV等の単価データが1件も無い場合false
  // クライアント別・月次の名目粗利率推移(トレンド表示用)
  monthlyNominalMarginTrend: { month: string; nominalGrossMarginRate: number; dataAvailable: boolean }[];
}

// Power Query Mコード対応参照型
export interface MCodeMapping {
  stepName: string;
  mCodeSnippet: string;
  typescriptEquivalent: string;
  explanation: string;
}
