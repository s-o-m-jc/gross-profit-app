/**
 * 派遣事業 粗利・経理管理システム
 * IndexedDBへのアプリデータ自動保存・自動読込 (オフライン用ローカルキャッシュ)
 *
 * ★Supabase移行後(★2026-08-26)の位置づけ: メインの保存先はSupabase(monthly_dataテーブル)に
 * 移行済み(src/utils/supabaseSync.ts参照)。このIndexedDBキャッシュは、
 *   1. Supabaseから正常に読み込めた最新データのローカルミラー(オフライン時の閲覧用)
 *   2. 起動時にSupabaseへの接続に失敗した場合のフォールバック表示
 * として残している。localStorageではなくIndexedDBを使うのは、複数月・複数社分の
 * CSVデータが数百KB〜数MB規模になりうるため(localStorageは通常5MB程度の上限かつ
 * 同期APIでUIをブロックしうる)。
 *
 * 併せて、選択中の会社(selectedCompanyId)も保存する。リロード後に常に既定の会社
 * (四国人材)へ戻ってしまい、他社のデータが保存されていてもすぐには見えない、という
 * 不便を避けるため(★2026-08-21追加)。
 *
 * 保存・読込のいずれも失敗時は例外を投げず、コンソール警告のみでアプリの動作を止めない
 * (プライベートブラウジング等でIndexedDBが使えない環境でも、アプリ自体は使い続けられるようにする)。
 */

import { AppMonthlyData } from './monthlyData';
import { CompanyId } from '../config/companies';

const DB_NAME = 'haken-gross-profit-db';
const DB_VERSION = 1;
const STORE_NAME = 'appState';
const RECORD_KEY = 'monthlyData';

export interface PersistedAppState {
  monthlyData: AppMonthlyData;
  selectedCompanyId?: CompanyId;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDBが利用できない環境です'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 保存済みのアプリ状態を読み込む。未保存 or 読み込み失敗時はnullを返す(例外は投げない) */
export async function loadAppState(): Promise<PersistedAppState | null> {
  try {
    const db = await openDb();
    return await new Promise<PersistedAppState | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(RECORD_KEY);
      req.onsuccess = () => {
        const result = req.result as PersistedAppState | AppMonthlyData | undefined;
        if (!result) {
          resolve(null);
          return;
        }
        // 旧バージョン(selectedCompanyIdを持たない、AppMonthlyDataを直接保存していた形式)との
        // 後方互換: monthlyDataキーが無ければ、result自体がAppMonthlyDataだったとみなす。
        if ('monthlyData' in result) {
          resolve(result as PersistedAppState);
        } else {
          resolve({ monthlyData: result as AppMonthlyData });
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('IndexedDBからの読み込みに失敗しました(初回起動または非対応環境の可能性があります):', e);
    return null;
  }
}

/** アプリ状態をIndexedDBへ保存する。失敗してもアプリを止めない(コンソール警告のみ) */
export async function saveAppState(state: PersistedAppState): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(state, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('IndexedDBへの保存に失敗しました:', e);
  }
}
