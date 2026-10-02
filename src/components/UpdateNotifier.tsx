/**
 * ★2026-10-02追加(はまさんの依頼): 開きっぱなしのタブに、新しいバージョンのデプロイを知らせる。
 * ビルドごとに出力される/version.json(vite.config.ts参照)を定期的に読み、このタブのコミットと違えば
 * 画面下に「新しいバージョンがあります」を出す。再読み込みは押したときだけ行う(入力途中の内容を勝手に
 * 消さないため)。開発サーバー(npm run dev)ではversion.jsonが無いので何もしない。
 */
import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { APP_COMMIT, formatBuiltAt } from '../version';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function UpdateNotifier() {
  const [latest, setLatest] = useState<{ commit: string; builtAt: string } | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const v = await res.json();
        if (!stopped && typeof v?.commit === 'string' && v.commit && v.commit !== APP_COMMIT) setLatest(v);
      } catch {
        // オフライン等は次回に再確認
      }
    };
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    // タブに戻ってきたときにもすぐ確認する(長時間開いたままのタブ向け)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!latest) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] w-[calc(100%-2rem)] max-w-xl bg-amber-50 border border-amber-300 shadow-lg rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-amber-900">
      <div className="flex-1">
        <div className="font-bold">新しいバージョンがあります。再読み込みしてください。</div>
        <div className="text-amber-700 mt-0.5">
          表示中: {APP_COMMIT.slice(0, 7)} → 最新: {latest.commit.slice(0, 7)}({formatBuiltAt(latest.builtAt)} ビルド)
        </div>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        再読み込み
      </button>
    </div>
  );
}
