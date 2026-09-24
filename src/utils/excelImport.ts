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
import { PayrollRow, BillingRow, InvoicePrintRow } from '../types';
import { parsePayrollCsv, parseBillingCsv, parseInvoicePrintCsv } from './csvParser';

// 未払計上表シートの「時間」列(H:MM形式で24時間を超えうる、[h]:mm書式のExcelセル)。
// Excel上はこれらのセルは「1日を1.0とする経過日数」の実数として保存されている
// (raw:trueで読むと175:30 → 7.3125 のような値になる)ため、csvParser.tsの
// parseHoursMinutesToDecimal(H:MM形式の文字列を想定)にそのまま渡せない。
// 実データで検証済み: raw値 × 24 = 10進の時間数(この例では175.5)。
// ここで数値化してからCSV化することで、既存のparsePayrollCsvをそのまま再利用できるようにする。
const PAYROLL_HOUR_COLUMNS = new Set([
  '時間内時間',
  '時間外時間',
  // ★2026-09-14追加(23章タスク2「大阪の月次データ全月インポート」): 大阪の「給与一覧（スタナビ）」
  // シートでは「時間内時間」「時間外時間」がそれぞれ「契約内時間」「契約外時間」表記になっている
  // (実データ確認済み)。セル自体は他の時間列と同じ[h]:mm書式(経過日数の実数)のため、同じ
  // ×24変換が必要。
  '契約内時間',
  '契約外時間',
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

export type PastImportCompany = 'matsuyama' | 'shikoku' | 'osaka';

// ★2026-09-29追加(四国「売上実績一覧表」形式の取込み対応): 紹介手数料パターン(支払＝0、
// 社保他＝0、出勤日数＝0、粗利率＝100%、かつ売上が0でない)に該当した行。通常のbillingRows/
// payrollRowsには含めず、確認用にここへ退避する。はまさんが今後この紹介手数料を毎月手動入力する
// 運用のため、この配列からReferralFeeRowへ自動登録することはしない(二重登録防止)。
export interface ShikokuReferralFeeCandidateRow {
  targetMonth: string;
  clientName: string;
  staffName: string;
  staffNo: string;
  amount: number;
}

export interface PastImportResult {
  payrollRows: PayrollRow[];
  billingRows: BillingRow[];
  // ★2026-09-15追加(23章「集計」シート方式の名目指標を行レベルにも拡張): 契約単価(請求＠)。
  // 従来このモジュールはpayrollRows/billingRowsしか返しておらず、過去実績Excel取り込み分は
  // 常に請求＠が取得できず名目粗利率・名目粗利額が「データなし」になっていた。大阪の
  // 「請求書（スタナビ）」シートのように契約単価(時間内－単価)を持つシートがある場合はここに
  // 格納する(現状は大阪のみ。松山・四国の過去実績Excelには該当シートが無いため空配列)。
  invoiceRows: InvoicePrintRow[];
  targetMonth: string;
  /** シートが見つからない等、部分的に取り込めなかった場合の警告(取り込み自体は続行) */
  warnings: string[];
  // ★2026-09-29追加: 四国「売上実績一覧表」形式のみ使用。他社では常に空配列。
  referralFeeRows?: ShikokuReferralFeeCandidateRow[];
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

  // 松山の過去実績Excelには契約単価(請求＠)を持つシートが無いため常に空(23章参照)
  return { payrollRows, billingRows, invoiceRows: [], targetMonth, warnings };
}

// ---------------------------------------------------------------------------
// 四国人材
// ---------------------------------------------------------------------------
//
// ★2026-09-29全面改訂(はまさんと事前に対象ファイル・列構成を確認済み): 従来は
// 「未払計上表」(給与、生CSV相当)+「実績加工」(請求、列位置固定)の2シート構成を前提に
// していたが、はまさんのパソコン上の実際の過去実績ファイル(2023-10〜2026-06分)は
// 「売上実績一覧表」という1ファイル完結型の書式(1シート=基本1ヶ月分)で、この2シート構成の
// 前提とは異なることが判明した。この形式は既に「請求額・支払額(＝給与総額、有給手当込み)・
// 社保他・粗利益(＝売上−支払−社保他、計算済み)」が1行に揃っているため、旧方式のように
// 給与側・請求側の生データを個別に読み取って結合する必要が無い。以下、この新形式専用の
// 抽出処理に置き換える(関数名extractShikokuPastDataは維持し、PastExcelImportPanel/
// extractPastDataからの呼び出し口を変更せずに済むようにしている)。
//
// 【列構成】ヘッダー行(「企業名」というセルがある行)から下がデータ。列の並びはファイルにより
// 1列ずれる・列が増える等の揺れがあるため、固定の列位置ではなくヘッダーのテキストで列を
// 特定する(findShikokuSummaryColumns参照。2025年2月以降のファイルで実際に列ずれを確認済み)。
//
// 【行の除外ルール】(1)企業名列が「合計」の行、シート末尾の「一致」等のチェック行はスキップ。
// (2)スタッフ氏名が空欄かつ売上も0/空欄の行(空の予備行)はスキップ。
//
// 【紹介手数料行の判定】支払＝0、社保他＝0、出勤日数＝0、粗利率＝100%(1.0)、かつ売上が0でない
// 行は、通常の派遣請求ではなく紹介手数料のみの行。billingRows/payrollRowsには含めず、
// referralFeeRows(確認用、自動登録はしない)へ退避する。
//
// 【粗利計算式の再現】このシートの「粗利益＝売上−支払−社保他」を、calculator.tsの既存の式
// (grossProfitExTax = billingAmountExTax − BillingRow.paymentAmount − BillingRow.
// socialInsuranceBilling − PayrollRow.parkingFee − retirementAmount)でそのまま再現できるよう、
// 「売上」→billingAmountExTax、「支払」→BillingRow.paymentAmount、「社保他」→BillingRow.
// socialInsuranceBilling にマッピングし、parkingFee・retirementAmountは0(このシートにはその
// ような内訳列が無く、粗利益の計算式自体にも含まれていないため)とする。

const SHIKOKU_SUMMARY_HEADER_MARKER = '企業名';

// ヘッダーのテキスト候補(表記ゆれ含む、はまさん確認済み)。定義順が列特定の優先順位になる
// (「支払」より前に「支払の内交通費」を確定させることで、部分一致フォールバック時に
// 「支払」候補が「支払の内交通費」列を誤って拾わないようにしている。findShikokuSummaryColumns参照)。
//
// ★2026-09-30修正(はまさんの指摘・実データ確認で判明した不具合): 「請求＠」「支払＠」列の
// 「＠」は全角(U+FF20)だが、normalizeShikokuHeader()内のNFKC正規化が全角＠を半角の「@」
// (U+0040)に変換してしまうため、候補側に全角の「＠」を書いていると正規化後のヘッダー文字列と
// 一律に不一致になり、この2列だけが常に列特定に失敗していた(その結果、請求＠・支払＠が
// 全行0円になり、名目粗利率もbillingUnitPrice>0の判定に失敗して「データなし」になっていた)。
// 候補文字列自体をNFKC正規化後の半角「@」で書くことで一致させる。
const SHIKOKU_SUMMARY_FIELD_CANDIDATES: [string, string[]][] = [
  ['clientName', ['企業名', 'クライアント名', '得意先名']],
  ['staffNo', ['スタッフ番号', 'ｽﾀｯﾌ番号', 'スタッフNo']],
  ['staffName', ['氏名', 'スタッフ氏名', 'スタッフ名']],
  ['billingUnitPrice', ['請求@', '請求単価']],
  ['payUnitPrice', ['支払@', '支払単価']],
  ['marginRate', ['粗利率']],
  ['billingAmount', ['売上']],
  ['transport', ['支払の内交通費']],
  ['paymentAmount', ['支払']],
  ['socialInsuranceOther', ['社保他']],
  ['grossProfit', ['粗利益']],
  ['workDays', ['出勤日数']],
];

// 検算(月次売上合計の突合)・除外判定に必須な項目。これらが1つでも見つからない場合は
// 警告を出す(取り込み自体は続行し、見つからなかった項目は0/空欄として扱う)。
const SHIKOKU_SUMMARY_REQUIRED_FIELDS = [
  'clientName',
  'staffName',
  'staffNo',
  'billingAmount',
  'paymentAmount',
  'socialInsuranceOther',
  'workDays',
  'marginRate',
];

function parseShikokuNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const s = String(val).replace(/,/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function parseShikokuStr(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).normalize('NFKC').trim();
}

/**
 * ヘッダーセルのテキスト正規化(項目特定専用)。実データ確認済み: このシートのヘッダー行は
 * セル内で折り返して入力されている列がある(例: "スタッフ\n番号"、"支払の内\n交通費")ため、
 * NFKC正規化・trimだけでは候補名「スタッフ番号」「支払の内交通費」と一致しない。改行を含む
 * 空白文字をすべて除去することで、見た目上1つの単語であるヘッダーを正しく1つの文字列として
 * 比較できるようにする(データ値側のparseShikokuStrは、氏名等の正当な空白を壊さないよう
 * この空白除去は行わない)。
 */
function normalizeShikokuHeader(val: any): string {
  return String(val ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
}

/**
 * ヘッダー行(セルのテキスト配列)から、SHIKOKU_SUMMARY_FIELD_CANDIDATESの各項目に対応する
 * 列インデックスを特定する。csvParser.ts findColumnKeyと同じ考え方(NFKC正規化、完全一致優先
 * →部分一致フォールバック)だが、複数項目を同時に1つのヘッダー行から特定する必要があるため、
 * 一度使った列インデックスは他の項目が再利用しない(used集合で管理)。これにより、例えば
 * 「支払の内交通費」列が先に確定していれば、「支払」候補の部分一致フォールバックがその列を
 * 誤って拾うことはない。
 */
function findShikokuSummaryColumns(headerRow: any[]): { columns: Record<string, number>; missingRequired: string[] } {
  const normalized = headerRow.map((c) => normalizeShikokuHeader(c));
  const used = new Set<number>();
  const columns: Record<string, number> = {};

  // フェーズ1: 完全一致(衝突しやすい項目を先に定義しているSHIKOKU_SUMMARY_FIELD_CANDIDATESの
  // 順序どおりに処理することで、後続の項目が既に確定済みの列を再利用しないようにする)
  SHIKOKU_SUMMARY_FIELD_CANDIDATES.forEach(([field, candidates]) => {
    for (const candidate of candidates) {
      const idx = normalized.findIndex((h, i) => h === candidate && !used.has(i));
      if (idx !== -1) {
        columns[field] = idx;
        used.add(idx);
        return;
      }
    }
  });
  // フェーズ2: 部分一致フォールバック(フェーズ1で確定できなかった項目のみ。列名が1列ずれる等の
  // 揺れがあるファイル向け)
  SHIKOKU_SUMMARY_FIELD_CANDIDATES.forEach(([field, candidates]) => {
    if (columns[field] !== undefined) return;
    for (const candidate of candidates) {
      const idx = normalized.findIndex((h, i) => h.includes(candidate) && !used.has(i));
      if (idx !== -1) {
        columns[field] = idx;
        used.add(idx);
        return;
      }
    }
  });

  const missingRequired = SHIKOKU_SUMMARY_REQUIRED_FIELDS.filter((f) => columns[f] === undefined);
  return { columns, missingRequired };
}

/**
 * 対象年月("YYYY-MM")から、四国「売上実績一覧表」形式の典型的なシート名("YYYY年M月"、
 * 月は0埋めなし)を組み立て、ワークブック内で一致するシートを探す。完全一致が無い場合、
 * この文字列で始まるシート名(例: "2023年10月（21日～30日差引）")を探すが、該当が複数ある
 * 場合はどちらが正しいか自動判定できないため、諦めてnullを返す(呼び出し元でシート名を
 * 明示的に指定してもらう必要がある。実際、はまさんとの事前確認でも複数月・複数候補が
 * 同じファイルに混在するケースがあったため、この自動判定はあくまで簡易月1ファイルのケース
 * 向けの補助であり、過去分の一括取込みではシート名を明示指定する運用としている)。
 */
export function guessShikokuSheetName(wb: XLSX.WorkBook, targetMonth: string): string | null {
  const [y, m] = targetMonth.split('-');
  if (!y || !m) return null;
  const base = `${y}年${parseInt(m, 10)}月`;
  if (wb.Sheets[base]) return base;
  const candidates = wb.SheetNames.filter((n) => n.startsWith(base));
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * 四国「売上実績一覧表」形式の1シートを読み取り、PayrollRow[]/BillingRow[]を組み立てる。
 * シート名を明示的に指定する版(過去分の一括取込み・シート名が自動判定できない場合に使用)。
 */
export function extractShikokuSalesSummarySheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  targetMonth: string,
  fileName: string,
  // ★2026-09-29追加(過去分一括取込みでの実データ確認・はまさんの判断結果): 紹介手数料パターン
  // (支払＝0・社保他＝0・出勤日数＝0・粗利率＝100%)に機械的には該当するが、実際には紹介手数料
  // ではなく通常の派遣請求(部分月の精算等)である行が実データで5件見つかった(2024年7月 今治造船
  // 安井楓・須田恵理、2024年8月 今治造船 佐竹明子、2025年9月 今治造船 堀田由紀、2025年10月
  // 今治造船 渋谷桂。いずれも金額が450,000円等の丸い数字ではなく半端な小額だった)。はまさんに
  // 実データを確認いただいた結果「通常の派遣請求として取り込む」との判断だったため、
  // targetMonth+staffNoで指定した行は紹介手数料パターンに一致しても通常のbillingRows/
  // payrollRowsとして取り込む(既定は空配列。この一覧は今回判明した過去分の既知の例外であり、
  // 汎用の判定ロジック自体(isReferralFeeRow)は変更しない)。
  forceNormalBillingKeys: Set<string> = new Set()
): PastImportResult {
  const warnings: string[] = [];
  const referralFeeRows: ShikokuReferralFeeCandidateRow[] = [];

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return {
      payrollRows: [],
      billingRows: [],
      invoiceRows: [],
      targetMonth,
      warnings: [`シート「${sheetName}」が見つかりませんでした(ファイル: ${fileName})。`],
      referralFeeRows,
    };
  }

  const aoa: any[][] = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false, defval: '', raw: true });
  // ★2026-09-30修正(はまさんの指摘・実データ確認で判明した不具合): このシートには「企業名」
  // セルを含む行が2回出現する。1回目はスタッフ単位の明細表のヘッダー(本来読みたいデータ)だが、
  // 2回目はその下に続く「クライアント単位の集計表」(列構成が全く異なる: 企業名/担当/売上/
  // 売上比率/支払/社保他/粗利益/人数/出勤日数)のヘッダーで、実データ全33ヶ月で必ず存在することを
  // 確認済み。従来は最初の「企業名」出現行だけをヘッダーとして検出し、そこからシート末尾までを
  // 全てスタッフ明細行として読んでいたため、2番目の集計表の行までスタッフ明細表の列位置で
  // 誤読していた(例: 集計表の「売上」列の値がスタッフ明細表の「スタッフ番号」列として読まれる等)。
  // 集計表の各行は売上・支払等の値が数十円程度と極端に小さいため合計金額への影響は軽微だったが、
  // 支払だけが数百円計上される行として大量の「赤字」誤検知(LOW_MARGIN)を生んでいた。
  // 2回目の「企業名」出現行をスタッフ明細表の終端とし、そこより後ろは読み込み対象から除外する。
  const headerRowIdx = aoa.findIndex((row) =>
    row.some((cell) => normalizeShikokuHeader(cell) === SHIKOKU_SUMMARY_HEADER_MARKER)
  );
  if (headerRowIdx === -1) {
    return {
      payrollRows: [],
      billingRows: [],
      invoiceRows: [],
      targetMonth,
      warnings: [`シート「${sheetName}」内に「${SHIKOKU_SUMMARY_HEADER_MARKER}」列を含むヘッダー行が見つかりませんでした(ファイル: ${fileName})。`],
      referralFeeRows,
    };
  }
  let dataEndRowIdx = aoa.length;
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    if (aoa[i].some((cell) => normalizeShikokuHeader(cell) === SHIKOKU_SUMMARY_HEADER_MARKER)) {
      dataEndRowIdx = i;
      break;
    }
  }

  const { columns, missingRequired } = findShikokuSummaryColumns(aoa[headerRowIdx]);
  if (missingRequired.length > 0) {
    warnings.push(
      `シート「${sheetName}」のヘッダー行から次の列を特定できませんでした: ${missingRequired.join(' / ')}。該当項目は0または空欄として扱われます。`
    );
  }

  const billingRowsRaw: BillingRow[] = [];
  // 同一対象月・同一スタッフ番号のPayrollRowが複数生成されうる(1人が同月に複数クライアントへ
  // 派遣されているケース)。calculator.tsのpayrollMapは`${targetMonth}_${staffNo}`キーで
  // 最後の1件のみを採用する仕様(同一スタッフの支払単価は契約単位ではなくスタッフ単位の値として
  // 扱う、calculator.ts既存コメント参照)のため、ここでも同じキーで重複を排除してから返す
  // (件数表示・FiscalYearSummaryの有給集計等での重複計上を防ぐため)。
  const payrollRowMap = new Map<string, PayrollRow>();

  let rowSeq = 0;
  for (let i = headerRowIdx + 1; i < dataEndRowIdx; i++) {
    const row = aoa[i];
    const get = (field: string) => (columns[field] !== undefined ? row[columns[field]] : '');

    const clientNameRaw = parseShikokuStr(get('clientName'));
    // 「合計」行(集計行)・シート末尾の「一致」等のチェック行は無視する
    if (clientNameRaw === '合計' || clientNameRaw === '一致') continue;

    const staffName = parseShikokuStr(get('staffName'));
    const billingAmount = parseShikokuNum(get('billingAmount'));
    // スタッフ氏名が空欄で売上も0/空欄の行は、空の予備行としてスキップ
    if (!staffName && billingAmount === 0) continue;

    const staffNo = parseShikokuStr(get('staffNo'));
    if (!staffNo) continue; // スタッフ番号が無い行は取込み対象外(安全策)

    const paymentAmount = parseShikokuNum(get('paymentAmount'));
    const socialInsuranceOther = parseShikokuNum(get('socialInsuranceOther'));
    const workDays = parseShikokuNum(get('workDays'));
    const marginRate = parseShikokuNum(get('marginRate'));
    const billingUnitPrice = parseShikokuNum(get('billingUnitPrice'));
    const payUnitPrice = parseShikokuNum(get('payUnitPrice'));
    // ★2026-09-30修正: 「支払の内交通費」列の値自体はもう使わない(下のsalaryTransport参照)。
    // 列マッピング(COLUMN_CANDIDATES の'transport'エントリ)自体は、「支払」列の部分一致
    // フォールバックがこの列を誤って拾わないようにする列特定の目印として引き続き必要なため、
    // 定義は残している(findShikokuSummaryColumns参照)。
    const clientName = clientNameRaw || '派遣先企業';

    // 紹介手数料行の判定(はまさん確認済みのパターン): 支払＝0、社保他＝0、出勤日数＝0、
    // 粗利率＝100%(1.0)、かつ売上が0でない。通常の派遣請求行としては取り込まず、確認用に
    // referralFeeRowsへ退避する(紹介手数料カテゴリへの自動登録はしない。はまさんが毎月
    // 手動入力する運用のため、二重登録を避ける)。
    const isReferralFeeRow =
      paymentAmount === 0 &&
      socialInsuranceOther === 0 &&
      workDays === 0 &&
      Math.abs(marginRate - 1) < 0.001 &&
      billingAmount !== 0 &&
      !forceNormalBillingKeys.has(`${targetMonth}_${staffNo}`);
    if (isReferralFeeRow) {
      referralFeeRows.push({ targetMonth, clientName, staffName, staffNo, amount: billingAmount });
      continue;
    }

    rowSeq++;
    // このシートには請求No・受注番号が無いため、行ごとに一意なIDを合成する
    // (過去実績は既に確定済みの1契約1行のため、今後の月のような20日締め統合は不要)。
    const syntheticId = `SHIKOKU_${targetMonth}_${rowSeq}`;

    billingRowsRaw.push({
      billingNo: syntheticId,
      targetMonth,
      staffNo,
      staffName,
      // 取引先コード相当の列がこのシートには無いため、企業名をそのままコードとして使う
      // (同一企業名であれば月をまたいで同じclientCodeになり、クライアント別集計が正しく
      // グルーピングされる。LeaveCompensationRow等、既存の手入力機能でも同じ考え方を採用している)。
      clientCode: clientName,
      clientName,
      orderNo: syntheticId,
      orderName: '',
      billingAmountExTax: billingAmount,
      // 支払(＝給与総額、有給手当込み)はBillingRow.paymentAmountに入れる。calculator.tsの
      // grossProfitExTax計算式が参照するのはこちら(請求CSV由来の値)であり、このシートの
      // 「粗利益＝売上−支払−社保他」をそのまま再現できる。
      paymentAmount,
      socialInsuranceBilling: socialInsuranceOther,
      // 有給使用日数はこのシートに列が無いため0(このシートには有給日数・有給手当の内訳列
      // 自体が存在しない。「支払」列の説明どおり、有給手当は既に支払額に合算済みだが、
      // 内訳として取り出すことはできない)。
      paidLeaveDaysUsed: 0,
      // 請求側交通費の列はこのシートには無い(「支払の内交通費」は給与側の内訳のため
      // PayrollRow.salaryTransportに反映する)。
      billingTransport: 0,
      referralFee: 0,
      workHours: 0,
      // 請求＠(契約単価)。calculator.tsのbillingUnitPrice算出で、請求書印刷CSV未読込時の
      // フォールバックとして参照される(四国は請求書印刷CSV相当のシートが無いため常にこちらを使う)。
      unitPrice: billingUnitPrice,
    });

    const payrollKey = `${targetMonth}_${staffNo}`;
    payrollRowMap.set(payrollKey, {
      targetMonth,
      staffNo,
      staffName,
      // スタッフ給与明細画面での参考表示専用(grossProfitExTaxの算出には使われない。
      // 上のBillingRow.paymentAmountが実際の控除対象)。
      paymentAmount,
      // 社保他はBillingRow.socialInsuranceBilling(粗利計算の実際の控除対象)にも同じ値を
      // 設定済み。PayrollRow側にも同値を入れることで、calculator.tsの社保負担額突合
      // (SOCIAL_INSURANCE_MISMATCH、参考ログ)で無用な差異アラートが出ないようにする。
      socialInsurance: socialInsuranceOther,
      employmentInsurance: 0,
      // このシートには駐車場代・退職金配賦に相当する列が無く、粗利益の計算式自体
      // (売上−支払−社保他)にもこれらの控除項目が含まれていない。0のまま(=無し)として扱うことで、
      // 粗利計算がシート側の「粗利益」列と一致するようにする。
      parkingFee: 0,
      // ★2026-09-30修正(はまさんの実データ確認・スタッフ給与実額チェックで発覚): 以前は
      // ここに「支払の内交通費」の値(=transport)をそのまま入れていたが、これは誤りだった。
      // PayrollRow.salaryTransportは、通常の給与CSV(大阪等)では「総支給額に内包されている
      // 会社負担の交通費」を意味し、月次サマリ表示(MonthlyCalculationTable/
      // FiscalYearAnalytics)側で「給与総額(狭義)=paymentAmount−salaryTransport」
      // 「社保他小計=socialInsurance+salaryTransport+parkingFee」という、総額から交通費を
      // 分離して社保他側へ付け替える表示用の分解式に使われる(大阪の実データで検算・確定済み
      // の設計、types.ts参照)。
      // 一方、このシート(売上実績一覧表)の「支払の内交通費」は名前どおり「支払の内訳」の
      // 参考情報でしかなく、請求側にも対応する交通費列が無い(billingTransportは常に0、上記
      // 参照)。transportをsalaryTransportにそのまま入れると、上記の分解式が誤って適用され、
      // 実際には支払・社保他とも元ファイルの値そのままで正しいにもかかわらず、表示上の
      // 「給与総額」が支払より交通費分だけ少なく、「社保他小計」が社保他より交通費分だけ
      // 多く表示される不具合が生じていた(実質粗利益・実質粗利率自体はsalaryTransportを
      // 参照しないため影響を受けない)。paymentAmount・socialInsuranceOtherは元ファイルの
      // 値のまま(=修正不要)、salaryTransportを0にすることで、この表示専用の分解を
      // 適用させないようにする。
      salaryTransport: 0,
      // 有給関連の内訳列がこのシートには無いため0(「支払」列の説明どおり有給手当は既に
      // 支払額に合算済みだが、内訳としては取り出せない。FiscalYearSummaryの有給金額・
      // 有給日数の合計には、四国のこの期間分は反映されない制約として残る)。
      paidLeaveAllowance: 0,
      paidLeaveDays: 0,
      // 支払＠(このシートの参考単価列)を、calculator.tsのpayUnitPrice算出式
      // (regularAmount ÷ regularHours)でそのまま再現するための変換。regularHours=1に
      // 固定することで、regularAmount(=支払＠)がそのままpayUnitPriceとして使われる
      // (このシートには実際の稼働時間の内訳が無いため、単価を単価のまま伝えるための
      // 割り切った処理。「時間内時間」としての実際の意味は持たない)。
      regularAmount: payUnitPrice,
      regularHours: payUnitPrice > 0 ? 1 : 0,
      remarks: '過去実績Excel(売上実績一覧表)取込み: 給与の時間内訳データなし(支払＠を単価として直接反映)',
    });
  }

  return {
    payrollRows: Array.from(payrollRowMap.values()),
    billingRows: billingRowsRaw,
    invoiceRows: [],
    targetMonth,
    warnings,
    referralFeeRows,
  };
}

