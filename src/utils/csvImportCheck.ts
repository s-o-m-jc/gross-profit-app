/**
 * 派遣事業 粗利・経理管理システム
 * CSV取込み前の確認(ストッパー)の判定 (React非依存。テスト: csvImportCheck.test.ts)
 *
 * ★2026-11-26追加(はまさんの依頼): 2026-11-25に、松山の①②③を四国を選んだまま取り込み、四国2026-07を上書きした事故の再発防止。
 * CSVを選んでもすぐには取り込まず、この判定の結果(拠点・対象年月・ファイルの種類・③の紐付け・登録済みのデータ)を
 * 確認画面に出し、止める条件(blockers)が無く、確認のチェックがすべて付いたときだけ取り込む。
 * - 対象年月はファイル名に頼らず中身で決める。①は支払日の前月(csvParser.tsのderiveTargetMonthFromPayDate)。
 *   ②③は日付の列が無いので、同じ回に選んだ①との突き合わせで①の月に結び付ける。①②③(拠点ごとのREQUIRED_CSV_CARDS)がそろわなければ止める。
 *   ファイル名の年月は確かめにだけ使い、中身と違えば止める。
 * - 拠点は、スタッフ番号・クライアント番号・請求Noの形で判定する(2024年以降の登録済みデータで確認):
 *   大阪は8桁で2から始まる(スタッフ2000/2001…、クライアント22/24/25/26/29…、請求No 2000…)、
 *   松山は8桁で3から始まる(3000…)、四国はスタッフ番号が6桁以下(請求Noは8桁で1から始まる、例: 10031190)。
 */
import Papa from 'papaparse';
import { PayrollRow, BillingRow, InvoicePrintRow, InvoiceListRow } from '../types';
import { PAYROLL_TRANSPORT_COLUMNS } from '../config/payrollColumns';
import { employerEmploymentInsuranceRate } from '../config/employmentInsuranceRates';
import { WORKERS_COMP_RATES_IN_SOCIAL_INSURANCE, workersCompRate } from '../config/socialInsuranceCheck';
import { parseInvoiceListCsv, applyMatsuyamaCsvRules } from './matsuyamaCsvImport';
import { CompanyId, COMPANIES } from '../config/companies';
import { MonthlyDataState, MonthlyCategory } from './monthlyData';
import {
  parsePayrollCsv,
  parseBillingCsv,
  parseInvoicePrintCsv,
  deriveTargetMonthFromPayDate,
  extractMonthFromFileName,
} from './csvParser';

/** カードの種類。④請求一覧CSVは2026-11-26追加(松山だけ必須。請求書ごとの消費税に使い、データとしては保存しない) */
export type CsvCardKind = 'payroll' | 'billing' | 'invoice' | 'invoiceList';
/** 中身から判定したファイルの種類 */
export type DetectedCsvKind = CsvCardKind | 'unknown';

export const CSV_KIND_LABEL: Record<DetectedCsvKind, string> = {
  payroll: '①給与計算書印刷CSV',
  billing: '②請求支払一覧表印刷CSV',
  invoice: '③請求書印刷CSV',
  invoiceList: '④請求一覧CSV',
  unknown: '判定できない形式',
};

/** 確認画面の「すべて一緒に選んでください」の文言で使う名前 */
export const CSV_CARD_FULL_LABEL: Record<CsvCardKind, string> = {
  payroll: '①給与計算書印刷CSV',
  billing: '②請求支払一覧表印刷CSV',
  invoice: '③請求書印刷CSV(15日締・20日締・末締)',
  invoiceList: '④請求一覧CSV',
};

/**
 * 拠点ごとに、1回の取込みでそろっていなければならないカード(★2026-11-26 はまさんの判断)。
 * 松山は①②③④(④で請求書ごとの消費税を使う。matsuyamaCsvImport.ts)、四国・大阪は①②③。
 */
export const REQUIRED_CSV_CARDS: Record<CompanyId, CsvCardKind[]> = {
  shikoku: ['payroll', 'billing', 'invoice'],
  osaka: ['payroll', 'billing', 'invoice'],
  matsuyama: ['payroll', 'billing', 'invoice', 'invoiceList'],
};

