/**
 * このアプリのバージョン(ビルドしたコミットとビルド日時)。vite.config.tsのdefineで埋め込まれる。
 * ★2026-10-02追加(はまさんの依頼): 本番画面が最新かどうかをすぐ判断できるよう、フッターに表示する。
 */
export const APP_COMMIT: string = __APP_COMMIT__;
export const APP_COMMIT_SHORT = APP_COMMIT.slice(0, 7);
export const APP_BUILT_AT: string = __APP_BUILT_AT__;

/** ビルド日時を日本時間で「2026/10/02 15:40」の形にする */
export function formatBuiltAt(iso: string = APP_BUILT_AT): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 例: 「81b5703 (2026/10/02 15:40 ビルド)」。開発サーバー(npm run dev)では「(開発中)」を付ける */
export function formatAppVersion(): string {
  return `${APP_COMMIT_SHORT} (${formatBuiltAt()} ビルド${import.meta.env.DEV ? '・開発中' : ''})`;
}
