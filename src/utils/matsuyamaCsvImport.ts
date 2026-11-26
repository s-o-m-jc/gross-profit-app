/**
 * 派遣事業 粗利・経理管理システム
 * 松山のCSV直接取込み(①②③④)の規則 (★2026-11-26追加、はまさんの決定。テスト: matsuyamaCsvImport.test.ts)
 *
 * 松山の経理のExcel(★派遣明細)と1円まで合わせるため、CSVの取込み(確認画面)でだけ使う。四国・大阪と、過去実績Excel取込みには使わない。
 * 1. 請求交通費は③(実際に請求した額)を正とする: ③の「交通費－金額」+「課税１－金額」(定額交通費の日割りを課税１で請求している)。
 *    Excelの「請求支払一覧」の副表は契約上の定額を受注ごとに出すため、日割りや受注が2つに分かれた月に多くなる。
 * 2. 同じ請求No・スタッフ・クライアントで受注番号が2つ以上に分かれ、支払額のある行が1つ以下なら、1つの契約にまとめる
 *    (Excelでは経理が手で行を消して請求額を足している。請求額・有給などを二重に数えないため)。支払額のある行の受注番号・受注名称を残す。
 * 3. 立替金は、③の非課税(プラス)のうち、③の備考に「立替」「寸志」があるもの、または①の「立替金」の欄と同額のもの。
 *    ①の交通費の枠(非課税他１)とは比べない(交通費を立替金と取り違えないため)。
 * 4. ④請求一覧CSVの請求書ごとの消費税を、その請求書の行に課税額(請求額−非課税)の比で分け(円未満切り捨て、端数は課税額が一番大きい行)、
 *    請求行の税込額(billingAmountIncTax)にする。④に無い請求書の行は今までの計算(行ごとの税込換算)のまま。
 */
import Papa from 'papaparse';
import { PayrollRow, BillingRow, InvoicePrintRow, InvoiceListRow } from '../types';
import { allocateByGuide } from './calculator';

const norm = (s: unknown) => String(s ?? '').normalize('NFKC').trim();
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};

/** 日付("2026/07/31"・"2026-07-31"・Excelのシリアル値)を"YYYY-MM-DD"にする。読めなければ空 */
export function normalizeDate(v: unknown): string {
  const s = norm(v);
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return '';
}

/** ④請求一覧CSVを読む(見出しで列を探す。請求Noの無い行は読まない) */
export function parseInvoiceListCsv(text: string): InvoiceListRow[] {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];
  const key = (...names: string[]) => fields.find((f) => names.includes(norm(f))) ?? '';
  const noKey = key('請求No', '請求番号');
  const dateKey = key('請求日');
  const taxableKey = key('売上(課税)');
  const nonTaxableKey = key('売上(非課税)');
  const taxKey = key('消費税');
  const totalKey = key('請求合計額');
  return parsed.data
    .map((r) => ({
      billingNo: norm(r[noKey]),
      invoiceDate: normalizeDate(r[dateKey]),
      taxableAmount: num(r[taxableKey]),
      nonTaxableAmount: num(r[nonTaxableKey]),
      consumptionTax: num(r[taxKey]),
      totalAmount: num(r[totalKey]),
    }))
    .filter((r) => /^\d+$/.test(r.billingNo));
}

export interface MatsuyamaCsvResult {
  billingRows: BillingRow[];
  invoiceRows: InvoicePrintRow[];
  /** まとめた契約(スタッフ番号・請求No・まとめた受注番号) */
  mergedGroups: { staffNo: string; billingNo: string; orderNos: string[] }[];
  warnings: string[];
}

