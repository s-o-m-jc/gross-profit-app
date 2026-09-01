/**
 * 派遣事業 粗利・経理管理システム
 * 過去実績Excel取り込み (フェーズ2、要件整理16章・18-3章)
 *
 * 四国・松山の過去分(スタナビCSV取り込み以前の期間)は、拠点担当者が独自にまとめてきた
 * Excelファイル(★派遣明細YYYYMM.xlsm / ★YYMM勤怠明細票 時間計算.xlsm)として既に存在する。
 * このモジュールは、そのExcelファイルの中の決まったシートを読み取り、既存のCSV取り込み
 * パイプライン(csvParser.ts)と同じ PayrollRow[] / BillingRow[] を組み立てる。
 *
 * 設計方針(16-6章で確定): 各シートの「完成された集計値(粗利額・粗利率)」をそのまま
 * 信用するのではなく、給与側データ(未払計上表シート = 生の給与計算CSV)と
 * 請求側データ(松山=請求支払一覧シート、四国=実績加工シート)を組み合わせ、
 * 今後の月と全く同じ計算エンジン(calculateGrossProfit)に通す。これにより、
 * 粗利計算式を二重に実装・保守する必要がなくなる。
 *
 * 実データ(2026-09-01、運用者PC上の実ファイルで直接検証済み)での確認結果:
 * - 松山(★派遣明細202410.xlsm): 「未払計上表」シート(12行目がヘッダー、現行CSV取込と
 *   全く同じ列構成) + 「請求支払一覧」シート(16行目がヘッダー。列名が現行のparseBillingCsv
 *   の候補名とそのまま一致するため、変更せず再利用できる)。
 *   ※要件整理16-4章では「売上実績表」シート(8行目ヘッダー)を使う想定だったが、
 *   実ファイルにはこの「請求支払一覧」シートも存在し、既存パーサーの候補名と完全一致する
 *   ためこちらを採用する(受注番号・請求Noも持っており、20日締め等の統合処理にも対応できる)。
 * - 四国(★2410勤怠明細票 時間計算.xlsm): 「未払計上表」シート(10行目がヘッダー) +
 *   「実績加工」シート(25行目がヘッダー)。実績加工シートは同じ列名(スタッフ番号/スタッフ氏名/
 *   請求額/社保負担額 等)がシート内に複数ブロック重複して存在するため、列名ベースではなく
 *   列位置(0始まりインデックス)で直接読み取る。粗利益・実質粗利率・有給関連の列は無いため、
 *   計算エンジン側で算出する(有給は未払計上表シート由来のPayrollRow.paidLeaveDaysで担保)。
 */

import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { PayrollRow, BillingRow } from '../types';
import { parsePayrollCsv, parseBillingCsv } from './csvParser';

// 未払計上表シートの「時間」列(H:MM形式で24時間を超えうる、[h]:mm書式のExcelセル)。
// Excel上はこれらのセルは「1日を1.0とする経過日数」の実数として保存されている
// (raw:trueで読むと175:30 → 7.3125 のような値になる)ため、csvParser.tsの
// parseHoursMinutesToDecimal(H:MM形式の文字列を想定)にそのまま渡せない。
// 実データで検証済み: raw値 × 24 = 10進の時間数(この例では175.5)。
// ここで数値化してからCSV化することで、既存のparsePayrollCsvをそのまま再利用できるようにする。
const PAYROLL_HOUR_COLUMNS = new Set([
  '時間内時間',
  '時間外時間',
  '深夜内時間',
  '深夜外時間',
  '休日出時間',
  'その他時間外',
  '有給時間',
  '遅早',
  '有給残時間',
]);

const PAYROLL_DATE_COLUMNS = new Set(['支給日']);

/**
 * Excel由来のセル値(raw:true読み取り)を、csvParser.ts側のパーサーが期待するテキストに変換する。
 * - 時間列: 経過日数の実数 → 10進の時間数(文字列)
 * - 日付列: Excelのシリアル値 → "YYYY-MM-DD"文字列
 * - それ以外: そのまま(数値 or 文字列)
 */
function normalizePayrollCellForColumn(headerName: string, value: any): any {
  if (value === null || value === undefined || value === '') return value;
  if (PAYROLL_HOUR_COLUMNS.has(headerName) && typeof value === 'number') {
    return value * 24;
  }
  if (PAYROLL_DATE_COLUMNS.has(headerName) && typeof value === 'number') {
    return excelSerialDateToIsoString(value);
  }
  return value;
}

/**
 * Excelの日付シリアル値(1900年1月1日を1とする日数)を"YYYY-MM-DD"文字列に変換する。
 * ★XLSX.SSF.format はESM importでは公開されていないため使用しない(自前実装)。
 */
function excelSerialDateToIsoString(serial: number): string {
  const utcDays = Math.floor(serial - 25569); // 25569 = 1970-01-01 と 1899-12-30 の日数差
  const utcMillis = utcDays * 86400 * 1000;
  const date = new Date(utcMillis);
  return date.toISOString().substring(0, 10);
}

export type PastImportCompany = 'matsuyama' | 'shikoku';

