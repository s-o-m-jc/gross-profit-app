/**
 * 派遣事業 粗利・経理管理システム
 * テスト用データ生成器
 *
 * 2026-08-20: 実データ検証結果(要件整理ドキュメント11章)に合わせ、列構成を
 * 実際のスタッフナビ出力(未払計上表・請求支払一覧表印刷CSV)準拠に更新。
 * 高橋裕樹(S1003)の2026-04データで20日締重複行の統合デモ、
 * 社保負担額のわずかな差異(SOCIAL_INSURANCE_MISMATCH検算アラート)のデモを含む。
 */

import { PayrollRow, BillingRow, InvoicePrintRow, RetirementRow } from '../types';

// 「時間内」(金額)・「時間内時間」(H:MM形式の時間)は支払＠算出用の実列。
// 実データのCSVは時間外・深夜内等の割増区分も含む多数の列を持つが、ひな形としては最小限のみ記載。
export const SAMPLE_PAYROLL_CSV = `スタッフ番号,スタッフ氏名,総支給額,社保合計,雇用保険,駐車場手当,交通費1,交通費2,有給手当,有給日数,支給日,備考,時間内,時間内時間
S1001,佐藤 健太,280000,42000,2800,5000,15000,0,8000,1,2026-05-15,製造派遣Aライン,252000,160:00
S1002,鈴木 美咲,250000,37500,2500,0,12000,0,0,0,2026-05-15,事務派遣,225000,150:00
S1003,高橋 裕樹,320000,48000,3200,8000,18000,0,0,0,2026-05-15,エンジニア派遣,288000,160:00
S1004,田中 太郎,290000,43500,2900,0,10000,0,6000,1,2026-05-15,コールセンター,261000,160:00
S1005,渡辺 順子,210000,31500,2100,0,8000,0,0,0,2026-05-15,軽作業 (低粗利検証),189000,140:00
S1006,伊藤 誠,260000,39000,2600,0,14000,0,0,0,2026-05-15,給料のみ存在データ (請求漏れ検証),234000,150:00
S1001,佐藤 健太,285000,42750,2850,5000,15000,0,0,0,2026-06-15,製造派遣Aライン,256500,160:00
S1002,鈴木 美咲,255000,38250,2550,0,12000,0,0,0,2026-06-15,事務派遣,229500,150:00
S1003,高橋 裕樹,330000,49500,3300,8000,18000,0,0,0,2026-06-15,エンジニア派遣,297000,160:00
S1004,田中 太郎,295000,44250,2950,0,10000,0,0,0,2026-06-15,コールセンター,265500,160:00
S1001,佐藤 健太,290000,43500,2900,5000,15000,0,0,0,2026-07-15,製造派遣Aライン,261000,160:00
S1002,鈴木 美咲,260000,39000,2600,0,12000,0,0,0,2026-07-15,事務派遣,234000,150:00
S1003,高橋 裕樹,325000,48750,3250,8000,18000,0,0,0,2026-07-15,エンジニア派遣,292500,160:00`;

