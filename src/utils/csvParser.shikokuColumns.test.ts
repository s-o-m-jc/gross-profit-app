/**
 * スタナビCSVの列名の違い(npm test)。★2026-10-23追加。
 * - 請求支払一覧: 四国は同じ出力機能だが見出しが「ク番号/クライアント/ス番号/有休/担当」(大阪・松山は
 *   「クライアント番号/クライアント名称/スタッフNo/有給使用日数/担当者」)。
 * - 給与計算書印刷(未払計上表): 四国・松山は雇用保険対象額の見出しが空のまま総支給額のすぐ右にある。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBillingCsv, parsePayrollCsv } from './csvParser';

test('請求支払一覧: 四国の見出し(ク番号/ス番号/有休/担当)でも大阪・松山と同じ項目に読む', () => {
  const shikoku = [
    '請求No,ク番号,クライアント,請求先部署番号,請求先部署名称,ス番号,スタッフ氏名,受注番号,受注名称,請求額,支払額,社保負担額,粗利額,粗利率(%),状況,有休,担当',
    '10033578,702,鎌田醤油株式会社,1,営業部,3698,北村 麻菜,18090201,鎌田醤油　北村,38300,27080,28948,-17728,0,稼働中,1,松本　孝二',
  ].join('\n');
  const osaka = [
    '請求No,クライアント番号,クライアント名称,請求先部署番号,請求先部署名称,スタッフNo,スタッフ氏名,受注番号,受注名称,請求額,支払額,社保負担額,粗利額,粗利率(%),スタッフ区分,有給使用日数,担当者',
    '20008534,22000014,株式会社ブンカ,2,営業推進部,20005489,曽我部 あき子,22140336,ブンカ＿一般事務（曽我部）,431690,312926,50897,67867,15.72,稼働中,1,前田 真一',
  ].join('\n');
  const [s] = parseBillingCsv(shikoku, '請求支払一覧202604.csv');
  assert.equal(s.staffNo, '3698');
  assert.equal(s.clientCode, '702');
  assert.equal(s.clientName, '鎌田醤油株式会社');
  assert.equal(s.billingAmountExTax, 38300);
  assert.equal(s.paymentAmount, 27080);
  assert.equal(s.socialInsuranceBilling, 28948);
  assert.equal(s.paidLeaveDaysUsed, 1);
  assert.equal(s.personInCharge, '松本　孝二');
  assert.equal(s.targetMonth, '2026-04');

  const [o] = parseBillingCsv(osaka, '請求支払一覧202603.csv');
  assert.deepEqual(
    [o.staffNo, o.clientCode, o.clientName, o.billingAmountExTax, o.paidLeaveDaysUsed, o.personInCharge],
    ['20005489', '22000014', '株式会社ブンカ', 431690, 1, '前田 真一']
  );
});

const PAY_HEADER_BLANK = 'スタッフ番号,スタッフ氏名,出勤日数,総支給額,,保険,保険,保険,保険,保険,社保合計,支給日';
test('給与計算書印刷: 総支給額の右の見出しが空の列を雇用保険対象額として読む(立替金のある人は総支給額と違う)', () => {
  const csv = [PAY_HEADER_BLANK, '12226,白政 実里衣,19,298850,248850,12300,0,22875,0,1493,36668,2025-11-14'].join('\n');
  const [p] = parsePayrollCsv(csv);
  assert.equal(p.paymentAmount, 298850);
  assert.equal(p.employmentInsuranceBase, 248850);
  assert.equal(p.employmentInsurance, 1493);
  assert.equal(p.targetMonth, '2025-10');
});

test('給与計算書印刷: 見出しのある「雇用保険対象額」はそのまま読む(大阪の給与一覧（スタナビ）)', () => {
  const csv = ['スタッフ番号,スタッフ氏名,総支給額,雇用保険対象額,健康保険,雇用保険,社保合計額', '20005489,曽我部 あき子,343351,343351,16576,1717,50165'].join('\n');
  assert.equal(parsePayrollCsv(csv)[0].employmentInsuranceBase, 343351);
});

test('給与計算書印刷: 総支給額の右に見出しのある別の列があれば、雇用保険対象額は0のまま(誤って読まない)', () => {
  const csv = ['スタッフ番号,スタッフ氏名,総支給額,健康保険,雇用保険', '1,A,200000,10000,1000'].join('\n');
  assert.equal(parsePayrollCsv(csv)[0].employmentInsuranceBase, 0);
});
