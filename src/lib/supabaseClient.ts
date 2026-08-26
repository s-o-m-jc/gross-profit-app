/**
 * 派遣事業 粗利・経理管理システム
 * Supabaseクライアント初期化 (認証 + データベース)
 *
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY は .env.local (Gitにコミットしない) に設定する。
 * anon keyはブラウザに公開される前提の公開鍵であり、実際のアクセス制御はSupabase側の
 * Row Level Security (RLS) で行う (supabase/migrations/ 参照)。
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Supabaseの環境変数(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)が設定されていません。' +
      '.env.local(ローカル)またはVercelの環境変数設定を確認してください。'
  );
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    // ブラウザのlocalStorageにセッションを保持し、リロード後もログイン状態を維持する
    persistSession: true,
    autoRefreshToken: true,
  },
});
