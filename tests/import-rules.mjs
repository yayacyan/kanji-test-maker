/**
 * PR-A の規則テスト。ブラウザを開かない。
 *   node tests/import-rules.mjs
 *
 * 受け入れ（PRD 項目1・6、付帯B / ARCH 7.1）:
 * - 公開するソースに Tesseract・OCR_PROVIDERS・デモ・縦書き写真・「読み取り完了」が残っていない
 * - お願い文は印刷された読み・例文を使い、手書きと赤ペンを使わない
 * - 貼り付けの解析は弱くならない
 * - 超長・重複・形式の違う行は印が付き、初期状態では採用しない。印の付いた行が先
 * - 題庫にある「客」「旅」「駅」は3年。題庫にない字だけ空。手で入れた学年は残す
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);

function loadWindowScript(name) {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(new URL(name, ROOT), 'utf8'), sandbox, { filename: name });
  return sandbox;
}

function bankLookup() {
  const sandbox = loadWindowScript('kanji-db.js');
  const byKanji = new Map();
  const byWord = new Map();
  (sandbox.KANJI_DB_ROWS || []).forEach((row) => {
    const entry = { grade: row[0], kanji: row[1], word: row[2], reading: row[3], sentence: row[4] };
    byKanji.set(entry.kanji, entry);
    if (!byWord.has(entry.word)) byWord.set(entry.word, entry);
  });
  return (token) => byWord.get(token) || byKanji.get(token) || null;
}

function loadImport() {
  const sandbox = loadWindowScript('import.js');
  return sandbox.KanjiImport;
}

const CODE = [
  'index.html', 'app.js', 'import.js', 'i18n.js', 'sw.js', 'styles.css',
  'paper.css', 'package.json', 'config.js', 'README.md'
];

export function runImportRuleChecks(record) {
  const files = CODE.map((name) => ({ name, text: readFileSync(new URL(name, ROOT), 'utf8') }));
  const changelog = readFileSync(new URL('changelog.html', ROOT), 'utf8');
  const forbidden = [
    [/tesseract/i, 'tesseract'],
    [/OCR_PROVIDERS/, 'OCR_PROVIDERS'],
    [/runOcr/, 'runOcr'],
    [/cdn\.jsdelivr\.net\/npm\/tesseract/, 'tesseract CDN'],
    [/縦書きの写真/, '縦書きの写真'],
    [/読み取りが完了/, '読み取りが完了'],
    [/読み取り完了/, '読み取り完了'],
    [/デモ（サンプル/, 'デモ（サンプル']
  ];
  forbidden.forEach(([re, label]) => {
    const hit = files.find((f) => re.test(f.text));
    record('shipped source has no ' + label, !hit, hit ? hit.name : '');
  });
  record('service worker cache version moved past the notebook build',
    !/2026-11-05-notebook-2/.test(files.find((f) => f.name === 'sw.js').text) &&
    /const VERSION = '2026-11-15-v2a'/.test(files.find((f) => f.name === 'sw.js').text));

  const KI = loadImport();
  record('import module no longer exports an OCR provider', !KI.OCR_PROVIDERS && typeof KI.runOcr !== 'function');
  record('parseBulk is still available', typeof KI.parseBulk === 'function' && typeof KI.buildPrompt === 'function');

  const lookup = bankLookup();
  const opts = { type: 'auto', source: 'paste', lookup, format: 'A4-portrait', questionCount: 50, headMm: 22 };

  const classic = KI.parseBulk([
    '巣（す）／くもの巣がはる。',
    '歩く,あるく,公園を歩く。',
    '花の（　）が出る。|芽',
    '山 川 空'
  ].join('\n'), opts);
  const classicRows = classic.items.filter((item) => !item._skip);
  const classicKanji = classicRows.map((item) => item.kanji);
  record('existing paste shapes still parse',
    classicKanji.includes('巣') && classicKanji.includes('歩く') && classicKanji.includes('芽') &&
    classicKanji.includes('山') && classicKanji.includes('川') && classicKanji.includes('空') &&
    classicRows.find((item) => item.kanji === '巣').reading === 'す' &&
    classicRows.find((item) => item.kanji === '巣').sentence === 'くもの巣がはる。' &&
    classicRows.find((item) => item.kanji === '芽').type === 'sentence',
    classicKanji.join(','));

  const verified = [
    ['客', 'きゃく', 'お客さん'],
    ['旅', 'たび', '旅に出る。'],
    ['駅', 'えき', '近くの駅。']
  ];
  const verifiedParsed = KI.parseBulk(verified.map((row) => row[0] + '（' + row[1] + '）／' + row[2]).join('\n'), opts);
  const grades = {};
  verifiedParsed.items.forEach((item) => { grades[item.kanji] = item.grade; });
  record('客・旅・駅 infer grade 3 from the bank',
    grades['客'] === 3 && grades['旅'] === 3 && grades['駅'] === 3 &&
    verifiedParsed.items.every((item) => item.gradeInferred !== true),
    JSON.stringify(grades));

  const compound = KI.parseBulk('道具（どうぐ）／道具をつかう。', opts).items[0];
  record('a compound uses the highest character grade and says so',
    compound && compound.kanji === '道具' && compound.grade === 3 && compound.gradeInferred === true,
    JSON.stringify({ kanji: compound && compound.kanji, grade: compound && compound.grade, inferred: compound && compound.gradeInferred }));

  const unknown = KI.parseBulk('凰（おう）／凰が飛ぶ。', opts).items[0];
  record('a kanji outside the bank stays without a grade',
    unknown && unknown.kanji === '凰' && (unknown.grade === '' || unknown.grade === null || unknown.grade === undefined),
    JSON.stringify({ kanji: unknown && unknown.kanji, grade: unknown && unknown.grade }));

  const manual = KI.parseBulk('[{"kanji":"客","reading":"きゃく","sentence":"お客さん","grade":5}]', opts).items[0];
  record('a grade typed by hand is kept',
    manual && manual.grade === 5 && manual.gradeInferred !== true,
    JSON.stringify({ grade: manual && manual.grade, inferred: manual && manual.gradeInferred }));

  const budget = KI.columnBudget({ format: 'A4-portrait', questionCount: 50, headMm: 22 });
  record('column budget uses the existing paper constants', budget > 0 && budget < 80, String(budget));
  const longSentence = 'あ'.repeat(budget + 8);
  const flagged = KI.parseBulk([
    '客（きゃく）／お客さん',
    '客（きゃく）／お客さん',
    '### メモ',
    'これはただの文章です。',
    '旅（たび）／' + longSentence
  ].join('\n'), opts);
  const kinds = (item) => (item.flags || []).map((flag) => flag.kind);
  const dupes = flagged.items.filter((item) => item.kanji === '客');
  const longItem = flagged.items.find((item) => item.kanji === '旅');
  const memo = flagged.items.find((item) => item._skip);
  const prose = flagged.items.find((item) => (item.sentence || '').includes('ただの文章'));
  const flaggedFirst = flagged.items.findIndex((item) => !(item.flags || []).length) > flagged.items.findIndex((item) => (item.flags || []).length);
  const cleanGuest = dupes.find((item) => !kinds(item).includes('duplicate'));
  const dupeGuest = dupes.find((item) => kinds(item).includes('duplicate'));
  record('duplicate 客 is flagged and left out by default',
    dupes.length === 2 && cleanGuest && dupeGuest && dupeGuest._exclude === true && cleanGuest._exclude !== true,
    JSON.stringify(dupes.map((item) => ({ flags: kinds(item), exclude: item._exclude }))));
  record('an over-long sentence is flagged with the paper limit and left out',
    longItem && kinds(longItem).includes('long') && longItem._exclude === true &&
    longItem.flags.some((flag) => flag.kind === 'long' && flag.limit === budget && flag.length > budget),
    JSON.stringify(longItem && longItem.flags));
  record('a heading and a prose line are malformed and left out',
    memo && kinds(memo).includes('malformed') && memo._exclude === true &&
    prose && kinds(prose).includes('malformed') && prose._exclude === true,
    JSON.stringify({ memo: memo && memo.flags, prose: prose && prose.flags }));
  record('flagged rows are listed before clean rows', flaggedFirst, flagged.items.map((item) => kinds(item).join('+') || 'ok').join(' | '));

  const short = KI.parseBulk('客（きゃく）／お客さん', Object.assign({}, opts, { questionCount: 1 })).items[0];
  record('a short verified line is not flagged', short && !(short.flags || []).length && short._exclude !== true, JSON.stringify(short && short.flags));

  const photo = KI.buildPrompt({ mode: 'photo', rangeLabel: '小学3年', count: 50, paperLabel: 'A4縦', theme: '町' });
  const write = KI.buildPrompt({ mode: 'write', rangeLabel: '小学3年', count: 10, paperLabel: 'A4縦' });
  record('photo prompt uses printed text and refuses handwriting and red ink',
    /印刷/.test(photo) && /読み/.test(photo) && /例文/.test(photo) && /手書き/.test(photo) && /赤/.test(photo) && /添付/.test(photo),
    photo.slice(0, 180));
  record('write prompt does not pretend a photo was attached',
    !/手書き/.test(write) && !/赤ペン/.test(write) && /漢字（よみ）／例文/.test(write));
  record('prompt carries the selected range, count, and paper',
    photo.includes('小学3年') && photo.includes('50問') && photo.includes('A4縦') && photo.includes('町'));
  record('prompt does not contain an API key or a school-test 50-question quota',
    !/sk-[A-Za-z0-9]/.test(photo) && !/api[_-]?key/i.test(photo) && !/39/.test(photo) && !/10mm/.test(photo));
  record('official AI sites are only ChatGPT and Gemini',
    KI.AI_SITES.length === 2 &&
    KI.AI_SITES.some((site) => site.url === 'https://chatgpt.com/') &&
    KI.AI_SITES.some((site) => site.url === 'https://gemini.google.com/'));

  const log = changelog;
  const block = (lang) => {
    const start = log.indexOf('data-lang-block="' + lang + '"');
    const end = log.indexOf('data-lang-block=', start + 10);
    return log.slice(start, end === -1 ? undefined : end);
  };
  const ja = block('ja');
  const en = block('en');
  const zh = block('zh');
  record('changelog ja covers external AI and removed in-browser OCR',
    ja.includes('2026-11-15') && /Tesseract|ブラウザ内/.test(ja) && ja.includes('ChatGPT') && ja.includes('Gemini') && ja.includes('手書き') && ja.includes('赤'));
  record('changelog en covers external AI and removed in-browser OCR',
    en.includes('2026-11-15') && en.includes('Tesseract') && en.includes('ChatGPT') && en.includes('Gemini') && /handwriting/i.test(en) && /red/i.test(en));
  record('changelog zh covers external AI and removed in-browser OCR',
    zh.includes('2026-11-15') && zh.includes('Tesseract') && zh.includes('ChatGPT') && zh.includes('Gemini') && zh.includes('手寫') && zh.includes('紅'));

  record('readme no longer says the site reads photos with Tesseract',
    !/Tesseract/.test(files.find((f) => f.name === 'README.md').text) &&
    /ChatGPT/.test(files.find((f) => f.name === 'README.md').text));
}

function standalone() {
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail || '' });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  };
  runImportRuleChecks(record);
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + results.length + ' checks, ' + failed.length + ' failed');
  if (failed.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) standalone();
