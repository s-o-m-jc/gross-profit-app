/**
 * 四国: 紹介手数料の請求書を派遣売上の請求行から分ける(npm test)。★2026-10-26追加。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readShikokuReferralInvoices, splitShikokuReferralFees } from './excelImport';
import { BillingRow, PayrollRow } from '../types';

const HEADER = ['請求No', 'ク番号', 'クライアント', '請求先部署番号', '請求先部署名称', 'ス番号', 'スタッフ氏名', '受注番号', '受注名称', '請求額', '支払額', '社保負担額'];

function workbook(rows: any[][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['実績CSV'], HEADER, ...rows]), '実績ＣＳＶ');
  return wb;
}

const bill = (staffNo: string, amount: number, payment: number, social: number): BillingRow => ({
  billingNo: `B_${staffNo}`,
  targetMonth: '2026-03',
  staffNo,
  staffName: `S${staffNo}`,
  clientCode: 'C',
  clientName: 'C',
  orderNo: `B_${staffNo}`,
  orderName: '',
  billingAmountExTax: amount,
  paymentAmount: payment,
  socialInsuranceBilling: social,
  paidLeaveDaysUsed: 0,
  billingTransport: 0,
  referralFee: 0,
  workHours: 0,
  unitPrice: 0,
});
const pay = (staffNo: string, payment: number): PayrollRow =>
  ({ targetMonth: '2026-03', staffNo, staffName: `S${staffNo}`, paymentAmount: payment, socialInsurance: 0, employmentInsurance: 0, parkingFee: 0, salaryTransport: 0 } as PayrollRow);

test('実績CSVから紹介手数料の請求書(部署名に「紹介」・受注番号なし・支払0)だけを読む', () => {
  const wb = workbook([
    [10033326, 812, 'ヤンマー', 1, '高松支店', 12866, '下河 実咲', 10204113, 'ヤンマー下河', 262695, 225430, 30807],
    ['', 812, 'ヤンマー', 2, '高松支店紹介料', 12866, '下河 実咲', '', '', 1250400, 0, ''],
    // 受注番号のある行は「紹介」を含んでも派遣の請求(読まない)
    [1, 9, 'X', 1, '紹介予定派遣', 1, 'A', 555, 'X受注', 200000, 150000, 20000],
    ['', 407, '讃王興産', 2, '紹介手数料', '', '笹岡真帆', '', '', 250000, 0, ''],
  ]);
  const inv = readShikokuReferralInvoices(wb);
  assert.deepEqual(
    inv.map((i) => [i.clientNo, i.staffNo, i.amount, i.dept]),
    [
      ['812', '12866', 1250400, '高松支店紹介料'],
      ['407', '', 250000, '紹介手数料'],
    ]
  );
});

test('合算行は紹介手数料分を差し引き、紹介手数料だけの行は請求行と金額0の給与行を消す', () => {
  const r = splitShikokuReferralFees(
    '2026-03',
    [bill('12866', 1513095, 225430, 30807), bill('13460', 450000, 0, 0), bill('1', 100000, 80000, 10000)],
    [pay('12866', 225430), pay('13460', 0), pay('1', 80000)],
    [
      { clientNo: '812', clientName: 'ヤンマー', dept: '高松支店紹介料', staffNo: '12866', staffName: '下河 実咲', amount: 1250400 },
      { clientNo: '735', clientName: '三菱ふそう', dept: '紹介手数料(徳島支店)', staffNo: '13460', staffName: '佐藤 亜紗子', amount: 450000 },
    ],
    []
  );
  assert.deepEqual(r.billingRows.map((b) => [b.staffNo, b.billingAmountExTax]), [['12866', 262695], ['1', 100000]]);
  assert.deepEqual(r.payrollRows.map((p) => p.staffNo), ['12866', '1']);
  assert.deepEqual(r.referralFeeRows.map((x) => [x.staffNo, x.amount, x.targetMonth]), [['12866', 1250400, '2026-03'], ['13460', 450000, '2026-03']]);
  assert.equal(r.warnings.length, 0);
});

test('登録済みの紹介手数料は二重に付け替えない。スタッフ番号の無いもの・請求行に無いものは警告だけ', () => {
  const r = splitShikokuReferralFees(
    '2026-03',
    [bill('13489', 0, 0, 0)],
    [],
    [
      { clientNo: '735', clientName: 'ふそう', dept: '紹介手数料(高松支店)', staffNo: '13489', staffName: '澁谷', amount: 450000 },
      { clientNo: '407', clientName: '讃王興産', dept: '紹介手数料', staffNo: '', staffName: '笹岡真帆', amount: 250000 },
      { clientNo: '9', clientName: 'X', dept: '紹介料', staffNo: '777', staffName: 'B', amount: 100000 },
    ],
    [{ staffNo: '13489', amount: 450000 }]
  );
  assert.equal(r.referralFeeRows.length, 0);
  assert.equal(r.billingRows.length, 1);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /スタッフ番号の無い/);
  assert.match(r.warnings[1], /請求行に見つからず/);
});

test('スタッフ番号の無い請求書は、取引先番号で指定したスタッフ番号に付け替えられる', () => {
  const r = splitShikokuReferralFees(
    '2026-03',
    [bill('11727', 250000, 0, 0)],
    [pay('11727', 0)],
    [{ clientNo: '407', clientName: '讃王興産', dept: '紹介手数料', staffNo: '', staffName: '笹岡真帆', amount: 250000 }],
    [],
    { '407': '11727' }
  );
  assert.equal(r.billingRows.length, 0);
  assert.equal(r.payrollRows.length, 0);
  assert.deepEqual(r.referralFeeRows.map((x) => [x.staffNo, x.amount]), [['11727', 250000]]);
});
