/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_TAX_RATE?: string;
  readonly VITE_LOW_MARGIN_THRESHOLD?: string;
  readonly VITE_ENABLE_AUDIT_LOG?: string;
  /** SupabaseプロジェクトURL (Project Settings > API)。認証・DB接続に使用。 */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase Publishable(anon) key。ブラウザに公開される前提のキー(RLSで保護する)。 */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** ビルドしたコミット(フル)とビルド日時(ISO)。vite.config.tsのdefineで埋め込む */
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;
