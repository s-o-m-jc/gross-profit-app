/**
 * 四国: 勤怠明細票(実績加工+未払計上表)からの取込み((A)案)と、取込み前の差の一覧(npm test)。★2026-10-27追加。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { extractShikokuKintaiPastData, alignShikokuClientNames, diffShikokuMonthImport } from './excelImport';
import { BillingRow, PayrollRow } from '../types';

/** 新しい書式の勤怠明細票(実績加工の「番号」の表・実績ＣＳＶ・未払計上表)を作る */
function kintaiWorkbook(extraKako: any[][] = [], extraPay: any[][] = []): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const kako = [
    ['売上実績表の資料'],
    ['番号', '氏名', '請求額\n右の額を戻した状態', '支給額\n右の額を戻した状態', '社保負担額', '給与の\n出勤日数', '請求単価', '支給単価', '支給額内交通費', '', '番号', '氏名', '請求', '支給'],
    ['317-11992', '野田 佐織', 83671, 59450, 24763, 8, 1850, 1300, 1600, '', '864-12590', 'タカハシ美咲', '', ''],
    ['812-12866', '下河 実咲', 1513095, 225430, 30807, 20, 1700, 1250, 5000],
    ['735-13489', '澁谷 愛生', 450000, 0, 0, 0, 0, 0, 0],
    ['0-0', 0, 0, 0, 0, 0, 0, 0, 0], // 数式だけの予備行(読まない)
    ...extraKako,
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kako), '実績加工');
  const csv = [
    ['請求No', 'ク番号', 'クライアント', '請求先部署番号', '請求先部署名称', 'ス番号', 'スタッフ氏名', '受注番号', '受注名称', '請求額', '支払額', '社保負担額'],
    [1, 317, '株式会社レクザム', 1, '総務部', 11992, '野田 佐織', 18130101, 'レクザム野田', 83671, 59450, 24763],
    [2, 812, 'ヤンマーエネルギーシステム株式会社', 1, '高松支店', 12866, '下河 実咲', 10204113, 'ヤンマー下河', 262695, 225430, 30807],
    ['', 812, 'ヤンマーエネルギーシステム株式会社', 2, '高松支店紹介料', 12866, '下河 実咲', '', '', 1250400, 0, ''],
    ['', 735, '四国三菱ふそう販売株式会社', 13, '紹介手数料(高松支店)', 13489, '澁谷 愛生', '', '', 450000, 0, ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(csv), '実績ＣＳＶ');
  const pay = [
    ...Array.from({ length: 9 }, () => ['']),
    ['スタッフ番号', 'スタッフ氏名', '出勤日数', '総支給額', '社保合計', '雇用保険'],
    [11992, '野田 佐織', 8, 59450, 24433, 297],
    [12866, '下河 実咲', 20, 225430, 29000, 1200],
    [12494, '大島 紀子', 0, 0, -18300, 0], // 社保の返金だけの行(残す)
    [9999, '過去 稼働', 0, 0, 0, 0], // 金額0・請求なし(除く)
    ...extraPay,
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pay), '未払計上表');
  return wb;
}

test('勤怠明細票: 実績加工を請求、未払計上表を給与として読み、紹介手数料を分け、登録済みの紹介手数料は請求から差し引く', () => {
  const r = extractShikokuKintaiPastData(kintaiWorkbook(), '2026-06', '★2606勤怠明細票.xlsm', [{ staffNo: '13489', amount: 450000 }]);
  assert.deepEqual(
    r.billingRows.map((b) => [b.staffNo, b.clientCode, b.clientName, b.billingAmountExTax, b.paymentAmount, b.socialInsuranceBilling, b.unitPrice, b.payUnitPrice, b.paidTransport]),
    [
      ['11992', '317', '株式会社レクザム', 83671, 59450, 24763, 1850, 1300, 1600],
      // 1,513,095 − 紹介手数料1,250,400
      ['12866', '812', 'ヤンマーエネルギーシステム株式会社', 262695, 225430, 30807, 1700, 1250, 5000],
      // 澁谷さんは登録済みの紹介手数料450,000を差し引いて0になり、行が無くなる
    ]
  );
  assert.deepEqual(r.splitReferralFeeRows?.map((x) => [x.staffNo, x.amount]), [['12866', 1250400]]);
  assert.deepEqual(r.payrollRows.map((p) => [p.staffNo, p.paymentAmount, p.socialInsurance]), [
    ['11992', 59450, 24433],
    ['12866', 225430, 29000],
    ['12494', 0, -18300],
  ]);
  assert.equal(r.warnings.length, 0);
});

test('勤怠明細票: 登録済みの紹介手数料が実績加工に見つからなければ警告する(差し引かない)', () => {
  const r = extractShikokuKintaiPastData(kintaiWorkbook(), '2026-06', 'x.xlsm', [{ staffNo: '777', amount: 100000 }]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /スタッフ番号777/);
});

