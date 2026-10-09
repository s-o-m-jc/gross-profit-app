-- 派遣事業 粗利・経理管理システム
-- フェーズ2: 従業員の権限管理・登録(4ロール化、登録申請フロー、CSV操作履歴、決算期集計の全拠点公開)
--
-- 適用方法: 20260826120000_init_schema.sql は適用済みの前提(companies/profiles/monthly_dataが
-- 既に存在する)。20260826130000_change_history.sql は本番未適用(2026-09-16/09-30確認済み、
-- トリガーの設計課題が未解決のため)で、本マイグレーションはこれに依存しない。
-- Supabaseダッシュボード > SQL Editor に本ファイルの内容を貼り付けて実行する。
--
-- 設計方針(はまさんとの合意事項、2026-10-09):
--   1. role: 'admin'|'viewer' の2種類から、'super_admin'|'branch_admin'|'general'|'accounting'
--      の4種類に拡張する。
--      - super_admin: 全拠点閲覧・編集可。CSV入出力可。登録申請の最終承認権限あり。company_idはNULL。
--      - branch_admin: 全拠点閲覧可(編集不可)。自拠点(company_id)宛の「general」登録申請を承認できる。
--        company_idは必須(承認ルーティング用の「自分の所属拠点」。閲覧範囲が全拠点であることとは別軸)。
--      - general: 自拠点(company_id)のみ閲覧可(編集不可)。company_id必須。
--      - accounting: 自拠点(company_id)のみ閲覧・編集可。CSV入出力可。company_id必須。
--   2. RLSのSELECT方針: 「全員に全開放してUI側で絞る」ではなく、ロールに応じてRLSで制限する
--      (super_admin・branch_adminは全社SELECT可、general・accountingは自社のみ)。
--      決算期(年間)集計・グラフだけの例外は、生データ(monthly_data)を直接SELECTさせるのではなく、
--      「集計済みの数値(FiscalYearSummary)だけを別テーブルにキャッシュしておき、SECURITY DEFINER
--      関数経由でロールに関わらず全員が読める」という設計で実現する(下記6参照)。
--      理由: calculateFiscalYearSummary()(src/utils/calculator.ts)は非常に複雑な業務ロジックを
--      多数含み、これをSQLに重複実装すると将来の修正漏れ・数値の食い違いを招く危険が大きい。
--      既存のフロント側の計算結果(super_admin/branch_adminが実際に閲覧した際にクライアント側で
--      正しく計算済みの値)をそのままキャッシュに書き込む方式にすることで、ロジックの二重実装を避け、
--      「生データそのものは一切返さない」という要件も満たす。
--   3. 登録申請フロー: 本人がサインアップ(メール確認)後、希望ロール・拠点を指定して申請する。
--      承認は、全管理者(super_admin)は常に可能、拠点管理者(branch_admin)は「general」かつ
--      自拠点宛の申請のみ可能。却下後は同じユーザーが再度申請できる。
--   4. CSV入出力の履歴: super_admin・accountingのみCSV入出力が可能なので、この2ロールの操作のみ記録する。
--
-- 既存データへの影響: 本マイグレーションはprofilesのCHECK制約を変更するため、新しい制約を
-- 追加する前に、このファイル自身の中で既存2行(下記セクション1内)を新しい値に揃えてから
-- 制約を追加する(でないと制約追加時に既存データが違反してALTERが失敗する)。

-- ============================================================
-- 1. profiles: roleを4種類化、company_idの必須条件を変更
-- ============================================================

-- 旧CHECK制約を削除(名前は20260826120000_init_schema.sqlでの自動命名に従う。
-- 存在しない場合でもエラーにならないようIF EXISTSを使う)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_viewer_requires_company;

-- 既存データの移行(はまさんとの合意事項、2026-10-09): 新しいCHECK制約を追加する前に、
-- 旧role('admin'/'viewer')の既存2行を新しい値に揃える(制約追加時に違反するとALTERが失敗するため)。
-- - ha.ma.520112@gmail.com(旧admin): super_adminへ更新(company_idはNULLのまま)。
-- - hamaguchi@seva-consultant.com(旧viewer、osaka): 本アプリの実利用者ではない(別アプリ用の
--   テスト確認アカウント)ため、profiles行を削除する。auth.users自体は削除しない(別アプリで
--   使われている可能性があるため、プロフィールのみ削除してこのアプリへのアクセス権を外す)。
-- 合わせてemail列(これまで未設定だった)をauth.usersから補っておく。
update public.profiles p
set role = 'super_admin', email = u.email
from auth.users u
where p.id = u.id and u.email = 'ha.ma.520112@gmail.com';

