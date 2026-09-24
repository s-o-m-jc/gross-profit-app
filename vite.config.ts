import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // ★2026-09-30一時追加(本番障害の調査用): removeChildクラッシュの実際の発生箇所を
      // ブラウザのスタックトレースから特定するため、一時的にsourcemapを有効化した。
      // 原因特定・修正が完了したら元に戻すこと(このコメントごと削除してfalseに戻す)。
      // ★同日追記: 通常の外部.map方式だとVercelが/*.mapへの直接アクセスを403で
      // ブロックしており(プラットフォーム側の既定挙動、vercel.jsonのrewritesとは無関係)、
      // ブラウザが.mapを取得できずスタックトレースが読めなかった。'inline'にしてJS本体に
      // sourcemapを埋め込むことで、別リクエスト無しにDevToolsが解決できるようにした
      // (一時的にJSバンドルのサイズが大きくなるが、調査用のため許容する)。
      // 注意: 有効な間は、閲覧者がブラウザの開発者ツール経由で元のソース構造を閲覧可能になる。
      sourcemap: 'inline',
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