export interface PastImportResult {
  payrollRows: PayrollRow[];
  billingRows: BillingRow[];
  targetMonth: string;
  /** シートが見つからない等、部分的に取り込めなかった場合の警告(取り込み自体は続行) */
  warnings: string[];
}

/**
 * ブラウザで選択されたExcelファイルをワークブックとして読み込む。
 * ★注意: cellDates:trueにすると、時間列([h]:mm書式、24時間超の経過時間)がJSのDate
 * オブジェクトに変換されてしまい、そこから正しい時間数を復元できなくなる(実データ検証済み)。
 * 生の数値(1日を1.0とする実数)のまま読み、必要な列だけ自前で変換する(payrollSheetToCsv参照)。
 */
export async function readWorkbookFile(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array', cellDates: false });
}

/**
 * ファイル名から対象年月を推測する(取り込み画面での初期値表示用。最終的な値は
 * 運用者が画面上で確認・修正できるようにする)。
 * - 松山形式: "★派遣明細202410.xlsm" のような6桁(YYYYMM)
 * - 四国形式: "★2410勤怠明細票　時間計算.xlsm" のような4桁(YYMM、20XX年とみなす)
 */
export function guessTargetMonthFromFileName(fileName: string): string {
  let m = fileName.match(/(20\d{2})[-_]?(\d{2})(?!\d)/);
  if (m) {
    const month = parseInt(m[2], 10);
    if (month >= 1 && month <= 12) return `${m[1]}-${m[2]}`;
  }
  m = fileName.match(/(?:^|\D)(\d{2})(\d{2})(?!\d)/);
  if (m) {
    const month = parseInt(m[2], 10);
    if (month >= 1 && month <= 12) return `20${m[1]}-${m[2]}`;
  }
  return '';
}

/**
 * 指定した1始まり行番号をヘッダー行として、シートの使用範囲を配列の配列(セルの生の値)として
 * 読み取る。
 * ★注意: XLSX.utils.sheet_to_csvのrangeオプションは(検証の結果)効かないため使用しない。
 * sheet_to_jsonのrangeオプション(こちらは正しく機能する)でAOAを取得する方式に統一する。
 */
function sheetToAoaFromRow(ws: XLSX.WorkSheet, headerRow1Based: number): any[][] {
  return XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    range: headerRow1Based - 1,
    blankrows: false,
    defval: '',
    raw: true,
  });
}

/**
 * 未払計上表シート(給与データ、H:MM超24時間形式の時間列・シリアル日付の支給日列を含む)を、
 * 既存のparsePayrollCsv()にそのまま渡せるCSVテキストへ変換する。
 */
function payrollSheetToCsv(ws: XLSX.WorkSheet, headerRow1Based: number): string {
  const aoa = sheetToAoaFromRow(ws, headerRow1Based);
  if (aoa.length === 0) return '';
  const header = aoa[0].map((h) => String(h ?? ''));
  const normalized = aoa.map((row, rowIdx) =>
    rowIdx === 0 ? row : row.map((cell, colIdx) => normalizePayrollCellForColumn(header[colIdx], cell))
  );
  return Papa.unparse(normalized);
}

/** 数値・文字列が混在するシンプルな表(時間列を含まない)を、CSVテキストへ変換する */
function plainSheetToCsv(ws: XLSX.WorkSheet, headerRow1Based: number): string {
  const aoa = sheetToAoaFromRow(ws, headerRow1Based);
  if (aoa.length === 0) return '';
  return Papa.unparse(aoa);
}

// ---------------------------------------------------------------------------
// 松山人材
// ---------------------------------------------------------------------------

const MATSUYAMA_PAYROLL_SHEET = '未払計上表';
const MATSUYAMA_PAYROLL_HEADER_ROW = 12;
const MATSUYAMA_BILLING_SHEET = '請求支払一覧';
const MATSUYAMA_BILLING_HEADER_ROW = 16;

export function extractMatsuyamaPastData(
  wb: XLSX.WorkBook,
  targetMonth: string,
  fileName: string
): PastImportResult {
  const warnings: string[] = [];

  const payrollSheet = wb.Sheets[MATSUYAMA_PAYROLL_SHEET];
  let payrollRows: PayrollRow[] = [];
  if (!payrollSheet) {
    warnings.push(`「${MATSUYAMA_PAYROLL_SHEET}」シートが見つかりませんでした。給与データは取り込まれません。`);
  } else {
    const csv = payrollSheetToCsv(payrollSheet, MATSUYAMA_PAYROLL_HEADER_ROW);
    payrollRows = parsePayrollCsv(csv, fileName)
      .filter((r) => r.staffNo)
      .map((r) => ({ ...r, targetMonth }));
  }

  const billingSheet = wb.Sheets[MATSUYAMA_BILLING_SHEET];
  let billingRows: BillingRow[] = [];
  if (!billingSheet) {
    warnings.push(`「${MATSUYAMA_BILLING_SHEET}」シートが見つかりませんでした。請求データは取り込まれません。`);
  } else {
    const csv = plainSheetToCsv(billingSheet, MATSUYAMA_BILLING_HEADER_ROW);
    billingRows = parseBillingCsv(csv, fileName)
      .filter((r) => r.staffNo)
      .map((r) => ({ ...r, targetMonth }));
  }

  return { payrollRows, billingRows, targetMonth, warnings };
}