export function extractShikokuPastData(
  wb: XLSX.WorkBook,
  targetMonth: string,
  fileName: string
): PastImportResult {
  const sheetName = guessShikokuSheetName(wb, targetMonth);
  if (!sheetName) {
    return {
      payrollRows: [],
      billingRows: [],
      invoiceRows: [],
      targetMonth,
      warnings: [
        `対象年月(${targetMonth})に対応するシートを自動判定できませんでした(「${targetMonth.split('-')[0]}年${parseInt(
          targetMonth.split('-')[1],
          10
        )}月」で始まるシートが無い、または複数存在し曖昧なため)。extractShikokuSalesSummarySheetでシート名を明示的に指定して取り込んでください。`,
      ],
      referralFeeRows: [],
    };
  }
  return extractShikokuSalesSummarySheet(wb, sheetName, targetMonth, fileName);
}

// ---------------------------------------------------------------------------
// 大阪人材
// ---------------------------------------------------------------------------

/**
 * ★2026-09-14追加(23章タスク2「大阪の月次データ全月インポート」)。
 * 大阪の拠点担当者が独自にまとめてきたExcelファイル(契約別売上実績表（YYYY.M).xlsx)を取り込む。
 * 実データ(2026-09-14、契約別売上実績表（2023.9).xlsxで直接検証済み)での確認結果:
 * - 「請求支払（スタナビ）」シート(1行目がヘッダー)。列構成が松山の「請求支払一覧」シートと
 *   完全に同一(請求No, クライアント番号, クライアント名称, ..., 担当者、まで全項目一致)のため、
 *   extractMatsuyamaPastDataと同じくparseBillingCsvをそのまま再利用できる。担当者列にも
 *   実データが入っている(例:「池内 奨太」)。
 * - 「給与一覧（スタナビ）」シート(1行目がヘッダー)。標準的な給与CSV(未払計上表)の列構成と
 *   ほぼ完全に一致するが、「契約内時間」「契約外時間」(松山・四国では「時間内時間」「時間外時間」)
 *   という表記ゆれがある(csvParser.ts側に候補名を追加済み)。時間列は他社同様[h]:mm形式の
 *   Excelセル(経過日数の実数)のため、PAYROLL_HOUR_COLUMNS(上記)で同じ変換処理を行う。
 * - 大阪の給与一覧シートには駐車場代・退職金配賦に該当する列が存在しない(実データ確認済み。
 *   parsePayrollCsvのparkingKey候補が見つからずparkingFeeは常に0になるが、これは大阪の実態
 *   (該当項目自体が無い)を正しく反映した結果であり、取込漏れではない)。
 * - ★2026-09-15追加(23章「集計」シート方式の名目指標を行レベルにも拡張): 「請求書（スタナビ）」
 *   シート(1行目がヘッダー)には契約単価(「時間内－単価」列)が契約(受注番号・請求番号)単位で
 *   入っている。実データ検証済み: このシートの「請求番号」列は「請求支払（スタナビ）」シートの
 *   「請求No」と同じ値(例: 20004253)で紐付き、「時間内－単価」(例: 1930)は「契約別売上実績表」
 *   シート自体が持つ「請求＠」列の値と完全一致する。既存のparseInvoicePrintCsv(請求書印刷CSV用)を
 *   そのまま再利用できるが、ハイフンの文字種が候補名と異なる(全角ハイフン「－」(U+FF0D)。
 *   候補名側は減算記号「−」(U+2212)。csvParser.ts側に候補を追加済み)。
 */
