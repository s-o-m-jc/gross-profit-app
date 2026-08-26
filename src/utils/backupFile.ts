/**
 * 派遣事業 粗利・経理管理システム
 * プロジェクトデータ(全社・全月)のファイル保存/読込 (PCの乗り換え・ブラウザ変更時の持ち運び用)
 *
 * IndexedDBはブラウザ・プロファイルに閉じているため、環境をまたいだ持ち運びには
 * 使えない。そのため、全社・全月のデータをJSONファイルとしてダウンロード/読込できる
 * 機能を別途用意する。
 */

import { AppMonthlyData } from './monthlyData';

const FORMAT_VERSION = 1;

interface BackupFile {
  formatVersion: number;
  exportedAt: string;
  appName: string;
  data: AppMonthlyData;
}

export function buildBackupFile(data: AppMonthlyData): BackupFile {
  return {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appName: '派遣事業-粗利・経理管理システム',
    data,
  };
}

/** 全社・全月のデータをJSONファイルとしてダウンロードする */
export function downloadBackupFile(data: AppMonthlyData): void {
  const backup = buildBackupFile(data);
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `派遣事業粗利経理システム_バックアップ_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * バックアップファイルのテキスト内容をパースし、AppMonthlyDataを取り出す。
 * 形式が不正な場合は例外を投げる(呼び出し側でユーザーにエラー表示することを想定)。
 */
export function parseBackupFile(text: string): AppMonthlyData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読み込めませんでした。正しいバックアップファイルを選択してください。');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as BackupFile).formatVersion !== FORMAT_VERSION ||
    typeof (parsed as BackupFile).data !== 'object'
  ) {
    throw new Error('このファイルは対応形式のバックアップファイルではありません。');
  }
  return (parsed as BackupFile).data;
}
