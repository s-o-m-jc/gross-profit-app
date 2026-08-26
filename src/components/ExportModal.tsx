/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * CSV/Excel エクスポートモーダル
 */

import React, { useState } from 'react';
import { X, Download, FileSpreadsheet, Check } from 'lucide-react';
import Papa from 'papaparse';
import { GrossProfitResult } from '../types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: GrossProfitResult[];
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  results,
}) => {
  const [exportType, setExportType] = useState<'ALL' | 'ALERTS_ONLY' | 'TRANSPORT_MISMATCH'>('ALL');
  const [includeBOM, setIncludeBOM] = useState(true);

  if (!isOpen) return null;

  const handleDownload = () => {
    let dataToExport = results;
    if (exportType === 'ALERTS_ONLY') {
      dataToExport = results.filter((r) => r.alerts.length > 0);
    } else if (exportType === 'TRANSPORT_MISMATCH') {
      dataToExport = results.filter((r) => r.transportDiff !== 0);
    }

    const formattedData = dataToExport.map((r) => ({
      対象年月: r.targetMonth,
      請求No: r.billingNo,
      スタッフNo: r.staffNo,
      スタッフ氏名: r.staffName,
      派遣先コード: r.clientCode,
      派遣先名: r.clientName,
      '請求金額(税抜)': r.billingAmountExTax,
      '請求金額(税込)': r.billingAmountIncTax,
      給与支給額: r.paymentAmount,
      社保負担額: r.socialInsurance,
      '雇用保険(参考・社保負担額に含まれる想定)': r.employmentInsurance,
      駐車場代: r.parkingFee,
      退職金配賦額: r.retirementAmount,
      有給手当: r.paidLeaveAllowance,
      有給日数: r.paidLeaveDays,
      '20日締等統合件数': r.mergedRowCount,
      '紹介手数料(粗利非算入)': r.referralFee,
      '粗利益(税抜)': r.grossProfitExTax,
      '粗利率(%)': r.grossProfitRate,
      給与交通費: r.salaryTransport,
      請求交通費: r.billingTransport,
      交通費差額: r.transportDiff,
      交通費判定:
        r.transportDiff === 0
          ? '一致'
          : r.transportDiff > 0
          ? '請求漏れ疑い'
          : '過剰請求疑い',
      要確認フラグ: r.alerts.length > 0 ? '要確認' : '正常',
      アラート詳細: r.alerts.map((a) => a.message).join(' | '),
    }));

    const csvContent = Papa.unparse(formattedData);
    const prefix = includeBOM ? '\uFEFF' : '';
    const blob = new Blob([prefix + csvContent], { type: 'text/csv;charset=utf-8;' });

    const fileName = `派遣粗利管理集計_${
      exportType === 'ALL' ? '全件' : exportType === 'ALERTS_ONLY' ? '要確認のみ' : '交通費差額のみ'
    }_${new Date().toISOString().substring(0, 10)}.csv`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-bold">CSV/Excel 出力設定</h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          <div>
            <label className="font-bold text-slate-700 block mb-2">出力対象レコード</label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="radio"
                  name="exportType"
                  checked={exportType === 'ALL'}
                  onChange={() => setExportType('ALL')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium text-slate-800">全計算結果 ({results.length}件)</span>
              </label>

              <label className="flex items-center space-x-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="radio"
                  name="exportType"
                  checked={exportType === 'ALERTS_ONLY'}
                  onChange={() => setExportType('ALERTS_ONLY')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium text-slate-800">
                  要確認・不整合アラートのみ ({results.filter((r) => r.alerts.length > 0).length}件)
                </span>
              </label>

              <label className="flex items-center space-x-2 p-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="radio"
                  name="exportType"
                  checked={exportType === 'TRANSPORT_MISMATCH'}
                  onChange={() => setExportType('TRANSPORT_MISMATCH')}
                  className="text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium text-slate-800">
                  交通費不一致データのみ ({results.filter((r) => r.transportDiff !== 0).length}件)
                </span>
              </label>
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeBOM}
                onChange={(e) => setIncludeBOM(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-bold text-slate-800">
                Excel用 UTF-8 BOM を付与する (文字化け防止推奨)
              </span>
            </label>
          </div>
        </div>

        <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-white"
          >
            キャンセル
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 flex items-center space-x-1.5 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSVをダウンロード</span>
          </button>
        </div>
      </div>
    </div>
  );
};
