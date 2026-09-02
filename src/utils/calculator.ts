/**
 * 派遣事業 粗利・経理管理システム
 * 粗利計算 & 監査エンジン
 *
 * 2026-08-20: 実データ検証(要件整理ドキュメント11章)により、請求支払一覧CSVの
 * 「支払額」「社保負担額」は既に契約(受注)単位で正しく配分された値であることが
 * 判明したため、給与CSVと突合して按分配賦する設計から、請求CSV側の値をそのまま
 * 信頼する設計に変更した。給与CSVは駐車場代・退職金(契約に紐付かない月次原価)と、
 * 有給手当・有給日数(参考表示/検算用)の取得元としてのみ使用する。
 */

import {
  PayrollRow,
  BillingRow,
  InvoicePrintRow,
  RetirementRow,
  LeaveCompensationRow,
  LeaveAllowanceRow,
  NextMonthAdjustmentRow,
  GrossProfitResult,
  AuditAlert,
  FiscalYearSummary,
  MonthlyTrend,
  ClientRanking,
} from '../types';

// 環境変数からのデフォルト値取得 (Vite環境変数要件遵守)
const DEFAULT_TAX_RATE = Number(import.meta.env.VITE_DEFAULT_TAX_RATE || '0.1');
const LOW_MARGIN_THRESHOLD = Number(import.meta.env.VITE_LOW_MARGIN_THRESHOLD || '10');

// 社保負担額の検算許容誤差 (これを超える差異はSOCIAL_INSURANCE_MISMATCHとして警告)
const SOCIAL_INSURANCE_TOLERANCE = 500;

// 決算開始月のフォールバック既定値。会社ごとの実際の決算開始月はsrc/config/companiesの
// 設定テーブルで管理しており、App.tsxから毎回startFiscalMonth引数として明示的に渡される。
// この定数は引数省略時(未使用箇所からの呼び出し等)のための保険的な既定値。
const FALLBACK_FISCAL_START_MONTH = '04';

/** 実行時点の年 + 決算開始月から、デフォルトの決算期開始年月("YYYY-MM")を組み立てる */
function getDefaultFiscalYearStart(): string {
  const currentYear = new Date().getFullYear();
  return `${currentYear}-${FALLBACK_FISCAL_START_MONTH.padStart(2, '0')}`;
}

/**
 * 決算期開始年月("YYYY-MM")から、その決算期に属するmonthsCount ヶ月分の対象年月("YYYY-MM")配列を
 * 組み立てる。calculateFiscalYearSummaryの期間フィルタと、UI側(月次粗利明細一覧の
 * 「年間(決算期)」表示切替)の両方から共通で使う。
 */
