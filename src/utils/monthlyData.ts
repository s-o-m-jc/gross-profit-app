/**
 * 派遣事業 粗利・経理管理システム
 * 会社×対象月ごとのCSVデータを管理するための型・純粋関数群 (React非依存)
 *
 * 2026-08-21: 「1回きりのCSVアップロードで終わり」ではなく、毎月新しいCSVを追加
 * アップロードしながら決算期を通して使い続ける運用にするため、データ構造を
 * 会社ID → 対象月(YYYY-MM) → {payrollRows, billingRows, invoiceRows, retirementRows}
 * の2段階キー構造に変更した。同一カテゴリを同じ月に再アップロードした場合は、
 * その月のそのカテゴリだけをクリーンに置き換える(他の月・他のカテゴリ・他社は保持)。
 *
 * ★2026-08-21追記: 当初InvoicePrintRow(請求書印刷CSV)はtargetMonth列を持たないと
 * 想定し、月バケツに分けず固定の疑似キー(旧INVOICE_BUCKET_KEY)へ丸ごと格納していた。
 * しかしこの設計だと、4月分の請求書印刷CSVアップロード後に5月分をアップロードすると
 * 4月分のInvoicePrintRowが消え、4月分の請求＠(billingUnitPrice)が0円になったり
 * invoicePrintStatusが誤ってMISSING_INVOICEになったりする不具合があった。
 * 請求支払一覧CSVと同じく「対象年月はファイル名に由来する」(11-2章)ルールを適用して
 * targetMonthを取得できるようにし、他の3カテゴリと同じ月バケツ方式に統一した。
 */

import {
  PayrollRow,
  BillingRow,
  InvoicePrintRow,
  RetirementRow,
  LeaveCompensationRow,
  LeaveAllowanceRow,
  NextMonthAdjustmentRow,
} from '../types';
import { CompanyId, COMPANIES } from '../config/companies';
import {
  getSamplePayrollData,
  getSampleBillingData,
  getSampleInvoicePrintData,
  getSampleRetirementData,
} from './sampleData';

export interface MonthlyDataState {
  payrollRows: PayrollRow[];
  billingRows: BillingRow[];
  invoiceRows: InvoicePrintRow[];
  retirementRows: RetirementRow[];
  // 15章: 手入力調整項目 (休業分補償・休業手当・次月調整)。CSVアップロードではなく
  // フォームから1件ずつ追加/削除するため、他のカテゴリと違い「置き換え」ではなく
  // 追加・削除の専用ヘルパー(addManualEntryRow/removeManualEntryRow)で操作する。
  leaveCompensationRows: LeaveCompensationRow[];
  leaveAllowanceRows: LeaveAllowanceRow[];
  nextMonthAdjustmentRows: NextMonthAdjustmentRow[];
}

export type MonthlyCategory = keyof MonthlyDataState;

/**
 * 手入力調整項目(1件ずつ追加/削除するカテゴリ)を指すキーのユニオン。
 * ★2026-08-26: retirementRows(退職金)もCSV取込から手入力方式に変更したため追加。
 */
export type ManualEntryCategory =
  | 'leaveCompensationRows'
  | 'leaveAllowanceRows'
  | 'nextMonthAdjustmentRows'
  | 'retirementRows';

/** 対象月が空/判定不能だった行の格納先 (実際のYYYY-MM形式とは衝突しない固定文字列) */
export const UNKNOWN_MONTH_KEY = '対象月不明';
/**
 * 旧バージョン(2026-08-21の初回実装)で、請求書印刷CSVをtargetMonthなしの固定バケツに
 * 格納していた際のキー。IndexedDB/バックアップファイルに残っている可能性がある古いデータを
 * 読み込み時にUNKNOWN_MONTH_KEYへ移行するためだけに残している(新規保存では使わない)。
 */
const LEGACY_INVOICE_BUCKET_KEY = '__invoice__';

export type CompanyMonthlyData = Record<string, MonthlyDataState>;
export type AppMonthlyData = Record<CompanyId, CompanyMonthlyData>;

export function emptyMonthlyDataState(): MonthlyDataState {
  return {
    payrollRows: [],
    billingRows: [],
    invoiceRows: [],
    retirementRows: [],
    leaveCompensationRows: [],
    leaveAllowanceRows: [],
    nextMonthAdjustmentRows: [],
  };
}

