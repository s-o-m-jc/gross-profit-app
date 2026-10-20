/**
 * 四国: 売上実績一覧表の売上と勤怠明細票「実績加工」シートの照合(npm test)。★2026-10-20追加。
 * きっかけ: 2026-05 電通プロモーション 萱野 僚子さんの売上で、実績加工では内税交通費の消費税1,120円を引いて201,133円に
 * なっていたのに、一覧表には202,253円のまま転記されていた。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { extractShikokuJissekiKakoSales, checkShikokuSalesAgainstJissekiKako } from './excelImport';
import type { BillingRow } from '../types';

const bookOf = (aoa: unknown[][], sheetName = '実績加工') => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return wb;
};

// 〜2025年の書式: 左(A〜E)はスタナビの実績CSVのまま、右の「参照番号」の表を一覧表へ転記する(2024-07 井藤 ちづるさんの実例)
const OLD_LAYOUT = [
  ['①一旦、数式を下までコピーする。', '', '', '', '', '', '⑥こちらのデータを売上実績表に転記する。'],
  [],
  ['スタッフ番号', 'スタッフ氏名', '請求額', '支払額', '社保負担額', '', '参照番号', '取引先番号', '取引先名', 'スタッフ番号', 'スタッフ氏名', '請求額', '支給額'],
  [0, 0, 0, 0, 0, 230, '0-0', 0, 0, 0, 0, 0, 0],
  [12308, '井藤 ちづる', 318179, 242514, 35998, 1, '947-12308', 947, '富士フイルムメディカル株式会社', 12308, '井藤ちづる', 313499, 237834],
  [4541, '藤田 しのぶ', 338917, 245920, 39113, 1, '31-4541', 31, '今治造船株式會社', 4541, '藤田しのぶ', 338917, 245920],
];

// 2025年末〜の書式: 左の「売上実績表へ貼り付ける」表。右の立替金等一覧にも「番号」列がある(2026-05の実例)
const NEW_LAYOUT = [
  ['売上実績表の資料'],
  ['実績ｃｓｖから', '実績ｃｓｖから', '実績ｃｓｖから', '', '', '', '', '', '', '', '立替金等一覧'],
  ['番号', '氏名', '請求額\n右の額を戻した状態', '支給額\n右の額を戻した状態', '社保負担額', '給与の\n出勤日数', '請求単価', '支給単価', '支給額内交通費', '', '番号', '氏名', '請求\nその他非課税タブ'],
  ['833-13738', '萱野 僚子', 201133, 138194, 40676, 11, 2200, 1450, 11560, '', '864-12590', 'タカハシ美咲', 99999],
  ['833-13610', '青井 良太', 317258, 209103, 38407, 18, 2200, 1450, 0, '', '833-13738', '萱野僚子', 1120],
];

const billing = (staffNo: string, staffName: string, clientName: string, amount: number, month = '2026-05'): BillingRow => ({
  billingNo: `SHIKOKU_${month}_${staffNo}`,
  targetMonth: month,
  staffNo,
  staffName,
  clientCode: clientName,
  clientName,
  orderNo: '',
  orderName: '',
  billingAmountExTax: amount,
  paymentAmount: 0,
  socialInsuranceBilling: 0,
  paidLeaveDaysUsed: 0,
  billingTransport: 0,
  referralFee: 0,
  workHours: 0,
  unitPrice: 0,
});

test('古い書式: 右側の転記用の表(参照番号)の請求額を読み、左側のスタナビの値と「0-0」の空行は読まない', () => {
  const rows = extractShikokuJissekiKakoSales(bookOf(OLD_LAYOUT));
  assert.deepEqual(rows, [
    { clientNo: '947', staffNo: '12308', staffName: '井藤ちづる', clientName: '富士フイルムメディカル株式会社', amount: 313499 },
    { clientNo: '31', staffNo: '4541', staffName: '藤田しのぶ', clientName: '今治造船株式會社', amount: 338917 },
  ]);
});

test('新しい書式: 左の「番号」の表を読み、右の立替金等一覧の「番号」列は読まない', () => {
  const rows = extractShikokuJissekiKakoSales(bookOf(NEW_LAYOUT));
  assert.deepEqual(
    rows?.map((r) => [r.staffNo, r.amount]),
    [
      ['13738', 201133],
      ['13610', 317258],
    ]
  );
});

test('実績加工シートが無ければnullで、照合は省略(取込みは止めない)', () => {
  const wb = bookOf([['番号']], '未払計上表');
  const kako = extractShikokuJissekiKakoSales(wb);
  assert.equal(kako, null);
  const r = checkShikokuSalesAgainstJissekiKako('2026-07', [billing('1', 'A', 'X', 100, '2026-07')], [], kako);
  assert.equal(r.status, 'no-sheet');
  assert.equal(r.mismatches.length, 0);
});

test('転記漏れ(2026-05 萱野さんの1,120円)を警告し、一致するスタッフは出さない', () => {
  const kako = extractShikokuJissekiKakoSales(bookOf(NEW_LAYOUT));
  const r = checkShikokuSalesAgainstJissekiKako(
    '2026-05',
    [billing('13738', '萱野僚子', '電通プロモーション', 202253), billing('13610', '青井良太', '電通プロモーション', 317258)],
    [],
    kako
  );
  assert.equal(r.status, 'checked');
  assert.equal(r.comparedStaffCount, 2);
  assert.deepEqual(r.mismatches, [
    { staffNo: '13738', staffName: '萱野僚子', clientName: '電通プロモーション', summaryAmount: 202253, kakoAmount: 201133, diff: 1120 },
  ]);
  assert.equal(r.isFiscalBoundaryMonth, false);
});

test('1円の差でも警告する(しきい値1円)。小数の端数は円に丸めてから比べる', () => {
  const kako = [{ clientNo: '229', staffNo: '12081', staffName: '曽川幸', clientName: '', amount: 335780.9999999 }];
  assert.equal(checkShikokuSalesAgainstJissekiKako('2026-05', [billing('12081', '曽川幸', '三菱電機', 335781)], [], kako).mismatches.length, 0);
  const r = checkShikokuSalesAgainstJissekiKako('2026-05', [billing('12081', '曽川幸', '三菱電機', 335782)], [], kako);
  assert.deepEqual(r.mismatches.map((m) => m.diff), [1]);
});

test('紹介手数料は一覧表側に足して比べる(一覧表は請求行に入れないが、実績加工には請求額として入っている)', () => {
  const kako = [{ clientNo: '98', staffNo: '13496', staffName: '三好亜也子', clientName: '', amount: 826000 }];
  assert.equal(checkShikokuSalesAgainstJissekiKako('2026-05', [], [], kako).mismatches.length, 1);
  assert.equal(checkShikokuSalesAgainstJissekiKako('2026-05', [], [{ staffNo: '13496', amount: 826000 }], kako).mismatches.length, 0);
});

test('同月複数契約はスタッフごとに合計して比べ、片方にしかいないスタッフも警告する', () => {
  const kako = [
    { clientNo: '1', staffNo: '100', staffName: 'A', clientName: '', amount: 1000 },
    { clientNo: '2', staffNo: '100', staffName: 'A', clientName: '', amount: 500 },
    { clientNo: '3', staffNo: '300', staffName: 'C', clientName: '', amount: 700 },
  ];
  const r = checkShikokuSalesAgainstJissekiKako(
    '2026-06',
    [billing('100', 'A', '甲社', 1200, '2026-06'), billing('100', 'A', '乙社', 300, '2026-06'), billing('200', 'B', '鎌田醤油', 382, '2026-06')],
    [],
    kako
  );
  assert.deepEqual(
    r.mismatches.map((m) => [m.staffNo, m.clientName, m.summaryAmount, m.kakoAmount, m.diff]),
    [
      ['300', '取引先番号3', 0, 700, -700],
      ['200', '鎌田醤油', 382, 0, 382],
    ]
  );
});

test('9月・10月は決算月の計上月のずれの注記を付ける', () => {
  assert.equal(checkShikokuSalesAgainstJissekiKako('2025-09', [], [], []).isFiscalBoundaryMonth, true);
  assert.equal(checkShikokuSalesAgainstJissekiKako('2025-10', [], [], []).isFiscalBoundaryMonth, true);
  assert.equal(checkShikokuSalesAgainstJissekiKako('2025-11', [], [], []).isFiscalBoundaryMonth, false);
});
