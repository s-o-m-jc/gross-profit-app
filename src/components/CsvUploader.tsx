/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * CSVファイル取り込みコンポーネント
 *
 * ★2026-08-26: 「④退職金・調整CSV」は手入力方式(RetirementPanel.tsx)に変更したため、
 * このコンポーネントからは撤去した。あわせて、クリックでのファイル選択に加えて
 * ドラッグ&ドロップでのアップロード、直前のアップロードを取り消す「取り消し」ボタンを追加した。
 *
 * ★2026-11-26変更(取込み前の確認画面=ストッパー): ファイルを選んでも、すぐには取り込まない。選んだファイルを保留にして
 * 確認画面(拠点・対象年月とその根拠・ファイルの種類と行数・③の紐付け・登録済みのデータ)を出し、止める条件が無く、
 * 確認のチェックがすべて付いたときに「取り込む」で①②③をまとめて反映する。判定はutils/csvImportCheck.ts。
 * ③は15日締・20日締・末締を複数選べ、同じ月の③として合わせて取り込む(以前は1つ選ぶたびに置き換わっていた)。
 */

import React, { useMemo, useRef, useState } from 'react';
import { UploadCloud, FilePlus, Download, CheckCircle, AlertTriangle, XCircle, Undo2, X, ClipboardCheck } from 'lucide-react';
import { SAMPLE_PAYROLL_CSV, SAMPLE_BILLING_CSV, SAMPLE_INVOICE_PRINT_CSV, SAMPLE_INVOICE_LIST_CSV } from '../utils/sampleData';
import { PayrollRow, BillingRow, InvoicePrintRow } from '../types';
import { CompanyId, COMPANIES } from '../config/companies';
import { MonthlyDataState } from '../utils/monthlyData';
import {
  CsvCardKind,
  CsvImportPreview,
  PendingCsvFile,
  CSV_KIND_LABEL,
  REQUIRED_CSV_CARDS,
  buildCsvImportPreview,
  formatMonthJa,
} from '../utils/csvImportCheck';

export interface CsvBatchImport {
  payrollRows?: PayrollRow[];
  billingRows?: BillingRow[];
  invoiceRows?: InvoicePrintRow[];
}

interface CsvUploaderProps {
  selectedCompanyId: CompanyId;
  payrollRows: PayrollRow[];
  billingRows: BillingRow[];
  invoiceRows: InvoicePrintRow[];
  /** 登録済みの月のデータ(選んでいる会社)。確認画面の「登録済みのデータ」と、①が無いときの月の確かめに使う */
  getMonthState: (month: string) => MonthlyDataState | undefined;
  /** 確認画面で「取り込む」を押したときに、①②③をまとめて反映する(取り消しは1回分) */
  onImport: (rows: CsvBatchImport, label: string) => void;
  /** 直前のCSVアップロードを取り消せるか(1操作分のみ)。App.tsx側でアップロード前の状態を保持している。 */
  canUndo: boolean;
  /** 取り消し対象の操作の説明(ボタンのツールチップ表示用) */
  undoLabel?: string;
  onUndo: () => void;
}

// 文字化け検出: 置換文字(U+FFFD)があればエンコード誤りとみなす
const looksMojibake = (text: string): boolean => (text.slice(0, 2000).match(/�/g) || []).length > 0;

// 実データ検証の結果、スタッフナビ出力CSVはUTF-8(BOM付き)のことがあるため、まずUTF-8で読み、文字化けしたらShift-JISで読み直す
const readFileText = (file: File): Promise<string> =>
  new Promise((resolve) => {
    const utf8Reader = new FileReader();
    utf8Reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      if (!looksMojibake(text)) return resolve(text);
      const sjisReader = new FileReader();
      sjisReader.onload = (e2) => resolve((e2.target?.result as string) || '');
      sjisReader.readAsText(file, 'shift-jis');
    };
    utf8Reader.readAsText(file, 'utf-8');
  });

