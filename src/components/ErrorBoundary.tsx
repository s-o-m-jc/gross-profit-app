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
 *
 * ★2026-09-26追加(removeChildクラッシュの原因追跡用): 次に同種のエラーが起きたときに原因を
 * 追えるよう、発生時刻・直前の認証イベント名・URLもconsole.errorに出力する。
 * あわせて、認証状態の不整合が疑われるケースから確実に復帰できるよう、エラー画面に
 * 「ログインし直す」ボタン(signOut後に再読み込み)を追加した。
 */

import { Component, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getLastAuthEventInfo } from '../lib/AuthContext';

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
    // ★診断情報: 発生時刻・直前の認証イベント・URLを併せて出力する。
    // (removeChildクラッシュは「AppShellがアンマウントされる瞬間」に起きており、その引き金が
    //  認証イベントだったため、どのイベント直後に起きたかが原因切り分けの決め手になる)
    const authInfo = getLastAuthEventInfo();
    console.error(
      'アプリの描画中に予期しないエラーが発生しました:',
      error,
      {
        発生時刻: new Date().toISOString(),
        直前の認証イベント: authInfo.event,
        認証イベント受信時刻: authInfo.at,
        URL: typeof window !== 'undefined' ? window.location.href : '(不明)',
      },
      info.componentStack
    );
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleSignOutAndReload = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('ログアウト処理に失敗しましたが、再読み込みを続行します:', e);
    }
    window.location.reload();
  };

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
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700"
            >
              再読み込み
            </button>
            {/* 再読み込みでも直らない場合(認証状態の不整合が疑われる場合)の復帰手段 */}
            <button
              onClick={this.handleSignOutAndReload}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50"
            >
              ログインし直す
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            再読み込みでも直らない場合は「ログインし直す」をお試しください。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
