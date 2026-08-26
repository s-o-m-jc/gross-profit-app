/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * CSVファイル取り込みコンポーネント
 *
 * ★2026-08-26: 「④退職金・調整CSV」は手入力方式(RetirementPanel.tsx)に変更したため、
 * このコンポーネントからは撤去した。あわせて、クリックでのファイル選択に加えて
 * ドラッグ&ドロップでのアップロード、直前のアップロードを取り消す「取り消し」ボタンを追加した。
 */

import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  FileCheck,
  FilePlus,
  Trash2,
  Download,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  FileText,
  Undo2,
} from 'lucide-react';
import {
  parsePayrollCsv,
  parseBillingCsv,
  parseInvoicePrintCsv,
} from '../utils/csvParser';
import {
  SAMPLE_PAYROLL_CSV,
  SAMPLE_BILLING_CSV,
  SAMPLE_INVOICE_PRINT_CSV,
} from '../utils/sampleData';
import { PayrollRow, BillingRow, InvoicePrintRow } from '../types';

type UploadItemId = 'payroll' | 'billing' | 'invoice';

interface CsvUploaderProps {
  payrollRows: PayrollRow[];
  billingRows: BillingRow[];
  invoiceRows: InvoicePrintRow[];
  onPayrollLoaded: (data: PayrollRow[]) => void;
  onBillingLoaded: (data: BillingRow[]) => void;
  onInvoiceLoaded: (data: InvoicePrintRow[]) => void;
  onClearAll: () => void;
  /** 直前のCSVアップロードを取り消せるか(1操作分のみ)。App.tsx側でアップロード前の状態を保持している。 */
  canUndo: boolean;
  /** 取り消し対象の操作の説明(ボタンのツールチップ表示用) */
  undoLabel?: string;
  onUndo: () => void;
}

