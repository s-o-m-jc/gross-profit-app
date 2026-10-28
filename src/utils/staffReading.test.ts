/**
 * スタッフ氏名の五十音順(npm test)。★2026-10-28追加。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReading, buildStaffReadingMap, compareStaffByReading } from './staffReading';

test('読みの正規化: 半角カナ・ひらがな・空白をそろえる', () => {
  assert.equal(normalizeReading('ﾅｶｼﾞﾏ ﾅｵﾐ'), 'ナカジマナオミ');
  assert.equal(normalizeReading('なかじま　なおみ'), 'ナカジマナオミ');
  assert.equal(normalizeReading(undefined), '');
});

test('スタッフ番号ごとの読み: どれかの月にあれば使う(新しい月を優先)', () => {
  const m = buildStaffReadingMap([
    { staffNo: '1', staffNameKana: 'ヤマダ ハナコ', targetMonth: '2025-01' },
    { staffNo: '1', staffNameKana: undefined, targetMonth: '2025-03' },
    { staffNo: '2', staffNameKana: 'サトウ', targetMonth: '2025-01' },
    { staffNo: '2', staffNameKana: 'スズキ', targetMonth: '2025-06' }, // 改姓
  ]);
  assert.equal(m.get('1'), 'ヤマダハナコ');
  assert.equal(m.get('2'), 'スズキ');
});

const staff = [
  { staffName: '渡辺 綾子', staffNo: '5', reading: 'ワタナベアヤコ' },
  { staffName: '安井 楓', staffNo: '3', reading: 'ヤスイカエデ' },
  { staffName: '阿部 奈美', staffNo: '1', reading: 'アベナミ' },
  { staffName: '張 遥', staffNo: '9' }, // 読みなし
  { staffName: '伊藤 恵', staffNo: '2', reading: 'イトウメグミ' },
  { staffName: '梶野 由季', staffNo: '8' }, // 読みなし
];

test('五十音順に並ぶ(漢字の文字コード順ではない)。読みの無い人は末尾で、その中は漢字の氏名順', () => {
  const asc = [...staff].sort((a, b) => compareStaffByReading(a, b, 'asc')).map((s) => s.staffName);
  assert.deepEqual(asc.slice(0, 4), ['阿部 奈美', '伊藤 恵', '安井 楓', '渡辺 綾子']);
  assert.deepEqual(new Set(asc.slice(4)), new Set(['張 遥', '梶野 由季']));
});

test('降順でも読みの無い人は末尾', () => {
  const desc = [...staff].sort((a, b) => compareStaffByReading(a, b, 'desc')).map((s) => s.staffName);
  assert.deepEqual(desc.slice(0, 4), ['渡辺 綾子', '安井 楓', '伊藤 恵', '阿部 奈美']);
  assert.deepEqual(new Set(desc.slice(4)), new Set(['張 遥', '梶野 由季']));
});