export interface PendingCsvFile {
  card: CsvCardKind;
  fileName: string;
  text: string;
}

const norm = (s: unknown) => String(s ?? '').normalize('NFKC').trim();

function parseRaw(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return { headers: (parsed.meta.fields ?? []).map(norm), rows: parsed.data };
}

/** 見出しからファイルの種類を判定する(②の社保負担額の有無は問わない) */
export function detectCsvKind(text: string): { kind: DetectedCsvKind; columnCount: number } {
  const { headers } = parseRaw(text);
  const has = (...names: string[]) => names.some((n) => headers.includes(n));
  let kind: DetectedCsvKind = 'unknown';
  if (has('総支給額') && has('差引支給額', '差引支給') && has('出勤日数')) kind = 'payroll';
  else if (has('小計') && has('請求番号', '請求No') && has('時間内-単価', '時間内−単価')) kind = 'invoice';
  else if (has('請求日') && has('消費税') && has('請求合計額')) kind = 'invoiceList';
  else if (has('請求No', '請求番号') && has('請求額') && has('支払額')) kind = 'billing';
  return { kind, columnCount: headers.length };
}

/** ②に社保負担額(四国は「社保他」)の列があるか */
export function billingHasSocialInsuranceColumn(text: string): boolean {
  const { headers } = parseRaw(text);
  return headers.includes('社保負担額') || headers.includes('社保他');
}

/** 番号1つから拠点を推定する(判定できなければnull) */
export function companyFromId(value: unknown): CompanyId | null {
  const v = norm(value);
  if (/^\d{8}$/.test(v)) {
    if (v[0] === '2') return 'osaka';
    if (v[0] === '3') return 'matsuyama';
    if (v[0] === '1') return 'shikoku';
    return null;
  }
  if (/^\d{1,6}$/.test(v)) return 'shikoku';
  return null;
}

const ID_COLUMNS = ['スタッフ番号', 'スタッフNo', 'ス番号', 'クライアント番号', 'ク番号', '請求No', '請求番号'];

/** ファイルの番号の列から拠点を判定する。判定できた番号の9割以上が同じ拠点なら、その拠点 */
export function detectCompanyFromCsv(text: string): { company: CompanyId | null; votes: Record<CompanyId, number> } {
  const { rows } = parseRaw(text);
  const votes: Record<CompanyId, number> = { shikoku: 0, osaka: 0, matsuyama: 0 };
  rows.forEach((row) => {
    Object.keys(row).forEach((k) => {
      if (!ID_COLUMNS.includes(norm(k))) return;
      const c = companyFromId(row[k]);
      if (c) votes[c]++;
    });
  });
  const total = votes.shikoku + votes.osaka + votes.matsuyama;
  const top = (Object.keys(votes) as CompanyId[]).sort((a, b) => votes[b] - votes[a])[0];
  return { company: total > 0 && votes[top] / total >= 0.9 ? top : null, votes };
}

/** ③のファイル名から締め日を読む(③の中身には日付の列が無いため、表示の参考だけ) */
export function closingFromFileName(fileName: string): string {
  const m = norm(fileName).match(/(\d{1,2}日|末)締/);
  return m ? `${m[1]}締` : '';
}