export const CsvUploader: React.FC<CsvUploaderProps> = ({
  payrollRows,
  billingRows,
  invoiceRows,
  onPayrollLoaded,
  onBillingLoaded,
  onInvoiceLoaded,
  onClearAll,
  canUndo,
  undoLabel,
  onUndo,
}) => {
  const payrollInputRef = useRef<HTMLInputElement>(null);
  const billingInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  // 対象年月が判定できなかった場合の警告表示用
  const [monthWarning, setMonthWarning] = useState<string>('');
  // ドラッグ&ドロップ中、どのカードの上にファイルがドラッグされているかのハイライト表示用
  const [dragOverId, setDragOverId] = useState<UploadItemId | null>(null);

  // 文字化け検出: 出現頻度の高い置換文字(U+FFFD)や制御文字が多い場合はエンコード誤りとみなす
  const looksMojibake = (text: string): boolean => {
    const sampleLen = Math.min(text.length, 2000);
    const sample = text.slice(0, sampleLen);
    const badCharCount = (sample.match(/�/g) || []).length;
    return badCharCount > 0;
  };

  const readFileWithEncodingFallback = (file: File, onText: (text: string) => void) => {
    // 実データ検証の結果、スタッフナビ出力CSVはUTF-8(BOM付き)であったため、まずUTF-8で読み込む。
    // 文字化けを検出した場合のみShift-JISで再読込する。
    const utf8Reader = new FileReader();
    utf8Reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      if (looksMojibake(text)) {
        const sjisReader = new FileReader();
        sjisReader.onload = (e2) => {
          onText((e2.target?.result as string) || '');
        };
        sjisReader.readAsText(file, 'shift-jis');
      } else {
        onText(text);
      }
    };
    utf8Reader.readAsText(file, 'utf-8');
  };

  const handleFileUpload = (file: File, type: UploadItemId) => {
    readFileWithEncodingFallback(file, (text) => {
      if (!text) return;

      if (type === 'payroll') {
        const parsed = parsePayrollCsv(text, file.name);
        onPayrollLoaded(parsed);
        if (parsed.length > 0 && parsed.every((r) => !r.targetMonth)) {
          setMonthWarning(
            '給与データCSVから対象年月を判定できませんでした（支給日・ファイル名のいずれからも取得不可）。'
          );
        }
      } else if (type === 'billing') {
        const parsed = parseBillingCsv(text, file.name);
        onBillingLoaded(parsed);
        if (parsed.length > 0 && parsed.every((r) => !r.targetMonth)) {
          setMonthWarning(
            '請求データCSVから対象年月を判定できませんでした。ファイル名に年月(例: 202410)を含めてください。'
          );
        }
      } else if (type === 'invoice') {
        const parsed = parseInvoicePrintCsv(text, file.name);
        onInvoiceLoaded(parsed);
        if (parsed.length > 0 && parsed.every((r) => !r.targetMonth)) {
          setMonthWarning(
            '請求書印刷CSVから対象年月を判定できませんでした。ファイル名に年月(例: 202410)を含めてください。'
          );
        }
      }
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, type: UploadItemId) => {
    e.preventDefault();
    setDragOverId(null);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file, type);
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

  const items: {
    id: UploadItemId;
    title: string;
    required: boolean;
    count: number;
    ref: React.RefObject<HTMLInputElement>;
    sampleContent: string;
    sampleName: string;
    color: string;
    iconColor: string;
    description: string;
  }[] = [
    {
      id: 'payroll',
      title: '① 給与データ CSV',
      required: true,
      count: payrollRows.length,
      ref: payrollInputRef,
      sampleContent: SAMPLE_PAYROLL_CSV,
      sampleName: '給与データ_サンプル.csv',
      color: 'border-blue-200 bg-blue-50/50 hover:bg-blue-50',
      iconColor: 'text-blue-600',
      description: 'スタッフ番号, 氏名, 総支給額, 社保合計, 駐車場手当, 交通費1/2, 有給手当, 支給日',
    },
    {
      id: 'billing',
      title: '② 請求データ CSV',
      required: true,
      count: billingRows.length,
      ref: billingInputRef,
      sampleContent: SAMPLE_BILLING_CSV,
      sampleName: '請求データ_サンプル_202604.csv',
      color: 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50',
      iconColor: 'text-emerald-600',
      description: '請求No, クライアント番号/名称, スタッフNo, 受注番号/名称, 請求額, 支払額, 社保負担額（対象年月はファイル名から取得）',
    },
    {
      id: 'invoice',
      title: '③ 請求書印刷 CSV',
      required: false,
      count: invoiceRows.length,
      ref: invoiceInputRef,
      sampleContent: SAMPLE_INVOICE_PRINT_CSV,
      sampleName: '請求書印刷データ_サンプル_202604.csv',
      color: 'border-purple-200 bg-purple-50/50 hover:bg-purple-50',
      iconColor: 'text-purple-600',
      description: '請求No, 発行日, 振込予定日, 印刷ステータス, 送付ステータス（対象年月はファイル名から取得）',
    },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <UploadCloud className="w-5 h-5 text-indigo-600" />
            <span>CSVデータ自動結合・取り込みエリア</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            クリックでファイル選択、またはカードへドラッグ&ドロップでCSVを読み込みます。スタッフNoと対象年月で自動キー突合を行います (Power Query自動処理再現)
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
          {(payrollRows.length > 0 || billingRows.length > 0) && (
            <button
              onClick={onClearAll}
              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>データをクリア</span>
            </button>
          )}
        </div>
      </div>

      {monthWarning && (
        <div className="mb-4 flex items-start space-x-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{monthWarning}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
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

                {item.count > 0 ? (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                    <CheckCircle className="w-3 h-3" />
                    <span>{item.count}件</span>
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 font-medium">未読み込み</span>
                )}
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed mb-3">{item.description}</p>
            </div>

            <div className="space-y-2 mt-2">
              <input
                ref={item.ref}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, item.id);
                  e.target.value = '';
                }}
              />

              <button
                onClick={() => item.ref.current?.click()}
                className="w-full py-2 px-3 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 shadow-sm flex items-center justify-center space-x-1.5 transition-colors"
              >
                <FilePlus className={`w-4 h-4 ${item.iconColor}`} />
                <span>CSVファイルを選択 (またはドラッグ&ドロップ)</span>
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
        ))}
      </div>
    </div>
  );
};
