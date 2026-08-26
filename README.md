<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# 派遣事業 粗利・経理管理システム（3社統合版）

大阪人材・四国人材・松山人材の3社は同じ計算方式・同じCSVフォーマットを使うため、**1つのアプリ内でヘッダーの会社選択ドロップダウンから会社を切り替えて運用する方針**（従来は会社ごとに別インスタンス/別デプロイだったが統合済み）。

会社ごとの設定（会社名・決算開始月）は `src/config/companies.ts` の設定テーブルで一元管理する。3社確定値（要件整理ドキュメント12章）:

| 会社 | 決算開始月 |
|---|---|
| 大阪人材 | 07月 |
| 四国人材 | 10月 |
| 松山人材 | 09月 |

`csvParser.ts`の列マッピング・`calculator.ts`の粗利計算式は、四国人材の実CSV（請求支払一覧表印刷CSV・給与計算書印刷CSV、2024年10月分）で検証済みのものを3社共通ロジックとしてそのまま使用している（3社のCSVフォーマットは完全に同一、違いは決算開始月のみと運用者確認済み）。

アップロードしたCSVデータは「会社ID → 対象月(YYYY-MM) → {給与/請求/請求書印刷/退職金}」の2段階構造で保持しており（`src/utils/monthlyData.ts`の`AppMonthlyData`、`App.tsx`の`monthlyData`ステート）、会社を切り替えても他社のデータと混ざらない。会社を追加・変更する場合は`src/config/companies.ts`に1件追加/編集するだけでよい。

**複数月データの蓄積・永続化に対応**（★2026-08-21）: 1回きりのCSVアップロードで終わりではなく、毎月新しいCSVを追加アップロードしながら決算期を通して使い続けられる。同じ月に再アップロードした場合はその月のデータだけをクリーンに置き換え、他の月・他社のデータは保持される。決算期集計（`calculateFiscalYearSummary`）は選択中の決算期に該当する全ての月を横断して自動集計する。

- **ブラウザへの自動保存**: 状態変更のたびIndexedDBへ自動保存し、起動時に自動復元する（`src/utils/persistence.ts`）。保存データが1件もない場合のみ、四国人材へサンプルデータを自動読込する。
- **ファイルへの保存/読込**: ヘッダー下の「データ管理」パネルから、全社・全月のデータをJSONファイルとして保存/読込できる（`src/utils/backupFile.ts`）。PCの乗り換えやブラウザ変更時に、このファイルを新環境へ持ち込んで読み込む運用を想定している。読込時は上書き確認ダイアログを表示する。
- 「データ管理」パネルには、選択中の会社についてどの対象月のデータが読み込み済みかの一覧（給与/請求/請求書印刷/退職金の件数）を表示する。

View your app in AI Studio: https://ai.studio/apps/0a46d36a-e9f6-4617-9a69-d0b40d1f25ce

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
