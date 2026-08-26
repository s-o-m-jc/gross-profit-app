/**
 * 派遣事業 粗利・経理管理システム
 * CSVパース & 実データ準拠ヘッダーマッピング
 *
 * 2026-08-20: 実サンプルCSV(請求支払一覧・未払計上表)で検証した結果、
 * 旧来の緩い正規表現マッチングは実列名（半角カナ・「クライアント番号」等）に
 * 対応できていなかったため、NFKC正規化 + 候補名リストによる完全一致優先の
 * マッチング方式に全面書き直し。
 */

import Papa from 'papaparse';
import { PayrollRow, BillingRow, InvoicePrintRow, RetirementRow } from '../types';

/**
 * 数値文字列を安全にパース (カンマ除去, null/undefined/空文字処理)
 */
function parseSafeNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).replace(/,/g, '').trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * 文字列トリム
 */
function parseSafeString(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * ヘッダー名の正規化。
 * 実データのスタッフナビ出力は列名が半角カナ(例: "ｽﾀｯﾌ番号")のことがあり、
 * 全角前提の候補名と一致しない問題があった。
 * NFKC正規化で半角カナ→全角カナに変換した上で比較する。
 */
function normalizeHeader(key: string): string {
  return String(key).normalize('NFKC').trim();
}

/**
 * 候補名リストに対して、正規化ヘッダーの完全一致を優先し、
 * 見つからなければ部分一致にフォールバックして列キーを探す。
 * (旧実装の「最初にマッチした列を拾う」方式は「交通費」が複数列にマッチする等の
 *  誤爆があったため、完全一致を優先することで実データの列名ゆらぎに対応する)
 */
function findColumnKey(row: Record<string, any>, candidates: string[]): string {
  const entries = Object.keys(row).map((orig) => ({ orig, norm: normalizeHeader(orig) }));

  for (const candidate of candidates) {
    const hit = entries.find((e) => e.norm === candidate);
    if (hit) return hit.orig;
  }
  for (const candidate of candidates) {
    const hit = entries.find((e) => e.norm.includes(candidate));
    if (hit) return hit.orig;
  }
  return '';
}

/**
 * 年月フォーマット正規化 ('2026/04' -> '2026-04', '202604' -> '2026-04')
 */
function normalizeMonth(val: string): string {
  const s = parseSafeString(val).replace(/\//g, '-');
  if (/^\d{4}-\d{1,2}$/.test(s)) {
    const [y, m] = s.split('-');
    return `${y}-${m.padStart(2, '0')}`;
  }
  if (/^\d{6}$/.test(s)) return `${s.substring(0, 4)}-${s.substring(4, 6)}`;
  return s;
}

/**
 * ファイル名から対象年月を抽出する (例: "請求支払一覧_202410.csv" -> "2026-10"改め"2024-10")
 * 請求支払一覧CSVには対象年月を表す列が存在しないため、運用者確認によりファイル名を正とする。
 */
function extractMonthFromFileName(fileName?: string): string {
  if (!fileName) return '';
  const m = fileName.match(/(\d{4})[-_]?(\d{2})(?!\d)/);
  if (!m) return '';
  const year = m[1];
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return '';
  return `${year}-${m[2]}`;
}

/**
 * 給与CSVの「支給日」から対象年月を算出する。
 * 運用者確認: 給与は末締め・翌月15日払いのため、対象月 = 支給日の前月。
 * (例: 支給日 2024-11-15 -> 対象年月 2024-10)
 */
function deriveTargetMonthFromPayDate(payDateStr: string): string {
  const datePart = parseSafeString(payDateStr).split(/[ T]/)[0];
  const m = datePart.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '';
  let year = parseInt(m[1], 10);
  let month = parseInt(m[2], 10) - 1; // 前月にずらす
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${month < 10 ? `0${month}` : month}`;
}

/**
 * 給与CSVの時間列("164:30"のようなH:MM形式、24時間を超えることがある)を10進の時間数に変換する。
 * 支払＠(支払単価) = 時間内(金額) ÷ 時間内時間 の算出に使用する(運用者確認・実データ検算済み)。
 */
function parseHoursMinutesToDecimal(val: any): number {
  const s = parseSafeString(val);
  if (!s) return 0;
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) {
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    return hours + minutes / 60;
  }
  // H:MM形式でない場合のフォールバック(念のため数値としてそのまま解釈)
  return parseSafeNumber(s);
}

/**
 * 給与CSVのパース (未払計上表 / 給与計算書印刷CSV)
 * @param fileName 対象年月がCSV内から取得できない場合のフォールバック用
 */
export function parsePayrollCsv(csvText: string, fileName?: string): PayrollRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  return parsed.data
    .map((row) => {
      const staffNoKey = findColumnKey(row, ['スタッフ番号', 'スタッフNo', 'スタッフID', '社員番号']);
      const nameKey = findColumnKey(row, ['スタッフ氏名', '氏名', 'スタッフ名', '名前']);
      const payDateKey = findColumnKey(row, ['支給日']);
      const monthKey = findColumnKey(row, ['対象年月', '年月']);
      const payKey = findColumnKey(row, ['総支給額', '給与支給総額', '支給総額', '支給額']);
      const socialKey = findColumnKey(row, ['社保合計', '社会保険', '健康保険']);
      const empInsKey = findColumnKey(row, ['雇用保険']);
      const parkingKey = findColumnKey(row, ['駐車場手当', '駐車場代', '駐車場']);
      const transport1Key = findColumnKey(row, ['交通費1']);
      const transport2Key = findColumnKey(row, ['交通費2']);
      const transportFallbackKey = findColumnKey(row, ['交通費', '通勤手当']);
      // ★2026-08-21確定: 本物のスタッフナビCSV(未払計上表_202410.csv)では、交通費列が
      // 「交通費1」「交通費2」ではなく、同名の「交通費」列が2つ存在する形で出力される。
      // CSVパーサー(papaparse)は同名ヘッダーを自動検出し、2列目以降を「交通費_1」のように
      // リネームするため、その2列目をこのキーで拾って合算する。
      const transportDupKey = findColumnKey(row, ['交通費_1']);
      const paidLeaveAllowanceKey = findColumnKey(row, ['有給手当']);
      const paidLeaveDaysKey = findColumnKey(row, ['有給日数']);
      // 支払＠(支払単価)算出用。運用者確認・実データ検算済み(2026-08-21): 賃金台帳CSVは
      // 給与計算CSVと列構成が完全に同一のため、このCSVから直接取得できる。
      // ★2026-08-21確定: 金額列は「時間内」で確定(候補'基本'は削除済み)。以前「基本」列名の
      // 実データがあるように見えたのは、検証用サンプルファイル生成時の誤りだったと判明した
      // (本物のスタッフナビCSVエクスポートでは一貫して「時間内」)。
      const regularAmountKey = findColumnKey(row, ['時間内']);
      const regularHoursKey = findColumnKey(row, ['時間内時間']);

      const payDate = parseSafeString(row[payDateKey]);

      // 対象年月: (1)支給日から算出 → (2)列があれば列 → (3)ファイル名 の優先順
      let targetMonth = deriveTargetMonthFromPayDate(payDate);
      if (!targetMonth && monthKey) targetMonth = normalizeMonth(row[monthKey]);
      if (!targetMonth) targetMonth = extractMonthFromFileName(fileName);

      // 交通費: 交通費1+交通費2の合算ルール (6章・確定済み)
      // ★2026-08-21確定: 懸念していた「3章の20日締重複行統合ロジックとの干渉」は、
      // 11-5章の通り給与CSV(未払計上表)は1スタッフ・1ヶ月につき常に1行のみで行の
      // 重複が発生しないため、実際には起こり得ないケースだった。交通費1・交通費2は
      // 同一行内の2列にすぎず、行の重複統合とは無関係に常に安全に合算できる。
      // 実データ確認(未払計上表_202410.csv, 82件): 交通費1は全件0円、交通費2に70件の
      // 実額が入っており、両方に値が入っているケースは0件(単純合算で問題なし)。
      // ★2026-08-21追記: 本物のスタッフナビCSV(253行)では「交通費1/交通費2」ではなく、
      // 同名「交通費」列が2つ(papaparseリネーム後は「交通費」「交通費_1」)出力される
      // 別パターンも確認。この場合も同じ「2列を合算」ルールを適用する。
      const salaryTransport =
        transport1Key || transport2Key
          ? parseSafeNumber(row[transport1Key]) + parseSafeNumber(row[transport2Key])
          : transportDupKey
          ? parseSafeNumber(row[transportFallbackKey]) + parseSafeNumber(row[transportDupKey])
          : parseSafeNumber(row[transportFallbackKey]);

      return {
        targetMonth,
        staffNo: parseSafeString(row[staffNoKey]),
        staffName: parseSafeString(row[nameKey]),
        paymentAmount: parseSafeNumber(row[payKey]),
        socialInsurance: parseSafeNumber(row[socialKey]),
        employmentInsurance: parseSafeNumber(row[empInsKey]),
        parkingFee: parseSafeNumber(row[parkingKey]),
        salaryTransport,
        paidLeaveAllowance: parseSafeNumber(row[paidLeaveAllowanceKey]),
        paidLeaveDays: parseSafeNumber(row[paidLeaveDaysKey]),
        regularAmount: parseSafeNumber(row[regularAmountKey]),
        regularHours: parseHoursMinutesToDecimal(row[regularHoursKey]),
        payDate: payDate || undefined,
        remarks: row['備考'] || row['Remarks'] || '',
      };
    })
    .filter((r) => r.staffNo);
}

/**
 * 請求CSVのパース (請求支払一覧表印刷CSV)
 * @param fileName 対象年月の取得元。このCSVには対象年月の列が存在しないため必須に近い。
 */
export function parseBillingCsv(csvText: string, fileName?: string): BillingRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const monthFromFileName = extractMonthFromFileName(fileName);

  return parsed.data
    .map((row) => {
      const billingNoKey = findColumnKey(row, ['請求No', '請求番号']);
      const monthKey = findColumnKey(row, ['対象年月', '年月']);
      const staffNoKey = findColumnKey(row, ['スタッフNo', 'スタッフ番号', '社員番号']);
      const nameKey = findColumnKey(row, ['スタッフ氏名', 'スタッフ名', '氏名']);
      const clientCodeKey = findColumnKey(row, ['クライアント番号', '派遣先コード', '得意先コード']);
      const clientNameKey = findColumnKey(row, ['クライアント名称', '派遣先名', '得意先名', '企業名']);
      const orderNoKey = findColumnKey(row, ['受注番号']);
      const orderNameKey = findColumnKey(row, ['受注名称']);
      const billAmountKey = findColumnKey(row, ['請求額', '請求金額', '売上額']);
      const paymentAmountKey = findColumnKey(row, ['支払額']);
      const socialInsuranceKey = findColumnKey(row, ['社保負担額', '社保他']);
      const paidLeaveDaysUsedKey = findColumnKey(row, ['有給使用日数', '有休日数', '有給日数']);
      const transportKey = findColumnKey(row, ['請求交通費', 'うち交通費請求', '交通費']);
      const referralKey = findColumnKey(row, ['紹介手数料', '紹介料']);
      const hoursKey = findColumnKey(row, ['稼働時間', '労働時間']);
      const priceKey = findColumnKey(row, ['請求単価', '契約単価', '単価']);

      // 対象年月: (1)列があれば列 → (2)ファイル名 の優先順
      const targetMonth = monthKey ? normalizeMonth(row[monthKey]) : monthFromFileName;

      return {
        billingNo: parseSafeString(row[billingNoKey]),
        targetMonth,
        staffNo: parseSafeString(row[staffNoKey]),
        staffName: parseSafeString(row[nameKey]),
        clientCode: parseSafeString(row[clientCodeKey]) || 'CLIENT_DEF',
        clientName: parseSafeString(row[clientNameKey]) || '派遣先企業',
        orderNo: parseSafeString(row[orderNoKey]),
        orderName: parseSafeString(row[orderNameKey]),
        billingAmountExTax: parseSafeNumber(row[billAmountKey]),
        paymentAmount: parseSafeNumber(row[paymentAmountKey]),
        socialInsuranceBilling: parseSafeNumber(row[socialInsuranceKey]),
        paidLeaveDaysUsed: parseSafeNumber(row[paidLeaveDaysUsedKey]),
        billingTransport: parseSafeNumber(row[transportKey]),
        referralFee: parseSafeNumber(row[referralKey]),
        workHours: parseSafeNumber(row[hoursKey]),
        unitPrice: parseSafeNumber(row[priceKey]),
      };
    })
    .filter((r) => r.billingNo || r.staffNo);
}

/**
 * 請求書印刷CSVのパース
 *
 * 2026-08-21: 実データ(かこ.csv形式)で確認したところ、このCSVには「時間内−単価」列
 * (契約の請求単価。区切り文字は全角ハイフンではなくU+2212のマイナス記号「−」なので
 *  NFKC正規化しても半角ハイフンには変換されない。候補名は原文ママで指定する)が
 * 含まれている。請求支払一覧CSVには単価列が存在しない(要件整理11-3)ため、
 * 請求＠(大阪人材の集計シート方式)の算出にはこちらの列を使う。
 *
 * ★2026-08-21追加: 対象年月はこのCSV自体には列が無いため、請求支払一覧CSVと同じく
 * 11-2章のルール(ファイル名由来)を適用してfileNameから抽出する。複数月データ蓄積
 * アーキテクチャで、請求書印刷データも月バケツに分けて保持できるようにするために必要。
 * @param fileName 対象年月の取得元(例: 請求書印刷202410_15日締.csv)
 */
export function parseInvoicePrintCsv(csvText: string, fileName?: string): InvoicePrintRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const monthFromFileName = extractMonthFromFileName(fileName);

  return parsed.data
    .map((row) => {
      const billingNoKey = findColumnKey(row, ['請求No', '請求番号']);
      const monthKey = findColumnKey(row, ['対象年月', '年月']);
      const issueDateKey = findColumnKey(row, ['発行日', '印刷日']);
      const dueDateKey = findColumnKey(row, ['振込予定日', '支払期日']);
      const printKey = findColumnKey(row, ['印刷ステータス', '印刷済']);
      const sentKey = findColumnKey(row, ['送付ステータス', '送付']);
      const unitPriceKey = findColumnKey(row, ['時間内−単価', '請求単価']);

      const printVal = parseSafeString(row[printKey]);
      let printStatus: InvoicePrintRow['printStatus'] = '印刷済';
      if (printVal.includes('未')) printStatus = '未印刷';
      else if (printVal.includes('再')) printStatus = '再発行';

      const sentStatus: '送付済' | '未送付' = parseSafeString(row[sentKey]).includes('未') ? '未送付' : '送付済';

      // 対象年月: (1)列があれば列 → (2)ファイル名 の優先順(請求支払一覧CSVと同じ優先順位)
      const targetMonth = monthKey ? normalizeMonth(row[monthKey]) : monthFromFileName;

      return {
        billingNo: parseSafeString(row[billingNoKey]),
        targetMonth,
        invoiceIssueDate: parseSafeString(row[issueDateKey]),
        paymentDueDate: parseSafeString(row[dueDateKey]),
        printStatus,
        sentStatus,
        unitPrice: parseSafeNumber(row[unitPriceKey]),
      };
    })
    .filter((r) => r.billingNo);
}

/**
 * 退職金CSVのパース
 */
export function parseRetirementCsv(csvText: string): RetirementRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  return parsed.data
    .map((row) => {
      const monthKey = findColumnKey(row, ['対象年月', '年月']);
      const staffNoKey = findColumnKey(row, ['スタッフNo', 'スタッフ番号', '社員番号']);
      const amountKey = findColumnKey(row, ['退職金配賦額', '退職金', '配賦額']);

      return {
        targetMonth: normalizeMonth(row[monthKey]),
        staffNo: parseSafeString(row[staffNoKey]),
        retirementAmount: parseSafeNumber(row[amountKey]),
        memo: row['備考'] || '',
      };
    })
    .filter((r) => r.staffNo && r.targetMonth);
}
