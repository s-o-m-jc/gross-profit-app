-- 派遣事業 粗利・経理管理システム
-- フェーズ1: 複数人アクセス対応 初期スキーマ (companies / profiles / monthly_data) + RLS
--
-- 適用方法:
--   Supabaseダッシュボード > SQL Editor に本ファイルの内容を貼り付けて実行するか、
--   Supabase CLIで `supabase db push` を実行する。
--
-- 設計方針:
--   既存アプリは「会社ID → 対象月(YYYY-MM) → {給与/請求/請求書印刷/退職金/休業分補償/
--   休業手当/次月調整} の7カテゴリの行配列」という2段階キー構造(src/utils/monthlyData.ts の
--   AppMonthlyData / MonthlyDataState)でデータを保持している。この構造をそのまま壊さず、
--   会社×対象月を1行、その中身(7カテゴリの行データ全体)をJSONBカラムに保存する設計にした
--   (monthly_data テーブル)。フロントエンドの計算ロジック(calculator.ts等)・型定義は
--   一切変更不要で、永続化層のみをIndexedDB→Supabaseに差し替えられる。

-- ============================================================
-- 0. 拡張機能 (gen_random_uuid用。Supabaseでは通常有効化済みだが念のため)
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- 1. companies: 大阪人材・四国人材・松山人材の3社を固定データとして登録
-- ============================================================
create table if not exists public.companies (
  id text primary key,                 -- 'osaka' | 'shikoku' | 'matsuyama' (src/config/companies.ts の CompanyId と一致させる)
  name text not null,
  fiscal_start_month text not null,    -- 決算開始月 (2桁文字列, '01'〜'12')
  created_at timestamptz not null default now()
);

comment on table public.companies is '大阪人材・四国人材・松山人材の3社マスタ(固定3件)。src/config/companies.tsのCompanyIdと1:1対応。';

insert into public.companies (id, name, fiscal_start_month) values
  ('osaka', '大阪人材', '07'),
  ('shikoku', '四国人材', '10'),
  ('matsuyama', '松山人材', '09')
on conflict (id) do update set
  name = excluded.name,
  fiscal_start_month = excluded.fiscal_start_month;

-- ============================================================
-- 2. profiles: auth.usersに1:1で紐づく権限プロフィール
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  company_id text references public.companies(id),  -- viewerの場合のみ必須(自分が閲覧できる会社)
  created_at timestamptz not null default now(),
  -- roleがviewerの場合は必ずcompany_idを持たせる(adminはNULL=全社閲覧可)
  constraint profiles_viewer_requires_company check (role = 'admin' or company_id is not null)
);

comment on table public.profiles is 'auth.usersに紐づく権限プロフィール。role=admin(全社・編集可)/viewer(自社のみ・閲覧専用)。';

-- ============================================================
-- 3. monthly_data: 会社×対象月ごとの明細データ(給与・請求・粗利計算結果・退職金・
--    紹介手数料・休業分補償・休業手当・次月調整など、これまで実装済みの全カテゴリ)
-- ============================================================
create table if not exists public.monthly_data (
  id uuid primary key default gen_random_uuid(),
  company_id text not null references public.companies(id),
  target_month text not null,          -- 'YYYY-MM' 形式、または対象月不明時は '対象月不明' (UNKNOWN_MONTH_KEY)
  -- MonthlyDataState全体(payrollRows/billingRows/invoiceRows/retirementRows/
  -- leaveCompensationRows/leaveAllowanceRows/nextMonthAdjustmentRows)をそのままJSONBで保持する。
  -- 契約単位の粗利計算結果(GrossProfitResult)はフロント側でこの元データから都度再計算する
  -- (既存のcalculator.tsのロジックを踏襲。計算結果自体は永続化しない)。
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (company_id, target_month)
);

comment on table public.monthly_data is '会社×対象月ごとの給与/請求/請求書印刷/退職金/休業分補償/休業手当/次月調整データ(JSONB)。';

create index if not exists idx_monthly_data_company on public.monthly_data(company_id);

-- state更新時にupdated_at/updated_byをサーバ側で強制設定する(クライアントからの偽装を防ぐ)
create or replace function public.set_monthly_data_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_monthly_data_audit on public.monthly_data;
create trigger trg_monthly_data_audit
  before insert or update on public.monthly_data
  for each row execute function public.set_monthly_data_audit_fields();

-- ============================================================
-- 4. RLS判定用ヘルパー関数 (security definerでprofilesを参照し、
--    ポリシー内で毎回サブクエリを書かず再利用できるようにする)
-- ============================================================
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_company_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

-- ============================================================
-- 5. Row Level Security
-- ============================================================

-- ---- companies: ログイン済みユーザーなら誰でも参照可(3社の固定マスタなので閲覧制限は不要) ----
alter table public.companies enable row level security;

create policy companies_select_authenticated
  on public.companies for select
  to authenticated
  using (true);

-- companiesの変更はダッシュボード(サービスロール)からのみ行う想定。クライアントからの書き込みは許可しない。

-- ---- profiles: 本人のプロフィールのみ参照可。作成・更新はダッシュボード(サービスロール)で行う ----
alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- ---- monthly_data: adminは全社・全操作可。viewerは自分のcompany_idのSELECTのみ可 ----
alter table public.monthly_data enable row level security;

create policy monthly_data_select_admin_all
  on public.monthly_data for select
  to authenticated
  using (public.current_role_name() = 'admin');

create policy monthly_data_select_viewer_own_company
  on public.monthly_data for select
  to authenticated
  using (
    public.current_role_name() = 'viewer'
    and company_id = public.current_company_id()
  );

create policy monthly_data_insert_admin_only
  on public.monthly_data for insert
  to authenticated
  with check (public.current_role_name() = 'admin');

create policy monthly_data_update_admin_only
  on public.monthly_data for update
  to authenticated
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

create policy monthly_data_delete_admin_only
  on public.monthly_data for delete
  to authenticated
  using (public.current_role_name() = 'admin');
