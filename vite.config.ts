import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {execSync} from 'child_process';
import {defineConfig, type Plugin} from 'vite';

// ★2026-10-02追加(はまさんの依頼「古い画面を見ていたのでは」の混乱を無くす): ビルドしたコミットと日時を
// アプリに埋め込み(フッターに表示)、同じ内容をdist/version.jsonにも出す。開いているタブはversion.jsonを
// 定期的に読み、自分と違うコミットがデプロイされていたら再読み込みを促す(src/components/UpdateNotifier.tsx)。
// Vercelのビルドでは.gitが無い場合があるため、Vercelが渡すVERCEL_GIT_COMMIT_SHAを優先する。
function resolveCommit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', {encoding: 'utf8'}).trim();
  } catch {
    return 'unknown';
  }
}
const APP_COMMIT = resolveCommit();
const APP_BUILT_AT = new Date().toISOString();

function versionJsonPlugin(): Plugin {
  return {
    name: 'app-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({commit: APP_COMMIT, builtAt: APP_BUILT_AT}),
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), versionJsonPlugin()],
    define: {
      __APP_COMMIT__: JSON.stringify(APP_COMMIT),
      __APP_BUILT_AT__: JSON.stringify(APP_BUILT_AT),
    },
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