// ---------------------------------------------------------------------------
// 四国人材
// ---------------------------------------------------------------------------

const SHIKOKU_PAYROLL_SHEET = '未払計上表';
const SHIKOKU_PAYROLL_HEADER_ROW = 10;
const SHIKOKU_PERFORMANCE_SHEET = '実績加工';
const SHIKOKU_PERFORMANCE_HEADER_ROW = 25;

// 実績加工シートの列位置(0始まり)。ヘッダー文字列が同一シート内に複数ブロック
// 重複しているため、列名ではなく実データ検証済みの列位置で直接読む。
const SHIKOKU_COL = {
  clientNo: 7, // H列: 取引先番号
  clientName: 8, // I列: 取引先名
  staffNo: 9, // J列: スタッフ番号
  staffName: 10, // K列: スタッフ氏名
  billingAmount: 11, // L列: 請求額
  paymentAmount: 12, // M列: 支給額
  socialInsurance: 13, // N列: 社保負担額
  workDays: 14, // O列: 出勤日数
  billingUnitPrice: 15, // P列: 請求単価
  paymentUnitPrice: 16, // Q列: 支給単価
  transport: 17, // R列: 支給交通費
};

export function extractShikokuPastData(
  wb: XLSX.WorkBook,
  targetMonth: string,
  fileName: string
): PastImportResult {
  const warnings: string[] = [];

  const payrollSheet = wb.Sheets[SHIKOKU_PAYROLL_SHEET];
  let payrollRows: PayrollRow[] = [];
  if (!payrollSheet) {
    warnings.push(`「${SHIKOKU_PAYROLL_SHEET}」シートが見つかりませんでした。給与データは取り込まれません。`);
  } else {
    const csv = payrollSheetToCsv(payrollSheet, SHIKOKU_PAYROLL_HEADER_ROW);
    payrollRows = parsePayrollCsv(csv, fileName)
      .filter((r) => r.staffNo)
      .map((r) => ({ ...r, targetMonth }));
  }

  const perfSheet = wb.Sheets[SHIKOKU_PERFORMANCE_SHEET];
  const billingRows: BillingRow[] = [];
  if (!perfSheet) {
    warnings.push(`「${SHIKOKU_PERFORMANCE_SHEET}」シートが見つかりませんでした。請求データは取り込まれません。`);
  } else {
    // ヘッダー行(25行目)自体はスキップし、データ行だけをそのまま配列で読む。
    const aoa = sheetToAoaFromRow(perfSheet, SHIKOKU_PERFORMANCE_HEADER_ROW + 1);
    aoa.forEach((row, idx) => {
      const staffNo = String(row[SHIKOKU_COL.staffNo] ?? '').trim();
      const clientName = String(row[SHIKOKU_COL.clientName] ?? '').trim();
      // 空行・プレースホルダー行(スタッフ番号=0等)をスキップ
      if (!staffNo || staffNo === '0' || !clientName || clientName === '0') return;

      billingRows.push({
        // 実績加工シートには請求No・受注番号が無いため、行ごとに一意なIDを合成する。
        // (過去実績は既に確定済みの1契約1行のため、今後の月のような20日締め統合は不要)
        billingNo: `SHIKOKU_${targetMonth}_${idx}`,
        targetMonth,
        staffNo,
        staffName: String(row[SHIKOKU_COL.staffName] ?? '').trim(),
        clientCode: String(row[SHIKOKU_COL.clientNo] ?? '').trim() || 'CLIENT_DEF',
        clientName: clientName || '派遣先企業',
        orderNo: `SHIKOKU_${targetMonth}_${idx}`,
        orderName: '',
        billingAmountExTax: Number(row[SHIKOKU_COL.billingAmount]) || 0,
        paymentAmount: Number(row[SHIKOKU_COL.paymentAmount]) || 0,
        socialInsuranceBilling: Number(row[SHIKOKU_COL.socialInsurance]) || 0,
        // 有給使用日数はこのシートに列が無い。未払計上表シート由来のPayrollRow.paidLeaveDaysで
        // 給与側からは参照できるため、請求側はやむを得ず0とする(16-5章で確認済みの方針)。
        paidLeaveDaysUsed: 0,
        // 請求側交通費の列がこのシートには無い(16-4章で確認済み)。支給交通費(給与側)は
        // PayrollRow.salaryTransportに別途反映される。
        billingTransport: 0,
        referralFee: 0,
        workHours: 0,
        unitPrice: Number(row[SHIKOKU_COL.billingUnitPrice]) || 0,
      });
    });
  }

  return { payrollRows, billingRows, targetMonth, warnings };
}

export function extractPastData(
  company: PastImportCompany,
  wb: XLSX.WorkBook,
  targetMonth: string,
  fileName: string
): PastImportResult {
  return company === 'matsuyama'
    ? extractMatsuyamaPastData(wb, targetMonth, fileName)
    : extractShikokuPastData(wb, targetMonth, fileName);
}