// 対象年月はこのCSV自体には無く、ファイル名(例: 請求データ_サンプル_202604.csv)から取得する想定
export const SAMPLE_BILLING_CSV = `請求No,クライアント番号,クライアント名称,スタッフNo,スタッフ氏名,受注番号,受注名称,請求額,支払額,社保負担額,有給使用日数,請求交通費,紹介手数料,稼働時間,請求単価
B202604-001,C101,トヨタ自動車九州,S1001,佐藤 健太,O-1001-0401,トヨタ自動車九州・製造ライン(佐藤),420000,280000,44800,1,10000,0,160,2625
B202604-002,C102,ソニーセミコンダクタ,S1002,鈴木 美咲,O-1002-0401,ソニーセミコンダクタ・事務(鈴木),360000,250000,40000,0,12000,0,150,2400
B202604-003,C103,安川電機,S1003,高橋 裕樹,O-1003-0401,安川電機・エンジニア(高橋)前半,86180,0,0,0,0,0,0,3000
B202604-003,C103,安川電機,S1003,高橋 裕樹,O-1003-0402,安川電機・エンジニア(高橋)後半,393820,320000,52400,0,18000,0,160,3000
B202604-004,C104,九電工,S1004,田中 太郎,O-1004-0401,九電工・コールセンター(田中),400000,290000,46400,1,15000,0,160,2500
B202604-005,C105,福岡流通倉庫,S1005,渡辺 順子,O-1005-0401,福岡流通倉庫・軽作業(渡辺),260000,210000,33600,0,8000,0,140,1857
B202604-007,C106,西日本鉄道,S1099,未登録スタッフ,O-1099-0401,西日本鉄道・臨時(未登録),300000,0,0,0,5000,150000,120,2500
B202605-001,C101,トヨタ自動車九州,S1001,佐藤 健太,O-1001-0501,トヨタ自動車九州・製造ライン(佐藤),430000,285000,45600,0,15000,0,164,2622
B202605-002,C102,ソニーセミコンダクタ,S1002,鈴木 美咲,O-1002-0501,ソニーセミコンダクタ・事務(鈴木),370000,255000,40800,0,12000,0,154,2402
B202605-003,C103,安川電機,S1003,高橋 裕樹,O-1003-0501,安川電機・エンジニア(高橋),500000,330000,52800,0,18000,0,166,3012
B202605-004,C104,九電工,S1004,田中 太郎,O-1004-0501,九電工・コールセンター(田中),410000,295000,47200,0,10000,0,164,2500
B202606-001,C101,トヨタ自動車九州,S1001,佐藤 健太,O-1001-0601,トヨタ自動車九州・製造ライン(佐藤),440000,290000,46400,0,15000,0,168,2619
B202606-002,C102,ソニーセミコンダクタ,S1002,鈴木 美咲,O-1002-0601,ソニーセミコンダクタ・事務(鈴木),380000,260000,41600,0,12000,0,158,2405
B202606-003,C103,安川電機,S1003,高橋 裕樹,O-1003-0601,安川電機・エンジニア(高橋),490000,325000,52000,0,18000,0,162,3024`;

// 「時間内−単価」列(区切り文字はU+2212のマイナス記号)は決算期集計の「請求＠」算出に使用する実列。
// 実データのCSVは他にも多数の列(時間内−時間(日)等)を持つが、ひな形としては最小限のみ記載。
export const SAMPLE_INVOICE_PRINT_CSV = `請求No,発行日,振込予定日,印刷ステータス,送付ステータス,時間内−単価
B202604-001,2026-04-30,2026-05-31,印刷済,送付済,2625
B202604-002,2026-04-30,2026-05-31,印刷済,送付済,2400
B202604-003,2026-04-30,2026-05-31,未印刷,未送付,3000
B202604-004,2026-04-30,2026-05-31,印刷済,送付済,2500
B202604-005,2026-04-30,2026-05-31,印刷済,未送付,1857
B202604-007,2026-04-30,2026-05-31,印刷済,送付済,2500
B202605-001,2026-05-31,2026-06-30,印刷済,送付済,2622
B202605-002,2026-05-31,2026-06-30,印刷済,送付済,2402
B202605-003,2026-05-31,2026-06-30,印刷済,送付済,3012
B202605-004,2026-05-31,2026-06-30,印刷済,送付済,2500
B202606-001,2026-06-30,2026-07-31,未印刷,未送付,2619
B202606-002,2026-06-30,2026-07-31,未印刷,未送付,2405
B202606-003,2026-06-30,2026-07-31,未印刷,未送付,3024`;

