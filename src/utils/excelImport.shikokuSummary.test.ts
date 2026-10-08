/**
 * 四国の売上実績一覧表の取込み(extractShikokuSalesSummarySheet)のテスト(npm test)。
 * 2026-10-08: 2025-12の全行で氏名が空だった不具合への対応。★売上実績一覧表R8.5月～.xlsmの各月シートは右側に
 * 「スタナビデータ転記」用の別表(見出し: 番号/氏名/請求額/支給額/社保…)があり、見出しが「氏名」のその列を
 * スタッフ氏名の列として拾っていた。別表が空の月は氏名が空になり、氏名空・売上0の行も空行として落ちていた。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { extractShikokuSalesSummarySheet } from './excelImport';

const HEADER = [
  '', '№', '', '企業名', '担当別\n連番', '派遣先\nコード', 'スタッフ\n番号', 'スタッフ氏名', '請求＠', '支払＠', '粗利率',
  '売上', '支払', '社保他', '粗利益', '出勤日数', '支払の内\n交通費', 'ｶｳﾝﾄ', '派遣先コード\n＆スタッフ番号', '', '番号', '氏名',
  '請求額', '支給額', '社保', '給与の\n出勤日数', '請求単価', '支給単価', '支給額内交通費',
];
// 実データ例(2025-12): 藤田 しのぶさん、売上0で支払・社保のある石塚 恵さん。右側の別表は空。
const ROWS = [
  [1, 1, 1015, '今治造船', 1, 31, 4541, '藤田しのぶ', 2230, 1360, 0.39, 400810, 277980, 42198, 80632, 20, 7000],
  [1, 2, 702, '鎌田醤油', 2, 702, 12867, '石塚恵', 1800, 1210, 0.33, 0, 77440, 29363, -106803, 0, 0],
];

const book = (sideNames: string[] = []) => {
  const aoa = [[], [], [], HEADER, ...ROWS.map((r, i) => [...r, '', '', '', '', sideNames[i] ?? ''])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '2025年12月');
  return wb;
};

test('右側の別表の「氏名」列ではなく「スタッフ氏名」列を読む(別表が空でも氏名が入る)', () => {
  const r = extractShikokuSalesSummarySheet(book(), '2025年12月', '2025-12', 'test.xlsm');
  assert.deepEqual(r.billingRows.map((b) => b.staffName), ['藤田しのぶ', '石塚恵']);
  assert.deepEqual(r.payrollRows.map((p) => p.staffName), ['藤田しのぶ', '石塚恵']);
});

test('売上0で支払・社保のある行も落とさない', () => {
  const r = extractShikokuSalesSummarySheet(book(), '2025年12月', '2025-12', 'test.xlsm');
  const ishizuka = r.billingRows.find((b) => b.staffNo === '12867');
  assert.ok(ishizuka);
  assert.equal(ishizuka.paymentAmount, 77440);
  assert.equal(ishizuka.socialInsuranceBilling, 29363);
});

test('別表に別の並びの名前があっても、その名前は使わない', () => {
  const r = extractShikokuSalesSummarySheet(book(['別人A', '別人B']), '2025年12月', '2025-12', 'test.xlsm');
  assert.deepEqual(r.billingRows.map((b) => b.staffName), ['藤田しのぶ', '石塚恵']);
});