export function initialAppMonthlyData(): AppMonthlyData {
  const app = {} as AppMonthlyData;
  COMPANIES.forEach((c) => {
    app[c.id] = {};
  });
  return app;
}

/** targetMonthフィールドを持つ行の配列を、対象月ごとにグルーピングする */
export function groupByTargetMonth<T extends { targetMonth: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  rows.forEach((r) => {
    const key = r.targetMonth && r.targetMonth.trim() ? r.targetMonth : UNKNOWN_MONTH_KEY;
    const arr = map.get(key) || [];
    arr.push(r);
    map.set(key, arr);
  });
  return map;
}

/**
 * ある会社の月別データに、1カテゴリ分の「月ごとにグルーピング済みの行」をマージする。
 * 該当する月のそのカテゴリだけを新しい内容で置き換える(他のカテゴリ・他の月には触れない)。
 * 同一月への再アップロードは、この置き換えによって「重複追加ではなくクリーンな置き換え」になる。
 * payrollRows/billingRows/invoiceRows/retirementRowsのいずれも、このヘルパー1つで統一的に扱う。
 */
export function mergeGroupedRowsIntoCompanyMonths<K extends MonthlyCategory>(
  companyMonths: CompanyMonthlyData,
  category: K,
  rowsByMonth: Map<string, MonthlyDataState[K]>
): CompanyMonthlyData {
  const next: CompanyMonthlyData = { ...companyMonths };
  rowsByMonth.forEach((rows, month) => {
    const existing = next[month] || emptyMonthlyDataState();
    next[month] = { ...existing, [category]: rows } as MonthlyDataState;
  });
  return next;
}

/**
 * 手入力調整項目(休業分補償・休業手当・次月調整)を1件、対象月のバケツに追加する。
 * CSVカテゴリと違い「その月のそのカテゴリを丸ごと置き換える」のではなく、既存の手入力行を
 * 保持したまま1件だけ追加する(フォームからの1件ずつの手入力に合わせた挙動)。
 */
export function addManualEntryRow<K extends ManualEntryCategory>(
  companyMonths: CompanyMonthlyData,
  category: K,
  month: string,
  row: MonthlyDataState[K][number]
): CompanyMonthlyData {
  const existing = companyMonths[month] || emptyMonthlyDataState();
  const nextRows = [...(existing[category] || []), row] as MonthlyDataState[K];
  return { ...companyMonths, [month]: { ...existing, [category]: nextRows } };
}

/** 手入力調整項目を1件、id指定で削除する(対象月・カテゴリの他の行、他の月・他のカテゴリには触れない) */
export function removeManualEntryRow(
  companyMonths: CompanyMonthlyData,
  category: ManualEntryCategory,
  month: string,
  rowId: string
): CompanyMonthlyData {
  const existing = companyMonths[month];
  if (!existing) return companyMonths;
  const nextRows = (existing[category] || []).filter((r) => r.id !== rowId) as MonthlyDataState[typeof category];
  return { ...companyMonths, [month]: { ...existing, [category]: nextRows } };
}

/** 会社の全月のデータを1つのフラットなデータ束にまとめる(粗利計算エンジンへの入力用) */
export function flattenCompanyMonths(companyMonths: CompanyMonthlyData): MonthlyDataState {
  const result = emptyMonthlyDataState();
  Object.values(companyMonths).forEach((m) => {
    result.payrollRows.push(...m.payrollRows);
    result.billingRows.push(...m.billingRows);
    result.invoiceRows.push(...m.invoiceRows);
    result.retirementRows.push(...m.retirementRows);
    // 旧バージョンのIndexedDB/バックアップファイルにはこの3カテゴリが存在しない可能性があるため
    // (undefined)、念のため空配列にフォールバックしてから展開する
    result.leaveCompensationRows.push(...(m.leaveCompensationRows || []));
    result.leaveAllowanceRows.push(...(m.leaveAllowanceRows || []));
    result.nextMonthAdjustmentRows.push(...(m.nextMonthAdjustmentRows || []));
  });
  return result;
}

/** 会社の月別データをすべて空にする(データクリア用) */
export function clearCompanyMonths(app: AppMonthlyData, companyId: CompanyId): AppMonthlyData {
  return { ...app, [companyId]: {} };
}

