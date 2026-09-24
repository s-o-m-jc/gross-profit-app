/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ★2026-09-30追加(本番障害対応): 従来はトップレベルにErrorBoundaryが無く、描画中に
 * 何らかの例外(例: サードパーティ製チャート/アニメーションライブラリが原因のDOM操作エラー)
 * が起きると、Reactがツリー全体をアンマウントし画面が真っ白になったまま復旧手段が無かった。
 * これを防ぐため、アプリ全体を囲むErrorBoundaryを追加し、描画中の例外を捕捉して
 * 再読み込みを促す画面を表示するようにした。
 */

import { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  // このプロジェクトには@types/reactが導入されておらず、Componentの継承メンバーの型が
  // 補完されないため、props/stateを明示的に再宣言している(型情報のみ、実体はComponent側)。
  declare props: Props;
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('アプリの描画中に予期しないエラーが発生しました:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 text-slate-600 text-sm gap-4 px-4 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
          <p>
            画面の表示中に予期しないエラーが発生しました。
            <br />
            お手数ですが再読み込みをお試しください。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700"
          >
            再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