delete from public.profiles p
using auth.users u
where p.id = u.id and u.email = 'hamaguchi@seva-consultant.com';

-- 新しいCHECK制約: role 4種類、company_idはsuper_admin以外は必須
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'branch_admin', 'general', 'accounting'));

alter table public.profiles
  add constraint profiles_company_required_unless_super_admin
  check (role = 'super_admin' or company_id is not null);

comment on column public.profiles.role is
  'super_admin(全拠点閲覧・編集・CSV・承認) / branch_admin(全拠点閲覧のみ・自拠点のgeneral申請を承認) / ' ||
  'general(自拠点のみ閲覧) / accounting(自拠点のみ閲覧・編集・CSV)。2026-10-09、旧admin/viewerから移行。';
comment on column public.profiles.company_id is
  'super_admin以外は必須。branch_adminにとっては「承認ルーティング用の自分の所属拠点」であり、' ||
  '閲覧範囲(全拠点)とは別の意味を持つ点に注意。';

-- ============================================================
-- 2. registration_requests: 登録申請テーブル
-- ============================================================
create table if not exists public.registration_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  requested_role text not null check (requested_role in ('branch_admin', 'general', 'accounting')),
  requested_company_id text not null references public.companies(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

comment on table public.registration_requests is
  '本人がサインアップ後に申請する、希望ロール・拠点の登録申請。承認はapprove_registration_request()、' ||
  '却下はreject_registration_request()経由のみ(直接のUPDATEは許可しない)。却下後は再度pending行を作れる。';

-- 1ユーザーにつき同時に1件のpending申請のみ(却下・承認済みの履行行は残したまま、再申請できるようにする)
create unique index if not exists idx_registration_requests_one_pending_per_user
  on public.registration_requests(user_id)
  where (status = 'pending');

create index if not exists idx_registration_requests_branch_pending
  on public.registration_requests(requested_company_id, status);

alter table public.registration_requests enable row level security;

-- 申請の作成は本人のみ(直接INSERT。user_id/status/requested_roleをRLSで強制)
create policy registration_requests_insert_own
  on public.registration_requests for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

-- 自分の申請は閲覧可(承認待ち画面用)
create policy registration_requests_select_own
  on public.registration_requests for select
  to authenticated
  using (user_id = auth.uid());

-- super_adminは全件閲覧可
create policy registration_requests_select_super_admin
  on public.registration_requests for select
  to authenticated
  using (public.current_role_name() = 'super_admin');

-- branch_adminは自拠点宛の「general」申請のみ閲覧可(承認待ち一覧用)
create policy registration_requests_select_branch_admin
  on public.registration_requests for select
  to authenticated
  using (
    public.current_role_name() = 'branch_admin'
    and requested_role = 'general'
    and requested_company_id = public.current_company_id()
  );

-- 直接のUPDATE/DELETEはクライアントから一切許可しない(承認・却下は専用関数経由のみ)

-- ============================================================
-- 3. 承認・却下関数(SECURITY DEFINER。profilesへの行作成とrequestsの更新を1トランザクションで行う)
-- ============================================================

create or replace function public.approve_registration_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  approver_role text := public.current_role_name();
  approver_company text := public.current_company_id();
begin
  select * into req from public.registration_requests where id = p_request_id for update;
  if req is null then
    raise exception '申請が見つかりません。';
  end if;
  if req.status <> 'pending' then
    raise exception 'この申請は既に処理済みです(状態: %)。', req.status;
  end if;

  if approver_role = 'super_admin' then
    -- 全ロール・全拠点の申請を承認可能
    null;
  elsif approver_role = 'branch_admin' then
    if req.requested_role <> 'general' then
      raise exception '拠点管理者は「一般」以外のロールの申請は承認できません。';
    end if;
    if req.requested_company_id <> approver_company then
      raise exception '拠点管理者は自拠点以外の申請は承認できません。';
    end if;
  else
    raise exception 'この操作を行う権限がありません。';
  end if;

  insert into public.profiles (id, email, role, company_id)
  values (req.user_id, req.email, req.requested_role, req.requested_company_id)
  on conflict (id) do update set
    role = excluded.role,
    company_id = excluded.company_id,
    email = excluded.email;

  update public.registration_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id;
end;
$$;

create or replace function public.reject_registration_request(p_request_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  approver_role text := public.current_role_name();
  approver_company text := public.current_company_id();
begin
  select * into req from public.registration_requests where id = p_request_id for update;
  if req is null then
    raise exception '申請が見つかりません。';
  end if;
  if req.status <> 'pending' then
    raise exception 'この申請は既に処理済みです(状態: %)。', req.status;
  end if;

  if approver_role = 'super_admin' then
    null;
  elsif approver_role = 'branch_admin' then
    if req.requested_role <> 'general' then
      raise exception '拠点管理者は「一般」以外のロールの申請は却下できません。';
    end if;
    if req.requested_company_id <> approver_company then
      raise exception '拠点管理者は自拠点以外の申請は却下できません。';
    end if;
  else
    raise exception 'この操作を行う権限がありません。';
  end if;

  update public.registration_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = p_reason
  where id = p_request_id;
end;
$$;

-- ============================================================
-- 4. csv_operation_log: CSV入出力の履歴
-- ============================================================
create table if not exists public.csv_operation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  action text not null check (action in ('export', 'import')),
  company_id text not null references public.companies(id),
  target_month_start text,
  target_month_end text,
  detail text,
  created_at timestamptz not null default now()
);

comment on table public.csv_operation_log is
  'super_admin・accountingによるCSV入出力の履歴。誰が・いつ・どの拠点・どの期間を操作したかを記録する。';

create index if not exists idx_csv_operation_log_user on public.csv_operation_log(user_id, created_at desc);

alter table public.csv_operation_log enable row level security;

-- INSERT: super_admin(全拠点)・accounting(自拠点のみ)。user_idは必ず本人。
create policy csv_operation_log_insert
  on public.csv_operation_log for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.current_role_name() = 'super_admin'
      or (public.current_role_name() = 'accounting' and company_id = public.current_company_id())
    )
  );

