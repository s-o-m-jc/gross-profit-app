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
      // ★2026-09-26追加(本番エラーの追跡用): 本番ビルドでもsourcemapを出力する。
      // これにより、ブラウザに記録されたスタックトレースから元のコンポーネント名・行番号を
      // 特定できる(removeChildクラッシュの調査では、これが無かったため圧縮後の座標を
      // ローカルの同一ハッシュのビルドから手作業で逆引きする必要があった)。
      // 注意: Vercelは/*.mapへの直接アクセスを403で拒否するため、ブラウザのDevToolsが
      // 自動でsourcemapを解決できない場合がある。その場合も、デプロイ済みバンドルと
      // ハッシュが一致するローカルビルドの.mapで座標を解決できる(前回の調査で実証済み)。
      sourcemap: true,
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
