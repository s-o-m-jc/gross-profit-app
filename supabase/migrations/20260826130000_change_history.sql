-- 派遣事業 粗利・経理管理システム
-- フェーズ1 追加分: 自動バックアップ(変更履歴)の実装
--
-- 方針(実施報告にも記載): Supabase Pro機能の「自動バックアップ(Point-in-Time Recovery等)」は
-- 有料のため、無料プランの範囲内で完結する「DBトリガーによる変更履歴テーブル」方式を採用する。
-- monthly_dataテーブルへのUPDATE/DELETEが起きるたびに、変更前の内容(state列=会社×対象月の
-- 全データ)をmonthly_data_historyへ自動的に複製する。アプリ側のコードが「保存を忘れる」
-- 「定期実行を忘れる」といった心配がなく、DBレベルで確実に効くのが利点。
-- 特定の過去バックアップへの「復元(リストア)」UIはフェーズ1のスコープ外(必要になれば
-- 別途追加できるよう、変更前の全内容をそのまま保持する設計にしてある)。
--
-- 適用方法: 20260826120000_init_schema.sql と同様、SQL Editorに貼り付けて実行する
-- (init_schema.sqlを未適用の場合は先にそちらを実行すること)。

-- ============================================================
-- 1. 変更履歴テーブル
-- ============================================================
create table if not exists public.monthly_data_history (
  id uuid primary key default gen_random_uuid(),
  monthly_data_id uuid not null,       -- 変更元(monthly_data.id)。行削除後も履歴として参照できるようFK制約は付けない
  company_id text not null references public.companies(id),
  target_month text not null,
  state jsonb not null,                -- 変更"前"の内容(UPDATE: OLD行 / DELETE: 削除された行)
  operation text not null check (operation in ('UPDATE', 'DELETE')),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id)  -- 変更を行った(≒アップロード/削除操作をした)ユーザー
);

comment on table public.monthly_data_history is
  '無料プラン向けの自動バックアップ: monthly_dataの変更(UPDATE/DELETE)のたびに変更前の内容を' ||
  'トリガーで自動保存する変更履歴。復元UIはフェーズ1スコープ外。';

create index if not exists idx_monthly_data_history_lookup
  on public.monthly_data_history(company_id, target_month, changed_at desc);

-- ============================================================
-- 2. 変更前の内容を自動保存するトリガー
-- ============================================================
create or replace function public.archive_monthly_data_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE') then
    insert into public.monthly_data_history(monthly_data_id, company_id, target_month, state, operation, changed_by)
    values (old.id, old.company_id, old.target_month, old.state, 'UPDATE', auth.uid());
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.monthly_data_history(monthly_data_id, company_id, target_month, state, operation, changed_by)
    values (old.id, old.company_id, old.target_month, old.state, 'DELETE', auth.uid());
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_monthly_data_archive on public.monthly_data;
create trigger trg_monthly_data_archive
  before update or delete on public.monthly_data
  for each row execute function public.archive_monthly_data_change();

-- ============================================================
-- 3. RLS: 参照はadminのみ。INSERT/UPDATE/DELETEを行うクライアント向けポリシーは
--    一切定義しない(RLSは既定で全操作拒否のため、adminであってもトリガー経由以外での
--    書き込み・改ざんはできない = バックアップとしての信頼性を担保する)。
-- ============================================================
alter table public.monthly_data_history enable row level security;

create policy monthly_data_history_select_admin_only
  on public.monthly_data_history for select
  to authenticated
  using (public.current_role_name() = 'admin');