-- SELECT: super_adminは全件、accountingは自分の操作履歴のみ。branch_admin・generalは閲覧不可。
create policy csv_operation_log_select_super_admin
  on public.csv_operation_log for select
  to authenticated
  using (public.current_role_name() = 'super_admin');

create policy csv_operation_log_select_own
  on public.csv_operation_log for select
  to authenticated
  using (public.current_role_name() = 'accounting' and user_id = auth.uid());

-- ============================================================
-- 5. monthly_data: RLSを4ロール対応に差し替え
-- ============================================================

drop policy if exists monthly_data_select_admin_all on public.monthly_data;
drop policy if exists monthly_data_select_viewer_own_company on public.monthly_data;
drop policy if exists monthly_data_insert_admin_only on public.monthly_data;
drop policy if exists monthly_data_update_admin_only on public.monthly_data;
drop policy if exists monthly_data_delete_admin_only on public.monthly_data;

-- SELECT: super_admin・branch_adminは全社、general・accountingは自社のみ
create policy monthly_data_select_full_access_roles
  on public.monthly_data for select
  to authenticated
  using (public.current_role_name() in ('super_admin', 'branch_admin'));

create policy monthly_data_select_own_company_roles
  on public.monthly_data for select
  to authenticated
  using (
    public.current_role_name() in ('general', 'accounting')
    and company_id = public.current_company_id()
  );

-- 書き込みはsuper_admin(全社)・accounting(自社のみ)
create policy monthly_data_insert_write_roles
  on public.monthly_data for insert
  to authenticated
  with check (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'accounting' and company_id = public.current_company_id())
  );

create policy monthly_data_update_write_roles
  on public.monthly_data for update
  to authenticated
  using (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'accounting' and company_id = public.current_company_id())
  )
  with check (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'accounting' and company_id = public.current_company_id())
  );

create policy monthly_data_delete_write_roles
  on public.monthly_data for delete
  to authenticated
  using (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'accounting' and company_id = public.current_company_id())
  );