export function formatMonthJa(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]}年${parseInt(m[2], 10)}月` : month;
}

// ④は保存しない(取込み時に請求行の税込額へ反映するだけ)ので、置き換わるカテゴリは無い
const CARD_CATEGORY: Partial<Record<CsvCardKind, MonthlyCategory>> = {
  payroll: 'payrollRows',
  billing: 'billingRows',
  invoice: 'invoiceRows',
};

const MANUAL_CATEGORY_LABEL: [MonthlyCategory, string][] = [
  ['transportExTaxOverrideRows', '交通費(税抜)の月次上書き'],
  ['referralFeeRows', '紹介手数料'],
  ['retirementRows', '退職金'],
  ['leaveCompensationRows', '休業分補償'],
  ['leaveAllowanceRows', '休業手当'],
  ['nextMonthAdjustmentRows', '次月調整'],
  ['paidLeaveOverrideRows', '有給の上書き'],
  ['personInChargeRows', '担当者の手入力'],
];

export interface CsvFileSummary {
  card: CsvCardKind;
  fileName: string;
  rowCount: number;
  columnCount: number;
  detectedKind: DetectedCsvKind;
  detectedCompany: CompanyId | null;
  fileNameMonth: string;
  /** ③だけ: ファイル名の締め日と、小計の合計 */
  closing?: string;
  subtotal?: number;
}

export interface CsvImportPreview {
  selectedCompanyId: CompanyId;
  /** 中身から判定した拠点(ファイルごとの判定が一致したもの。判定できなければnull) */
  detectedCompany: CompanyId | null;
  targetMonth: string;
  monthBasis: string[];
  payDates: string[];
  files: CsvFileSummary[];
  /** ②の行のうち、③に受注番号(無ければ請求No)が見つかった数 */
  billingLinkedToInvoice?: { linked: number; total: number };
  existing: { payroll: number; billing: number; invoice: number; manual: { label: string; count: number }[] };
  replacesCategories: CsvCardKind[];
  /** 検算の結果(合わなければ警告にも出す。取込みは止めない)。okがnullは「確かめられない」 */
  checks: { label: string; ok: boolean | null; detail: string }[];
  /** 拠点ごとの取込みの規則で行ったこと(松山の2行のまとめなど) */
  notes: string[];
  blockers: string[];
  warnings: string[];
  confirmations: { id: string; label: string }[];
  rows: { payrollRows?: PayrollRow[]; billingRows?: BillingRow[]; invoiceRows?: InvoicePrintRow[] };
}

const companyName = (id: CompanyId) => COMPANIES.find((c) => c.id === id)?.name ?? id;
const unique = <T,>(xs: T[]) => [...new Set(xs)];

/**
 * 選んだCSV(①②は1つずつ、③は複数)から、確認画面の内容を作る。
 * @param getMonthState 登録済みの月のデータ(選んでいる会社)。無ければundefined
 */
export function buildCsvImportPreview(
  files: PendingCsvFile[],
  selectedCompanyId: CompanyId,
  getMonthState: (month: string) => MonthlyDataState | undefined
): CsvImportPreview {
  const blockers: string[] = [];
  const warnings: string[] = [];
  // 必要なカードがそろっていなければ止める(★2026-11-26 はまさんの判断: ①だけ・①③だけ等で取り込むと、Excelで取り込み済みの月の
  // 給与だけが置き換わり請求と食い違うため。①なしで②③だけを登録済みの①と突き合わせて取り込む例外も取りやめた)
  const required = REQUIRED_CSV_CARDS[selectedCompanyId];
  const missing = required.filter((c) => !files.some((f) => f.card === c));
  if (files.length > 0 && missing.length > 0) {
    blockers.push(
      `${required.map((c) => CSV_CARD_FULL_LABEL[c]).join('・')}を、すべて一緒に選んでください。足りないもの: ${missing.map((c) => CSV_KIND_LABEL[c]).join('・')}`
    );
  }
  const payrollFile = files.find((f) => f.card === 'payroll');
  const billingFile = files.find((f) => f.card === 'billing');
  const invoiceFiles = files.filter((f) => f.card === 'invoice');
  const invoiceListFile = files.find((f) => f.card === 'invoiceList');
  const checks: CsvImportPreview['checks'] = [];
  const notes: string[] = [];

  // ファイルごとの種類・拠点
  const summaries: CsvFileSummary[] = files.map((f) => {
    const { kind, columnCount } = detectCsvKind(f.text);
    const { rows } = parseRaw(f.text);
    const summary: CsvFileSummary = {
      card: f.card,
      fileName: f.fileName,
      rowCount: rows.length,
      columnCount,
      detectedKind: kind,
      detectedCompany: detectCompanyFromCsv(f.text).company,
      fileNameMonth: extractMonthFromFileName(f.fileName),
    };
    if (f.card === 'invoice') {
      summary.closing = closingFromFileName(f.fileName);
      summary.subtotal = rows.reduce((s, r) => s + (Number(String(r['小計'] ?? '').replace(/,/g, '')) || 0), 0);
    }
    if (kind !== f.card) {
      blockers.push(
        kind === 'unknown'
          ? `「${f.fileName}」は${CSV_KIND_LABEL[f.card]}の形ではありません(${columnCount}列。見出しで判定できませんでした)。`
          : `「${f.fileName}」は${CSV_KIND_LABEL[kind]}のようです(${columnCount}列)。${CSV_KIND_LABEL[f.card]}のカードには入れられません。`
      );
    }
    return summary;
  });

  // ②の社保負担額の列
  if (billingFile && detectCsvKind(billingFile.text).kind === 'billing' && !billingHasSocialInsuranceColumn(billingFile.text)) {
    blockers.push(
      `②「${billingFile.fileName}」に社保負担額の列がありません。スタナビで、出力オプション『社会保険料の～』と『事業主負担額に労災保険～』にチェックを入れて、出し直してください。`
    );
  }

  // 拠点
  const detectedSet = unique(summaries.map((s) => s.detectedCompany).filter((c): c is CompanyId => !!c));
  const detectedCompany = detectedSet.length === 1 ? detectedSet[0] : null;
  if (detectedSet.length > 1) {
    blockers.push(`ファイルによって拠点が違います(${detectedSet.map(companyName).join('・')})。同じ拠点のファイルだけを選んでください。`);
  } else if (detectedCompany && detectedCompany !== selectedCompanyId) {
    blockers.push(
      `CSVの中身は「${companyName(detectedCompany)}」のデータですが、今は「${companyName(selectedCompanyId)}」を選んでいます。画面上部で会社を選び直してください。`
    );
  } else if (!detectedCompany && files.length > 0) {
    blockers.push('CSVの中身(スタッフ番号・クライアント番号・請求Noの形)から拠点を判定できませんでした。取り込まずに、はまさんに連絡してください。');
  }

  // 解析
  // ①の交通費の列は拠点ごと(config/payrollColumns.ts。松山は「交通費」+「非課税他１」)
  const payrollRows = payrollFile
    ? parsePayrollCsv(payrollFile.text, payrollFile.fileName, { transportColumns: PAYROLL_TRANSPORT_COLUMNS[selectedCompanyId] })
    : undefined;
  const billingRows = billingFile ? parseBillingCsv(billingFile.text, billingFile.fileName) : undefined;
  const invoiceRows = invoiceFiles.length > 0 ? invoiceFiles.flatMap((f) => parseInvoicePrintCsv(f.text, f.fileName)) : undefined;
  const invoiceListRows: InvoiceListRow[] | undefined = invoiceListFile ? parseInvoiceListCsv(invoiceListFile.text) : undefined;

  // 対象年月
  const monthBasis: string[] = [];
  let targetMonth = '';
  const payDates = payrollRows ? unique(payrollRows.map((r) => r.payDate || '').filter(Boolean)).sort() : [];
  if (payrollRows) {
    const months = unique(payrollRows.map((r) => deriveTargetMonthFromPayDate(r.payDate || '')).filter(Boolean));
    if (months.length === 1) {
      targetMonth = months[0];
      monthBasis.push(`①の支払日(${payDates.join('・')})の前月`);
    } else if (months.length === 0) {
      blockers.push('①に支払日(支給日)が無く、対象年月を決められません。スタナビの給与計算書印刷CSV(全項目ON)を入れてください。');
    } else {
      blockers.push(`①の支払日が複数の月にまたがっています(${payDates.join('・')})。1か月分ずつ取り込んでください。`);
    }
  }

  // ①の行(同じ回に選んだもの)
  const basePayroll = payrollRows ?? [];
  const grossByStaff = new Map(basePayroll.map((p) => [norm(p.staffNo), p]));

  // ②と①の突き合わせ(スタッフごとの支払額と総支給額。立替金を除いて一致しても可)
  if (billingRows && targetMonth) {
    const payByStaff = new Map<string, number>();
    billingRows.forEach((b) => payByStaff.set(norm(b.staffNo), (payByStaff.get(norm(b.staffNo)) || 0) + (b.paymentAmount || 0)));
    const staff = [...payByStaff.entries()].filter(([, v]) => v !== 0);
    const matched = staff.filter(([s, v]) => {
      const p = grossByStaff.get(s);
      return p && (p.paymentAmount === v || p.paymentAmount - (p.reimbursement || 0) === v);
    }).length;
    if (staff.length > 0 && matched / staff.length < 0.5) {
      blockers.push(
        `②の支払額が①の総支給額と合うスタッフが${staff.length}人中${matched}人しかいないため、②を${formatMonthJa(targetMonth)}の①に結び付けられません。別の月のファイルではありませんか。`
      );
    } else if (staff.length > 0) {
      monthBasis.push(`②の支払額と①の総支給額が${staff.length}人中${matched}人で一致`);
      if (matched < staff.length) warnings.push(`②の支払額が①の総支給額と合わないスタッフが${staff.length - matched}人います。`);
    }
  }

  // ③の紐付け(②があれば請求No・受注番号、無ければ①のスタッフ番号)
  let billingLinkedToInvoice: CsvImportPreview['billingLinkedToInvoice'];
  if (invoiceRows && targetMonth) {
    if (billingRows) {
      const billNos = new Set(billingRows.map((b) => norm(b.billingNo)).filter(Boolean));
      const orderNos = new Set(billingRows.map((b) => norm(b.orderNo)).filter(Boolean));
      const linked = invoiceRows.filter((i) => (i.orderNo && orderNos.has(norm(i.orderNo))) || billNos.has(norm(i.billingNo))).length;
      if (invoiceRows.length > 0 && linked / invoiceRows.length < 0.5) {
        blockers.push(`③の${invoiceRows.length}行のうち、②の請求No・受注番号に当たるのが${linked}行しかないため、③を②に結び付けられません。別の月のファイルではありませんか。`);
      } else {
        monthBasis.push(`③の請求番号・受注番号が②と${invoiceRows.length}行中${linked}行で一致`);
      }
      // ②の請求額と③の小計(請求Noごと)
      const subByNo = new Map<string, number>();
      invoiceFiles.forEach((f) =>
        parseRaw(f.text).rows.forEach((r) => {
          const no = norm(r['請求番号'] ?? r['請求No']);
          subByNo.set(no, (subByNo.get(no) || 0) + (Number(String(r['小計'] ?? '').replace(/,/g, '')) || 0));
        })
      );
      const billByNo = new Map<string, number>();
      billingRows.forEach((b) => billByNo.set(norm(b.billingNo), (billByNo.get(norm(b.billingNo)) || 0) + (b.billingAmountExTax || 0)));
      const invNos = new Set(invoiceRows.map((i) => norm(i.billingNo)));
      const invOrders = new Set(invoiceRows.map((i) => norm(i.orderNo)).filter(Boolean));
      const missingNos = [...billByNo.keys()].filter((k) => k && !invNos.has(k));
      const missingOrders = billingRows.filter((b) => b.orderNo && !invOrders.has(norm(b.orderNo))).length;
      const amountMismatch = [...billByNo.entries()].filter(([k, v]) => invNos.has(k) && subByNo.get(k) !== v).length;
      billingLinkedToInvoice = {
        linked: billingRows.filter((b) => (b.orderNo && invOrders.has(norm(b.orderNo))) || invNos.has(norm(b.billingNo))).length,
        total: billingRows.length,
      };
      if (missingNos.length > 0 || missingOrders > 0) {
        warnings.push(
          `締め日のファイルが足りない可能性があります: ②の請求Noのうち③に無いものが${missingNos.length}件、受注番号のうち③に無いものが${missingOrders}件あります(15日締・20日締・末締がそろっているか確かめてください)。`
        );
      }
      if (amountMismatch > 0) warnings.push(`②の請求額と③の小計が合わない請求書が${amountMismatch}枚あります。`);
    } else {
      const staffSet = new Set(basePayroll.map((p) => norm(p.staffNo)));
      const withStaff = invoiceRows.filter((i) => i.staffNo);
      const linked = withStaff.filter((i) => staffSet.has(norm(i.staffNo))).length;
      if (withStaff.length === 0 || linked / withStaff.length < 0.5) {
        blockers.push(`③のスタッフ番号が①と${withStaff.length}行中${linked}行しか合わないため、③を${formatMonthJa(targetMonth)}に結び付けられません。`);
      } else {
        monthBasis.push(`③のスタッフ番号が①と${withStaff.length}行中${linked}行で一致`);
      }
    }
  }

  // ④の請求日の月(①から決めた対象年月と違えば止める)
  if (invoiceListFile && invoiceListRows && targetMonth) {
    const months = unique(invoiceListRows.map((r) => r.invoiceDate.slice(0, 7)).filter(Boolean));
    if (invoiceListRows.length === 0) {
      blockers.push(`④「${invoiceListFile.fileName}」から請求書を読めませんでした(請求No・請求日・消費税・請求合計額の列を確かめてください)。`);
    } else if (months.length !== 1 || months[0] !== targetMonth) {
      blockers.push(
        `④の請求日の月(${months.map(formatMonthJa).join('・') || '読めない'})が、①から決めた対象年月(${formatMonthJa(targetMonth)})と違います。同じ月のファイルを選んでください。`
      );
    } else {
      monthBasis.push(`④の請求日がすべて${formatMonthJa(targetMonth)}`);
    }
  }

  // 検算1: ①の非課税の支給(総支給額 − 社保合計額 − 課税対象額)と、読めた交通費+立替金など(1円でも違えば警告)
  if (payrollFile && payrollRows) {
    const { headers } = parseRaw(payrollFile.text);
    const label = '①の非課税の支給と、読めた交通費・立替金など';
    if (headers.includes('課税対象額') && (headers.includes('社保合計額') || headers.includes('社保合計'))) {
      let expected = 0;
      let read = 0;
      let off = 0;
      payrollRows.forEach((p) => {
        const e = (p.paymentAmount || 0) - (p.socialInsurance || 0) - (p.taxableIncomeBase || 0);
        const r = (p.salaryTransport || 0) + (p.reimbursement || 0) + (p.commsAllowance || 0) + (p.nonTaxableOtherAllowances || 0);
        expected += e;
        read += r;
        if (e !== r) off++;
      });
      const ok = off === 0;
      checks.push({
        label,
        ok,
        detail: `非課税の支給(総支給額−社保合計額−課税対象額)の合計 ¥${expected.toLocaleString()} / 読めた交通費・立替金などの合計 ¥${read.toLocaleString()}${ok ? '' : `(合わない人 ${off}人)`}`,
      });
      if (!ok) {
        warnings.push(
          `給与データの交通費などが読めていない可能性があります(${off}人)。非課税の支給額(総支給額−社保合計額−課税対象額)は合計¥${expected.toLocaleString()}ですが、取り込めた交通費・立替金などの合計は¥${read.toLocaleString()}です。①の交通費の列の見出しを確かめてください。`
        );
      }
    } else {
      checks.push({ label, ok: null, detail: '①に課税対象額・社保合計額の列が無いため、確かめられません。' });
    }
  }

  // 検算2: ②の社保負担額と、①から見込んだ額(本人の健保・介護・年金 + 会社の雇用保険 + 労災)。1人±2円を超えれば警告。
  // 四国は労災等の率が近似(0.2%)で1円単位では合わないため、確かめない(config/socialInsuranceCheck.ts)。
  if (billingRows && payrollRows && targetMonth && billingFile && billingHasSocialInsuranceColumn(billingFile.text)) {
    const label = '②の社保負担額と、①から見込んだ額(1人±2円)';
    if (selectedCompanyId === 'shikoku') {
      checks.push({ label, ok: null, detail: '四国は労災等の率が近似値のため、確かめません。' });
    } else {
      const eiRate = employerEmploymentInsuranceRate(targetMonth);
      const wcRate = workersCompRate(WORKERS_COMP_RATES_IN_SOCIAL_INSURANCE[selectedCompanyId], targetMonth);
      const billed = new Map<string, number>();
      billingRows.forEach((b) => billed.set(norm(b.staffNo), (billed.get(norm(b.staffNo)) || 0) + (b.socialInsuranceBilling || 0)));
      let off = 0;
      let billedTotal = 0;
      let expectedTotal = 0;
      billed.forEach((v, staff) => {
        const p = grossByStaff.get(staff);
        if (!p) return;
        const gross = p.paymentAmount || 0;
        const eiBase = p.employmentInsuranceBase && p.employmentInsuranceBase > 0 ? p.employmentInsuranceBase : gross;
        const expected =
          (p.healthInsurance || 0) +
          (p.nursingInsurance || 0) +
          (p.pensionInsurance || 0) +
          ((p.employmentInsurance || 0) > 0 ? Math.round(eiBase * eiRate) : 0) +
          Math.round(gross * wcRate);
        billedTotal += v;
        expectedTotal += expected;
        if (Math.abs(v - expected) > 2) off++;
      });
      const ok = off === 0;
      const rates = `雇用保険(会社) ${(eiRate * 100).toFixed(2)}%${wcRate ? `・労災 ${(wcRate * 100).toFixed(2)}%` : ''}`;
      checks.push({
        label,
        ok,
        detail: `②の社保負担額の合計 ¥${billedTotal.toLocaleString()} / ①から見込んだ額の合計 ¥${expectedTotal.toLocaleString()}(${rates})${ok ? '' : `。±2円を超える人 ${off}人`}`,
      });
      if (!ok) warnings.push(`②の社保負担額が、①から見込んだ額と±2円を超えて違うスタッフが${off}人います(${rates}で計算)。`);
    }
  }

  // 検算3: ④の請求書(売上(課税)+売上(非課税))と、②の請求額・③の小計(請求Noごと)
  if (invoiceListRows && billingRows) {
    const billByNo = new Map<string, number>();
    billingRows.forEach((b) => billByNo.set(norm(b.billingNo), (billByNo.get(norm(b.billingNo)) || 0) + (b.billingAmountExTax || 0)));
    const subByNo = new Map<string, number>();
    (invoiceRows ?? []).forEach((i) => subByNo.set(norm(i.billingNo), (subByNo.get(norm(i.billingNo)) || 0) + (i.subtotal || 0)));
    const listNos = new Set(invoiceListRows.map((r) => r.billingNo));
    const notInList = [...billByNo.keys()].filter((k) => k && !listNos.has(k)).length;
    const notInBilling = invoiceListRows.filter((r) => !billByNo.has(r.billingNo)).length;
    const amountOff = invoiceListRows.filter((r) => {
      const sales = r.taxableAmount + r.nonTaxableAmount;
      return billByNo.has(r.billingNo) && (billByNo.get(r.billingNo) !== sales || (!!invoiceRows && subByNo.get(r.billingNo) !== sales));
    }).length;
    const totalOff = invoiceListRows.filter((r) => r.taxableAmount + r.nonTaxableAmount + r.consumptionTax !== r.totalAmount).length;
    const ok = notInList + notInBilling + amountOff + totalOff === 0;
    const total = invoiceListRows.reduce((s, r) => s + r.totalAmount, 0);
    const tax = invoiceListRows.reduce((s, r) => s + r.consumptionTax, 0);
    checks.push({
      label: '④の請求合計額と、②③の合計(請求Noごと)',
      ok,
      detail:
        `④ ${invoiceListRows.length}枚・請求合計額 ¥${total.toLocaleString()}(うち消費税 ¥${tax.toLocaleString()})` +
        (ok
          ? '。②の請求額・③の小計と、すべての請求書で一致'
          : `。②③と合わない請求書 ${amountOff}枚・②に無い請求書 ${notInBilling}枚・④に無い②の請求No ${notInList}件・請求合計額が課税+非課税+消費税と合わない請求書 ${totalOff}枚`),
    });
    if (!ok) warnings.push('④の請求書が②③と合いません(「検算」を見てください)。④に無い請求書の行は、税込額を今までの計算で出します。');
  }

  // 松山の規則(交通費・2行のまとめ・立替金・④の消費税。utils/matsuyamaCsvImport.ts)
  let outBillingRows = billingRows;
  let outInvoiceRows = invoiceRows;
  if (selectedCompanyId === 'matsuyama' && billingRows && invoiceRows) {
    const r = applyMatsuyamaCsvRules(payrollRows ?? [], billingRows, invoiceRows, invoiceListRows ?? []);
    outBillingRows = r.billingRows;
    outInvoiceRows = r.invoiceRows;
    if (r.mergedGroups.length > 0) {
      notes.push(
        `受注番号が分かれた同じ契約(同じ請求No・スタッフ・クライアントで、支払額のある行が1つ)を1行にまとめます: ${r.mergedGroups.length}件(②の${billingRows.length}行→${r.billingRows.length}行)`
      );
    }
    notes.push('請求交通費は③の「交通費－金額」+「課税１－金額」です。');
    if (invoiceListRows?.length) notes.push('税込額は、④の請求書ごとの消費税を、その請求書の行に課税額の比で分けて出します。');
    warnings.push(...r.warnings);
  }

  // ファイル名の年月は確かめにだけ使う
  if (targetMonth) {
    summaries
      .filter((s) => s.fileNameMonth && s.fileNameMonth !== targetMonth)
      .forEach((s) =>
        blockers.push(`「${s.fileName}」のファイル名は${formatMonthJa(s.fileNameMonth)}ですが、中身から決めた対象年月は${formatMonthJa(targetMonth)}です。ファイルが正しいか確かめてください。`)
      );
  }

  // 同じ締め日の③が2つ
  const closings = invoiceFiles.map((f) => closingFromFileName(f.fileName)).filter(Boolean);
  const dupClosings = unique(closings.filter((c, i) => closings.indexOf(c) !== i));
  if (dupClosings.length > 0) warnings.push(`③に同じ締め日(${dupClosings.join('・')})のファイルが2つ以上あります。`);

  // 登録済みのデータ
  const existingState = targetMonth ? getMonthState(targetMonth) : undefined;
  const existing = {
    payroll: existingState?.payrollRows?.length ?? 0,
    billing: existingState?.billingRows?.length ?? 0,
    invoice: existingState?.invoiceRows?.length ?? 0,
    manual: MANUAL_CATEGORY_LABEL.map(([k, label]) => ({ label, count: (existingState?.[k] as unknown[] | undefined)?.length ?? 0 })).filter((m) => m.count > 0),
  };
  const replacesCategories = unique(files.map((f) => f.card)).filter((c) => {
    const cat = CARD_CATEGORY[c];
    return !!cat && !!(existingState?.[cat] as unknown[] | undefined)?.length;
  });
  if (replacesCategories.length > 0) {
    warnings.push(
      `${formatMonthJa(targetMonth)}には登録済みのデータがあります。取り込むと、この月の${replacesCategories.map((c) => CSV_KIND_LABEL[c].slice(0, 1)).join('')}が置き換わります。`
    );
  }

  const confirmations: { id: string; label: string }[] = [
    { id: 'company', label: `拠点が『${companyName(selectedCompanyId)}』で間違いありません` },
  ];
  if (targetMonth) confirmations.push({ id: 'month', label: `対象年月が『${formatMonthJa(targetMonth)}』で間違いありません` });
  if (invoiceFiles.length > 0) confirmations.push({ id: 'closings', label: '15日締・20日締・末締の、すべてのファイルを入れました' });
  if (replacesCategories.length > 0) confirmations.push({ id: 'replace', label: '登録済みのデータが置き換わることを理解しました' });

  const withMonth = <T extends { targetMonth: string }>(rows: T[] | undefined) => rows?.map((r) => ({ ...r, targetMonth }));
  return {
    selectedCompanyId,
    detectedCompany,
    targetMonth,
    monthBasis,
    payDates,
    files: summaries,
    billingLinkedToInvoice,
    existing,
    replacesCategories,
    blockers,
    warnings,
    confirmations,
    checks,
    notes,
    rows: { payrollRows: withMonth(payrollRows), billingRows: withMonth(outBillingRows), invoiceRows: withMonth(outInvoiceRows) },
  };
}
