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
 */

import React, { useRef, useState } from 'react';
import { FileSpreadsheet, UploadCloud, AlertTriangle, CheckCircle2, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { PayrollRow, BillingRow } from '../types';
import { CompanyId } from '../config/companies';
import {
  readWorkbookFile,
  guessTargetMonthFromFileName,
  extractPastData,
  PastImportCompany,
  PastImportResult,
} from '../utils/excelImport';

interface PastExcelImportPanelProps {
  /** 現在選択中の会社。四国・松山以外ではこのパネル自体を表示しない(呼び出し元でも判定するが念のため) */
  selectedCompanyId: CompanyId;
  onPayrollLoaded: (data: PayrollRow[]) => void;
  onBillingLoaded: (data: BillingRow[]) => void;
}

function toPastImportCompany(id: CompanyId): PastImportCompany | null {
  if (id === 'matsuyama') return 'matsuyama';
  if (id === 'shikoku') return 'shikoku';
  return null;
}

export const PastExcelImportPanel: React.FC<PastExcelImportPanelProps> = ({
  selectedCompanyId,
  onPayrollLoaded,
  onBillingLoaded,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [targetMonth, setTargetMonth] = useState('');
  const [result, setResult] = useState<PastImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const company = toPastImportCompany(selectedCompanyId);
  if (!company) return null; // 大阪は対象外(現行のCSV取込・月別詳細シート方式のまま)

  const resetForNewFile = () => {
    setResult(null);
    setError(null);
    setApplied(false);
  };

  const handleFile = async (file: File) => {
    resetForNewFile();
    setFileName(file.name);
    const guessed = guessTargetMonthFromFileName(file.name);
    setTargetMonth(guessed);
    if (!guessed) {
      setError('ファイル名から対象年月を推測できませんでした。下の欄に「YYYY-MM」形式で直接入力してください。');
    }
  };

  const runExtract = async (monthOverride?: string) => {
    if (!fileName || !inputRef.current?.files?.[0]) return;
    const month = monthOverride ?? targetMonth;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError('対象年月は「YYYY-MM」形式(例: 2024-10)で入力してください。');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const file = inputRef.current.files[0];
      const wb = await readWorkbookFile(file);
      const extracted = extractPastData(company, wb, month, file.name);
      setResult(extracted);
      setApplied(false);
    } catch (e) {
      setError(`読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (!result) return;
    onPayrollLoaded(result.payrollRows);
    onBillingLoaded(result.billingRows);
    setApplied(true);
  };

  const companyLabel = company === 'matsuyama' ? '松山人材' : '四国人材';
  const sheetLabel =
    company === 'matsuyama' ? '「未払計上表」「請求支払一覧」シート' : '「未払計上表」「実績加工」シート';

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
            {companyLabel}の拠点担当者が独自にまとめてきたExcelファイル(★派遣明細YYYYMM.xlsm /
            ★YYMM勤怠明細票 時間計算.xlsm)を選択してください。ファイル内の{sheetLabel}
            を自動的に読み取り、通常のCSV取り込みと同じ計算エンジンで粗利益・粗利率を算出します。
          </p>

          <div
            className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-indigo-400 hover:bg-slate-50 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) {
                const dt = new DataTransfer();
                dt.items.add(file);
                if (inputRef.current) inputRef.current.files = dt.files;
                handleFile(file);
              }
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsm,.xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <UploadCloud className="w-5 h-5 mx-auto text-slate-400 mb-1" />
            <p className="text-slate-500">
              {fileName ? (
                <span className="font-semibold text-slate-700">{fileName}</span>
              ) : (
                'クリックしてファイルを選択、またはドラッグ&ドロップ'
              )}
            </p>
          </div>

          {fileName && (
            <div className="flex items-end space-x-3">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">対象年月</label>
                <input
                  type="text"
                  value={targetMonth}
                  onChange={(e) => setTargetMonth(e.target.value)}
                  placeholder="2024-10"
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs w-32 font-mono"
                />
              </div>
              <button
                onClick={() => runExtract()}
                disabled={isLoading}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-bold flex items-center space-x-1.5"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
                <span>ファイルを読み取る</span>
              </button>
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center space-x-4">
                <span className="text-slate-700">
                  給与データ: <strong>{result.payrollRows.length}</strong> 件
                </span>
                <span className="text-slate-700">
                  請求データ: <strong>{result.billingRows.length}</strong> 件
                </span>
                <span className="text-slate-700">
                  対象年月: <strong className="font-mono">{result.targetMonth}</strong>
                </span>
              </div>
              {result.warnings.length > 0 && (
                <ul className="text-amber-700 space-y-0.5">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="flex items-start space-x-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
              {result.payrollRows.length === 0 && result.billingRows.length === 0 ? (
                <p className="text-rose-600 font-semibold">
                  データが1件も抽出できませんでした。シート構成が想定と異なる可能性があります。
                </p>
              ) : applied ? (
                <div className="flex items-center space-x-1.5 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {companyLabel}の{result.targetMonth}分として取り込み済みです(「月次粗利明細一覧」タブで確認できます)。
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleApply}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold"
                >
                  この内容で{result.targetMonth}分として取り込む
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
