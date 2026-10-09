-- 派遣事業 粗利・経理管理システム
-- 緊急修正: get_fiscal_year_summary()がstaffPaidLeaveBalances(個人名入り)を返していた問題の是正
--
-- ★2026-10-09判明(はまさんの指摘): FiscalYearSummary型(src/types.ts)の全フィールドを再確認した
-- 結果、staffPaidLeaveBalances(スタッフ番号・スタッフ氏名・直近の有給残日数を個人単位で持つ配列)
-- だけが唯一の個人単位の情報だった(他のフィールドはすべて月次・カテゴリ別・クライアント別の
-- 集計値)。get_fiscal_year_summary()はfiscal_year_summary_cacheのsummary列(FiscalYearSummary
-- オブジェクト全体)をそのまま返していたため、ロールに関わらず(一般・経理担当者を含む)
-- 他拠点のこのRPCを呼べば、他拠点のスタッフ氏名・有給残日数がネットワーク応答に含まれていた
-- (「全拠点比較パネル」はこのうち4項目しか画面に表示していなかったが、データ自体は既に
-- 越境していた)。
--
-- 対応: get_fiscal_year_summary()の返り値から、jsonbの'-'演算子でstaffPaidLeaveBalancesキーを
-- 除いて返すよう修正する。fiscal_year_summary_cache自体(保存内容)は変更しない
-- (super_admin/branch_admin、および自社分はgeneral/accountingも直接SELECTで見られる設計の
-- ままでよく、これは元から自分の拠点の情報のため問題ない。関数経由で他拠点分を読むときだけ除く)。
--
-- 適用方法: 20261009140000_role_management.sql適用後に、Supabaseダッシュボード > SQL Editorで
-- 本ファイルを実行する。他の変更より先に、優先して適用すること。

create or replace function public.get_fiscal_year_summary(p_company_id text, p_fiscal_year integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select summary - 'staffPaidLeaveBalances' from public.fiscal_year_summary_cache
  where company_id = p_company_id and fiscal_year = p_fiscal_year;
$$;

comment on function public.get_fiscal_year_summary is
  '決算期(年間)集計のキャッシュ済みの値(FiscalYearSummary、集計済みの数値のみ)を返す。' ||
  'ロールに関わらず承認済みユーザーなら誰でも呼べる(SECURITY DEFINERでfiscal_year_summary_cacheの' ||
  'RLSをバイパスするが、このテーブル自体が生データを持たないため「生データは返さない」要件を満たす)。' ||
  '★2026-10-09修正: staffPaidLeaveBalances(個人名入り)は除いて返す(他拠点への個人情報の越境を防ぐため)。' ||
  'authenticatedロールにのみEXECUTE権限があり、未ログインでは呼べない。';