export function getSamplePayrollData(): PayrollRow[] {
  // regularAmount(時間内)・regularHours(時間内時間)は支払＠算出用のデモ値。
  // 実データでは"164:30"のようなH:MM形式だが、ここではパース後の10進数値を直接指定している。
  // ★2026-08-27追加: staffCategory(スタッフ区分)・paidLeaveRemainingDays(有給残日数)は
  // 22章タスク2(離職率・有給残日数アラート)のデモ用に追加した値。S1006は2026-04のみ在籍する
  // (5月以降データが無い)ことで離職のデモになる。S1003は有給残日数を閾値超え(15日)にしてある。
  return [
    { targetMonth: '2026-04', staffNo: 'S1001', staffName: '佐藤 健太', paymentAmount: 280000, socialInsurance: 42000, employmentInsurance: 2800, parkingFee: 5000, salaryTransport: 15000, paidLeaveAllowance: 8000, paidLeaveDays: 1, regularAmount: 252000, regularHours: 160, payDate: '2026-05-15', remarks: '製造派遣Aライン', staffCategory: '稼働中', paidLeaveRemainingDays: 9 },
    { targetMonth: '2026-04', staffNo: 'S1002', staffName: '鈴木 美咲', paymentAmount: 250000, socialInsurance: 37500, employmentInsurance: 2500, parkingFee: 0, salaryTransport: 12000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 225000, regularHours: 150, payDate: '2026-05-15', remarks: '事務派遣', staffCategory: '稼働中', paidLeaveRemainingDays: 5 },
    { targetMonth: '2026-04', staffNo: 'S1003', staffName: '高橋 裕樹', paymentAmount: 320000, socialInsurance: 48000, employmentInsurance: 3200, parkingFee: 8000, salaryTransport: 18000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 288000, regularHours: 160, payDate: '2026-05-15', remarks: 'エンジニア派遣', staffCategory: '稼働中', paidLeaveRemainingDays: 14 },
    { targetMonth: '2026-04', staffNo: 'S1004', staffName: '田中 太郎', paymentAmount: 290000, socialInsurance: 43500, employmentInsurance: 2900, parkingFee: 0, salaryTransport: 10000, paidLeaveAllowance: 6000, paidLeaveDays: 1, regularAmount: 261000, regularHours: 160, payDate: '2026-05-15', remarks: 'コールセンター', staffCategory: '稼働中', paidLeaveRemainingDays: 7 },
    { targetMonth: '2026-04', staffNo: 'S1005', staffName: '渡辺 順子', paymentAmount: 210000, socialInsurance: 31500, employmentInsurance: 2100, parkingFee: 0, salaryTransport: 8000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 189000, regularHours: 140, payDate: '2026-05-15', remarks: '軽作業 (低粗利検証)', staffCategory: '稼働中', paidLeaveRemainingDays: 3 },
    { targetMonth: '2026-04', staffNo: 'S1006', staffName: '伊藤 誠', paymentAmount: 260000, socialInsurance: 39000, employmentInsurance: 2600, parkingFee: 0, salaryTransport: 14000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 234000, regularHours: 150, payDate: '2026-05-15', remarks: '給料のみ存在データ (請求漏れ検証・離職デモ: 5月以降データなし)', staffCategory: '稼働中', paidLeaveRemainingDays: 2 },
    { targetMonth: '2026-05', staffNo: 'S1001', staffName: '佐藤 健太', paymentAmount: 285000, socialInsurance: 42750, employmentInsurance: 2850, parkingFee: 5000, salaryTransport: 15000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 256500, regularHours: 160, payDate: '2026-06-15', remarks: '製造派遣Aライン', staffCategory: '稼働中', paidLeaveRemainingDays: 10 },
    { targetMonth: '2026-05', staffNo: 'S1002', staffName: '鈴木 美咲', paymentAmount: 255000, socialInsurance: 38250, employmentInsurance: 2550, parkingFee: 0, salaryTransport: 12000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 229500, regularHours: 150, payDate: '2026-06-15', remarks: '事務派遣', staffCategory: '稼働中', paidLeaveRemainingDays: 5 },
    { targetMonth: '2026-05', staffNo: 'S1003', staffName: '高橋 裕樹', paymentAmount: 330000, socialInsurance: 49500, employmentInsurance: 3300, parkingFee: 8000, salaryTransport: 18000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 297000, regularHours: 160, payDate: '2026-06-15', remarks: 'エンジニア派遣', staffCategory: '稼働中', paidLeaveRemainingDays: 14 },
    { targetMonth: '2026-05', staffNo: 'S1004', staffName: '田中 太郎', paymentAmount: 295000, socialInsurance: 44250, employmentInsurance: 2950, parkingFee: 0, salaryTransport: 10000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 265500, regularHours: 160, payDate: '2026-06-15', remarks: 'コールセンター', staffCategory: '稼働中', paidLeaveRemainingDays: 7 },
    { targetMonth: '2026-06', staffNo: 'S1001', staffName: '佐藤 健太', paymentAmount: 290000, socialInsurance: 43500, employmentInsurance: 2900, parkingFee: 5000, salaryTransport: 15000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 261000, regularHours: 160, payDate: '2026-07-15', remarks: '製造派遣Aライン', staffCategory: '稼働中', paidLeaveRemainingDays: 12 },
    { targetMonth: '2026-06', staffNo: 'S1002', staffName: '鈴木 美咲', paymentAmount: 260000, socialInsurance: 39000, employmentInsurance: 2600, parkingFee: 0, salaryTransport: 12000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 234000, regularHours: 150, payDate: '2026-07-15', remarks: '事務派遣', staffCategory: '稼働中', paidLeaveRemainingDays: 5 },
    { targetMonth: '2026-06', staffNo: 'S1003', staffName: '高橋 裕樹', paymentAmount: 325000, socialInsurance: 48750, employmentInsurance: 3250, parkingFee: 8000, salaryTransport: 18000, paidLeaveAllowance: 0, paidLeaveDays: 0, regularAmount: 292500, regularHours: 160, payDate: '2026-07-15', remarks: 'エンジニア派遣', staffCategory: '稼働中', paidLeaveRemainingDays: 15 },
  ];
}

