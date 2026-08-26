# Supabaseセットアップ手順 (フェーズ1: 複数人アクセス対応)

このディレクトリの `migrations/` に2つのSQLファイルがあります。**どちらもまだSupabase側に
適用されていません。** 以下の手順で、上から順に1回ずつ適用してください。

- `20260826120000_init_schema.sql`: 認証+DBの初期スキーマ(companies / profiles / monthly_data
  テーブルとRLSポリシー)
- `20260826130000_change_history.sql`: 自動バックアップ(変更履歴)用の `monthly_data_history`
  テーブルとトリガー。無料プランでも動く「DBトリガーで変更前の内容を自動複製する」方式。

## 1. マイグレーションの適用

1. https://supabase.com/dashboard/project/yqenjkotwgldrtlostel を開く
2. 左メニュー「SQL Editor」→「New query」
3. `supabase/migrations/20260826120000_init_schema.sql` の中身を全部コピーして貼り付け、
   右下の「Run」を実行
4. 成功したら、左メニュー「Table Editor」に `companies` / `profiles` / `monthly_data` の
   3テーブルが作成され、`companies` に大阪人材・四国人材・松山人材の3行が入っていることを確認
5. 同じ手順で `supabase/migrations/20260826130000_change_history.sql` も実行し、
   `monthly_data_history` テーブルが作成されたことを確認

## 2. テストユーザーの作成

### 2-1. 管理者(admin)ユーザー

1. ダッシュボード左メニュー「Authentication」→「Users」→「Add user」→「Create new user」
2. メールアドレス・パスワードを入力して作成(「Auto Confirm User」をONにしておくと、
   メール確認なしですぐログインできます)
3. 作成したユーザーの行をクリックし、「User UID」(uuid形式の文字列)をコピー
4. 「SQL Editor」で以下を実行(`<UID>` と `<メールアドレス>` を実際の値に置き換える)

```sql
insert into public.profiles (id, email, role, company_id)
values ('<UID>', '<メールアドレス>', 'admin', null);
```

### 2-2. 閲覧専用(viewer・大阪人材)ユーザー

1. 同様に「Authentication」→「Users」→「Add user」でもう1人作成し、UIDをコピー
2. 「SQL Editor」で以下を実行

```sql
insert into public.profiles (id, email, role, company_id)
values ('<UID>', '<メールアドレス>', 'viewer', 'osaka');
```

(`company_id` は `companies.id` の値。大阪人材=`osaka` / 四国人材=`shikoku` / 松山人材=`matsuyama`)

## 3. 動作確認

1. ローカルで `npm run dev` を起動し、`http://localhost:3000` を開く
2. 管理者アカウントでログイン → 会社切り替えドロップダウンが表示され、3社すべてに
   アクセスでき、CSVアップロードや手入力調整の追加/削除ができることを確認
3. いったんログアウトし、viewer(大阪人材)アカウントでログイン → ヘッダーの会社名が
   「大阪人材」に固定され会社切り替えUIが出ないこと、CSVアップロードパネルが表示されない
   こと、手入力調整パネルの入力フォーム・削除ボタンが出ないこと、四国・松山のデータが
   一切見えないことを確認

## 4. profilesの追加・変更(運用時)

新しい担当者を追加する場合は、上記2と同じ手順(Authentication でユーザー作成 → SQL Editor
で `profiles` に1行 insert)を繰り返してください。役割変更・会社変更は以下のようにUPDATEします。

```sql
update public.profiles set role = 'admin', company_id = null where email = '<メールアドレス>';
-- または
update public.profiles set role = 'viewer', company_id = 'shikoku' where email = '<メールアドレス>';
```
