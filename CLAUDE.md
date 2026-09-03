# このリポジトリでの作業に関する重要情報

Claude Code(ローカル・クラウド問わず)は、このファイルを毎回自動で読み込みます。
セッションをまたいで確認が必要な事項はここに追記してください。

## GitHubアカウント (★重要・毎回確認しない)

このマシン(はまさんのPC)のgh(GitHub CLI)には、複数のGitHubアカウントが認証されています。

- **`s-o-m-jc`**: このリポジトリ(`gross-profit-app`)の所有者。**はまさんご本人の別アカウント**(2026-08-25作成、「お客さんのアプリ」用として新規作成)。
  - リポジトリ: https://github.com/s-o-m-jc/gross-profit-app
- **`hamayannn`**: 別プロジェクト用のアカウントで、**このアプリとは無関係**。

このリポジトリは **SSH鍵(`~/.ssh/id_ed25519_s-o-m-jc`)経由で`s-o-m-jc`としてpushするよう設定済み**(2026-09-03設定)。`origin`は
`git@github-s-o-m-jc:s-o-m-jc/gross-profit-app.git`(`~/.ssh/config`の`Host github-s-o-m-jc`エイリアス経由)になっており、
**ghのアクティブアカウントに関わらず(`hamayannn`のままでも)そのまま `git push` / `git pull` でよい**。もう`gh auth switch`は不要。

`git push`が失敗した場合は、まず`git remote -v`で`origin`が上記SSH URLのままになっているか(HTTPS URLに戻っていないか)を確認すること。

## 関連ドキュメント

- 要件整理ドキュメント(`原価管理アプリ_要件整理.md`、はまさんに納品済み): 仕様決定の経緯・過去の議論の詳細はこちら。特に23章にGitHub/Vercel連携の経緯がある。