export function getFiscalYearMonths(
  startFiscalMonth: string = getDefaultFiscalYearStart(),
  monthsCount: number = 12
): string[] {
  const targetMonths: string[] = [];
  const [startYearStr, startMonthStr] = startFiscalMonth.split('-');
  let currentYear = parseInt(startYearStr, 10);
  let currentMonth = parseInt(startMonthStr, 10);

  for (let i = 0; i < monthsCount; i++) {
    const yStr = currentYear.toString();
    const mStr = currentMonth < 10 ? `0${currentMonth}` : `${currentMonth}`;
    targetMonths.push(`${yStr}-${mStr}`);

    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  return targetMonths;
}

/**
 * 監査アラートのうち、実際に確認・対応が必要な重要度('warning'|'error')だけを判定する。
 * severity='info'(社保負担額の差異検出・20日締重複統合ログ等、あくまで参考・透明化目的のログ)は
 * カウントに含めない。
 *
 * ★2026-08-26: 「月次粗利明細一覧の監査ステータスがほぼ全件『要確認』になる」不具合の原因調査結果、
 * UI側(監査ステータス列・ヘッダーの要確認バッジ)が `alerts.length > 0` (=info含む全アラート)を
 * そのまま「要確認」判定に使っていたことが判明した。実データでは社保負担額の突合(info)がほぼ全件で
 * 差異を検出するため、対応不要な参考ログまで「要確認」に見えてしまっていた。severityで
 * warning/errorのみを実際の要確認対象とすることで、本来対応が必要な項目だけが強調されるようにする。
 */
export function hasActionableAlerts(alerts: AuditAlert[]): boolean {
  return alerts.some((a) => a.severity === 'warning' || a.severity === 'error');
}

export function countActionableAlerts(alerts: AuditAlert[]): number {
  return alerts.filter((a) => a.severity === 'warning' || a.severity === 'error').length;
}

interface MergedBillingRow extends BillingRow {
  mergedRowCount: number;   // 統合された請求行数 (1なら統合なし)
  mergedOrderNos: string[]; // 統合元の受注番号一覧
}

/**
 * 20日締による重複行の統合処理。
 *
 * 実データ検証(要件整理ドキュメント11-4)により、重複行は受注番号が異なる一方、
 * 対象月・請求No・スタッフNo・クライアント番号・受注名称は一致することが確認できた。
 * ただし「請求No＋スタッフNo＋クライアント番号」だけをキーにすると、同一クライアントへの
 * 正当な複数契約まで誤って合算してしまう恐れがあるため、受注名称も一致条件に含める
 * 暫定ルールとする(運用者未確定・要継続検証。統合が発生した行にはDUPLICATE_MERGEDアラートを付与し、
 * 監査パネルで目視確認できるようにしている)。
 */
function mergeDuplicateBillingRows(billings: BillingRow[]): MergedBillingRow[] {
  const groups = new Map<string, BillingRow[]>();
  billings.forEach((b) => {
    const key = `${b.targetMonth}_${b.billingNo}_${b.staffNo}_${b.clientCode}_${b.orderName}`;
    const arr = groups.get(key) || [];
    arr.push(b);
    groups.set(key, arr);
  });

  const merged: MergedBillingRow[] = [];
  groups.forEach((rows) => {
    if (rows.length === 1) {
      merged.push({
        ...rows[0],
        mergedRowCount: 1,
        mergedOrderNos: rows[0].orderNo ? [rows[0].orderNo] : [],
      });
      return;
    }

    const base = rows[0];
    // 交通費は重複行間で同額のはずなので合算せず、非ゼロ側(最大値)を1行分として採用する
    const billingTransport = Math.max(...rows.map((r) => r.billingTransport));

    merged.push({
      ...base,
      billingAmountExTax: rows.reduce((s, r) => s + r.billingAmountExTax, 0),
      paymentAmount: rows.reduce((s, r) => s + r.paymentAmount, 0),
      socialInsuranceBilling: rows.reduce((s, r) => s + r.socialInsuranceBilling, 0),
      paidLeaveDaysUsed: rows.reduce((s, r) => s + r.paidLeaveDaysUsed, 0),
      referralFee: rows.reduce((s, r) => s + r.referralFee, 0),
      workHours: rows.reduce((s, r) => s + r.workHours, 0),
      billingTransport,
      mergedRowCount: rows.length,
      mergedOrderNos: rows.map((r) => r.orderNo).filter(Boolean),
    });
  });

  return merged;
}

/**
 * 月次粗利計算およびデータ結合処理
 */
export function calculateGrossProfit(
  payrolls: PayrollRow[],
  billings: BillingRow[],
  invoices: InvoicePrintRow[] = [],
  retirements: RetirementRow[] = [],
  taxRate: number = DEFAULT_TAX_RATE,
  // 15章: 手入力調整項目(いずれも既存の請求/給与CSVには存在しない、月次原価管理アプリ側だけの
  // 手入力データ)。既存呼び出し元との後方互換のため末尾に追加し、既定値は空配列にしている。
  leaveCompensations: LeaveCompensationRow[] = [],
  leaveAllowances: LeaveAllowanceRow[] = [],
  nextMonthAdjustments: NextMonthAdjustmentRow[] = []
): GrossProfitResult[] {
  // 退職金データのマップ作成 キー: `${targetMonth}_${staffNo}`
  const retirementMap = new Map<string, number>();
  retirements.forEach((r) => {
    const key = `${r.targetMonth}_${r.staffNo}`;
    retirementMap.set(key, (retirementMap.get(key) || 0) + (r.retirementAmount || 0));
  });

  // 請求書印刷データのマップ作成 キー: `${targetMonth}_${billingNo}`
  // ★2026-08-21修正: 以前はbillingNoのみをキーにしていたが、複数月データ蓄積アーキテクチャで
  // 複数月分のinvoicesが同時に配列へ渡されるようになったことで、billingNoが月をまたいで
  // (偶然にせよ)重複した場合に、他の月の請求書印刷データを誤って拾ってしまう不具合があった。
  // 他のMap(retirementMap・payrollMap等)と同じくtargetMonthを含むキーに統一して、
  // 月をまたいだ誤結合を防ぐ。
  const invoiceMap = new Map<string, InvoicePrintRow>();
  invoices.forEach((inv) => {
    if (inv.billingNo) {
      invoiceMap.set(`${inv.targetMonth}_${inv.billingNo}`, inv);
    }
  });

  // 給与データのマップ作成 キー: `${targetMonth}_${staffNo}`
  const payrollMap = new Map<string, PayrollRow>();
  payrolls.forEach((p) => {
    const key = `${p.targetMonth}_${p.staffNo}`;
    payrollMap.set(key, p);
  });

  // 処理された給与キー追跡用
  const processedPayrollKeys = new Set<string>();

  // スタッフNo → 氏名の逆引き(手入力調整行の表示名解決用。月をまたいで最後に見つかった氏名を採用する簡易実装)
  const staffNameLookup = new Map<string, string>();
  payrolls.forEach((p) => {
    if (p.staffNo && p.staffName) staffNameLookup.set(p.staffNo, p.staffName);
  });
  billings.forEach((b) => {
    if (b.staffNo && b.staffName) staffNameLookup.set(b.staffNo, b.staffName);
  });

  const results: GrossProfitResult[] = [];

  // 0. 20日締による重複行の統合
  const mergedBillings = mergeDuplicateBillingRows(billings);

  // 同月・同一スタッフが複数クライアントに派遣されているケースの検知用カウント。
  // 要件整理ドキュメント3章(追記)・9章: 支払額・社保負担額はbilling CSV由来の契約単位の値を
  // そのまま使うため水増しの心配はないが(11-1章)、駐車場代(parkingFee)・退職金配賦額
  // (retirementAmount)はpayroll側から`targetMonth_staffNo`キーで引き当てているだけで、
  // 契約数で按分する実装が入っていない。そのため同月に複数契約があると、この2項目だけが
  // 契約数だけ重複計上される可能性がある。按分ロジックのフル実装は見送り、まずは
  // アラートで検知・可視化するだけの軽量対応とする(実運用で頻発するようなら按分実装を検討)。
  const staffMonthContractCount = new Map<string, number>();
  mergedBillings.forEach((b) => {
    const k = `${b.targetMonth}_${b.staffNo}`;
    staffMonthContractCount.set(k, (staffMonthContractCount.get(k) || 0) + 1);
  });

  // 請求支払一覧CSVには交通費列が存在しないことがあり、その場合billingTransportは全行0になる。
  // データセット全体で1件も交通費請求が無い場合は「このデータソースには交通費情報が無い」とみなし、
  // 個々の行の突合結果(給与交通費 vs 0円)を請求漏れとして警告しない(実データ検証で判明。要件整理6章参照)。
  const transportDataAvailable = mergedBillings.some((b) => b.billingTransport > 0);

  // 1. 請求データを軸に結合および粗利計算を実行
  mergedBillings.forEach((billing) => {
    const key = `${billing.targetMonth}_${billing.staffNo}`;
    const payroll = payrollMap.get(key);
    if (payroll) {
      processedPayrollKeys.add(key);
    }

    const retirementAmount = retirementMap.get(key) || 0;
    const invoicePrint = invoiceMap.get(`${billing.targetMonth}_${billing.billingNo}`);
    // 請求＠算出用の契約単価。請求書印刷CSV由来(未読込 or 未紐付けの場合は0)
    const billingUnitPrice = invoicePrint?.unitPrice || 0;
    // 支払＠算出用の支払単価 = 時間内(金額) ÷ 時間内時間。時間内時間が0またはpayroll未紐付けなら0
    // (0除算回避。SUM集計では0は寄与しないため、自動的に「除外」と同じ効果になる)
    const payUnitPrice = payroll && payroll.regularHours > 0 ? payroll.regularAmount / payroll.regularHours : 0;

    // 支払額・社保負担額は請求CSV由来の値をそのまま使う(11-1参照。給与CSVとの突合は不要)
    const paymentAmount = billing.paymentAmount || 0;
    const socialInsurance = billing.socialInsuranceBilling || 0;
    // 雇用保険は参考表示のみ。社保負担額に含まれている想定のため粗利計算では控除しない(12章参照)
    const employmentInsurance = payroll?.employmentInsurance || 0;
    const parkingFee = payroll?.parkingFee || 0;
    const salaryTransport = payroll?.salaryTransport || 0;
    const paidLeaveAllowance = payroll?.paidLeaveAllowance || 0;
    const paidLeaveDays = payroll?.paidLeaveDays || 0;

    // 請求金額 (税抜)
    const billingAmountExTax = billing.billingAmountExTax || 0;
    const billingAmountIncTax = billing.billingAmountIncTax || Math.round(billingAmountExTax * (1 + taxRate));

    // 粗利益（税抜）＝ 請求額 − 支払額(請求CSV由来) − 社保負担額(請求CSV由来) − 駐車場料金 − 退職金
    const grossProfitExTax = billingAmountExTax - paymentAmount - socialInsurance - parkingFee - retirementAmount;

    // 税込粗利益 = 請求額(税込) − 原価(給与・社保・駐車場・退職金はいずれも不課税のため税率を掛けない)。
    // ★2026-08-26修正: 旧実装は grossProfitExTax * (1+taxRate) としており、本来消費税がかからない
    // 原価項目にまで税率が掛かってしまう不具合があった(消費税切替が「表示だけで計算に反映されない」
    // 問題の原因調査で判明。修正方針の詳細は本ファイル冒頭のコメント、および実施報告を参照)。
    const grossProfitIncTax = billingAmountIncTax - paymentAmount - socialInsurance - parkingFee - retirementAmount;

    // 粗利率 (%)
    const grossProfitRate =
      billingAmountExTax > 0
        ? Number(((grossProfitExTax / billingAmountExTax) * 100).toFixed(2))
        : 0;

    // 総原価
    const totalCostExTax = paymentAmount + socialInsurance + parkingFee + retirementAmount;

    // 交通費差額検証 (月次金額一致検証)
    const transportDiff = salaryTransport - billing.billingTransport;
    let transportStatus: GrossProfitResult['transportStatus'] = 'MATCH';
    if (transportDiff > 0) {
      transportStatus = 'UNDER_BILLED'; // 請求不足 (給与支給 > 請求)
    } else if (transportDiff < 0) {
      transportStatus = 'OVER_BILLED'; // 過剰請求 (請求 > 給与支給)
    }

    // アラート生成
    const alerts: AuditAlert[] = [];

    // 20日締重複行の統合ログ (暫定ルールで統合しているため、内容を必ず可視化する)
    if (billing.mergedRowCount > 1) {
      alerts.push({
        type: 'DUPLICATE_MERGED',
        severity: 'info',
        message: `20日締等の重複行を${billing.mergedRowCount}件統合しました（受注番号: ${billing.mergedOrderNos.join(' / ')}）。判定キーは暫定ルールのため要確認。`,
      });
    }

    // 同月・同一スタッフの複数クライアント契約検知 (駐車場代・退職金の重複計上リスク。按分ロジックは未実装のため軽量アラートのみ)
    const sameMonthContractCount = staffMonthContractCount.get(key) || 1;
    if (sameMonthContractCount > 1 && (parkingFee > 0 || retirementAmount > 0)) {
      alerts.push({
        type: 'MULTI_CONTRACT_SAME_MONTH',
        severity: 'warning',
        message: `同一スタッフが同月に${sameMonthContractCount}件の契約(請求行)を持っています。駐車場代(¥${parkingFee.toLocaleString()})・退職金配賦額(¥${retirementAmount.toLocaleString()})は按分されず、各契約行に同額がそのまま計上されています（重複計上の可能性あり・按分ロジック未実装）。`,
      });
    }

    // 交通費不一致 (このデータソースに交通費情報が無い場合は警告しない)
    if (transportDiff !== 0 && transportDataAvailable) {
      alerts.push({
        type: 'TRANSPORT_MISMATCH',
        severity: 'warning',
        message:
          transportStatus === 'UNDER_BILLED'
            ? `交通費請求漏れ疑い: 差額 +¥${transportDiff.toLocaleString()}（給料支給 ¥${salaryTransport.toLocaleString()} > 請求 ¥${billing.billingTransport.toLocaleString()}）`
            : `交通費過剰請求疑い: 差額 -¥${Math.abs(transportDiff).toLocaleString()}（請求 ¥${billing.billingTransport.toLocaleString()} > 給料支給 ¥${salaryTransport.toLocaleString()}）`,
      });
    }

    // 低粗利・赤字案件
    if (grossProfitExTax < 0) {
      alerts.push({
        type: 'LOW_MARGIN',
        severity: 'error',
        message: `赤字案件です！粗利益: ¥${grossProfitExTax.toLocaleString()} (${grossProfitRate}%)`,
      });
    } else if (grossProfitRate < LOW_MARGIN_THRESHOLD) {
      alerts.push({
        type: 'LOW_MARGIN',
        severity: 'warning',
        message: `低粗利案件 (閾値 ${LOW_MARGIN_THRESHOLD}% 未満): ${grossProfitRate}%`,
      });
    }

    // 給与データ未紐付け
    if (!payroll) {
      alerts.push({
        type: 'UNMATCHED_PAYROLL',
        severity: 'error',
        message: `請求データに対応する給与データが存在しません (対象年月: ${billing.targetMonth}, スタッフ: ${billing.staffNo})`,
      });
    } else {
      // 社保負担額の検算 (請求CSV由来の値 と 給与CSVの社保合計+雇用保険 を比較)
      // 12章: 「片方は0円になっていると思う」という未確定情報のため、実データで乖離があれば警告する
      const payrollSocialTotal = payroll.socialInsurance + payroll.employmentInsurance;
      const diff = socialInsurance - payrollSocialTotal;
      if (Math.abs(diff) > SOCIAL_INSURANCE_TOLERANCE) {
        alerts.push({
          type: 'SOCIAL_INSURANCE_MISMATCH',
          severity: 'info',
          message: `社保負担額の差異を検出: 請求CSV ¥${socialInsurance.toLocaleString()} / 給与CSV(社保合計+雇用保険) ¥${payrollSocialTotal.toLocaleString()}（差額 ¥${diff.toLocaleString()}）。二重控除でないか要確認。`,
        });
      }
    }

    // 退職金未配賦警告 (稼働時間が長いにも関わらず退職金0の場合。請求支払一覧CSVにworkHours列がない場合は常に0のため実質発火しない)
    if (billing.workHours >= 140 && retirementAmount === 0) {
      alerts.push({
        type: 'RETIREMENT_MISSING',
        severity: 'info',
        message: `稼働時間 ${billing.workHours}h に対して退職金配賦額が 0円 になっています。`,
      });
    }

    results.push({
      // ★2026-08-21修正: targetMonthを含めないと、billingNo+staffNoの組み合わせが
      // 複数月にまたがって偶然一致した場合にidが衝突する(複数月データ蓄積に対応した
      // アーキテクチャ変更で、同一配列内に複数月のデータが同時に存在しうるようになったため
      // 顕在化した)。Reactのリストkeyとして使われるため、月をまたいだ一意性が必須。
      id: `${billing.targetMonth}_${billing.billingNo}_${billing.staffNo}`,
      targetMonth: billing.targetMonth,
      billingNo: billing.billingNo,
      staffNo: billing.staffNo,
      staffName: billing.staffName || payroll?.staffName || '名称未設定',
      clientCode: billing.clientCode,
      clientName: billing.clientName,
      billingAmountExTax,
      billingAmountIncTax,
      billingTransport: billing.billingTransport,
      referralFee: billing.referralFee || 0,
      paymentAmount,
      socialInsurance,
      employmentInsurance,
      parkingFee,
      retirementAmount,
      salaryTransport,
      totalCostExTax,
      paidLeaveAllowance,
      paidLeaveDays,
      mergedRowCount: billing.mergedRowCount,
      mergedOrderNos: billing.mergedOrderNos,
      grossProfitExTax,
      grossProfitIncTax,
      grossProfitRate,
      transportDiff,
      transportStatus,
      transportDataAvailable,
      alerts,
      invoicePrintStatus: invoicePrint
        ? invoicePrint.printStatus === '印刷済'
          ? 'MATCHED'
          : 'NOT_PRINTED'
        : 'MISSING_INVOICE',
      paymentDueDate: invoicePrint?.paymentDueDate,
      billingUnitPrice,
      payUnitPrice,
    });
  });

  // 2. 未紐付けの給与データ (請求が存在しない不整合データ) を検出して登録
  payrolls.forEach((payroll) => {
    const key = `${payroll.targetMonth}_${payroll.staffNo}`;
    if (!processedPayrollKeys.has(key)) {
      const retirementAmount = retirementMap.get(key) || 0;
      const totalCostExTax = payroll.paymentAmount + payroll.socialInsurance + payroll.parkingFee + retirementAmount;

      results.push({
        id: `UNMATCHED_P_${payroll.targetMonth}_${payroll.staffNo}`,
        targetMonth: payroll.targetMonth,
        billingNo: '未紐付け（請求無）',
        staffNo: payroll.staffNo,
        staffName: payroll.staffName,
        clientCode: 'N/A',
        clientName: '給与のみ存在',
        billingAmountExTax: 0,
        billingAmountIncTax: 0,
        billingTransport: 0,
        referralFee: 0,
        paymentAmount: payroll.paymentAmount,
        socialInsurance: payroll.socialInsurance,
        employmentInsurance: payroll.employmentInsurance,
        parkingFee: payroll.parkingFee,
        retirementAmount,
        salaryTransport: payroll.salaryTransport,
        totalCostExTax,
        paidLeaveAllowance: payroll.paidLeaveAllowance,
        paidLeaveDays: payroll.paidLeaveDays,
        mergedRowCount: 0,
        mergedOrderNos: [],
        grossProfitExTax: -totalCostExTax,
        // 請求(課税売上)が存在しない給与のみの行のため、税込粗利益も税抜と同額(不課税の原価のみ。税率は掛けない)
        grossProfitIncTax: -totalCostExTax,
        grossProfitRate: 0,
        transportDiff: payroll.salaryTransport,
        transportStatus: 'UNDER_BILLED',
        transportDataAvailable,
        alerts: [
          {
            type: 'UNMATCHED_BILLING',
            severity: 'error',
            message: `給与が発生していますが請求データが存在しません (給与総額: ¥${payroll.paymentAmount.toLocaleString()})`,
          },
        ],
        invoicePrintStatus: 'MISSING_INVOICE',
        billingUnitPrice: 0,
        payUnitPrice: payroll.regularHours > 0 ? payroll.regularAmount / payroll.regularHours : 0,
      });
    }
  });

  // 3. 手入力調整項目(15章)を合成行として追加する。
  // いずれも請求CSV由来の行(既存の契約)に紐付けて按分するのではなく、独立した1行として
  // billingAmountExTax/paymentAmountに金額をそのまま計上する設計にしている。理由:
  // 退職金・駐車場代のように「対象月・スタッフNo」で既存の請求行へ加算する方式だと、
  // 同一スタッフが同月に複数契約を持つ場合に重複計上/未計上のリスクがある(MULTI_CONTRACT_SAME_MONTH
  // アラート参照)うえ、休業分補償のように該当月に請求行自体が存在しないケースもありうるため、
  // 「加算し忘れ・重複加算が絶対に起きない」独立行方式を採用した。この合成行は月次推移・得意先別集計
  // (calculateFiscalYearSummary)にもそのまま合算される(通常の請求行と同じ集計ロジックを流用するため)。
  leaveCompensations.forEach((lc) => {
    const amount = lc.amount || 0;
    const staffName = staffNameLookup.get(lc.staffNo) || lc.staffNo || '（スタッフ未特定）';
    results.push({
      id: `LEAVE_COMP_${lc.id}`,
      targetMonth: lc.targetMonth,
      billingNo: '手入力（休業分補償）',
      staffNo: lc.staffNo,
      staffName,
      clientCode: lc.clientCode || 'MANUAL',
      clientName: lc.clientName || '（クライアント未設定）',
      billingAmountExTax: amount,
      billingAmountIncTax: Math.round(amount * (1 + taxRate)),
      billingTransport: 0,
      referralFee: 0,
      paymentAmount: 0,
      socialInsurance: 0,
      employmentInsurance: 0,
      parkingFee: 0,
      retirementAmount: 0,
      salaryTransport: 0,
      totalCostExTax: 0,
      paidLeaveAllowance: 0,
      paidLeaveDays: 0,
      mergedRowCount: 0,
      mergedOrderNos: [],
      grossProfitExTax: amount,
      grossProfitIncTax: Math.round(amount * (1 + taxRate)),
      grossProfitRate: 0,
      transportDiff: 0,
      transportStatus: 'MATCH',
      transportDataAvailable,
      alerts: [],
      billingUnitPrice: 0,
      payUnitPrice: 0,
      manualEntryType: 'LEAVE_COMPENSATION',
      manualEntryMemo: lc.memo,
    });
  });

  leaveAllowances.forEach((la) => {
    const amount = la.amount || 0;
    const staffName = staffNameLookup.get(la.staffNo) || la.staffNo || '（スタッフ未特定）';
    results.push({
      id: `LEAVE_ALLOW_${la.id}`,
      targetMonth: la.targetMonth,
      billingNo: '手入力（休業手当）',
      staffNo: la.staffNo,
      staffName,
      clientCode: 'N/A',
      clientName: '（手入力：休業手当）',
      billingAmountExTax: 0,
      billingAmountIncTax: 0,
      billingTransport: 0,
      referralFee: 0,
      paymentAmount: amount,
      socialInsurance: 0,
      employmentInsurance: 0,
      parkingFee: 0,
      retirementAmount: 0,
      salaryTransport: 0,
      totalCostExTax: amount,
      paidLeaveAllowance: 0,
      paidLeaveDays: 0,
      mergedRowCount: 0,
      mergedOrderNos: [],
      grossProfitExTax: -amount,
      // 休業手当は給与と同様に不課税のため、税込粗利益も税抜と同額(税率は掛けない)
      grossProfitIncTax: -amount,
      grossProfitRate: 0,
      transportDiff: 0,
      transportStatus: 'MATCH',
      transportDataAvailable,
      alerts: [],
      billingUnitPrice: 0,
      payUnitPrice: 0,
      manualEntryType: 'LEAVE_ALLOWANCE',
      manualEntryMemo: la.memo,
    });
  });

  nextMonthAdjustments.forEach((adj) => {
    const amount = adj.amount || 0;
    const staffName = staffNameLookup.get(adj.staffNo) || adj.staffNo || '（スタッフ未特定）';
    const isSales = adj.side === 'SALES';
    const billingAmountExTax = isSales ? amount : 0;
    const paymentAmount = isSales ? 0 : amount;
    const grossProfitExTax = isSales ? amount : -amount;
    results.push({
      id: `NEXT_MONTH_ADJ_${adj.id}`,
      targetMonth: adj.targetMonth,
      billingNo: `手入力（次月調整・${isSales ? '売上側' : '原価側'}）`,
      staffNo: adj.staffNo,
      staffName,
      clientCode: 'N/A',
      clientName: `（手入力：次月調整・${isSales ? '売上側' : '原価側'}）`,
      billingAmountExTax,
      billingAmountIncTax: Math.round(billingAmountExTax * (1 + taxRate)),
      billingTransport: 0,
      referralFee: 0,
      paymentAmount,
      socialInsurance: 0,
      employmentInsurance: 0,
      parkingFee: 0,
      retirementAmount: 0,
      salaryTransport: 0,
      totalCostExTax: paymentAmount,
      paidLeaveAllowance: 0,
      paidLeaveDays: 0,
      mergedRowCount: 0,
      mergedOrderNos: [],
      grossProfitExTax,
      // 売上側(SALES)は課税のため税率を掛けるが、原価側(COST)は給与相当の調整で不課税のため
      // 税率を掛けない(★2026-08-26修正。旧実装はCOST側にも一律で税率を掛けていた)
      grossProfitIncTax: isSales ? Math.round(amount * (1 + taxRate)) : -amount,
      grossProfitRate: 0,
      transportDiff: 0,
      transportStatus: 'MATCH',
      transportDataAvailable,
      alerts: [],
      billingUnitPrice: 0,
      payUnitPrice: 0,
      manualEntryType: isSales ? 'NEXT_MONTH_ADJUSTMENT_SALES' : 'NEXT_MONTH_ADJUSTMENT_COST',
      manualEntryMemo: adj.memo,
    });
  });

  return results.sort((a, b) => {
    if (a.targetMonth !== b.targetMonth) return a.targetMonth.localeCompare(b.targetMonth);
    return a.staffNo.localeCompare(b.staffNo);
  });
}

/**
 * 決算期別 (年間) 集計計算関数
 * 4月〜翌3月等の決算期単位で集計と数値検証を実行
 */
export function calculateFiscalYearSummary(
  results: GrossProfitResult[],
  payrolls: PayrollRow[] = [],
  startFiscalMonth: string = getDefaultFiscalYearStart(),
  monthsCount: number = 12
): FiscalYearSummary {
  // 年月リストを生成 (例: 2026-04 から 12か月分)
  const targetMonths = getFiscalYearMonths(startFiscalMonth, monthsCount);
  const [startYearStr] = startFiscalMonth.split('-');

  // 対象期間にフィルタリング
  const periodResults = results.filter((r) => targetMonths.includes(r.targetMonth));
  // 有給金額・有給日数は給与CSVの行(1スタッフ1ヶ月1行、11-5章参照)から直接単純合計する。
  // 運用者確認・実データ検算済み(2026-08-21): 有給金額(決算期合計)=Σ有給手当、有給(日)(決算期合計)=Σ有給日数
  // (対象期間の全給与行の単純合計)。billing側の結合結果を経由しないため、同月複数契約による
  // 重複計上の心配がない(給与CSV自体がスタッフ×月で一意なため)。
  const periodPayrolls = payrolls.filter((p) => targetMonths.includes(p.targetMonth));

  let totalSalesExTax = 0;
  let totalReferralFee = 0;
  let totalSalary = 0;
  let totalSocialInsurance = 0;
  let totalEmploymentInsurance = 0;
  let totalParkingFee = 0;
  let totalRetirement = 0;
  let totalLeaveCompensation = 0;
  let totalLeaveAllowance = 0;
  let totalNextMonthAdjustmentSales = 0;
  let totalNextMonthAdjustmentCost = 0;
  let totalGrossProfit = 0;
  let totalGrossProfitIncTax = 0;
  let totalRevenueIncTax = 0;
  let totalTransportSalary = 0;
  let totalTransportBilling = 0;
  let totalPaidLeaveAmount = 0;
  let totalPaidLeaveDays = 0;
  let totalBillingUnitPrice = 0;
  let totalPayUnitPrice = 0;
  let alertCount = 0;

  const staffSet = new Set<string>();
  const clientMap = new Map<string, ClientRanking>();
  // ★2026-08-27追加(22章タスク3): クライアント別・名目粗利率(契約単価の単純合計ベース)算出用に、
  // クライアントごとの請求＠(billingUnitPrice)・支払＠(payUnitPrice)合計、および月次内訳を集計する。
  const clientUnitPriceTotals = new Map<string, { billingUnitPriceSum: number; payUnitPriceSum: number }>();
  const clientMonthlyUnitPrice = new Map<string, Map<string, { billingUnitPriceSum: number; payUnitPriceSum: number }>>();

  // 月別マップ初期化
  const monthlyMap = new Map<string, MonthlyTrend>();
  targetMonths.forEach((m) => {
    monthlyMap.set(m, {
      month: m,
      dispatchSales: 0,
      referralSales: 0,
      totalSales: 0,
      cost: 0,
      grossProfit: 0,
      grossMarginRate: 0,
      transportDiff: 0,
      paidLeaveAmount: 0,
      paidLeaveDays: 0,
      billingUnitPriceSum: 0,
      payUnitPriceSum: 0,
      alertCount: 0,
      socialInsurance: 0,
      employmentInsurance: 0,
      transportSalary: 0,
    });
  });

  periodResults.forEach((r) => {
    totalSalesExTax += r.billingAmountExTax;
    totalReferralFee += r.referralFee;
    totalSalary += r.paymentAmount;
    totalSocialInsurance += r.socialInsurance;
    totalEmploymentInsurance += r.employmentInsurance;
    totalParkingFee += r.parkingFee;
    totalRetirement += r.retirementAmount;
    // 15章: 手入力調整項目の内訳集計 (totalSalesExTax/totalSalary/totalGrossProfitには
    // 既に合成行として算入済みなので、ここでは検算・参考表示用に種類別内訳を別途積み上げるだけ)
    if (r.manualEntryType === 'LEAVE_COMPENSATION') totalLeaveCompensation += r.billingAmountExTax;
    if (r.manualEntryType === 'LEAVE_ALLOWANCE') totalLeaveAllowance += r.paymentAmount;
    if (r.manualEntryType === 'NEXT_MONTH_ADJUSTMENT_SALES') totalNextMonthAdjustmentSales += r.billingAmountExTax;
    if (r.manualEntryType === 'NEXT_MONTH_ADJUSTMENT_COST') totalNextMonthAdjustmentCost += r.paymentAmount;
    totalGrossProfit += r.grossProfitExTax;
    // 税込ベースの集計 (★2026-08-26追加。消費税率設定を決算期集計にも反映させるため)
    totalGrossProfitIncTax += r.grossProfitIncTax;
    totalRevenueIncTax += r.billingAmountIncTax;
    totalTransportSalary += r.salaryTransport;
    totalTransportBilling += r.billingTransport;
    // 請求＠ (大阪人材集計シート方式: 契約ごとの請求単価の単純合計。重み付けしない)
    totalBillingUnitPrice += r.billingUnitPrice;
    // 支払＠ (同じく単純合計。時間内時間0の行は0が入っているため自動的に寄与しない)
    totalPayUnitPrice += r.payUnitPrice;
    // ★2026-08-26修正: info severity(社保負担額の差異検出など、参考ログ)を除いた
    // warning/error件数のみを「要確認アラート数」としてカウントする(hasActionableAlerts参照)
    alertCount += countActionableAlerts(r.alerts);

    if (r.staffNo && r.staffNo !== 'N/A') {
      staffSet.add(r.staffNo);
    }

    // クライアント集計
    if (r.clientCode && r.clientCode !== 'N/A') {
      const existing = clientMap.get(r.clientCode) || {
        clientCode: r.clientCode,
        clientName: r.clientName,
        totalSales: 0,
        totalGrossProfit: 0,
        grossMarginRate: 0,
        staffCount: 0,
        nominalGrossMarginRate: 0,
        nominalGrossMarginRateDataAvailable: false,
        monthlyNominalMarginTrend: [],
      };
      existing.totalSales += r.billingAmountExTax;
      existing.totalGrossProfit += r.grossProfitExTax;
      existing.staffCount += 1;
      existing.grossMarginRate =
        existing.totalSales > 0
          ? Number(((existing.totalGrossProfit / existing.totalSales) * 100).toFixed(2))
          : 0;
      clientMap.set(r.clientCode, existing);

      // 名目粗利率(契約単価の単純合計ベース)算出用の請求＠・支払＠集計(全期間・月次の両方)
      const unitTotals = clientUnitPriceTotals.get(r.clientCode) || { billingUnitPriceSum: 0, payUnitPriceSum: 0 };
      unitTotals.billingUnitPriceSum += r.billingUnitPrice;
      unitTotals.payUnitPriceSum += r.payUnitPrice;
      clientUnitPriceTotals.set(r.clientCode, unitTotals);

      const monthlyForClient = clientMonthlyUnitPrice.get(r.clientCode) || new Map();
      const monthTotals = monthlyForClient.get(r.targetMonth) || { billingUnitPriceSum: 0, payUnitPriceSum: 0 };
      monthTotals.billingUnitPriceSum += r.billingUnitPrice;
      monthTotals.payUnitPriceSum += r.payUnitPrice;
      monthlyForClient.set(r.targetMonth, monthTotals);
      clientMonthlyUnitPrice.set(r.clientCode, monthlyForClient);
    }

    // 月別推移集計
    const mTrend = monthlyMap.get(r.targetMonth);
    if (mTrend) {
      mTrend.dispatchSales += r.billingAmountExTax;
      mTrend.referralSales += r.referralFee;
      mTrend.totalSales += r.billingAmountExTax + r.referralFee;
      mTrend.cost += r.totalCostExTax;
      mTrend.grossProfit += r.grossProfitExTax;
      mTrend.transportDiff += r.transportDiff;
      mTrend.billingUnitPriceSum += r.billingUnitPrice;
      mTrend.payUnitPriceSum += r.payUnitPrice;
      mTrend.alertCount += countActionableAlerts(r.alerts);
      // ★2026-08-27追加(22章タスク2): 自社負担コスト(雇用保険・社会保険・交通費)の月次内訳
      mTrend.socialInsurance += r.socialInsurance;
      mTrend.employmentInsurance += r.employmentInsurance;
      mTrend.transportSalary += r.salaryTransport;
      mTrend.grossMarginRate =
        mTrend.dispatchSales > 0
          ? Number(((mTrend.grossProfit / mTrend.dispatchSales) * 100).toFixed(2))
          : 0;
    }
  });

  // クライアントごとの名目粗利率(全期間)・月次推移を確定する
  clientMap.forEach((client, clientCode) => {
    const totals = clientUnitPriceTotals.get(clientCode);
    if (totals && totals.billingUnitPriceSum > 0) {
      client.nominalGrossMarginRateDataAvailable = true;
      client.nominalGrossMarginRate = Number(
        ((1 - totals.payUnitPriceSum / totals.billingUnitPriceSum) * 100).toFixed(2)
      );
    }
    const monthlyForClient = clientMonthlyUnitPrice.get(clientCode);
    client.monthlyNominalMarginTrend = targetMonths.map((m) => {
      const agg = monthlyForClient?.get(m);
      if (!agg || agg.billingUnitPriceSum <= 0) {
        return { month: m, nominalGrossMarginRate: 0, dataAvailable: false };
      }
      return {
        month: m,
        nominalGrossMarginRate: Number(((1 - agg.payUnitPriceSum / agg.billingUnitPriceSum) * 100).toFixed(2)),
        dataAvailable: true,
      };
    });
  });

  // 有給金額・有給(日) (決算期合計) = 対象期間の全給与行の単純合計(上記コメント参照)
  // ★2026-09-02修正(スタッフ給与明細バグ報告): 前月集計漏れの手入力等で「有休手当」列
  // (paidLeaveAllowance2)に金額が計上されているケースが「有給手当」(paidLeaveAllowance)
  // だけを見ていると集計から漏れてしまっていたため、両方を合算するようにした。
  periodPayrolls.forEach((p) => {
    const paidLeaveAmount = (p.paidLeaveAllowance || 0) + (p.paidLeaveAllowance2 || 0);
    totalPaidLeaveAmount += paidLeaveAmount;
    totalPaidLeaveDays += p.paidLeaveDays || 0;

    const mTrend = monthlyMap.get(p.targetMonth);
    if (mTrend) {
      mTrend.paidLeaveAmount += paidLeaveAmount;
      mTrend.paidLeaveDays += p.paidLeaveDays || 0;
    }
  });

  // ★2026-08-27追加(22章タスク2): 有給残日数アラート用。
  // 「有給残日数」は月ごとの残高(累積値)であり、対象期間の全月を単純合計すると二重計上になるため、
  // スタッフごとに対象期間内で最も新しい対象月の値だけを採用する。
  const latestPayrollByStaff = new Map<string, PayrollRow>();
  periodPayrolls.forEach((p) => {
    if (!p.staffNo) return;
    const existing = latestPayrollByStaff.get(p.staffNo);
    if (!existing || p.targetMonth > existing.targetMonth) {
      latestPayrollByStaff.set(p.staffNo, p);
    }
  });
  const staffPaidLeaveBalances: FiscalYearSummary['staffPaidLeaveBalances'] = [];
  latestPayrollByStaff.forEach((p) => {
    staffPaidLeaveBalances.push({
      staffNo: p.staffNo,
      staffName: p.staffName,
      targetMonth: p.targetMonth,
      paidLeaveRemainingDays: p.paidLeaveRemainingDays ?? 0,
    });
  });
  staffPaidLeaveBalances.sort((a, b) => b.paidLeaveRemainingDays - a.paidLeaveRemainingDays);
  // 有給取得率(%相当の平均値) = 有給取得日数合計 ÷ スタッフ人数 (=avgPaidLeaveDaysPerStaffと同一定義)。
  // ★2026-08-27修正(22-5・22-7章): 当初「取得日数÷(取得日数+有給残日数)」という消化率の
  // 近似式で実装していたが、運用者確認の結果「有給残日数はスタッフの有給管理上それ自体が
  // 正確さを求められる数値であり、他の値と組み合わせて近似的な指標を作る材料には使わない」
  // 方針となったため、有給残日数を一切使わない実績値のみの定義(22-2の当初依頼どおり)に戻した。
  // 有給残日数そのもの(staffPaidLeaveBalances・アラート機能)は従来どおり使用する。
  const paidLeaveUtilizationRateDataAvailable = staffSet.size > 0;
  const paidLeaveUtilizationRate =
    staffSet.size > 0 ? Number((totalPaidLeaveDays / staffSet.size).toFixed(2)) : 0;

  // ★2026-08-27追加(22章タスク2)。★2026-08-27修正(22-5・22-7章): 当初「スタッフ区分」列の
  // 文字列に「退職」を含むかで判定していたが、運用者が実データを確認した結果そのような
  // 文字列は出現しないことが判明した(常に離職率0%になるバグ)。21-5の当初設計どおり、
  // スタッフ区分の内容には依存しない「在籍有無ベース」に戻す: ある月の給与CSVに
  // 存在した(=在籍していた)スタッフNoが、対象期間内の以降のどの月の給与CSVにも
  // 現れなくなった割合を算出する。新規のCSV取り込みは不要(既存の給与CSVの蓄積のみで算出可能)。
  const monthsWithPayrollData = targetMonths.filter((m) => periodPayrolls.some((p) => p.targetMonth === m));
  const activeStaffByMonth = new Map<string, Set<string>>();
  monthsWithPayrollData.forEach((m) => activeStaffByMonth.set(m, new Set()));
  periodPayrolls.forEach((p) => {
    if (!p.staffNo) return;
    activeStaffByMonth.get(p.targetMonth)?.add(p.staffNo);
  });
  let turnoverBase = 0;
  let turnoverLeavers = 0;
  for (let i = 0; i < monthsWithPayrollData.length - 1; i++) {
    const base = activeStaffByMonth.get(monthsWithPayrollData[i])!;
    const laterUnion = new Set<string>();
    for (let j = i + 1; j < monthsWithPayrollData.length; j++) {
      activeStaffByMonth.get(monthsWithPayrollData[j])!.forEach((s) => laterUnion.add(s));
    }
    base.forEach((staffNo) => {
      turnoverBase += 1;
      if (!laterUnion.has(staffNo)) turnoverLeavers += 1;
    });
  }
  const turnoverRateDataAvailable = monthsWithPayrollData.length >= 2 && turnoverBase > 0;
  const turnoverRate = turnoverBase > 0 ? Number(((turnoverLeavers / turnoverBase) * 100).toFixed(2)) : 0;

  const totalRevenueExTax = totalSalesExTax + totalReferralFee;
  const totalCostExTax = totalSalary + totalSocialInsurance + totalParkingFee + totalRetirement;
  const overallGrossMarginRate =
    totalSalesExTax > 0 ? Number(((totalGrossProfit / totalSalesExTax) * 100).toFixed(2)) : 0;
  const avgPaidLeaveDaysPerStaff =
    staffSet.size > 0 ? Number((totalPaidLeaveDays / staffSet.size).toFixed(2)) : 0;
  // 請求書印刷CSVが1件も読み込まれていない(=単価データが1件もない)場合はfalseにし、
  // UI側で「0円」と「データなし」を区別できるようにする
  const billingUnitPriceDataAvailable = periodResults.some((r) => r.billingUnitPrice > 0);
  // 給与CSVに時間内時間データが1件も無い場合はfalse
  const payUnitPriceDataAvailable = periodResults.some((r) => r.payUnitPrice > 0);
  // 名目粗利率(%) = 1 - 支払＠/請求＠ (大阪人材集計シートK列と同一定義)
  const nominalGrossMarginRate =
    totalBillingUnitPrice > 0
      ? Number(((1 - totalPayUnitPrice / totalBillingUnitPrice) * 100).toFixed(2))
      : 0;

  const monthlyTrends = Array.from(monthlyMap.values());
  const clientRankings = Array.from(clientMap.values()).sort(
    (a, b) => b.totalGrossProfit - a.totalGrossProfit
  );

  return {
    fiscalYear: parseInt(startYearStr, 10),
    startMonth: targetMonths[0],
    endMonth: targetMonths[targetMonths.length - 1],
    totalSalesExTax,
    totalReferralFee,
    totalRevenueExTax,
    totalSalary,
    totalSocialInsurance,
    totalEmploymentInsurance,
    totalParkingFee,
    totalRetirement,
    totalCostExTax,
    totalLeaveCompensation,
    totalLeaveAllowance,
    totalNextMonthAdjustmentSales,
    totalNextMonthAdjustmentCost,
    totalGrossProfit,
    totalGrossProfitIncTax,
    totalRevenueIncTax,
    overallGrossMarginRate,
    totalTransportSalary,
    totalTransportBilling,
    totalTransportDiff: totalTransportSalary - totalTransportBilling,
    totalPaidLeaveAmount,
    totalPaidLeaveDays,
    avgPaidLeaveDaysPerStaff,
    avgPaidLeaveAmountPerStaff:
      staffSet.size > 0 ? Number((totalPaidLeaveAmount / staffSet.size).toFixed(2)) : 0,
    paidLeaveUtilizationRate,
    paidLeaveUtilizationRateDataAvailable,
    staffPaidLeaveBalances,
    turnoverRate,
    turnoverRateDataAvailable,
    totalBillingUnitPrice,
    billingUnitPriceDataAvailable,
    totalPayUnitPrice,
    payUnitPriceDataAvailable,
    nominalGrossMarginRate,
    activeStaffCount: staffSet.size,
    totalBillingCount: periodResults.length,
    alertCount,
    monthlyTrends,
    clientRankings,
  };
}