/** アプリ全体(全社・全月)にデータが1件でも存在するか (IndexedDB復元時、サンプル自動読込の要否判定に使用) */
export function hasAnyData(app: AppMonthlyData): boolean {
  return Object.values(app).some((companyMonths) =>
    Object.values(companyMonths || {}).some(
      (m) =>
        m.payrollRows.length > 0 ||
        m.billingRows.length > 0 ||
        m.invoiceRows.length > 0 ||
        m.retirementRows.length > 0 ||
        (m.leaveCompensationRows && m.leaveCompensationRows.length > 0) ||
        (m.leaveAllowanceRows && m.leaveAllowanceRows.length > 0) ||
        (m.nextMonthAdjustmentRows && m.nextMonthAdjustmentRows.length > 0)
    )
  );
}

/** 実際の対象月一覧 (表示用にソート済み) */
export function listRealMonths(companyMonths: CompanyMonthlyData): string[] {
  return Object.keys(companyMonths).sort();
}

/**
 * ★2026-08-27追加(22-16・22-17章)。給与CSVの行が、PayrollRow型の拡張(22章タスク1で
 * 出勤日数・時間内時間等を追加)より前にアップロード・保存された「旧形式」かどうかを判定する。
 *
 * このアプリはCSVの生テキストを保持せず、パース済みのPayrollRow[]をIndexedDB/Supabaseへ
 * そのまま保存する設計のため、型拡張前に保存された行にはworkDays等の新しいフィールドが
 * そもそも存在しない(undefined)。値が0なのではなくフィールド自体が無いため、値の0判定
 * ではなくプロパティの有無で判定する必要がある(実データ検証で、実CSVには出勤日数が
 * 全件非ゼロで入っているにも関わらず画面上0表示になる不具合の根本原因と判明した。22-16章参照)。
 * 該当する場合、その月のCSVを再アップロードすることで解消する(他に復元手段はない)。
 */
export function isLegacyPayrollRow(row: { workDays?: number; totalDeduction?: number }): boolean {
  return row.workDays === undefined && row.totalDeduction === undefined;
}

/** 給与CSVの行の配列に、1件でも旧形式(isLegacyPayrollRow参照)の行が含まれるか */
export function hasLegacyPayrollRows(rows: { workDays?: number; totalDeduction?: number }[]): boolean {
  return rows.length > 0 && rows.some(isLegacyPayrollRow);
}

/**
 * 旧バージョンで固定バケツ(LEGACY_INVOICE_BUCKET_KEY)に格納されていた請求書印刷データを、
 * UNKNOWN_MONTH_KEYへ移行する(データを消さずに保持したまま、月バケツ方式へ統一する)。
 * IndexedDB復元・バックアップファイル読込のどちらでも呼び出す。該当データが無ければ何もしない。
 */
export function migrateLegacyInvoiceBucket(app: AppMonthlyData): AppMonthlyData {
  const next: AppMonthlyData = { ...app };
  (Object.keys(next) as CompanyId[]).forEach((companyId) => {
    const companyMonths = next[companyId];
    const legacy = companyMonths?.[LEGACY_INVOICE_BUCKET_KEY];
    if (!legacy || legacy.invoiceRows.length === 0) return;
    const existingUnknown = companyMonths[UNKNOWN_MONTH_KEY] || emptyMonthlyDataState();
    const updatedMonths = { ...companyMonths };
    updatedMonths[UNKNOWN_MONTH_KEY] = {
      ...existingUnknown,
      invoiceRows: [...existingUnknown.invoiceRows, ...legacy.invoiceRows],
    };
    delete updatedMonths[LEGACY_INVOICE_BUCKET_KEY];
    next[companyId] = updatedMonths;
  });
  return next;
}

/**
 * サンプルデータ(四国人材の2026-04〜06分)を、月ごとにグルーピングして
 * 指定した会社の月別データにマージする(初回起動時 or 「サンプルデータ読込」ボタン用)。
 */
export function mergeSampleDataIntoCompanyMonths(companyMonths: CompanyMonthlyData): CompanyMonthlyData {
  let next = companyMonths;
  next = mergeGroupedRowsIntoCompanyMonths(next, 'payrollRows', groupByTargetMonth(getSamplePayrollData()));
  next = mergeGroupedRowsIntoCompanyMonths(next, 'billingRows', groupByTargetMonth(getSampleBillingData()));
  next = mergeGroupedRowsIntoCompanyMonths(next, 'retirementRows', groupByTargetMonth(getSampleRetirementData()));
  next = mergeGroupedRowsIntoCompanyMonths(next, 'invoiceRows', groupByTargetMonth(getSampleInvoicePrintData()));
  return next;
}
