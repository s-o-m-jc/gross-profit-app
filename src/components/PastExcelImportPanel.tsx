/**
 * 派遣事業 粗利・経理管理システム
 * 過去実績Excel取り込み (フェーズ2、要件整理16章・18-3章・18-6章)
 *
 * 四国・松山の過去分(スタナビCSV取り込み以前の期間)は、拠点担当者が独自にまとめてきた
 * Excelファイル(★派遣明細YYYYMM.xlsm / ★YYMM勤怠明細票 時間計算.xlsm)を取り込む。
 * 抽出ロジック本体はutils/excelImport.tsを参照。ここではファイル選択・対象月確認・
 * 取り込み結果プレビューのUIのみを担当し、確定後はCsvUploaderと同じ
 * onPayrollLoaded/onBillingLoadedハンドラ経由でApp.tsx側のmonthlyDataに反映する
 * (取り込み方式(CSV/Excel)によらず、月バケツへの反映処理は完全に共通化する)。
 *
 * ★2026-09-16追加(はまさんの指摘): 大阪33ヶ月分は1ファイルずつの手作業で完了したが、
 * 四国・松山については複数ファイルをまとめてドラッグ&ドロップ・一括取り込みできるように
 * 拡張した。1ファイル選択のみだった旧UIを、複数ファイルを一覧管理する方式に置き換えた
 * (対象年月の自動判定・手入力欄・読み取り結果・エラー時の他ファイルへの非影響は
 * ファイル単位で個別に保持する)。
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  UploadCloud,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  PlayCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { PayrollRow, BillingRow, InvoicePrintRow, ReferralFeeRow } from '../types';
import { CompanyId } from '../config/companies';
import {
  readWorkbookFile,
  guessTargetMonthFromFileName,
  extractPastData,
  isShikokuAttendanceWorkbook,
  extractShikokuKintaiPastData,
  alignShikokuClientNames,
  diffShikokuMonthImport,
  PastImportCompany,
  PastImportResult,
  ShikokuImportDiff,
} from '../utils/excelImport';

interface PastExcelImportPanelProps {
  /** 現在選択中の会社。四国・松山以外ではこのパネル自体を表示しない(呼び出し元でも判定するが念のため) */
  selectedCompanyId: CompanyId;
  onPayrollLoaded: (data: PayrollRow[]) => void;
  onBillingLoaded: (data: BillingRow[]) => void;
  // ★2026-09-15追加(23章「集計」シート方式の名目指標を行レベルにも拡張): 大阪の
  // 「請求書（スタナビ）」シートのように契約単価(請求＠)データを持つ会社向け。CsvUploaderの
  // onInvoiceLoadedと同じApp.tsx側のハンドラをそのまま渡す想定。
  onInvoiceLoaded: (data: InvoicePrintRow[]) => void;
  // ★2026-10-01追加: 四国の勤怠明細票で、登録済みの給与データに勤怠を補うときに使う(その月の登録済み給与行)
  getMonthPayrollRows: (month: string) => PayrollRow[];
  // ★2026-10-20追加: 四国の勤怠明細票の「実績加工」と照合する、その月の登録済み請求行・紹介手数料
  getMonthBillingRows: (month: string) => BillingRow[];
  getMonthReferralFeeRows: (month: string) => ReferralFeeRow[];
  // ★2026-10-26追加: 四国の勤怠明細票で、派遣売上の請求行に入っていた紹介手数料を付け替えるときに登録する
  onReferralFeeAdded: (row: ReferralFeeRow) => void;
}