export function getSampleBillingData(): BillingRow[] {
  return [
    { billingNo: 'B202604-001', targetMonth: '2026-04', staffNo: 'S1001', staffName: '佐藤 健太', clientCode: 'C101', clientName: 'トヨタ自動車九州', orderNo: 'O-1001-0401', orderName: 'トヨタ自動車九州・製造ライン(佐藤)', billingAmountExTax: 420000, paymentAmount: 280000, socialInsuranceBilling: 44800, paidLeaveDaysUsed: 1, billingTransport: 10000, referralFee: 0, workHours: 160, unitPrice: 2625 },
    { billingNo: 'B202604-002', targetMonth: '2026-04', staffNo: 'S1002', staffName: '鈴木 美咲', clientCode: 'C102', clientName: 'ソニーセミコンダクタ', orderNo: 'O-1002-0401', orderName: 'ソニーセミコンダクタ・事務(鈴木)', billingAmountExTax: 360000, paymentAmount: 250000, socialInsuranceBilling: 40000, paidLeaveDaysUsed: 0, billingTransport: 12000, referralFee: 0, workHours: 150, unitPrice: 2400 },
    // 20日締重複行のデモ: 同一請求No・スタッフ・クライアント・受注名称だが受注番号違いで2行に分かれるケース
    { billingNo: 'B202604-003', targetMonth: '2026-04', staffNo: 'S1003', staffName: '高橋 裕樹', clientCode: 'C103', clientName: '安川電機', orderNo: 'O-1003-0401', orderName: '安川電機・エンジニア(高橋)前半', billingAmountExTax: 86180, paymentAmount: 0, socialInsuranceBilling: 0, paidLeaveDaysUsed: 0, billingTransport: 0, referralFee: 0, workHours: 0, unitPrice: 3000 },
    // 社保負担額に労災保険相当が上乗せされているデモ(給与CSV合計48000+3200=51200に対し52400。SOCIAL_INSURANCE_MISMATCHアラートが発火する)
    { billingNo: 'B202604-003', targetMonth: '2026-04', staffNo: 'S1003', staffName: '高橋 裕樹', clientCode: 'C103', clientName: '安川電機', orderNo: 'O-1003-0402', orderName: '安川電機・エンジニア(高橋)前半', billingAmountExTax: 393820, paymentAmount: 320000, socialInsuranceBilling: 52400, paidLeaveDaysUsed: 0, billingTransport: 18000, referralFee: 0, workHours: 160, unitPrice: 3000 },
    { billingNo: 'B202604-004', targetMonth: '2026-04', staffNo: 'S1004', staffName: '田中 太郎', clientCode: 'C104', clientName: '九電工', orderNo: 'O-1004-0401', orderName: '九電工・コールセンター(田中)', billingAmountExTax: 400000, paymentAmount: 290000, socialInsuranceBilling: 46400, paidLeaveDaysUsed: 1, billingTransport: 15000, referralFee: 0, workHours: 160, unitPrice: 2500 },
    { billingNo: 'B202604-005', targetMonth: '2026-04', staffNo: 'S1005', staffName: '渡辺 順子', clientCode: 'C105', clientName: '福岡流通倉庫', orderNo: 'O-1005-0401', orderName: '福岡流通倉庫・軽作業(渡辺)', billingAmountExTax: 260000, paymentAmount: 210000, socialInsuranceBilling: 33600, paidLeaveDaysUsed: 0, billingTransport: 8000, referralFee: 0, workHours: 140, unitPrice: 1857 },
    { billingNo: 'B202604-007', targetMonth: '2026-04', staffNo: 'S1099', staffName: '未登録スタッフ', clientCode: 'C106', clientName: '西日本鉄道', orderNo: 'O-1099-0401', orderName: '西日本鉄道・臨時(未登録)', billingAmountExTax: 300000, paymentAmount: 0, socialInsuranceBilling: 0, paidLeaveDaysUsed: 0, billingTransport: 5000, referralFee: 150000, workHours: 120, unitPrice: 2500 },
    { billingNo: 'B202605-001', targetMonth: '2026-05', staffNo: 'S1001', staffName: '佐藤 健太', clientCode: 'C101', clientName: 'トヨタ自動車九州', orderNo: 'O-1001-0501', orderName: 'トヨタ自動車九州・製造ライン(佐藤)', billingAmountExTax: 430000, paymentAmount: 285000, socialInsuranceBilling: 45600, paidLeaveDaysUsed: 0, billingTransport: 15000, referralFee: 0, workHours: 164, unitPrice: 2622 },
    { billingNo: 'B202605-002', targetMonth: '2026-05', staffNo: 'S1002', staffName: '鈴木 美咲', clientCode: 'C102', clientName: 'ソニーセミコンダクタ', orderNo: 'O-1002-0501', orderName: 'ソニーセミコンダクタ・事務(鈴木)', billingAmountExTax: 370000, paymentAmount: 255000, socialInsuranceBilling: 40800, paidLeaveDaysUsed: 0, billingTransport: 12000, referralFee: 0, workHours: 154, unitPrice: 2402 },
    { billingNo: 'B202605-003', targetMonth: '2026-05', staffNo: 'S1003', staffName: '高橋 裕樹', clientCode: 'C103', clientName: '安川電機', orderNo: 'O-1003-0501', orderName: '安川電機・エンジニア(高橋)', billingAmountExTax: 500000, paymentAmount: 330000, socialInsuranceBilling: 52800, paidLeaveDaysUsed: 0, billingTransport: 18000, referralFee: 0, workHours: 166, unitPrice: 3012 },
    { billingNo: 'B202605-004', targetMonth: '2026-05', staffNo: 'S1004', staffName: '田中 太郎', clientCode: 'C104', clientName: '九電工', orderNo: 'O-1004-0501', orderName: '九電工・コールセンター(田中)', billingAmountExTax: 410000, paymentAmount: 295000, socialInsuranceBilling: 47200, paidLeaveDaysUsed: 0, billingTransport: 10000, referralFee: 0, workHours: 164, unitPrice: 2500 },
    { billingNo: 'B202606-001', targetMonth: '2026-06', staffNo: 'S1001', staffName: '佐藤 健太', clientCode: 'C101', clientName: 'トヨタ自動車九州', orderNo: 'O-1001-0601', orderName: 'トヨタ自動車九州・製造ライン(佐藤)', billingAmountExTax: 440000, paymentAmount: 290000, socialInsuranceBilling: 46400, paidLeaveDaysUsed: 0, billingTransport: 15000, referralFee: 0, workHours: 168, unitPrice: 2619 },
    { billingNo: 'B202606-002', targetMonth: '2026-06', staffNo: 'S1002', staffName: '鈴木 美咲', clientCode: 'C102', clientName: 'ソニーセミコンダクタ', orderNo: 'O-1002-0601', orderName: 'ソニーセミコンダクタ・事務(鈴木)', billingAmountExTax: 380000, paymentAmount: 260000, socialInsuranceBilling: 41600, paidLeaveDaysUsed: 0, billingTransport: 12000, referralFee: 0, workHours: 158, unitPrice: 2405 },
    { billingNo: 'B202606-003', targetMonth: '2026-06', staffNo: 'S1003', staffName: '高橋 裕樹', clientCode: 'C103', clientName: '安川電機', orderNo: 'O-1003-0601', orderName: '安川電機・エンジニア(高橋)', billingAmountExTax: 490000, paymentAmount: 325000, socialInsuranceBilling: 52000, paidLeaveDaysUsed: 0, billingTransport: 18000, referralFee: 0, workHours: 162, unitPrice: 3024 },
  ];
}

