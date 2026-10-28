/**
 * スタッフ氏名の五十音順(★2026-10-28追加、はまさんの指摘「名前で並べ替えると五十音順になっていない」)。
 *
 * 漢字の氏名を localeCompare(…, 'ja') で比べても、読みの順にはならない(漢字は読みを持たないため、文字コードに近い順になる)。
 * 給与データにはスタッフ氏名のカナ(PayrollRow.staffNameKana、給与CSVの「スタッフ氏名ｶﾅ」列)があるので、それで比べる。
 * カナは月によって無いことがある(四国2025-03など)ため、スタッフ番号ごとに、どの月かのカナを使う。
 * どの月にもカナが無いスタッフ(2026-10時点で4人)は、並べ替えの向きにかかわらず末尾に回し、その中は漢字の氏名順にする。
 */

const collator = new Intl.Collator('ja');

/** 比べるための読み: 半角カナ→全角(NFKC)、ひらがな→カタカナ、空白を除く */
export function normalizeReading(kana: string | undefined | null): string {
  return String(kana ?? '')
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s/g, '');
}

/** スタッフ番号→読み。同じスタッフで月によって違えば、新しい月の読みを使う */
export function buildStaffReadingMap(
  rows: { staffNo: string; staffNameKana?: string; targetMonth: string }[]
): Map<string, string> {
  const map = new Map<string, { reading: string; month: string }>();
  rows.forEach((r) => {
    const reading = normalizeReading(r.staffNameKana);
    if (!reading) return;
    const prev = map.get(r.staffNo);
    if (!prev || r.targetMonth >= prev.month) map.set(r.staffNo, { reading, month: r.targetMonth });
  });
  return new Map([...map].map(([k, v]) => [k, v.reading]));
}

/**
 * 読みで比べる(dir='desc'なら逆順)。読みの無い人は向きにかかわらず末尾、その中は漢字の氏名順。
 * 読みが同じ(同姓同名など)なら漢字の氏名、それも同じならスタッフ番号で決める。
 */
export function compareStaffByReading(
  a: { staffName: string; staffNo: string; reading?: string },
  b: { staffName: string; staffNo: string; reading?: string },
  dir: 'asc' | 'desc' = 'asc'
): number {
  const ra = a.reading || '';
  const rb = b.reading || '';
  if (!ra !== !rb) return ra ? -1 : 1;
  const sign = dir === 'asc' ? 1 : -1;
  if (ra && rb) {
    const c = collator.compare(ra, rb);
    if (c !== 0) return c * sign;
  }
  const n = collator.compare(a.staffName || '', b.staffName || '');
  if (n !== 0) return n * sign;
  return collator.compare(a.staffNo, b.staffNo) * sign;
}