const OSAKA_PAYROLL_SHEET = '給与一覧（スタナビ）';
// ★2026-09-26追加(はまさんが実ファイルを直接確認して判明): 2024-09・2025-02の2ヶ月分のみ、
// ファイル作成側の命名ミスでこのシートが「請求一覧（スタナビ）」という名前になっていた
// (中身の列構成(ｽﾀｯﾌ番号/ｽﾀｯﾌ氏名/出勤日数/有給日数/支払額等)は他の月の「給与一覧
// （スタナビ）」と完全に一致しており、紛れもなく給与データだった)。この結果、
// 「給与一覧（スタナビ）」シートが見つからず給与データが1件も取り込まれない不具合が起きていた。
// 今後また同様の命名ミスが起きても給与データを取り込めるよう、代替シート名として許容する。
const OSAKA_PAYROLL_SHEET_ALT_NAMES = ['請求一覧（スタナビ）'];
const OSAKA_PAYROLL_HEADER_ROW = 1;
const OSAKA_BILLING_SHEET = '請求支払（スタナビ）';
const OSAKA_BILLING_HEADER_ROW = 1;
const OSAKA_INVOICE_SHEET = '請求書（スタナビ）';
const OSAKA_INVOICE_HEADER_ROW = 1;
// 給与シート固有の列名(csvParser.tsのparsePayrollCsvが「出勤日数」列を給与データの目印として
// 使っている。請求・請求書シートにはこの列名は登場しないため、シート名の候補一致にも失敗した
// 場合の最終手段として、ヘッダー行の中身でシートを特定するのに使う)。
const OSAKA_PAYROLL_HEADER_SIGNATURE = '出勤日数';