const companyName = (id: CompanyId | null) => (id ? COMPANIES.find((c) => c.id === id)?.name ?? id : '判定できませんでした');

export const CsvUploader: React.FC<CsvUploaderProps> = ({
  selectedCompanyId,
  payrollRows,
  billingRows,
  invoiceRows,
  getMonthState,
  onImport,
  canUndo,
  undoLabel,
  onUndo,
}) => {
  const payrollInputRef = useRef<HTMLInputElement>(null);
  const billingInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const invoiceListInputRef = useRef<HTMLInputElement>(null);

  // ドラッグ&ドロップ中、どのカードの上にファイルがドラッグされているかのハイライト表示用
  const [dragOverId, setDragOverId] = useState<CsvCardKind | null>(null);
  // 保留中のファイル(まだ取り込んでいない)。①②は1つずつ、③は複数
  const [pending, setPending] = useState<PendingCsvFile[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const addFiles = async (fileList: FileList | File[], card: CsvCardKind) => {
    const list = Array.from(fileList);
    if (list.length === 0) return;
    const read = await Promise.all(list.map(async (f) => ({ card, fileName: f.name, text: await readFileText(f) })));
    setPending((prev) => {
      // ①②は新しいファイルで置き換え、③は同じ名前のファイルだけ置き換えて追加する
      const kept = prev.filter((p) => (card === 'invoice' ? !(p.card === 'invoice' && read.some((r) => r.fileName === p.fileName)) : p.card !== card));
      return [...kept, ...(card === 'invoice' ? read : read.slice(0, 1))];
    });
    setChecked({});
  };

  const removeFile = (file: PendingCsvFile) => {
    setPending((prev) => prev.filter((p) => p !== file));
    setChecked({});
  };

  const cancelAll = () => {
    setPending([]);
    setChecked({});
  };

  const preview: CsvImportPreview | null = useMemo(
    () => (pending.length > 0 ? buildCsvImportPreview(pending, selectedCompanyId, getMonthState) : null),
    [pending, selectedCompanyId, getMonthState]
  );

  const allChecked = !!preview && preview.confirmations.every((c) => checked[c.id]);
  const canImport = !!preview && preview.blockers.length === 0 && !!preview.targetMonth && allChecked;

  const doImport = () => {
    if (!preview || !canImport) return;
    const kinds = Array.from(new Set<CsvCardKind>(pending.map((p) => p.card))).map((k) => CSV_KIND_LABEL[k].slice(0, 1)).join('');
    onImport(preview.rows, `CSV取込み ${kinds} ${formatMonthJa(preview.targetMonth)} (${companyName(selectedCompanyId)})`);
    cancelAll();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, type: CsvCardKind) => {
    e.preventDefault();
    setDragOverId(null);
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files, type);
  };

  const downloadSampleCsv = (content: string, fileName: string) => {
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // カードの設定。④(請求一覧CSV)は、この配列に1件足せば4枚目として並ぶ
  const items: {
    id: CsvCardKind;
    title: string;
    required: boolean;
    multiple: boolean;
    count: number;
    ref: React.RefObject<HTMLInputElement>;
    sampleContent: string;
    sampleName: string;
    color: string;
    iconColor: string;
    guide: string;
  }[] = [
    {
      id: 'payroll',
      title: '① 給与データ CSV',
      required: true,
      multiple: false,
      count: payrollRows.length,
      ref: payrollInputRef,
      sampleContent: SAMPLE_PAYROLL_CSV,
      sampleName: '給与データ_サンプル.csv',
      color: 'border-blue-200 bg-blue-50/50 hover:bg-blue-50',
      iconColor: 'text-blue-600',
      guide: '①給与計算書印刷CSV を、ここに入れてね。スタナビ「給与計算書印刷」から出力(全項目ON・76列)。',
    },
    {
      id: 'billing',
      title: '② 請求データ CSV',
      required: true,
      multiple: false,
      count: billingRows.length,
      ref: billingInputRef,
      sampleContent: SAMPLE_BILLING_CSV,
      sampleName: '請求データ_サンプル_202604.csv',
      color: 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50',
      iconColor: 'text-emerald-600',
      guide: '②請求支払一覧表印刷CSV を、ここに入れてね。出力オプション『社会保険料の～』と『事業主負担額に労災保険～』にチェックを入れて出してください。',
    },
    {
      id: 'invoice',
      title: '③ 請求書印刷 CSV',
      required: false,
      multiple: true,
      count: invoiceRows.length,
      ref: invoiceInputRef,
      sampleContent: SAMPLE_INVOICE_PRINT_CSV,
      sampleName: '請求書印刷データ_サンプル_202604.csv',
      color: 'border-purple-200 bg-purple-50/50 hover:bg-purple-50',
      iconColor: 'text-purple-600',
      guide: '③請求書印刷CSV を、ここに入れてね。15日締・20日締・末締の3つを、まとめて選んでください。',
    },
    // ★2026-11-26追加: ④請求一覧CSV(松山だけ必須。請求書ごとの消費税に使う。データとしては保存しない)
    {
      id: 'invoiceList',
      title: '④ 請求一覧 CSV',
      required: REQUIRED_CSV_CARDS[selectedCompanyId].includes('invoiceList'),
      multiple: false,
      count: 0,
      ref: invoiceListInputRef,
      sampleContent: SAMPLE_INVOICE_LIST_CSV,
      sampleName: '請求一覧_サンプル_202604.csv',
      color: 'border-amber-200 bg-amber-50/50 hover:bg-amber-50',
      iconColor: 'text-amber-600',
      guide: '④請求一覧CSV を、ここに入れてね。Excelの『売上ＣＳＶから』に貼っているものです。',
    },
  ];

  const gridCols = items.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <UploadCloud className="w-5 h-5 text-indigo-600" />
            <span>CSVデータ自動結合・取り込みエリア</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            クリックでファイル選択、またはカードへドラッグ&ドロップでCSVを選びます。選んだだけでは取り込まれません。下の確認画面で内容を確かめてから「取り込む」を押してください。
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {canUndo && (
            <button
              onClick={onUndo}
              title={undoLabel ? `取り消す内容: ${undoLabel}` : undefined}
              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>直前のアップロードを取り消す</span>
            </button>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 ${gridCols} gap-4`}>
        {items.map((item) => {
          const selected = pending.filter((p) => p.card === item.id);
          return (
            <div
              key={item.id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverId(item.id);
              }}
              onDragLeave={() => setDragOverId((prev) => (prev === item.id ? null : prev))}
              onDrop={(e) => handleDrop(e, item.id)}
              className={`border-2 border-dashed rounded-xl p-4 transition-all flex flex-col justify-between relative ${
                dragOverId === item.id ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-300' : item.color
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center space-x-1">
                    <span>{item.title}</span>
                    {item.required && <span className="text-rose-500 font-bold">*</span>}
                  </span>

                  {/* ★2026-09-02: 総件数の表示は不要との判断で削除。読み込み済みかどうかのチェックマークのみ残す。 */}
                  {item.id === 'invoiceList' ? (
                    <span className="text-[10px] text-slate-400 font-medium">{item.required ? '松山は必須' : '使わない拠点'}</span>
                  ) : item.count > 0 ? (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                      <CheckCircle className="w-3 h-3" />
                      <span>読み込み済み</span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium">未読み込み</span>
                  )}
                </div>

                <p className="text-[11px] text-slate-600 leading-relaxed mb-3">{item.guide}</p>
                {selected.length > 0 && (
                  <p className="text-[11px] font-bold text-indigo-700 mb-2 break-all">
                    確認待ち: {selected.map((s) => s.fileName).join('、')}
                  </p>
                )}
              </div>

              <div className="space-y-2 mt-2">
                <input
                  ref={item.ref}
                  type="file"
                  accept=".csv,.txt"
                  multiple={item.multiple}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void addFiles(e.target.files, item.id);
                    e.target.value = '';
                  }}
                />

                <button
                  onClick={() => item.ref.current?.click()}
                  className="w-full py-2 px-3 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 shadow-sm flex items-center justify-center space-x-1.5 transition-colors"
                >
                  <FilePlus className={`w-4 h-4 ${item.iconColor}`} />
                  <span>{item.multiple ? 'CSVファイルを選択 (複数可・ドラッグ&ドロップ可)' : 'CSVファイルを選択 (またはドラッグ&ドロップ)'}</span>
                </button>

                <button
                  onClick={() => downloadSampleCsv(item.sampleContent, item.sampleName)}
                  className="w-full text-center text-[10px] text-indigo-600 hover:text-indigo-800 flex items-center justify-center space-x-1 py-0.5"
                >
                  <Download className="w-3 h-3" />
                  <span>ひな形CSVダウンロード</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <CsvImportConfirmation
          preview={preview}
          pending={pending}
          checked={checked}
          onCheck={(id, v) => setChecked((prev) => ({ ...prev, [id]: v }))}
          onRemove={removeFile}
          onImport={doImport}
          onCancel={cancelAll}
          canImport={canImport}
        />
      )}
    </div>
  );
};

