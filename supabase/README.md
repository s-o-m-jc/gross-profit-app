# Supabaseセットアップ手順

## 現在の適用状況(2026-10-09時点)

- `20260826120000_init_schema.sql`: **適用済み**(companies / profiles / monthly_data とRLS)。
- `20260826130000_change_history.sql`: **未適用**(2026-09-16/09-30確認済み。トリガーが
  UPDATEのたびに変更前のstate全体を複製する設計で、無料プランのDB容量を圧迫する懸念があり、
  適用を見送っている。対応方針はCLAUDE.mdの該当節を参照)。
- `20261009140000_role_management.sql`: フェーズ2(従業員の権限管理・登録)。role 4種類化
  (super_admin/branch_admin/general/accounting)、registration_requests(登録申請)、
  csv_operation_log(CSV入出力履歴)、fiscal_year_summary_cache+get_fiscal_year_summary()
  (決算期集計の全拠点公開)を追加する。**適用タイミングはCLAUDE.mdの該当節、または直近のコミット
  ログを確認すること。**

## マイグレーションの適用

1. https://supabase.com/dashboard/project/yqenjkotwgldrtlostel を開く
2. 左メニュー「SQL Editor」→「New query」
3. 未適用のマイグレーションファイルの中身を上から順に(ファイル名の日時順に)全部コピーして
   貼り付け、右下の「Run」を実行

## ユーザーの追加(新しい担当者)

運用上は、本人がアプリのログイン画面の「新規登録(申請)」からサインアップ→メール確認→
希望ロール・拠点を指定して申請→拠点管理者または全管理者が承認、という流れを基本とする
(`registration_requests`テーブル、`approve_registration_request()`/`reject_registration_request()`
関数。アプリの`ApprovalInboxModal`から承認・却下できる)。

全管理者・拠点管理者・経理担当者を、申請フローを経由せず直接作成したい場合(既存ユーザーの
初期移行時など)は、以下の手順で行う。

1. ダッシュボード左メニュー「Authentication」→「Users」→「Add user」→「Create new user」
   でユーザーを作成(「Auto Confirm User」をONにすると、メール確認なしですぐログインできます)。
   作成したユーザーの行をクリックし、「User UID」(uuid形式の文字列)をコピーする。
2. 「SQL Editor」で以下を実行(`<UID>`・`<メールアドレス>`を実際の値に置き換える)。
   `role`は`super_admin`(拠点閲覧・編集可、`company_id`はNULL) /
   `branch_admin`(全拠点閲覧のみ、`company_id`は自分の所属拠点) /
   `general`(自拠点のみ閲覧) / `accounting`(自拠点のみ閲覧・編集)のいずれか。
   `super_admin`以外は`company_id`が必須(`companies.id`の値。大阪人材=`osaka` /
   四国人材=`shikoku` / 松山人材=`matsuyama`)。

```sql
insert into public.profiles (id, email, role, company_id)
values ('<UID>', '<メールアドレス>', 'accounting', 'matsuyama');
```

役割変更・拠点変更は以下のようにUPDATEする。

```sql
update public.profiles set role = 'super_admin', company_id = null where email = '<メールアドレス>';
```

## 動作確認の目安

1. ローカルで `npm run dev` を起動し、`http://localhost:3000` を開く。
2. super_adminでログイン → 会社切り替えドロップダウンが表示され3社すべてにアクセスでき、
   CSVアップロード・手入力調整の追加/削除ができ、ヘッダーに「登録申請」ボタンが出ることを確認。
3. branch_adminでログイン → 3社とも閲覧できるが、CSVアップロードパネル・手入力調整の
   フォーム・削除ボタンが出ないこと(閲覧専用)、ヘッダーに「登録申請」ボタンが出るが
   自拠点宛の「一般」申請のみ表示されることを確認。
4. generalでログイン → 自拠点のみ閲覧でき、編集UIが一切出ないこと、決算期(年間)集計タブでは
   「全拠点比較」パネルに3拠点分の数値が出ることを確認。
5. accountingでログイン → 自拠点のみ閲覧・編集でき、CSVアップロード・エクスポートができる
   ことを確認。
