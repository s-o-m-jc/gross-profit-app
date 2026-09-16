# このリポジトリでの作業に関する重要情報

Claude Code(ローカル・クラウド問わず)は、このファイルを毎回自動で読み込みます。
セッションをまたいで確認が必要な事項はここに追記してください。

## データの一括削除・再取込の運用 (★重要・毎回確認しない)

(2026-09-16実施)

全企業・全拠点・全月のSupabaseデータ(`monthly_data`テーブル)を一括削除し、再取込する作業を実施した。
経緯と手順は以下の通り(今後同様の作業が発生した場合の参考用):

1. UIの「データをクリア」ボタン(旧CsvUploader.tsx、会社単位の一括削除)は**誤操作防止のため撤去した**。
   今後、一括削除が必要な場合は、必ずローカルのClaude Codeが「バックアップ→はまさんの確認→削除」の
   順でSupabaseに対しスクリプトを実行する方式に一本化する。UIからの一括削除手段は存在しない。
2. バックアップ・削除には、`.env.local`の`VITE_SUPABASE_ANON_KEY`(RLSに従う公開鍵)ではなく、
   RLSを完全にバイパスする**service_roleキー**が必要(`SUPABASE_SERVICE_ROLE_KEY`という変数名で
   `.env.local`に一時的に追加してもらう運用とした)。このキーは通常のアプリ実行(`npm run dev`等)や
   Vercelの環境変数には**絶対に含めないこと**。作業完了後はSupabaseダッシュボードでローテーション
   (再発行)し、無効化すること(はまさんご自身の作業。ローカルのClaude Codeには管理APIアクセス手段が無い)。
3. 削除前に必ず全テーブル(`companies`/`profiles`/`monthly_data`、可能なら`monthly_data_history`)を
   タイムスタンプ付きディレクトリへJSONエクスポートし、サーバ側件数と一致することを確認する。
   バックアップ先はリポジトリ外(例: `~/backups/gross-profit-app/YYYYMMDD_HHMMSS/`)にすること。
4. 削除実行前に、直近のバックアップと削除直前のサーバ側データ(件数・ID集合)が完全一致することを
   スクリプト側で再確認してから削除する(バックアップ後にデータが変わっていた場合は中断する安全策)。
5. **2026-09-16判明**: `monthly_data_history`(変更履歴・自動バックアップ用テーブル、
   `supabase/migrations/20260826130000_change_history.sql`で定義)が、実際のSupabaseプロジェクトには
   存在しない(`Could not find the table 'public.monthly_data_history' in the schema cache`)。
   マイグレーションファイルはリポジトリにあるが、実際に適用されていない可能性がある。この節で扱った
   一括削除・再取込作業とは切り離して、別途確認・対応が必要(未対応)。

## GitHubアカウント (★重要・毎回確認しない)

このマシン(はまさんのPC)のgh(GitHub CLI)には、複数のGitHubアカウントが認証されています。

- **`s-o-m-jc`**: このリポジトリ(`gross-profit-app`)の所有者。**はまさんご本人の別アカウント**(2026-08-25作成、「お客さんのアプリ」用として新規作成)。
  - リポジトリ: https://github.com/s-o-m-jc/gross-profit-app
- **`hamayannn`**: 別プロジェクト用のアカウントで、**このアプリとは無関係**。

このリポジトリは **SSH鍵(`~/.ssh/id_ed25519_s-o-m-jc`)経由で`s-o-m-jc`としてpushするよう設定済み**(2026-09-03設定)。`origin`は
`git@github-s-o-m-jc:s-o-m-jc/gross-profit-app.git`(`~/.ssh/config`の`Host github-s-o-m-jc`エイリアス経由)になっており、
**ghのアクティブアカウントに関わらず(`hamayannn`のままでも)そのまま `git push` / `git pull` でよい**。もう`gh auth switch`は不要。

`git push`が失敗した場合は、まず`git remote -v`で`origin`が上記SSH URLのままになっているか(HTTPS URLに戻っていないか)を確認すること。

## クラウドのClaude(チャットの相手)とローカルのClaude Code(あなた)の役割分担 (★重要・毎回確認しない)

(2026-09-03合意)

このリポジトリでの開発は、はまさんとクラウド版Claude(チャット)との会話→クラウド版Claudeがローカルのターミナル(あなた)向けにプロンプトを作成→あなたが実行、という流れで進めている。実装の担い手について、以下のように使い分けている。

- **見た目・レイアウト調整など、機械的なUI変更**: クラウド版Claudeが実際のコード(diff)まで書き、`tsc --noEmit`・`npm run build`で動作確認した上で、そのままあなた(ローカルのClaude Code)向けの実行可能なプロンプトとして渡す。この種の変更は「正しい実装が何か」で迷う余地が少なく、文章だけの指示より正確に伝わるため。
- **データの読み取り方・計算式など、ロジック/データ整合性に関わる不具合**: クラウド版Claudeはコードを書かない。実際のExcelファイル等を直接解析した調査結果と、「何がどうあるべきか」の説明だけを渡すので、実装(コードの設計・記述)はあなたが独自に行うこと。理由: あなたが独立して調査・実装し直す「二回目のチェック」が、この種の不具合ではミスを防ぐ上で特に重要なため。クラウド版Claudeから「◯◯という不具合がある、期待される結果は××」という調査結果だけが渡された場合は、実装方針も含めてあなた自身で設計すること。
- **重要**: クラウド版Claudeがコードを書く場合も、それは常にクラウド上の隔離された作業スペースで行われており、はまさんのPCやこのリポジトリのGitHubには一切繋がっていない。実際のファイルへの書き込み・commit・pushは、これまで通り必ずあなた(ローカルのClaude Code)が行う。