function toPastImportCompany(id: CompanyId): PastImportCompany | null {
  if (id === 'matsuyama') return 'matsuyama';
  if (id === 'shikoku') return 'shikoku';
  // ★2026-09-14追加(23章タスク2「大阪の月次データ全月インポート」): 大阪も過去実績Excel
  // (契約別売上実績表)経由での取り込みに対応した(excelImport.ts/extractOsakaPastData参照)。
  if (id === 'osaka') return 'osaka';
  return null;
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// 'confirm': 四国の勤怠明細票で、登録済みのデータとの差があり、取り込む前の確認待ち
type FileStatus = 'pending' | 'processing' | 'confirm' | 'success' | 'error';

/** 確認後に反映する内容(四国の勤怠明細票) */
interface PendingShikokuImport {
  billingRows: BillingRow[];
  payrollRows: PayrollRow[];
  newReferralFeeRows: ReferralFeeRow[];
}

interface PastImportFileEntry {
  id: string;
  file: File;
  /** ファイル名から自動判定できたか(判定できなかった行は手入力を促す表示にする) */
  monthGuessed: boolean;
  /** 対象年月(自動判定値、または運用者による手入力・修正値) */
  targetMonth: string;
  status: FileStatus;
  result?: PastImportResult;
  /** 取込み結果の件数表示を置き換える説明(四国の勤怠明細票) */
  summary?: string;
  errorMessage?: string;
  /** 四国の勤怠明細票: 登録済みのデータとの差 */
  diff?: ShikokuImportDiff;
  /** 四国の勤怠明細票: 確認後に反映する内容(status==='confirm'の間だけ) */
  pending?: PendingShikokuImport;
}

const yen = (n: number) => `${n.toLocaleString()}円`;
const signedYen = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}円`;

/** 四国の勤怠明細票: 登録済みのデータとの差の一覧(★2026-10-27追加) */
function ImportDiffView({ diff, month }: { diff: ShikokuImportDiff; month: string }) {
  const changedTotals = diff.totals.filter((t) => t.before !== t.after);
  return (
    <div className="mt-1.5 border border-amber-300 bg-amber-50 rounded-lg p-2 text-amber-900">
      <p className="font-semibold flex items-start space-x-1">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>
          {month}に登録済みのデータと違うスタッフが{diff.rows.length}人います。勤怠明細票は版が複数あることがあり、ファイル名だけでは
          新旧が分かりません。下の差を見て、この版で取り込んでよいか確認してください。
        </span>
      </p>
      {/-(09|10)$/.test(month) && (
        <p className="mt-1 text-amber-800">
          ※9月・10月は、決算月の9/21〜9/30分の計上月の扱いで、20日締めのスタッフに差が出ることがあります。
        </p>
      )}
      {changedTotals.length > 0 && (
        <p className="mt-1">
          月の合計:{' '}
          {changedTotals.map((t) => `${t.label} ${yen(t.before)} → ${yen(t.after)}(${signedYen(t.after - t.before)})`).join('、')}
        </p>
      )}
      <div className="overflow-auto mt-1.5 max-h-72">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="text-amber-800 border-b border-amber-200">
              <th className="text-left py-1 pr-3 font-semibold whitespace-nowrap">スタッフ</th>
              <th className="text-left py-1 pr-3 font-semibold whitespace-nowrap">派遣先</th>
              <th className="text-left py-1 pr-3 font-semibold whitespace-nowrap">項目</th>
              <th className="text-right py-1 pr-3 font-semibold whitespace-nowrap">登録済み</th>
              <th className="text-right py-1 pr-3 font-semibold whitespace-nowrap">取り込む値</th>
              <th className="text-right py-1 font-semibold whitespace-nowrap">差</th>
            </tr>
          </thead>
          <tbody>
            {diff.rows.flatMap((r) =>
              r.fields.map((f, i) => (
                <tr key={`${r.staffNo}_${f.label}`} className="border-b border-amber-100 last:border-0">
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {i === 0 && (
                      <>
                        {r.staffName}({r.staffNo})
                        {r.kind === 'added' && <span className="ml-1 text-emerald-700">新規</span>}
                        {r.kind === 'removed' && <span className="ml-1 text-rose-600">取込み後は無し</span>}
                      </>
                    )}
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap">{i === 0 ? r.clientName : ''}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{f.label}</td>
                  <td className="py-1 pr-3 text-right font-mono">{yen(f.before)}</td>
                  <td className="py-1 pr-3 text-right font-mono">{yen(f.after)}</td>
                  <td className="py-1 text-right font-mono font-semibold">{signedYen(f.after - f.before)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 前の月("YYYY-MM") */
function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export const PastExcelImportPanel: React.FC<PastExcelImportPanelProps> = ({
  selectedCompanyId,
  onPayrollLoaded,
  onBillingLoaded,
  onInvoiceLoaded,
  getMonthPayrollRows,
  getMonthBillingRows,
  getMonthReferralFeeRows,
  onReferralFeeAdded,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [files, setFiles] = useState<PastImportFileEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const company = toPastImportCompany(selectedCompanyId);

  // 会社タブを切り替えたら、前の会社向けに選択していたファイル一覧はクリアする
  // (取り込みロジック(extractPastData)は会社ごとに全く異なるシート構成を前提にしており、
  // 会社を跨いで一覧を残すと誤った会社設定で取り込んでしまう事故につながるため)。
  useEffect(() => {
    setFiles([]);
  }, [selectedCompanyId]);

  if (!company) return null;

  const addFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    const entries: PastImportFileEntry[] = newFiles.map((file) => {
      const guessed = guessTargetMonthFromFileName(file.name);
      return {
        id: generateId('PASTFILE'),
        file,
        monthGuessed: !!guessed,
        targetMonth: guessed,
        status: 'pending',
      };
    });
    setFiles((prev) => [...prev, ...entries]);
  };

  const updateEntry = (id: string, patch: Partial<PastImportFileEntry>) => {
    setFiles((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeEntry = (id: string) => {
    setFiles((prev) => prev.filter((e) => e.id !== id));
  };

  const clearAll = () => setFiles([]);

  // 四国の勤怠明細票: その月の請求・給与を置き換え、請求行から分けた紹介手数料を登録する
  const applyShikokuKintaiImport = (id: string, pending: PendingShikokuImport, diff: ShikokuImportDiff) => {
    onBillingLoaded(pending.billingRows);
    onPayrollLoaded(pending.payrollRows);
    pending.newReferralFeeRows.forEach(onReferralFeeAdded);
    const referralNote =
      pending.newReferralFeeRows.length > 0
        ? `、紹介手数料${pending.newReferralFeeRows.length}件(計${pending.newReferralFeeRows
            .reduce((t, r) => t + r.amount, 0)
            .toLocaleString()}円)を派遣売上から分けて登録`
        : '';
    const diffNote = diff.existingEmpty ? '' : diff.rows.length > 0 ? `(登録済みと違ったスタッフ${diff.rows.length}人)` : '(登録済みと同じ)';
    updateEntry(id, {
      status: 'success',
      summary: `勤怠明細票: 請求${pending.billingRows.length}件(実績加工)・給与${pending.payrollRows.length}件(未払計上表)を取り込みました${referralNote}${diffNote}`,
      pending: undefined,
      errorMessage: undefined,
    });
  };
  const confirmEntry = (entry: PastImportFileEntry) => {
    if (entry.pending && entry.diff) applyShikokuKintaiImport(entry.id, entry.pending, entry.diff);
  };
  const cancelEntry = (id: string) =>
    updateEntry(id, { status: 'error', pending: undefined, errorMessage: '取り込みを取りやめました(登録済みのデータは変わっていません)。' });

  // 一括確定: 一覧の各ファイルについて、順番にreadWorkbookFile→extractPastDataを実行し、
  // 成功したものから順にonPayrollLoaded等で反映する。1ファイルの失敗(対象年月未入力・
  // 読み取りエラー・データ0件など)は、そのファイルをエラー表示にするだけで処理を止めず、
  // 残りのファイルの取り込みを続行する。既に成功済み(status==='success')のファイルは
  // 二重取り込みを避けるため再処理しない(失敗ファイルの月を直して再度ボタンを押した場合の
  // 再試行用途を想定)。
  const handleImportAll = async () => {
    setIsProcessing(true);
    // 処理対象は「呼び出し時点で未成功のファイル」のスナップショット(idのみ)。
    // 処理中にfilesの中身(各行のstate)は都度updateEntryで更新していく。
    // ★2026-10-20変更: 先に全ファイルを読み、四国は売上実績一覧表→勤怠明細票の順に処理する。同じ回に選んだ一覧表の
    // 取込み結果は画面の状態にまだ反映されていない(getMonthPayrollRows等はボタンを押した時点の値を返す)ため、
    // importedInBatchで勤怠明細票の処理に引き継ぐ。
    const loaded: { entry: PastImportFileEntry; wb: XLSX.WorkBook; isAttendance: boolean }[] = [];
    for (const entry of files.filter((e) => e.status !== 'success' && e.status !== 'confirm')) {
      if (!/^\d{4}-\d{2}$/.test(entry.targetMonth)) {
        updateEntry(entry.id, {
          status: 'error',
          errorMessage: '対象年月が未入力、または形式が不正です(「YYYY-MM」形式、例: 2024-10で入力してください)。',
        });
        continue;
      }
      updateEntry(entry.id, { status: 'processing', errorMessage: undefined });
      try {
        const wb = await readWorkbookFile(entry.file);
        loaded.push({ entry, wb, isAttendance: company === 'shikoku' && isShikokuAttendanceWorkbook(wb, entry.targetMonth) });
      } catch (e) {
        updateEntry(entry.id, {
          status: 'error',
          errorMessage: `読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
    const ordered = [...loaded.filter((l) => !l.isAttendance), ...loaded.filter((l) => l.isAttendance)];
    const importedInBatch = new Map<string, PastImportResult>();

    for (const { entry, wb, isAttendance } of ordered) {
      const id = entry.id;
      const month = entry.targetMonth;
      try {
        // ★2026-10-27変更((A)案): 四国の勤怠明細票(未払計上表あり・売上実績一覧表の月シート無し)から、その月の請求・給与を
        // 取り込む(請求=「実績加工」、給与=「未払計上表」。excelImport.ts extractShikokuKintaiPastData)。以前は売上実績一覧表で
        // 取り込んだ月に勤怠だけを補っていた。勤怠明細票は版が複数あることがあるため、その月に登録済みのデータと差があれば、
        // 一覧で見せて確認してから反映する(差が無い・その月が未登録なら、そのまま反映する)。
        if (isAttendance) {
          const batch = importedInBatch.get(month);
          const existingBilling = batch?.billingRows ?? getMonthBillingRows(month);
          const existingPayroll = batch?.payrollRows ?? getMonthPayrollRows(month);
          const registeredReferrals = getMonthReferralFeeRows(month);
          const extracted = extractShikokuKintaiPastData(
            wb,
            month,
            entry.file.name,
            registeredReferrals.map((r) => ({ staffNo: r.staffNo, amount: r.amount }))
          );
          if (extracted.billingRows.length === 0 && extracted.payrollRows.length === 0) {
            updateEntry(id, {
              status: 'error',
              result: extracted,
              errorMessage: `「実績加工」「未払計上表」シートからデータを読み取れませんでした。${extracted.warnings.join(' ')}`,
            });
            continue;
          }
          // 取引先名を登録済みのデータ(同じ月、無ければ3ヶ月前まで)に揃える
          let reference = existingBilling;
          for (let m = month, i = 0; reference.length === 0 && i < 3; i++) {
            m = previousMonth(m);
            reference = getMonthBillingRows(m);
          }
          const billingRows = alignShikokuClientNames(extracted.billingRows, reference);
          const newReferralFeeRows = extracted.splitReferralFeeRows ?? [];
          const pending: PendingShikokuImport = { billingRows, payrollRows: extracted.payrollRows, newReferralFeeRows };
          const diff = diffShikokuMonthImport(
            { billingRows: existingBilling, payrollRows: existingPayroll, referralFeeRows: registeredReferrals },
            { billingRows, payrollRows: extracted.payrollRows, referralFeeRows: [...registeredReferrals, ...newReferralFeeRows] }
          );
          const result = { ...extracted, billingRows };
          if (!diff.existingEmpty && diff.rows.length > 0) {
            updateEntry(id, { status: 'confirm', result, diff, pending, errorMessage: undefined });
            continue;
          }
          applyShikokuKintaiImport(id, pending, diff);
          continue;
        }

        const extracted = extractPastData(company, wb, month, entry.file.name);
        if (extracted.payrollRows.length === 0 && extracted.billingRows.length === 0) {
          updateEntry(id, {
            status: 'error',
            result: extracted,
            errorMessage: 'データが1件も抽出できませんでした。シート構成が想定と異なる可能性があります。',
          });
          continue;
        }
        onPayrollLoaded(extracted.payrollRows);
        onBillingLoaded(extracted.billingRows);
        if (extracted.invoiceRows.length > 0) onInvoiceLoaded(extracted.invoiceRows);
        importedInBatch.set(month, extracted);
        updateEntry(id, { status: 'success', result: extracted, errorMessage: undefined });
      } catch (e) {
        updateEntry(id, {
          status: 'error',
          errorMessage: `読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    setIsProcessing(false);
  };

  const companyLabel = company === 'matsuyama' ? '松山人材' : company === 'osaka' ? '大阪人材' : '四国人材';
  const sheetLabel =
    company === 'matsuyama'
      ? '「未払計上表」「請求支払一覧」シート'
      : company === 'osaka'
      ? '「給与一覧（スタナビ）」「請求支払（スタナビ）」シート'
      : '「実績加工」「未払計上表」シート';
  // ★2026-10-01修正: 四国は2026-09-29に売上実績一覧表形式へ切り替えたが、この案内が勤怠明細票のままだった
  const fileNameLabel =
    company === 'matsuyama'
      ? '★派遣明細YYYYMM.xlsm'
      : company === 'osaka'
      ? '契約別売上実績表（YYYY.M).xlsx'
      : '★YYMM勤怠明細票 時間計算.xlsm(または売上実績一覧表)';

  const pendingCount = files.filter((e) => e.status !== 'success' && e.status !== 'confirm').length;
  const successCount = files.filter((e) => e.status === 'success').length;
  const errorCount = files.filter((e) => e.status === 'error').length;

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list && list.length > 0) addFiles(Array.from(list));
    e.target.value = ''; // 同じファイルを続けて選び直せるようにリセット
  };

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm mb-4 overflow-hidden">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 hover:bg-amber-100 transition-colors"
      >
        <div className="flex items-center space-x-2">
          {isOpen ? <ChevronDown className="w-4 h-4 text-amber-700" /> : <ChevronRight className="w-4 h-4 text-amber-700" />}
          <FileSpreadsheet className="w-4 h-4 text-amber-700" />
          <span className="text-xs font-bold text-amber-900">
            過去実績Excel取り込み({companyLabel}、スタナビCSV導入前の月向け)
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="p-4 space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            {companyLabel}の拠点担当者が独自にまとめてきたExcelファイル({fileNameLabel})を選択してください。複数ファイルを
            まとめて選択・ドラッグ&ドロップできます。ファイル内の{sheetLabel}
            を自動的に読み取り、通常のCSV取り込みと同じ計算エンジンで粗利益・粗利率を算出します。
          </p>
          {company === 'shikoku' && (
            <p className="text-slate-600 leading-relaxed">
              通常は ★YYMM勤怠明細票 時間計算.xlsm を選んでください。「実績加工」シート(経理が内税交通費・立替金・締め日などを
              直した後のスタッフ別の請求・支給・社保負担額)を請求データ、「未払計上表」シートを給与データとして、その月の分を取り込みます。
              紹介手数料の請求書(実績CSVの請求先部署名に「紹介」)は派遣売上から分けて紹介手数料に登録します。
              その月に登録済みのデータと違うスタッフがいる場合は、取り込む前に差を一覧で表示するので、確認してから取り込んでください
              (勤怠明細票は修正後の版が複数あることがあり、ファイル名だけでは新旧が分からないため)。
              売上実績一覧表(「YYYY年M月」シート)も従来どおり取り込めます。
            </p>
          )}

          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
              isDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const dropped: File[] = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
              if (dropped.length > 0) addFiles(dropped);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsm,.xlsx"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <UploadCloud className="w-5 h-5 mx-auto text-slate-400 mb-1" />
            <p className="text-slate-500">
              クリックしてファイルを選択(複数選択可)、またはドラッグ&ドロップ
            </p>
          </div>

          {files.length > 0 && (
            <div className="space-y-3">
              <div className="overflow-x-auto table-scroll">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">ファイル名</th>
                      <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">対象年月</th>
                      <th className="text-left py-1.5 pr-3 font-semibold whitespace-nowrap">読み取り結果</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-50 last:border-0 align-top">
                        <td className="py-2 pr-3 font-medium text-slate-700 max-w-[220px] truncate" title={entry.file.name}>
                          {entry.file.name}
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            type="text"
                            value={entry.targetMonth}
                            onChange={(e) => updateEntry(entry.id, { targetMonth: e.target.value })}
                            placeholder="2024-10"
                            disabled={entry.status === 'processing' || entry.status === 'success' || entry.status === 'confirm'}
                            className={`border rounded-lg px-2 py-1 text-xs w-28 font-mono disabled:bg-slate-100 disabled:text-slate-400 ${
                              entry.monthGuessed ? 'border-slate-300' : 'border-amber-400 bg-amber-50'
                            }`}
                          />
                          {!entry.monthGuessed && entry.status === 'pending' && (
                            <p className="text-amber-700 mt-1 leading-tight">
                              ファイル名から自動判定できませんでした。手入力してください。
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3 min-w-[220px]">
                          {entry.status === 'pending' && <span className="text-slate-400">未処理</span>}
                          {entry.status === 'processing' && (
                            <span className="inline-flex items-center space-x-1 text-indigo-600">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>読み取り中...</span>
                            </span>
                          )}
                          {entry.status === 'success' && entry.result && (
                            <div className="text-emerald-700">
                              <span className="inline-flex items-center space-x-1 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>取込済み</span>
                              </span>
                              <div className="text-slate-600 mt-0.5">
                                {entry.summary ?? (
                                  <>
                                    給与{entry.result.payrollRows.length}件 / 請求{entry.result.billingRows.length}件
                                    {entry.result.invoiceRows.length > 0 && ` / 契約単価${entry.result.invoiceRows.length}件`}
                                  </>
                                )}
                              </div>
                              {entry.result.warnings.length > 0 && (
                                <ul className="text-amber-700 mt-0.5 space-y-0.5">
                                  {entry.result.warnings.map((w, i) => (
                                    <li key={i} className="flex items-start space-x-1">
                                      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                      <span>{w}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                          {entry.status === 'error' && (
                            <div className="text-rose-600 flex items-start space-x-1">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                              <span>{entry.errorMessage}</span>
                            </div>
                          )}
                          {entry.status === 'confirm' && entry.diff && (
                            <div>
                              <span className="inline-flex items-center space-x-1 font-semibold text-amber-800">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>確認待ち(まだ取り込んでいません)</span>
                              </span>
                              <ImportDiffView diff={entry.diff} month={entry.targetMonth} />
                              {entry.result && entry.result.warnings.length > 0 && (
                                <ul className="text-amber-700 mt-1 space-y-0.5">
                                  {entry.result.warnings.map((w, i) => (
                                    <li key={i} className="flex items-start space-x-1">
                                      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                      <span>{w}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div className="flex items-center gap-2 mt-2">
                                <button
                                  onClick={() => confirmEntry(entry)}
                                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-colors"
                                >
                                  この版で取り込む(登録済みの{entry.targetMonth}の請求・給与を置き換え)
                                </button>
                                <button
                                  onClick={() => cancelEntry(entry.id)}
                                  className="px-3 py-1 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg font-medium transition-colors"
                                >
                                  取り込まない
                                </button>
                              </div>
                            </div>
                          )}

                        </td>
                        <td className="py-2">
                          {entry.status !== 'success' && (
                            <button
                              onClick={() => removeEntry(entry.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              title="この行を一覧から削除"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleImportAll}
                    disabled={isProcessing || pendingCount === 0}
                    className="inline-flex items-center space-x-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-bold transition-colors"
                  >
                    {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                    <span>
                      この内容ですべて取り込む
                      {pendingCount > 0 ? `(${pendingCount}件)` : ''}
                    </span>
                  </button>
                  <button
                    onClick={clearAll}
                    disabled={isProcessing}
                    className="px-3 py-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg font-medium disabled:opacity-50 transition-colors"
                  >
                    一覧をクリア
                  </button>
                </div>
                {(successCount > 0 || errorCount > 0) && (
                  <div className="text-slate-600">
                    成功 <strong className="text-emerald-700">{successCount}</strong> 件 / 失敗{' '}
                    <strong className="text-rose-600">{errorCount}</strong> 件 / 全{files.length}件
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
