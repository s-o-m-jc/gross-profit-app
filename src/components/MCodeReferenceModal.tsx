/**
 * 派遣事業 粗利・経理管理システム (Power Query v1.1 互換)
 * Power Query Mコード ⇔ TypeScript 変換リファレンスモーダル
 */

import React from 'react';
import { X, FileSpreadsheet, Code2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { POWER_QUERY_M_MAPPINGS } from '../utils/mCodeGuide';

interface MCodeReferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MCodeReferenceModal: React.FC<MCodeReferenceModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
        {/* モーダルヘッダー */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-600 rounded-lg">
              <FileSpreadsheet className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold">
                Excel (Power Query) ⇔ Web App (TypeScript) 仕様変換設計図
              </h2>
              <p className="text-xs text-slate-400">
                仕様書 v1.1 の MコードステップとWebアプリロジックの1対1対応
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 flex items-start space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold block mb-1">
                Power Query完全互換エンジンの特徴:
              </strong>
              本Webアプリケーションは、従来のExcel Power Queryブック（v1.1）における手動更新・ファイルパス依存・Windowsクライアント制約を排除し、完全ブラウザ完結で同等以上の結合精度と計算速度を実現しています。
            </div>
          </div>

          <div className="space-y-6">
            {POWER_QUERY_M_MAPPINGS.map((item, index) => (
              <div
                key={index}
                className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm"
              >
                <h3 className="text-xs font-bold text-slate-800 mb-2 flex items-center space-x-2">
                  <span className="bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded-full">
                    Step {index + 1}
                  </span>
                  <span>{item.stepName}</span>
                </h3>

                <p className="text-xs text-slate-600 mb-3 leading-relaxed">{item.explanation}</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Mコード */}
                  <div className="bg-slate-900 text-emerald-300 p-3 rounded-lg font-mono text-[11px] overflow-x-auto border border-slate-800">
                    <div className="text-[10px] text-slate-400 font-bold mb-1 border-b border-slate-800 pb-1">
                      Power Query Mコード (現行Excel)
                    </div>
                    <pre>{item.mCodeSnippet}</pre>
                  </div>

                  {/* TSコード */}
                  <div className="bg-slate-900 text-indigo-300 p-3 rounded-lg font-mono text-[11px] overflow-x-auto border border-slate-800">
                    <div className="text-[10px] text-slate-400 font-bold mb-1 border-b border-slate-800 pb-1">
                      TypeScript 処理エンジン (Web App)
                    </div>
                    <pre>{item.typescriptEquivalent}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* モーダルフッター */}
        <div className="bg-slate-50 border-t border-slate-200 p-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