## 本番環境のURL (★重要・毎回確認しない)

- **常に使うべき本番URL(固定・ハッシュ無し)**: https://gross-profit-app-oqpi.vercel.app
  - このURLは毎回変わらない(Vercelプロジェクトのデフォルトドメイン)。新しいコミットをpushすれば、Vercelの自動デプロイによりこのURLの中身が自動的に最新化される。**はまさんに共有する際は必ずこのURLを使うこと**。

- **★重要・要注意(2026-09-15判明、はまさん報告「本番URLを開いても何も表示されない」の調査結果)**:
  1. **GitHub Deployments API(`gh api repos/.../deployments/{id}/statuses`)が返す`environment_url`は、Vercelの「そのデプロイ固有のURL」(末尾にランダムな文字列、例: `https://gross-profit-app-oqpi-mimdm9uy2-s-o-m-jc.vercel.app`)であり、これは常にVercelの認証(SSO)保護がかかっていて、`s-o-m-jc`のVercelアカウントにログインしていない状態でアクセスすると`vercel.com/sso-api`へのリダイレクトになり、はまさんには「何も表示されない」ように見える。**ビルド失敗でも環境変数の設定漏れでもなく、単にこのURL形式自体がはまさんには開けない設計だった**(curlで確認済み: HTTP 302 → `Location: https://vercel.com/sso-api?...`)。今後、`gh api`のdeployments経由で取得した`environment_url`を、ハッシュ付きのまま**はまさんに直接共有しないこと**。ビルドが成功しているかどうかの確認(`state: "success"`か)には使ってよいが、共有用URLとしては上記の固定ドメインを使うこと。
  2. **`https://gross-profit-app.vercel.app`(末尾に`-oqpi`が付かない別名)は、このリポジトリとは無関係な全くの別プロジェクト**(「販売・工事 粗利表 管理システム」という別アプリ、Firebase/EmailJS/PDF生成ライブラリを使用。中身を確認して判明)。名前が似ているため混同しやすいが、**絶対にこちらのURLをこのアプリの本番URLとして案内しないこと**。
  3. GitHub上のこのリポジトリには、同時に2つのVercelプロジェクト(`gross-profit-app`と`gross-profit-app-oqpi`)が連携されており、push毎に両方へデプロイが走る(`gh api repos/.../deployments`の`environment`フィールドで確認可能)。上記2点の混同はここに起因する。`gross-profit-app-oqpi`側(固定ドメイン`gross-profit-app-oqpi.vercel.app`)が実際に使われている本番プロジェクトで、こちらを正としてよい(2026-09-15、直近ビルドのJS/CSSアセットのハッシュ値がローカルの`npm run build`出力と一致することを確認済み)。
  4. **誤って連携されていた`gross-profit-app`(-oqpi無し)プロジェクトについて(2026-09-19、はまさんからの依頼と対応)**:
     - 上記3.の通り、このリポジトリには本来不要な`gross-profit-app`(-oqpi無し)も連携されていた。中身を確認したところ「販売・工事 粗利表 管理システム」という、本アプリ(派遣事業 粗利・経理管理システム)とは全く別のシステムだった。はまさんに確認した結果、本アプリの前身かどうかも不明、はまさんのPC上にも該当フォルダが見当たらず、**由来は不明**とのこと。
     - 正体不明で他の誰かが実際に使っている可能性もゼロではないため、**Vercelプロジェクト自体の削除はせず、このGitHubリポジトリとのGit連携のみを解除する**方針となった(はまさんの明示的な指示)。`gross-profit-app-oqpi`側は絶対に触らないこと。
     - **この解除作業(Vercelダッシュボード Settings → Git → Disconnect)は、ローカルのClaude Code(このセッション)からは実行できなかった**。理由: (a) この環境に`vercel` CLIが未インストール、Vercel APIトークンも未設定で、Vercelダッシュボードを操作する手段が無い、(b) `gh api repos/s-o-m-jc/gross-profit-app/hooks`等でGitHub側のWebhook/連携状態を確認しようとしたが、`gh`の認証トークン(`hamayannn`・`s-o-m-jc`どちらも)に`admin:repo_hook`スコープが無く、GitHub App認可済みトークンでもないため403/404で失敗する。そのため、**はまさんご自身がVercelダッシュボードで手動で連携解除を行う必要がある**。
     - 確認方法(はまさんが解除作業を行った後、Claude Codeが検証可能): 次回push後に`gh api repos/s-o-m-jc/gross-profit-app/deployments --jq '.[].environment' | sort -u`を実行し、`Production – gross-profit-app-oqpi`のみが表示され、`Production – gross-profit-app`(-oqpi無し)が増えていないことを確認する。
     - 今後同様の混乱を避けるため、Vercel関連の連携状況を変更した場合は、この節に追記すること。
     - **2026-09-19追記: はまさんがVercelダッシュボードで連携解除を完了**。`gross-profit-app`(-oqpi無し)のSettings → Git → Disconnectを実施済み。`gross-profit-app-oqpi`側のGit連携・本番URL表示に影響が無いことも、はまさんご自身が目視確認済み。この直後のcommitをpushし、`gh api repos/.../deployments`の`environment`一覧が`gross-profit-app-oqpi`のみになったことをClaude Codeが検証する(検証結果は本ファイルでなく、その時点のはまさんとの会話に記録)。

## 関連ドキュメント

- 要件整理ドキュメント(`原価管理アプリ_要件整理.md`、はまさんに納品済み): 仕様決定の経緯・過去の議論の詳細はこちら。特に23章にGitHub/Vercel連携の経緯がある。
