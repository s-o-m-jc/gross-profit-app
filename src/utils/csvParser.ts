/**
 * 派遣事業 粗利・経理管理システム
 * CSVパース & 実データ準拠ヘッダーマッピング
 *
 * 2026-08-20: 実サンプルCSV(請求支払一覧・未払計上表)で検証した結果、
 * 旧来の緩い正規表現マッチングは実列名（半角カナ・「クライアント番号」等）に
 * 対応できていなかったため、NFKC正規化 + 候補名リストによる完全一致優先の
 * マッチング方式に全面書き直し。
 */

import Papa from 'papaparse';
import { PayrollRow, BillingRow, InvoicePrintRow } from '../types';

/**
 * 数値文字列を安全にパース (カンマ除去, null/undefined/空文字処理)
 */
function parseSafeNumber(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).replace(/,/g, '').trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * 文字列トリム
 */
function parseSafeString(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * findColumnKeyが返したキーで安全に行の値を取得するためのラッパー群。
 *
 * ★2026-09-02追加(スタッフ給与明細バグ報告・実データ解析で確定): findColumnKeyは候補列が
 * 1つも見つからない場合、空文字列''を返す仕様になっている。従来はこれを疑わず
 * そのまま row[key] のように参照していたため、該当キーが''の場合に row[''] という
 * 「ヘッダーが空文字だった列」の値を誤って読んでしまっていた。
 * 実データ(★派遣明細202310.xlsm)で検証したところ、この未払計上表シートには「総支給額」列の
 * 直後にヘッダーが空文字の列が実在し(元Excel側の集計チェック用と見られる、総支給額と
 * 同一の値を持つ列)、findColumnKeyがマッチ先を見つけられなかった複数のフィールド
 * (厚生年金基金・年調過不足額・仮払精算・差引支給額 等、実列名が候補名と食い違っていた
 * もの)が、揃ってこの「総支給額の複製列」の値を表示してしまう不具合として現れていた
 * (「複数の控除項目が同一の金額を示す」というバグ報告の直接の原因)。
 * key===''(=該当列なし)の場合は必ず未取得値(0 / 空文字)を返すことで、たとえ将来また
 * 候補名の不一致が起きても「別の列の値を誤って表示する」のではなく「取得できない
 * (0/空欄)」という安全な形で失敗するようにする。
 */
function getNum(row: Record<string, any>, key: string): number {
  return key ? parseSafeNumber(row[key]) : 0;
}
function getStr(row: Record<string, any>, key: string): string {
  return key ? parseSafeString(row[key]) : '';
}

/**
 * ヘッダー名の正規化。
 * 実データのスタッフナビ出力は列名が半角カナ(例: "ｽﾀｯﾌ番号")のことがあり、
 * 全角前提の候補名と一致しない問題があった。
 * NFKC正規化で半角カナ→全角カナに変換した上で比較する。
 */
function normalizeHeader(key: string): string {
  return String(key).normalize('NFKC').trim();
}

/**
 * 候補名リストに対して、正規化ヘッダーの完全一致を優先し、
 * 見つからなければ部分一致にフォールバックして列キーを探す。
 * (旧実装の「最初にマッチした列を拾う」方式は「交通費」が複数列にマッチする等の
 *  誤爆があったため、完全一致を優先することで実データの列名ゆらぎに対応する)
 *
 * ★2026-09-02修正(スタッフ給与明細バグ報告): 部分一致フォールバックには「取り違えて
 * 別の列を誤って拾ってしまう」リスクがある。実際に「時間内」(金額列)を探す際、CSVに
 * その完全一致列が無いファイル(松山の過去実績Excel取り込み等)では、部分一致で
 * 「時間内時間」(時間数列)を誤って拾ってしまい、時間数がそのまま金額として表示される
 * 不具合が発生していた。「時間外/深夜内/深夜外/休日出」の金額列にも同型の「◯◯時間」
 * という時間数列が存在し、同じ事故が起こり得る。安全策として、既に判明している時間数列の
 * 実列名は exclude で明示的に除外できるようにし、金額系の列取得では必ず渡すようにする。
 */
function findColumnKey(row: Record<string, any>, candidates: string[], exclude: string[] = []): string {
  const entries = Object.keys(row)
    .map((orig) => ({ orig, norm: normalizeHeader(orig) }))
    .filter((e) => !exclude.includes(e.norm));

  for (const candidate of candidates) {
    const hit = entries.find((e) => e.norm === candidate);
    if (hit) return hit.orig;
  }
  for (const candidate of candidates) {
    const hit = entries.find((e) => e.norm.includes(candidate));
    if (hit) return hit.orig;
  }
  warnMissingColumn(candidates);
  return '';
}

// ★2026-09-02追加(スタッフ給与明細バグ報告対応の一環): 候補名がどれも見つからなかった場合に
// コンソールへ警告を出す。findColumnKeyは行ごとに(=CSVの全行分)呼ばれるため、同じ候補リストに
// ついて毎回警告すると数百行分のログで埋め尽くされてしまう。候補リスト単位(=項目単位)で
// 1回だけ警告するよう重複排除する(該当ファイルの読み込み中に同じ項目が繰り返し見つからない
// ことは分かっているため、2回目以降は情報として不要)。
const warnedMissingColumnKeys = new Set<string>();

function warnMissingColumn(candidates: string[]): void {
  const key = candidates.join('|');
  if (warnedMissingColumnKeys.has(key)) return;
  warnedMissingColumnKeys.add(key);
  console.warn(
    `[csvParser] 列が見つかりませんでした(候補: ${candidates.join(' / ')})。この項目は取り込みファイルにこの候補名の列が無いため、0または空欄として扱われます。`
  );
}

// ★2026-09-02追加: 「◯◯時間」という時間数列の実名一覧。金額列(時間内/時間外/深夜内/深夜外/
// 休日出)を探す際、部分一致フォールバックがこれらの時間数列を誤って拾わないよう除外に使う。
const HOUR_COLUMN_NAMES = [
  '時間内時間',
  '時間外時間',
  '深夜内時間',
  '深夜外時間',
  '休日出時間',
  'その他時間外',
  '有給時間',
  '有給残時間',
];

/**
 * 年月フォーマット正規化 ('2026/04' -> '2026-04', '202604' -> '2026-04')
 */
function normalizeMonth(val: string): string {
  const s = parseSafeString(val).replace(/\//g, '-');
  if (/^\d{4}-\d{1,2}$/.test(s)) {
    const [y, m] = s.split('-');
    return `${y}-${m.padStart(2, '0')}`;
  }
  if (/^\d{6}$/.test(s)) return `${s.substring(0, 4)}-${s.substring(4, 6)}`;
  return s;
}

/**
 * ファイル名から対象年月を抽出する (例: "請求支払一覧_202410.csv" -> "2026-10"改め"2024-10")
 * 請求支払一覧CSVには対象年月を表す列が存在しないため、運用者確認によりファイル名を正とする。
 */
function extractMonthFromFileName(fileName?: string): string {
  if (!fileName) return '';
  const m = fileName.match(/(\d{4})[-_]?(\d{2})(?!\d)/);
  if (!m) return '';
  const year = m[1];
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return '';
  return `${year}-${m[2]}`;
}

/**
 * 給与CSVの「支給日」から対象年月を算出する。
 * 運用者確認: 給与は末締め・翌月15日払いのため、対象月 = 支給日の前月。
 * (例: 支給日 2024-11-15 -> 対象年月 2024-10)
 */
function deriveTargetMonthFromPayDate(payDateStr: string): string {
  const datePart = parseSafeString(payDateStr).split(/[ T]/)[0];
  const m = datePart.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '';
  let year = parseInt(m[1], 10);
  let month = parseInt(m[2], 10) - 1; // 前月にずらす
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${month < 10 ? `0${month}` : month}`;
}

/**
 * 給与CSVの時間列("164:30"のようなH:MM形式、24時間を超えることがある)を10進の時間数に変換する。
 * 支払＠(支払単価) = 時間内(金額) ÷ 時間内時間 の算出に使用する(運用者確認・実データ検算済み)。
 */
function parseHoursMinutesToDecimal(val: any): number {
  const s = parseSafeString(val);
  if (!s) return 0;
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) {
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    return hours + minutes / 60;
  }
  // H:MM形式でない場合のフォールバック(念のため数値としてそのまま解釈)
  return parseSafeNumber(s);
}

/** getNum/getStrと同様、該当列なし(key==='')の場合にrow['']を誤って読まないためのラッパー */
function getHours(row: Record<string, any>, key: string): number {
  return key ? parseHoursMinutesToDecimal(row[key]) : 0;
}

/**
 * 給与CSVのパース (未払計上表 / 給与計算書印刷CSV)
 * @param fileName 対象年月がCSV内から取得できない場合のフォールバック用
 */
export function parsePayrollCsv(csvText: string, fileName?: string): PayrollRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  return parsed.data
    .map((row) => {
      const staffNoKey = findColumnKey(row, ['スタッフ番号', 'スタッフNo', 'スタッフID', '社員番号']);
      const nameKey = findColumnKey(row, ['スタッフ氏名', '氏名', 'スタッフ名', '名前']);
      const payDateKey = findColumnKey(row, ['支給日']);
      const monthKey = findColumnKey(row, ['対象年月', '年月']);
      const payKey = findColumnKey(row, ['総支給額', '給与支給総額', '支給総額', '支給額']);
      // ★2026-08-27修正(22-14章調査1で発見): 実CSVの列名は「社保合計額」(2-1章の全76列
      // 確定リスト)だが、旧候補リストには額を含まない「社保合計」しかなく、フォールバック
      // 候補の「健康保険」が誤って一致していた(健康保険は社保合計額の内訳の一部にすぎない)。
      const socialKey = findColumnKey(row, ['社保合計額', '社保合計', '社会保険']);
      // ★2026-09-02修正(実データ解析★2310勤怠明細票時間計算.xlsm=四国分で確定): 四国の
      // 過去実績Excel(未払計上表シート)では、健康保険/介護保険/厚生年金/厚生年金基金/雇用保険の
      // 5列がすべて同じ「保険」という見出しになっている(松山はこの5列それぞれに個別の見出しが
      // 付いており、「保険」という汎用見出しは厚生年金基金の1列だけ)。CSV変換時にPapa Parseが
      // 重複ヘッダーを「保険」「保険_1」「保険_2」「保険_3」「保険_4」と列の並び順にリネームする
      // ため、個別列名(雇用保険 等)が見つからない場合のフォールバックとして、実データで確認した
      // 並び順どおりの添字候補を追加する(健康保険→保険、介護保険→保険_1、厚生年金→保険_2、
      // 厚生年金基金→保険_3、雇用保険→保険_4。実データ検証: 4件の合計が「社保合計」列の値と
      // 完全一致することを確認済み)。松山側は個別列名で先に一致するため、この追加候補は
      // 四国のみで使われる(松山の「保険」列は重複が無いためPapa Parseにリネームされず、
      // 厚生年金基金側の候補にのみ影響する)。
      const empInsKey = findColumnKey(row, ['雇用保険', '保険_4']);
      const parkingKey = findColumnKey(row, ['駐車場手当', '駐車場代', '駐車場']);
      const transport1Key = findColumnKey(row, ['交通費1']);
      const transport2Key = findColumnKey(row, ['交通費2']);
      const transportFallbackKey = findColumnKey(row, ['交通費', '通勤手当']);
      // ★2026-08-21確定: 本物のスタッフナビCSV(未払計上表_202410.csv)では、交通費列が
      // 「交通費1」「交通費2」ではなく、同名の「交通費」列が2つ存在する形で出力される。
      // CSVパーサー(papaparse)は同名ヘッダーを自動検出し、2列目以降を「交通費_1」のように
      // リネームするため、その2列目をこのキーで拾って合算する。
      const transportDupKey = findColumnKey(row, ['交通費_1']);
      const paidLeaveAllowanceKey = findColumnKey(row, ['有給手当']);
      const paidLeaveDaysKey = findColumnKey(row, ['有給日数']);
      // ★2026-08-27追加(22章タスク1「スタッフ給与明細」ビュー向け)。給与計算CSV(76列)の
      // うち、粗利計算には使わないが給与支給額の内訳確認に必要な項目を追加抽出する。
      const staffNameKanaKey = findColumnKey(row, ['スタッフ氏名ｶﾅ', 'スタッフ氏名カナ']);
      const staffCategoryKey = findColumnKey(row, ['スタッフ区分']);
      const workDaysKey = findColumnKey(row, ['出勤日数']);
      const absenceDaysKey = findColumnKey(row, ['欠勤日数']);
      const holidayWorkDaysKey = findColumnKey(row, ['休出日数']);
      const lateEarlyDaysKey = findColumnKey(row, ['遅早日数']);
      const specialLeaveDaysKey = findColumnKey(row, ['特別休暇日数']);
      const leave2DaysKey = findColumnKey(row, ['休暇２日数', '休暇2日数']);
      const leave3DaysKey = findColumnKey(row, ['休暇３日数', '休暇3日数']);
      const leave4DaysKey = findColumnKey(row, ['休暇４日数', '休暇4日数']);
      const paidLeaveRemainingDaysKey = findColumnKey(row, ['有給残日数']);
      const overtimeHoursKey = findColumnKey(row, ['時間外時間']);
      const nightHoursKey = findColumnKey(row, ['深夜内時間']);
      const nightOvertimeHoursKey = findColumnKey(row, ['深夜外時間']);
      const holidayWorkHoursKey = findColumnKey(row, ['休日出時間']);
      const otherOvertimeHoursKey = findColumnKey(row, ['その他時間外']);
      const paidLeaveHoursKey = findColumnKey(row, ['有給時間']);
      const lateEarlyHoursKey = findColumnKey(row, ['遅早']);
      const paidLeaveRemainingHoursKey = findColumnKey(row, ['有給残時間']);
      // ★2026-09-02修正: 時間数列(◯◯時間)を誤って拾わないようexcludeを渡す(上記コメント参照)
      const overtimeAmountKey = findColumnKey(row, ['時間外'], HOUR_COLUMN_NAMES);
      const nightAmountKey = findColumnKey(row, ['深夜内'], HOUR_COLUMN_NAMES);
      const nightOvertimeAmountKey = findColumnKey(row, ['深夜外'], HOUR_COLUMN_NAMES);
      const holidayWorkAmountKey = findColumnKey(row, ['休日出'], HOUR_COLUMN_NAMES);
      const otherOvertimeAllowanceKey = findColumnKey(row, ['その他時間外手当']);
      const leaveAllowanceKey = findColumnKey(row, ['休暇手当']);
      const absenceLeaveAllowanceKey = findColumnKey(row, ['欠勤休業手当']);
      const specialLeaveAllowanceKey = findColumnKey(row, ['特休手当']);
      const trainingAllowanceKey = findColumnKey(row, ['研修手当']);
      const welfareAllowanceKey = findColumnKey(row, ['福祉手当']);
      const paidLeaveAllowance2Key = findColumnKey(row, ['有休手当']);
      const taxableOther8Key = findColumnKey(row, ['課税他８', '課税他8']);
      const taxableOther9Key = findColumnKey(row, ['課税他９', '課税他9']);
      const taxableOther10Key = findColumnKey(row, ['課税他１０', '課税他10']);
      const transportTaxableKey = findColumnKey(row, ['交通費課税']);
      const commsAllowanceKey = findColumnKey(row, ['通信費']);
      const nonTaxableOther3Key = findColumnKey(row, ['非課税他３', '非課税他3']);
      const nonTaxableOther4Key = findColumnKey(row, ['非課税他４', '非課税他4']);
      const reimbursementKey = findColumnKey(row, ['立替金']);
      const lateEarlyDeductionKey = findColumnKey(row, ['遅早控除']);
      const absenceDeductionKey = findColumnKey(row, ['欠勤控除']);
      const leaveDeductionKey = findColumnKey(row, ['休暇控除']);
      const employmentInsuranceBaseKey = findColumnKey(row, ['雇用保険対象額']);
      // ★2026-09-02修正: 四国分では個別列名が無く「保険」の重複列(添字リネーム後)になるため、
      // 上のempInsKeyのコメント参照の並び順に従いフォールバック候補を追加。
      const healthInsuranceKey = findColumnKey(row, ['健康保険', '保険']);
      const nursingInsuranceKey = findColumnKey(row, ['介護保険', '保険_1']);
      const pensionInsuranceKey = findColumnKey(row, ['厚生年金', '保険_2']);
      // ★2026-09-02修正(実データ解析★派遣明細202310.xlsmで確定): 松山の過去実績Excel
      // (未払計上表シート)では「厚生年金基金」列は存在せず、代わりに「保険」という
      // 汎用的な見出しの列がその位置(厚生年金の隣)にある。四国分は上記コメントの並び順のとおり
      // 「保険_3」に対応するため、候補に両方追加する。
      const pensionFundKey = findColumnKey(row, ['厚生年金基金', '保険_3', '保険']);
      const taxableIncomeBaseKey = findColumnKey(row, ['課税対象額']);
      const incomeTaxKey = findColumnKey(row, ['所得税']);
      // ★2026-09-02修正: 同ファイルでは「年調過不足額」ではなく「年調」列。候補に追加。
      const yearEndAdjustmentKey = findColumnKey(row, ['年調過不足額', '年調']);
      const residentTaxKey = findColumnKey(row, ['住民税']);
      // ★2026-09-02判明: 同ファイルには「昼食代」「健康診断料」「クリーニング代」に該当する
      // 列が存在せず(代わりに「その他控除1」〜「その他控除9」という汎用列が9個あるのみで、
      // どれがどの項目に対応するか列名からは判別不能)、findColumnKeyは意図的に空(''=該当列
      // なし)を返す。これによりgetNum/getStrがrow['']を誤参照することはなくなったが、
      // このファイル形式ではこの3項目自体が0/未取得として表示される(実害はなく、その他控除
      // 1〜9の金額は「総控除額」(総支給額側で完成済みの列)に既に反映されているため、
      // 差引支給額の計算自体には影響しない)。
      const lunchFeeKey = findColumnKey(row, ['昼食代']);
      const healthCheckFeeKey = findColumnKey(row, ['健康診断料']);
      const cleaningFeeKey = findColumnKey(row, ['ｸﾘｰﾆﾝｸﾞ代', 'クリーニング代']);
      // ★2026-09-02修正: 同ファイルの実列名は「仮払い精算」(「い」が入る)で、候補の
      // 「仮払精算」とは完全一致はもちろん部分一致もしない(文字が挿入されているため)。
      // 候補に実列名を追加する。
      const advancePaymentSettlementKey = findColumnKey(row, ['仮払精算', '仮払い精算']);
      const totalDeductionKey = findColumnKey(row, ['総控除額']);
      // ★2026-09-02修正: 同ファイルの実列名は「差引支給」(「額」が付かない)。候補に追加。
      const netPaymentKey = findColumnKey(row, ['差引支給額', '差引支給']);
      // 支払＠(支払単価)算出用・基本給。
      // ★2026-09-02修正 → 同日再訂正: 当初「実列名は『基本』一本で、『時間内』は誤りだった」と
      // 記載したが、これは不正確だった。運用者提供のスクリーンショットは★派遣明細*.xlsm(松山の
      // 過去実績Excel取込・16章)の「未払計上表」シートのものであり、そちらは独自に「基本」という
      // 見出しを使っている。一方、通常の月次給与計算CSV(スタッフナビエクスポート)は実データ再検証
      // (給与計算202410.csv)により「時間内」列が実在することを確認済み(13-0章で警告されていた
      // 「Excelの見出し行と実CSVエクスポートの列名は別物」の罠に、修正時に自分で引っかかっていた)。
      // つまり両方とも実在する正しい列名であり、ファイル形式によって異なる。候補を両方とも入れ、
      // 完全一致を優先して探すことで、どちらの形式でも正しく拾えるようにしている
      // (「時間内」の完全一致列が無い場合のみ、部分一致フォールバックが「時間内時間」等の時間数列を
      // 誤って拾わないようHOUR_COLUMN_NAMESで除外している)。
      const regularAmountKey = findColumnKey(row, ['基本', '基本給', '時間内'], HOUR_COLUMN_NAMES);
      const regularHoursKey = findColumnKey(row, ['時間内時間']);

      const payDate = getStr(row, payDateKey);

      // 対象年月: (1)支給日から算出 → (2)列があれば列 → (3)ファイル名 の優先順
      let targetMonth = deriveTargetMonthFromPayDate(payDate);
      if (!targetMonth && monthKey) targetMonth = normalizeMonth(row[monthKey]);
      if (!targetMonth) targetMonth = extractMonthFromFileName(fileName);

      // 交通費: 交通費1+交通費2の合算ルール (6章・確定済み)
      // ★2026-08-21確定: 懸念していた「3章の20日締重複行統合ロジックとの干渉」は、
      // 11-5章の通り給与CSV(未払計上表)は1スタッフ・1ヶ月につき常に1行のみで行の
      // 重複が発生しないため、実際には起こり得ないケースだった。交通費1・交通費2は
      // 同一行内の2列にすぎず、行の重複統合とは無関係に常に安全に合算できる。
      // 実データ確認(未払計上表_202410.csv, 82件): 交通費1は全件0円、交通費2に70件の
      // 実額が入っており、両方に値が入っているケースは0件(単純合算で問題なし)。
      // ★2026-08-21追記: 本物のスタッフナビCSV(253行)では「交通費1/交通費2」ではなく、
      // 同名「交通費」列が2つ(papaparseリネーム後は「交通費」「交通費_1」)出力される
      // 別パターンも確認。この場合も同じ「2列を合算」ルールを適用する。
      const salaryTransport =
        transport1Key || transport2Key
          ? getNum(row, transport1Key) + getNum(row, transport2Key)
          : transportDupKey
          ? getNum(row, transportFallbackKey) + getNum(row, transportDupKey)
          : getNum(row, transportFallbackKey);

      return {
        targetMonth,
        staffNo: getStr(row, staffNoKey),
        staffName: getStr(row, nameKey),
        paymentAmount: getNum(row, payKey),
        socialInsurance: getNum(row, socialKey),
        employmentInsurance: getNum(row, empInsKey),
        parkingFee: getNum(row, parkingKey),
        salaryTransport,
        paidLeaveAllowance: getNum(row, paidLeaveAllowanceKey),
        paidLeaveDays: getNum(row, paidLeaveDaysKey),
        regularAmount: getNum(row, regularAmountKey),
        regularHours: getHours(row, regularHoursKey),
        payDate: payDate || undefined,
        remarks: row['備考'] || row['Remarks'] || '',

        // ★2026-08-27追加(22章タスク1)。詳細はtypes.tsのコメント・上記キー抽出部分を参照。
        staffNameKana: getStr(row, staffNameKanaKey) || undefined,
        staffCategory: getStr(row, staffCategoryKey) || undefined,

        workDays: getNum(row, workDaysKey),
        absenceDays: getNum(row, absenceDaysKey),
        holidayWorkDays: getNum(row, holidayWorkDaysKey),
        lateEarlyDays: getNum(row, lateEarlyDaysKey),
        specialLeaveDays: getNum(row, specialLeaveDaysKey),
        otherLeaveDays: getNum(row, leave2DaysKey) + getNum(row, leave3DaysKey) + getNum(row, leave4DaysKey),
        paidLeaveRemainingDays: getNum(row, paidLeaveRemainingDaysKey),

        overtimeHours: getHours(row, overtimeHoursKey),
        nightHours: getHours(row, nightHoursKey),
        nightOvertimeHours: getHours(row, nightOvertimeHoursKey),
        holidayWorkHours: getHours(row, holidayWorkHoursKey),
        otherOvertimeHours: getHours(row, otherOvertimeHoursKey),
        paidLeaveHours: getHours(row, paidLeaveHoursKey),
        lateEarlyHours: getHours(row, lateEarlyHoursKey),
        paidLeaveRemainingHours: getHours(row, paidLeaveRemainingHoursKey),

        overtimeAmount: getNum(row, overtimeAmountKey),
        nightAmount: getNum(row, nightAmountKey),
        nightOvertimeAmount: getNum(row, nightOvertimeAmountKey),
        holidayWorkAmount: getNum(row, holidayWorkAmountKey),
        otherOvertimeAllowance: getNum(row, otherOvertimeAllowanceKey),
        leaveAllowance: getNum(row, leaveAllowanceKey),
        absenceLeaveAllowance: getNum(row, absenceLeaveAllowanceKey),
        specialLeaveAllowance: getNum(row, specialLeaveAllowanceKey),
        trainingAllowance: getNum(row, trainingAllowanceKey),
        welfareAllowance: getNum(row, welfareAllowanceKey),
        paidLeaveAllowance2: getNum(row, paidLeaveAllowance2Key),
        taxableOtherAllowances:
          getNum(row, taxableOther8Key) + getNum(row, taxableOther9Key) + getNum(row, taxableOther10Key),

        transportTaxable: getNum(row, transportTaxableKey),
        commsAllowance: getNum(row, commsAllowanceKey),
        nonTaxableOtherAllowances: getNum(row, nonTaxableOther3Key) + getNum(row, nonTaxableOther4Key),
        reimbursement: getNum(row, reimbursementKey),

        lateEarlyDeduction: getNum(row, lateEarlyDeductionKey),
        absenceDeduction: getNum(row, absenceDeductionKey),
        leaveDeduction: getNum(row, leaveDeductionKey),
        employmentInsuranceBase: getNum(row, employmentInsuranceBaseKey),
        healthInsurance: getNum(row, healthInsuranceKey),
        nursingInsurance: getNum(row, nursingInsuranceKey),
        pensionInsurance: getNum(row, pensionInsuranceKey),
        pensionFund: getNum(row, pensionFundKey),
        taxableIncomeBase: getNum(row, taxableIncomeBaseKey),
        incomeTax: getNum(row, incomeTaxKey),
        yearEndAdjustment: getNum(row, yearEndAdjustmentKey),
        residentTax: getNum(row, residentTaxKey),
        lunchFee: getNum(row, lunchFeeKey),
        healthCheckFee: getNum(row, healthCheckFeeKey),
        cleaningFee: getNum(row, cleaningFeeKey),
        advancePaymentSettlement: getNum(row, advancePaymentSettlementKey),
        totalDeduction: getNum(row, totalDeductionKey),

        netPayment: getNum(row, netPaymentKey),
      };
    })
    .filter((r) => r.staffNo);
}

/**
 * 請求CSVのパース (請求支払一覧表印刷CSV)
 * @param fileName 対象年月の取得元。このCSVには対象年月の列が存在しないため必須に近い。
 */
export function parseBillingCsv(csvText: string, fileName?: string): BillingRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const monthFromFileName = extractMonthFromFileName(fileName);

  return parsed.data
    .map((row) => {
      const billingNoKey = findColumnKey(row, ['請求No', '請求番号']);
      const monthKey = findColumnKey(row, ['対象年月', '年月']);
      const staffNoKey = findColumnKey(row, ['スタッフNo', 'スタッフ番号', '社員番号']);
      const nameKey = findColumnKey(row, ['スタッフ氏名', 'スタッフ名', '氏名']);
      const clientCodeKey = findColumnKey(row, ['クライアント番号', '派遣先コード', '得意先コード']);
      const clientNameKey = findColumnKey(row, ['クライアント名称', '派遣先名', '得意先名', '企業名']);
      const orderNoKey = findColumnKey(row, ['受注番号']);
      const orderNameKey = findColumnKey(row, ['受注名称']);
      const billAmountKey = findColumnKey(row, ['請求額', '請求金額', '売上額']);
      const paymentAmountKey = findColumnKey(row, ['支払額']);
      const socialInsuranceKey = findColumnKey(row, ['社保負担額', '社保他']);
      const paidLeaveDaysUsedKey = findColumnKey(row, ['有給使用日数', '有休日数', '有給日数']);
      const transportKey = findColumnKey(row, ['請求交通費', 'うち交通費請求', '交通費']);
      const referralKey = findColumnKey(row, ['紹介手数料', '紹介料']);
      const hoursKey = findColumnKey(row, ['稼働時間', '労働時間']);
      const priceKey = findColumnKey(row, ['請求単価', '契約単価', '単価']);

      // 対象年月: (1)列があれば列 → (2)ファイル名 の優先順
      const targetMonth = monthKey ? normalizeMonth(row[monthKey]) : monthFromFileName;

      return {
        billingNo: getStr(row, billingNoKey),
        targetMonth,
        staffNo: getStr(row, staffNoKey),
        staffName: getStr(row, nameKey),
        clientCode: getStr(row, clientCodeKey) || 'CLIENT_DEF',
        clientName: getStr(row, clientNameKey) || '派遣先企業',
        orderNo: getStr(row, orderNoKey),
        orderName: getStr(row, orderNameKey),
        billingAmountExTax: getNum(row, billAmountKey),
        paymentAmount: getNum(row, paymentAmountKey),
        socialInsuranceBilling: getNum(row, socialInsuranceKey),
        paidLeaveDaysUsed: getNum(row, paidLeaveDaysUsedKey),
        billingTransport: getNum(row, transportKey),
        referralFee: getNum(row, referralKey),
        workHours: getNum(row, hoursKey),
        unitPrice: getNum(row, priceKey),
      };
    })
    .filter((r) => r.billingNo || r.staffNo);
}

/**
 * 請求書印刷CSVのパース
 *
 * 2026-08-21: 実データ(かこ.csv形式)で確認したところ、このCSVには「時間内−単価」列
 * (契約の請求単価。区切り文字は全角ハイフンではなくU+2212のマイナス記号「−」なので
 *  NFKC正規化しても半角ハイフンには変換されない。候補名は原文ママで指定する)が
 * 含まれている。請求支払一覧CSVには単価列が存在しない(要件整理11-3)ため、
 * 請求＠(大阪人材の集計シート方式)の算出にはこちらの列を使う。
 *
 * ★2026-08-21追加: 対象年月はこのCSV自体には列が無いため、請求支払一覧CSVと同じく
 * 11-2章のルール(ファイル名由来)を適用してfileNameから抽出する。複数月データ蓄積
 * アーキテクチャで、請求書印刷データも月バケツに分けて保持できるようにするために必要。
 * @param fileName 対象年月の取得元(例: 請求書印刷202410_15日締.csv)
 */
export function parseInvoicePrintCsv(csvText: string, fileName?: string): InvoicePrintRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const monthFromFileName = extractMonthFromFileName(fileName);

  return parsed.data
    .map((row) => {
      const billingNoKey = findColumnKey(row, ['請求No', '請求番号']);
      const monthKey = findColumnKey(row, ['対象年月', '年月']);
      const issueDateKey = findColumnKey(row, ['発行日', '印刷日']);
      const dueDateKey = findColumnKey(row, ['振込予定日', '支払期日']);
      const printKey = findColumnKey(row, ['印刷ステータス', '印刷済']);
      const sentKey = findColumnKey(row, ['送付ステータス', '送付']);
      const unitPriceKey = findColumnKey(row, ['時間内−単価', '請求単価']);

      const printVal = getStr(row, printKey);
      let printStatus: InvoicePrintRow['printStatus'] = '印刷済';
      if (printVal.includes('未')) printStatus = '未印刷';
      else if (printVal.includes('再')) printStatus = '再発行';

      const sentStatus: '送付済' | '未送付' = getStr(row, sentKey).includes('未') ? '未送付' : '送付済';

      // 対象年月: (1)列があれば列 → (2)ファイル名 の優先順(請求支払一覧CSVと同じ優先順位)
      const targetMonth = monthKey ? normalizeMonth(row[monthKey]) : monthFromFileName;

      return {
        billingNo: getStr(row, billingNoKey),
        targetMonth,
        invoiceIssueDate: getStr(row, issueDateKey),
        paymentDueDate: getStr(row, dueDateKey),
        printStatus,
        sentStatus,
        unitPrice: getNum(row, unitPriceKey),
      };
    })
    .filter((r) => r.billingNo);
}

// ★2026-08-26: 退職金は実運用上CSVでの取込対象ではなく手入力すべき項目のため、
// CSVパース関数は廃止した(手入力UIはsrc/components/RetirementPanel.tsx参照)。