/**
 * 大阪の給与シートを名前で探す。まず正式名称「給与一覧（スタナビ）」、次に既知の命名ミスの
 * 代替名(OSAKA_PAYROLL_SHEET_ALT_NAMES)を順に試す。いずれの名前にも一致しない場合の最終手段
 * として、請求・請求書シート以外の全シートのヘッダー行を確認し、給与シート固有の列
 * (出勤日数)を含むシートを給与シートとみなす(未知の命名ミスに対する保険)。
 */
function findOsakaPayrollSheetName(wb: XLSX.WorkBook): string | null {
  const candidates = [OSAKA_PAYROLL_SHEET, ...OSAKA_PAYROLL_SHEET_ALT_NAMES];
  for (const name of candidates) {
    if (wb.Sheets[name]) return name;
  }
  for (const name of wb.SheetNames) {
    if (name === OSAKA_BILLING_SHEET || name === OSAKA_INVOICE_SHEET) continue;
    const header = sheetToAoaFromRow(wb.Sheets[name], OSAKA_PAYROLL_HEADER_ROW)[0] || [];
    if (header.some((cell) => String(cell ?? '').includes(OSAKA_PAYROLL_HEADER_SIGNATURE))) {
      return name;
    }
  }
  return null;
}

export function extractOsakaPastData(
  wb: XLSX.WorkBook,
  targetMonth: string,
  fileName: string
): PastImportResult {
  const warnings: string[] = [];

  const payrollSheetName = findOsakaPayrollSheetName(wb);
  const payrollSheet = payrollSheetName ? wb.Sheets[payrollSheetName] : undefined;
  let payrollRows: PayrollRow[] = [];
  if (!payrollSheet) {
    warnings.push(`「${OSAKA_PAYROLL_SHEET}」シートが見つかりませんでした。給与データは取り込まれません。`);
  } else {
    if (payrollSheetName !== OSAKA_PAYROLL_SHEET) {
      warnings.push(
        `給与シートが正式名称「${OSAKA_PAYROLL_SHEET}」ではなく「${payrollSheetName}」という名前で見つかりました(ファイル作成側の命名ミスの可能性があります)。列構成から給与データと判断して取り込みましたが、念のため内容をご確認ください。`
      );
    }
    const csv = payrollSheetToCsv(payrollSheet, OSAKA_PAYROLL_HEADER_ROW);
    payrollRows = parsePayrollCsv(csv, fileName)
      .filter((r) => r.staffNo)
      .map((r) => ({ ...r, targetMonth }));
  }

  const billingSheet = wb.Sheets[OSAKA_BILLING_SHEET];
  let billingRows: BillingRow[] = [];
  if (!billingSheet) {
    warnings.push(`「${OSAKA_BILLING_SHEET}」シートが見つかりませんでした。請求データは取り込まれません。`);
  } else {
    const csv = plainSheetToCsv(billingSheet, OSAKA_BILLING_HEADER_ROW);
    billingRows = parseBillingCsv(csv, fileName)
      .filter((r) => r.staffNo)
      .map((r) => ({ ...r, targetMonth }));
  }

  // ★2026-09-15追加(23章「集計」シート方式の名目指標を行レベルにも拡張): 契約単価(請求＠)。
  // 見つからなくても給与・請求データの取り込み自体は継続する(名目粗利率が「データなし」になるだけ)。
  const invoiceSheet = wb.Sheets[OSAKA_INVOICE_SHEET];
  let invoiceRows: InvoicePrintRow[] = [];
  if (!invoiceSheet) {
    warnings.push(
      `「${OSAKA_INVOICE_SHEET}」シートが見つかりませんでした。契約単価(請求＠)は取り込まれず、名目粗利率・名目粗利額は算出されません。`
    );
  } else {
    const csv = plainSheetToCsv(invoiceSheet, OSAKA_INVOICE_HEADER_ROW);
    // ★2026-09-29修正(はまさんの指摘・大阪2025-04の実データで確定): 以前はここで
    // 「請求Noが空欄の行を無効行として除外する」ガード条件(.filter((r) => r.billingNo))を
    // 重ねてかけていたが、これがまさに「請求No(管理用の参照番号)が空欄なだけで、請求額・
    // 支払額とも正常な行」を丸ごと除外してしまっていた真の原因だった(株式会社ブンカの契約
    // 9件、うち8件は請求額も正常にあったにもかかわらず除外され、結果として支払＠だけが
    // 名目粗利率の分子に非対称に加算される不具合(6e137edで対処済み)の一因にもなっていた)。
    // parseInvoicePrintCsv側で既に「請求No・受注番号のどちらも無い行のみ除外」という
    // 緩和済みの判定を行っているため、ここでの重複filterは撤去した。
    invoiceRows = parseInvoicePrintCsv(csv, fileName).map((r) => ({ ...r, targetMonth }));
  }

  return { payrollRows, billingRows, invoiceRows, targetMonth, warnings };
}

export function extractPastData(
  company: PastImportCompany,
  wb: XLSX.WorkBook,
  targetMonth: string,
  fileName: string
): PastImportResult {
  if (company === 'matsuyama') return extractMatsuyamaPastData(wb, targetMonth, fileName);
  if (company === 'osaka') return extractOsakaPastData(wb, targetMonth, fileName);
  return extractShikokuPastData(wb, targetMonth, fileName);
}