export function getSampleInvoicePrintData(): InvoicePrintRow[] {
  // unitPrice(時間内−単価)はgetSampleBillingData()の同一billingNoの値と揃えている(デモ用の整合性のため)。
  // 実データでは請求支払一覧CSVに単価列が無く、この請求書印刷CSV側にのみ単価が存在する点に注意。
  // targetMonthは対応するbillingNoの対象月と揃えている(実データではファイル名から取得。11-2章参照)。
  return [
    { billingNo: 'B202604-001', targetMonth: '2026-04', invoiceIssueDate: '2026-04-30', paymentDueDate: '2026-05-31', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 2625 },
    { billingNo: 'B202604-002', targetMonth: '2026-04', invoiceIssueDate: '2026-04-30', paymentDueDate: '2026-05-31', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 2400 },
    { billingNo: 'B202604-003', targetMonth: '2026-04', invoiceIssueDate: '2026-04-30', paymentDueDate: '2026-05-31', printStatus: '未印刷', sentStatus: '未送付', unitPrice: 3000 },
    { billingNo: 'B202604-004', targetMonth: '2026-04', invoiceIssueDate: '2026-04-30', paymentDueDate: '2026-05-31', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 2500 },
    { billingNo: 'B202604-005', targetMonth: '2026-04', invoiceIssueDate: '2026-04-30', paymentDueDate: '2026-05-31', printStatus: '印刷済', sentStatus: '未送付', unitPrice: 1857 },
    { billingNo: 'B202604-007', targetMonth: '2026-04', invoiceIssueDate: '2026-04-30', paymentDueDate: '2026-05-31', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 2500 },
    { billingNo: 'B202605-001', targetMonth: '2026-05', invoiceIssueDate: '2026-05-31', paymentDueDate: '2026-06-30', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 2622 },
    { billingNo: 'B202605-002', targetMonth: '2026-05', invoiceIssueDate: '2026-05-31', paymentDueDate: '2026-06-30', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 2402 },
    { billingNo: 'B202605-003', targetMonth: '2026-05', invoiceIssueDate: '2026-05-31', paymentDueDate: '2026-06-30', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 3012 },
    { billingNo: 'B202605-004', targetMonth: '2026-05', invoiceIssueDate: '2026-05-31', paymentDueDate: '2026-06-30', printStatus: '印刷済', sentStatus: '送付済', unitPrice: 2500 },
    { billingNo: 'B202606-001', targetMonth: '2026-06', invoiceIssueDate: '2026-06-30', paymentDueDate: '2026-07-31', printStatus: '未印刷', sentStatus: '未送付', unitPrice: 2619 },
    { billingNo: 'B202606-002', targetMonth: '2026-06', invoiceIssueDate: '2026-06-30', paymentDueDate: '2026-07-31', printStatus: '未印刷', sentStatus: '未送付', unitPrice: 2405 },
    { billingNo: 'B202606-003', targetMonth: '2026-06', invoiceIssueDate: '2026-06-30', paymentDueDate: '2026-07-31', printStatus: '未印刷', sentStatus: '未送付', unitPrice: 3024 },
  ];
}