/** 取込み前の確認画面(まだ何も取り込んでいない状態で表示する) */
const CsvImportConfirmation: React.FC<{
  preview: CsvImportPreview;
  pending: PendingCsvFile[];
  checked: Record<string, boolean>;
  onCheck: (id: string, value: boolean) => void;
  onRemove: (file: PendingCsvFile) => void;
  onImport: () => void;
  onCancel: () => void;
  canImport: boolean;
}> = ({ preview, pending, checked, onCheck, onRemove, onImport, onCancel, canImport }) => {
  const { existing } = preview;
  const hasExisting = existing.payroll + existing.billing + existing.invoice > 0;
  const closings = preview.files.filter((f) => f.card === 'invoice');
  return (
    <div className="mt-5 border-2 border-indigo-300 rounded-xl bg-indigo-50/40 p-4 space-y-4 text-xs text-slate-800">
      <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-1.5">
        <ClipboardCheck className="w-4 h-4" />
        取込み前の確認(まだ取り込んでいません)
      </h3>

      {preview.blockers.length > 0 && (
        <div className="rounded-lg border-2 border-rose-400 bg-rose-50 p-3 space-y-1.5 text-rose-800">
          <p className="font-bold flex items-center gap-1">
            <XCircle className="w-4 h-4 shrink-0" />
            次の理由で、取り込めません
          </p>
          <ul className="list-disc pl-5 space-y-1">
            {preview.blockers.map((b, i) => (
              <li key={i} className="break-words">{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-3">
          <p className="font-bold text-slate-600 mb-1">拠点</p>
          <p>選んでいる会社: <span className="font-bold">{companyName(preview.selectedCompanyId)}</span></p>
          <p>CSVの中身から判定した拠点: <span className="font-bold">{companyName(preview.detectedCompany)}</span></p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3">
          <p className="font-bold text-slate-600 mb-1">対象年月</p>
          <p className="text-base font-bold">{preview.targetMonth ? formatMonthJa(preview.targetMonth) : '決められません'}</p>
          {preview.monthBasis.length > 0 && (
            <ul className="list-disc pl-5 text-slate-600 mt-1 space-y-0.5">
              {preview.monthBasis.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {closings.length > 0 && (
            <p className="text-slate-600 mt-1">③の締め日(ファイル名から): {closings.map((c) => c.closing || '不明').join('・')}</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <p className="font-bold text-slate-600 mb-2">選んだファイル</p>
        <ul className="space-y-2">
          {preview.files.map((f, i) => (
            <li key={i} className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="font-bold break-all">{f.fileName}</p>
                <p className="text-slate-600">
                  カード: {CSV_KIND_LABEL[f.card]} / 判定した種類: {CSV_KIND_LABEL[f.detectedKind]} / {f.rowCount}行・{f.columnCount}列
                  {f.card === 'invoice' && ` / 締め日: ${f.closing || '不明'} / 小計の合計: ¥${(f.subtotal ?? 0).toLocaleString()}`}
                </p>
              </div>
              <button
                onClick={() => onRemove(pending[i])}
                className="shrink-0 inline-flex items-center gap-0.5 px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                <X className="w-3 h-3" />
                外す
              </button>
            </li>
          ))}
        </ul>
        {preview.billingLinkedToInvoice && (
          <p className="mt-2 text-slate-600">
            ②の請求{preview.billingLinkedToInvoice.total}行のうち、③に紐付く行: {preview.billingLinkedToInvoice.linked}行
          </p>
        )}
      </div>

      {preview.targetMonth && (
        <div className={`rounded-lg p-3 border ${hasExisting ? 'border-2 border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <p className="font-bold text-slate-600 mb-1">{formatMonthJa(preview.targetMonth)}の登録済みのデータ</p>
          <p>
            ①給与 {existing.payroll}件 / ②請求 {existing.billing}件 / ③請求書 {existing.invoice}件
          </p>
          {preview.replacesCategories.length > 0 && (
            <p className="mt-1 font-bold text-amber-800 flex items-start gap-1">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              取り込むと、この月の{preview.replacesCategories.map((c) => CSV_KIND_LABEL[c].slice(0, 1)).join('')}が置き換わります(元のデータは消えます)。
            </p>
          )}
          <p className="mt-1 text-slate-700">
            {existing.manual.length > 0
              ? `手入力の項目(${existing.manual.map((m) => `${m.label} ${m.count}件`).join('、')})は、そのまま残ります(置き換わりません)。`
              : '手入力の項目(交通費(税抜)の月次上書きなど)は、この月にはありません。手入力の項目は、取り込んでも置き換わりません。'}
          </p>
        </div>
      )}

      {(preview.checks.length > 0 || preview.notes.length > 0) && (
        <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5">
          <p className="font-bold text-slate-600">検算</p>
          {preview.checks.map((c, i) => (
            <div key={i} className="flex items-start gap-1.5">
              {c.ok === true ? (
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
              ) : c.ok === false ? (
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              ) : (
                <span className="w-4 shrink-0 text-center text-slate-400">－</span>
              )}
              <p className="min-w-0 break-words">
                <span className="font-bold">{c.label}</span>: {c.detail}
              </p>
            </div>
          ))}
          {preview.notes.map((n, i) => (
            <p key={`n${i}`} className="text-slate-600 break-words">・{n}</p>
          ))}
        </div>
      )}

      {preview.warnings.filter((w) => !w.includes('置き換わります')).length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1 text-amber-900">
          <p className="font-bold flex items-center gap-1">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            確かめてください(取り込むことはできます)
          </p>
          <ul className="list-disc pl-5 space-y-1">
            {preview.warnings
              .filter((w) => !w.includes('置き換わります'))
              .map((w, i) => (
                <li key={i} className="break-words">{w}</li>
              ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-1.5">
        {preview.confirmations.map((c) => (
          <label key={c.id} className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!!checked[c.id]}
              disabled={preview.blockers.length > 0}
              onChange={(e) => onCheck(c.id, e.target.checked)}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-medium">
          キャンセル(何も取り込まない)
        </button>
        <button
          onClick={onImport}
          disabled={!canImport}
          className="px-4 py-2 rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          取り込む
        </button>
      </div>
    </div>
  );
};