const b = (staffNo: string, clientName: string, amount: number, pay = 0, si = 0): BillingRow => ({
  billingNo: `B${staffNo}${clientName}`,
  targetMonth: '2026-06',
  staffNo,
  staffName: `S${staffNo}`,
  clientCode: clientName,
  clientName,
  orderNo: '',
  orderName: '',
  billingAmountExTax: amount,
  paymentAmount: pay,
  socialInsuranceBilling: si,
  paidLeaveDaysUsed: 0,
  billingTransport: 0,
  referralFee: 0,
  workHours: 0,
  unitPrice: 0,
});

test('取引先名: 同じスタッフの登録済みの取引先名が1つで似た名前なら揃える。派遣先が変わった人・複数契約の人は変えない', () => {
  const incoming = [b('1', '株式会社レクザム', 1), b('2', '株式会社永木精機', 1), b('3', '鎌田醤油株式会社', 1), b('3', '株式会社レクザム', 1)];
  const reference = [b('1', 'レクザム', 1), b('2', '大栄鋼業', 1), b('3', '鎌田醤油', 1)];
  assert.deepEqual(
    alignShikokuClientNames(incoming, reference).map((x) => [x.staffNo, x.clientName, x.clientCode]),
    [
      ['1', 'レクザム', 'レクザム'],
      ['2', '株式会社永木精機', '株式会社永木精機'],
      ['3', '鎌田醤油株式会社', '鎌田醤油株式会社'],
      ['3', '株式会社レクザム', '株式会社レクザム'],
    ]
  );
});

const p = (staffNo: string, payment: number): PayrollRow =>
  ({ targetMonth: '2026-06', staffNo, staffName: `S${staffNo}`, paymentAmount: payment, socialInsurance: 0, employmentInsurance: 0, parkingFee: 0, salaryTransport: 0 } as PayrollRow);

test('差の一覧: スタッフ単位で、違う項目だけを出す(新規・無くなる人も)。差の大きい順', () => {
  const d = diffShikokuMonthImport(
    { billingRows: [b('1', 'A', 100000, 70000, 10000), b('2', 'B', 50000, 40000, 5000), b('4', 'D', 1, 0, 0)], payrollRows: [p('1', 70000), p('2', 40000)], referralFeeRows: [] },
    {
      billingRows: [b('1', 'A', 100000, 70000, 10000), b('2', 'B', 50000, 45000, 5050), b('3', 'C', 30000, 20000, 0)],
      payrollRows: [p('1', 70000), p('2', 45000), p('3', 20000)],
      referralFeeRows: [{ staffNo: '1', amount: 300000 }],
    }
  );
  assert.equal(d.existingEmpty, false);
  assert.deepEqual(
    d.rows.map((r) => [r.staffNo, r.kind, r.fields.map((f) => `${f.label}:${f.before}→${f.after}`).join(',')]),
    [
      ['1', 'changed', '紹介手数料:0→300000'],
      ['3', 'added', '派遣売上:0→30000,支払:0→20000,給与の総支給額:0→20000'],
      ['2', 'changed', '支払:40000→45000,社保負担額:5000→5050,給与の総支給額:40000→45000'],
      ['4', 'removed', '派遣売上:1→0'],
    ]
  );
  assert.deepEqual(d.totals.find((t) => t.label === '派遣売上'), { label: '派遣売上', before: 150001, after: 180000 });
});

test('差の一覧: その月が未登録なら existingEmpty', () => {
  const d = diffShikokuMonthImport({ billingRows: [], payrollRows: [], referralFeeRows: [] }, { billingRows: [b('1', 'A', 1)], payrollRows: [], referralFeeRows: [] });
  assert.equal(d.existingEmpty, true);
});

test('勤怠明細票: キーが「0-0」の手入力行は氏名でスタッフ番号に結び付けて「引当なし」の請求行にする。見つからなければ警告して読み飛ばす', () => {
  const wb = kintaiWorkbook(
    [
      ['0-0', '岩部彩香', 0, 0, 22824, 0, 0, 0, 0],
      ['0-0', '不明 太郎', 0, 0, 5000, 0, 0, 0, 0],
    ],
    [[12709, '岩部 彩香', 0, 0, 22824, 0]]
  );
  const r = extractShikokuKintaiPastData(wb, '2024-01', '★2401勤怠明細票.xlsm', [{ staffNo: '13489', amount: 450000 }]);
  const iwabu = r.billingRows.filter((b) => b.staffNo === '12709');
  assert.deepEqual(
    iwabu.map((b) => [b.staffName, b.clientCode, b.clientName, b.billingAmountExTax, b.paymentAmount, b.socialInsuranceBilling]),
    [['岩部 彩香', '引当なし', '引当なし', 0, 0, 22824]]
  );
  assert.ok(r.payrollRows.some((p) => p.staffNo === '12709'));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /不明 太郎.*同じ氏名のスタッフがいない/);
});
