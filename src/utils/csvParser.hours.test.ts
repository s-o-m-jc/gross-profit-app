/**
 * 給与CSVの時間列(H:MM・H:MM:SS)の読み取りのテスト(npm test)。
 * 2026-10-05: Excelから書き出した大阪 契約別売上実績表（2024.12).csvの「105:15:00」が105時間と読まれ、分が落ちていた。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayrollCsv } from './csvParser';

test('H:MM:SS・H:MMの時間を分まで読む', () => {
  const csv = 'スタッフ番号,スタッフ氏名,総支給額,契約内時間,契約外時間,出勤日数\n1,テスト,1000,105:15:00,18:35,10\n';
  const [p] = parsePayrollCsv(csv, '契約別売上実績表（2024.12).csv');
  assert.equal(p.regularHours, 105.25);
  assert.equal(Math.round(p.overtimeHours! * 60), 18 * 60 + 35);
});