-- ============================================================
-- 6. fiscal_year_summary_cache: 決算期(年間)集計の全拠点公開用キャッシュ
-- ============================================================
-- 設計: 生データ(billingRows/payrollRows等)は一切持たず、フロント側で既に正しく計算済みの
-- FiscalYearSummaryオブジェクト(src/types.ts)をそのままJSONBで保持するだけのキャッシュテーブル。
-- super_admin(全社)・branch_admin(全社、閲覧権限はあるため正しい値を計算できる)が、決算期集計画面を
-- 開くたびにクライアント側でupsertする。general・accountingは自社分のみupsert可(自社の生データは
-- 正しく見えているため)。読み取りは7のSECURITY DEFINER関数経由でロールに関わらず誰でも可能にする。
create table if not exists public.fiscal_year_summary_cache (
  company_id text not null references public.companies(id),
  fiscal_year integer not null,  -- 決算期の開始年(例: 2026年度なら2026)
  summary jsonb not null,
  computed_at timestamptz not null default now(),
  computed_by uuid references auth.users(id),
  primary key (company_id, fiscal_year)
);

comment on table public.fiscal_year_summary_cache is
  '決算期(年間)集計(FiscalYearSummary)の計算済みキャッシュ。生データは持たない。' ||
  'super_admin/branch_adminは全社分、general/accountingは自社分のみ書き込み可。' ||
  '読み取りはget_fiscal_year_summary()関数経由(ロールに関わらず全員可)。';

-- computed_at/computed_byは、monthly_dataのset_monthly_data_audit_fields()と同じ考え方で
-- サーバ側のトリガーで強制設定する(クライアントからの偽装防止。クライアント側はこの2列を
-- 送らなくてよい)。
create or replace function public.set_fiscal_year_summary_cache_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.computed_at := now();
  new.computed_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_fiscal_year_summary_cache_audit on public.fiscal_year_summary_cache;
create trigger trg_fiscal_year_summary_cache_audit
  before insert or update on public.fiscal_year_summary_cache
  for each row execute function public.set_fiscal_year_summary_cache_audit_fields();

alter table public.fiscal_year_summary_cache enable row level security;

-- 直接のSELECTはsuper_admin/branch_admin(全社)・general/accounting(自社のみ)。
-- 他拠点の値はこのポリシーでは読めず、7のSECURITY DEFINER関数経由のみ(そちらはロール不問)。
-- ★general/accountingにも自社分の直接SELECTを許可しているのは、クライアント側のupsert
-- (INSERT ... ON CONFLICT DO UPDATE)がRLS下で正しく動作するために既存行を見える必要があるため
-- (このテーブルは集計済みの数値のみで生データを含まないため、自社分を見せても問題ない)。
create policy fiscal_year_summary_cache_select
  on public.fiscal_year_summary_cache for select
  to authenticated
  using (
    public.current_role_name() in ('super_admin', 'branch_admin')
    or company_id = public.current_company_id()
  );

-- 書き込み(INSERT/UPDATE)はsuper_admin・branch_admin(全社)、general・accounting(自社のみ)
create policy fiscal_year_summary_cache_upsert
  on public.fiscal_year_summary_cache for insert
  to authenticated
  with check (
    public.current_role_name() in ('super_admin', 'branch_admin')
    or company_id = public.current_company_id()
  );

create policy fiscal_year_summary_cache_update
  on public.fiscal_year_summary_cache for update
  to authenticated
  using (
    public.current_role_name() in ('super_admin', 'branch_admin')
    or company_id = public.current_company_id()
  )
  with check (
    public.current_role_name() in ('super_admin', 'branch_admin')
    or company_id = public.current_company_id()
  );

-- ============================================================
-- 7. get_fiscal_year_summary: 決算期集計の公開読み取り関数(SECURITY DEFINER、生データは一切返さない)
-- ============================================================
create or replace function public.get_fiscal_year_summary(p_company_id text, p_fiscal_year integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select summary from public.fiscal_year_summary_cache
  where company_id = p_company_id and fiscal_year = p_fiscal_year;
$$;

comment on function public.get_fiscal_year_summary is
  '決算期(年間)集計のキャッシュ済みの値(FiscalYearSummary、集計済みの数値のみ)を返す。' ||
  'ロールに関わらず承認済みユーザーなら誰でも呼べる(SECURITY DEFINERでfiscal_year_summary_cacheの' ||
  'RLSをバイパスするが、このテーブル自体が生データを持たないため「生データは返さない」要件を満たす)。' ||
  'authenticatedロールにのみEXECUTE権限があり、未ログインでは呼べない。';

revoke all on function public.get_fiscal_year_summary(text, integer) from public;
grant execute on function public.get_fiscal_year_summary(text, integer) to authenticated;