// ★2026-08-26: 退職金はCSV取込から手入力方式に変更したため、サンプル行にも一意なidを付与する。
export function getSampleRetirementData(): RetirementRow[] {
  return [
    { id: 'SAMPLE_RET_202604_S1001', targetMonth: '2026-04', staffNo: 'S1001', retirementAmount: 12000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202604_S1002', targetMonth: '2026-04', staffNo: 'S1002', retirementAmount: 10000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202604_S1003', targetMonth: '2026-04', staffNo: 'S1003', retirementAmount: 15000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202604_S1004', targetMonth: '2026-04', staffNo: 'S1004', retirementAmount: 11000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202604_S1005', targetMonth: '2026-04', staffNo: 'S1005', retirementAmount: 8000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202605_S1001', targetMonth: '2026-05', staffNo: 'S1001', retirementAmount: 12000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202605_S1002', targetMonth: '2026-05', staffNo: 'S1002', retirementAmount: 10000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202605_S1003', targetMonth: '2026-05', staffNo: 'S1003', retirementAmount: 15000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202605_S1004', targetMonth: '2026-05', staffNo: 'S1004', retirementAmount: 11000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202606_S1001', targetMonth: '2026-06', staffNo: 'S1001', retirementAmount: 12000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202606_S1002', targetMonth: '2026-06', staffNo: 'S1002', retirementAmount: 10000, memo: '毎月定額積立配賦' },
    { id: 'SAMPLE_RET_202606_S1003', targetMonth: '2026-06', staffNo: 'S1003', retirementAmount: 15000, memo: '毎月定額積立配賦' },
  ];
}