/** 松山のCSVの規則を当てる(上のコメントの1〜4)。invoiceListRowsが空なら税込額は付けない */
export function applyMatsuyamaCsvRules(
  payrollRows: PayrollRow[],
  billingRows: BillingRow[],
  invoiceRows: InvoicePrintRow[],
  invoiceListRows: InvoiceListRow[] = []
): MatsuyamaCsvResult {
  const warnings: string[] = [];

  // 1. ③の請求交通費 = 交通費－金額 + 課税１－金額
  const invoices = invoiceRows.map((inv) => ({ ...inv, transportAmount: (inv.transportAmount || 0) + (inv.taxable1Amount || 0) }));
  const invoicesByOrder = new Map<string, InvoicePrintRow[]>();
  invoices.forEach((inv) => {
    if (inv.orderNo) invoicesByOrder.set(norm(inv.orderNo), [...(invoicesByOrder.get(norm(inv.orderNo)) || []), inv]);
  });

  // 2. 受注番号が分かれた同じ契約をまとめる
  const groups = new Map<string, BillingRow[]>();
  billingRows.forEach((b) => {
    const k = `${b.targetMonth}_${norm(b.billingNo)}_${norm(b.staffNo)}_${norm(b.clientCode)}`;
    groups.set(k, [...(groups.get(k) || []), b]);
  });
  const mergedGroups: MatsuyamaCsvResult['mergedGroups'] = [];
  const merged: { row: BillingRow; orderNos: string[] }[] = [];
  groups.forEach((rows) => {
    const orderNos = rows.map((r) => norm(r.orderNo)).filter(Boolean);
    const paying = rows.filter((r) => (r.paymentAmount || 0) !== 0);
    if (rows.length < 2 || !rows[0].billingNo || paying.length > 1 || new Set(orderNos).size < 2) {
      rows.forEach((r) => merged.push({ row: r, orderNos: r.orderNo ? [norm(r.orderNo)] : [] }));
      return;
    }
    const base = paying[0] ?? rows[0];
    mergedGroups.push({ staffNo: base.staffNo, billingNo: base.billingNo, orderNos });
    merged.push({
      row: {
        ...base,
        billingAmountExTax: rows.reduce((s, r) => s + (r.billingAmountExTax || 0), 0),
        paymentAmount: rows.reduce((s, r) => s + (r.paymentAmount || 0), 0),
        socialInsuranceBilling: rows.reduce((s, r) => s + (r.socialInsuranceBilling || 0), 0),
        paidLeaveDaysUsed: rows.reduce((s, r) => s + (r.paidLeaveDaysUsed || 0), 0),
        referralFee: rows.reduce((s, r) => s + (r.referralFee || 0), 0),
        workHours: rows.reduce((s, r) => s + (r.workHours || 0), 0),
      },
      orderNos,
    });
  });

  // 1・3. 行ごとの請求交通費・非課税・立替金(③の、その行の受注番号の請求書行の合計)
  const payrollByStaff = new Map(payrollRows.map((p) => [norm(p.staffNo), p]));
  const usedReimbursement = new Set<string>();
  const withInvoice = merged.map(({ row, orderNos }) => {
    const invs = orderNos.flatMap((o) => invoicesByOrder.get(o) || []);
    if (invs.length === 0) return row;
    const transport = invs.reduce((s, i) => s + (i.transportAmount || 0), 0);
    const nonTaxable = invs.some((i) => i.nonTaxableAmount !== undefined) ? invs.reduce((s, i) => s + (i.nonTaxableAmount || 0), 0) : undefined;
    let reimbursementAmount: number | undefined;
    const byRemarks = invs.reduce((s, i) => s + (i.reimbursementAmount || 0), 0);
    const staff = norm(row.staffNo);
    const payrollReimbursement = payrollByStaff.get(staff)?.reimbursement || 0;
    if (byRemarks > 0) {
      reimbursementAmount = byRemarks;
    } else if (nonTaxable && nonTaxable > 0 && payrollReimbursement === nonTaxable && !usedReimbursement.has(staff)) {
      reimbursementAmount = nonTaxable;
      usedReimbursement.add(staff);
    }
    return { ...row, billingTransport: transport, nonTaxableAmount: nonTaxable, reimbursementAmount };
  });

  // 4. ④の請求書ごとの消費税を行に分ける
  let result = withInvoice;
  if (invoiceListRows.length > 0) {
    const taxByNo = new Map(invoiceListRows.map((r) => [r.billingNo, r]));
    const rowsByNo = new Map<string, number[]>();
    result.forEach((b, i) => rowsByNo.set(norm(b.billingNo), [...(rowsByNo.get(norm(b.billingNo)) || []), i]));
    result = result.map((b) => ({ ...b }));
    rowsByNo.forEach((idxs, no) => {
      const inv = taxByNo.get(no);
      if (!inv) {
        warnings.push(`請求No ${no} が④請求一覧CSVに無いため、その行の税込額は今までの計算(行ごとの換算)にしました。`);
        return;
      }
      const taxable = idxs.map((i) => Math.max(0, (result[i].billingAmountExTax || 0) - (result[i].nonTaxableAmount || 0)));
      allocateByGuide(inv.consumptionTax, taxable).forEach((tax, j) => {
        const b = result[idxs[j]];
        b.billingAmountIncTax = (b.billingAmountExTax || 0) - (b.reimbursementAmount || 0) + tax;
      });
    });
  }

  return { billingRows: result, invoiceRows: invoices, mergedGroups, warnings };
}
