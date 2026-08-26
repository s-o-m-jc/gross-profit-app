/**
 * 派遣事業 粗利・経理管理システム
 * 会社別設定テーブル
 *
 * 大阪人材・四国人材・松山人材の3社は同じ計算ロジック(csvParser.ts / calculator.ts)を
 * 共有しつつ、会社名・決算開始月のみが異なる。従来は会社ごとに別インスタンス(別デプロイ)で
 * 運用していたが、1つのアプリ内で会社を切り替えられるようこのテーブルに集約した
 * (要件整理ドキュメント12章で確定した3社確定値: 大阪人材=07 / 四国人材=10 / 松山人材=09)。
 *
 * 会社を追加・変更する場合は、この配列に1件追加/編集するだけでよい
 * (UI側のドロップダウンや決算期セレクタは自動的にこのテーブルに追従する)。
 */

export type CompanyId = 'shikoku' | 'osaka' | 'matsuyama';

export interface CompanyConfig {
  id: CompanyId;
  name: string;
  /** 決算開始月 (2桁文字列, '01'〜'12') */
  fiscalStartMonth: string;
}

export const COMPANIES: CompanyConfig[] = [
  { id: 'shikoku', name: '四国人材 粗利・経理管理システム', fiscalStartMonth: '10' },
  { id: 'osaka', name: '大阪人材 粗利・経理管理システム', fiscalStartMonth: '07' },
  { id: 'matsuyama', name: '松山人材 粗利・経理管理システム', fiscalStartMonth: '09' },
];

export const DEFAULT_COMPANY_ID: CompanyId = 'shikoku';

export function getCompanyConfig(id: CompanyId): CompanyConfig {
  return COMPANIES.find((c) => c.id === id) ?? COMPANIES[0];
}
