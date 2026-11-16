/**
 * PR-B。送りがなは漢字と送りがなを一緒に書く。
 * 規則はブラウザなし。画面・旧JSON・夏祭りの枠は Playwright。
 *   node tests/okuri.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url);
const ARTIFACTS = '/opt/cursor/artifacts';

const ELEVEN = [
  ['苦しい', 'くるしい', 'いきがくるしい。', 'しい'],
  ['幸せ', 'しあわせ', 'しあわせを感じる。', 'せ'],
  ['終える', 'おえる', '運動をおえる。', 'える'],
  ['速い', 'はやい', 'はやい車。', 'い'],
  ['寒い', 'さむい', '部屋がさむい。', 'い'],
  ['祭り', 'まつり', '夏祭りに行く。', 'り'],
  ['進む', 'すすむ', 'ゆっくりすすむ。', 'む'],
  ['深い', 'ふかい', 'ふかい海のそこ。', 'い'],
  ['受ける', 'うける', 'おうえんをうける。', 'ける'],
  ['助ける', 'たすける', '友達をたすける。', 'ける'],
  ['投げる', 'なげる', 'ボールをなげる。', 'げる']
];

function loadWindowScript(name) {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(new URL(name, ROOT), 'utf8'), sandbox, { filename: name });
  return sandbox;
}

function loadImport() {
  return loadWindowScript('import.js').KanjiImport;
}

function oldQuestion(row, index, extra) {
  return Object.assign({
    id: 'q' + (40 + index),
    type: 'okuri',
    grade: 3,
    kanji: row[0],
    reading: row[1],
    sentence: row[2],
    answer: row[3],
    style: 'mas',
    source: 'custom',
    base: ''
  }, extra || {});
}

function stemQuestion(row, index) {
  const KI = loadImport();
  const parts = KI.okuriParts(row[0]);
  return oldQuestion([parts.stem, row[1], row[2], parts.okuri], index);
}

export function runOkuriRuleChecks(record) {
  const KI = loadImport();
  const sw = readFileSync(new URL('sw.js', ROOT), 'utf8');
  record('service worker cache is v2b', /const VERSION = '2026-11-16-v2b'/.test(sw));

  record('default okuri answer is the whole word',
    KI.defaultAnswer({ type: 'okuri', kanji: '苦しい', reading: 'くるしい' }, 'okuri') === '苦しい' &&
    KI.defaultAnswer({ type: 'okuri', kanji: '祭り', reading: 'まつり' }, 'okuri') === '祭り' &&
    KI.defaultAnswer({ type: 'okuri', kanji: '幸せ', reading: 'しあわせ' }, 'okuri') === '幸せ');

  const old = ELEVEN.map(oldQuestion);
  const once = KI.migrateOkuriList(old);
  const words = once.questions.map((q) => q.kanji + '/' + q.answer);
  record('eleven old okuri answers become the whole word',
    once.changed && once.needs.length === 0 &&
    ELEVEN.every((row, i) => once.questions[i].kanji === row[0] && once.questions[i].answer === row[0] && once.questions[i].type === 'okuri'),
    words.join(' '));

  const stems = ELEVEN.map(stemQuestion);
  const fromStems = KI.migrateOkuriList(stems);
  record('eleven stem-plus-ending questions rebuild the same words',
    fromStems.needs.length === 0 &&
    ELEVEN.every((row, i) => fromStems.questions[i].kanji === row[0] && fromStems.questions[i].answer === row[0]),
    fromStems.questions.map((q) => q.answer).join(' '));

  const twice = KI.migrateOkuriList(once.questions);
  record('migration is idempotent',
    twice.changed === false && twice.needs.length === 0 &&
    JSON.stringify(twice.questions) === JSON.stringify(once.questions));

  const v4 = KI.migrateOkuriList(JSON.parse(JSON.stringify(once.questions)));
  record('version 4 questions stay as they are',
    v4.changed === false && JSON.stringify(v4.questions) === JSON.stringify(once.questions));

  const readingAnswer = KI.migrateOkuriQuestion({
    type: 'okuri', kanji: '苦しい', reading: 'くるしい', sentence: 'いきがくるしい。', answer: 'くるしい'
  });
  const readingAgain = KI.migrateOkuriQuestion(readingAnswer.question);
  record('a reading used as the answer is flagged and not rewritten',
    readingAnswer.needsEdit === true && readingAnswer.question.answer === 'くるしい' &&
    readingAnswer.question.kanji === '苦しい' && readingAnswer.question.okuriNeedsEdit === true &&
    readingAgain.changed === false && readingAgain.question.answer === 'くるしい');

  const emptyStem = KI.migrateOkuriQuestion({
    type: 'okuri', kanji: '祭', reading: '', sentence: '夏祭りに行く。', answer: ''
  });
  const emptyAgain = KI.migrateOkuriQuestion(emptyStem.question);
  record('a bare kanji with no ending is flagged and not guessed',
    emptyStem.needsEdit === true && emptyStem.question.kanji === '祭' && emptyStem.question.answer === '' &&
    emptyStem.question.kanji !== '祭り' && emptyStem.question.kanji !== '夏祭り' &&
    emptyAgain.changed === false && emptyAgain.question.answer === '');

  const readingStem = KI.migrateOkuriQuestion({
    type: 'okuri', kanji: '祭', reading: 'まつり', sentence: '夏祭りに行く。', answer: 'まつり'
  });
  record('joining the reading onto the kanji is not treated as a recovered word',
    readingStem.needsEdit === true && readingStem.question.kanji === '祭' && readingStem.question.answer === 'まつり');

  const mismatch = KI.migrateOkuriQuestion({
    type: 'okuri', kanji: '山', reading: 'やま', sentence: '山に登る。', answer: 'です'
  });
  record('a hand-edited ending that disagrees with the reading is flagged',
    mismatch.needsEdit === true && mismatch.question.answer === 'です' && mismatch.question.kanji === '山');

  const kaki = KI.migrateOkuriQuestion({ type: 'kaki', kanji: '客', reading: 'きゃく', answer: '客', sentence: 'お客さん' });
  record('other question types are left alone', kaki.changed === false && kaki.question.answer === '客' && kaki.needsEdit === false);

  const badList = KI.migrateOkuriList(old.concat([
    { type: 'okuri', kanji: '祭', reading: '', sentence: '夏祭りに行く。', answer: '' }
  ]));
  const badAgain = KI.migrateOkuriList(badList.questions);
  record('a mixed list flags only the question that cannot be rebuilt',
    badList.needs.length === 1 && badList.needs[0] === 12 &&
    badList.questions[11].okuriNeedsEdit === true && badList.questions[0].answer === '苦しい' &&
    badAgain.changed === false && badAgain.needs.length === 1);

  const version2 = {
    app: 'kanji-test-maker', version: 2,
    state: { questions: ELEVEN.map(oldQuestion) }
  };
  const fromV2 = KI.migrateOkuriList(version2.state.questions);
  const version3 = {
    app: 'kanji-test-maker', version: 3, kind: 'sets',
    sets: [{ id: 's1', name: '小3', questions: ELEVEN.map(oldQuestion) }]
  };
  const fromV3 = KI.migrateOkuriList(version3.sets[0].questions);
  record('version 2 and version 3 questions migrate to the whole word',
    ELEVEN.every((row, i) => fromV2.questions[i].answer === row[0] && fromV3.questions[i].answer === row[0]));

  const pasted = KI.parseBulk(JSON.stringify(ELEVEN.map((row, i) => oldQuestion(row, i))), { type: 'auto', source: 'paste' });
  record('pasted old JSON becomes the whole word and is not left out',
    pasted.items.length === 11 && pasted.items.every((item, i) => item.answer === ELEVEN[i][0] && item._exclude !== true && !item.okuriNeedsEdit));

  const pastedBad = KI.parseBulk(JSON.stringify([
    { type: 'okuri', kanji: '祭', reading: 'まつり', sentence: '夏祭りに行く。', answer: 'まつり' }
  ]), { type: 'auto', source: 'paste' });
  const badItem = pastedBad.items[0];
  record('pasted unrecoverable JSON is marked for editing and stays unchecked',
    badItem && badItem.okuriNeedsEdit === true && badItem.answer === 'まつり' && badItem._exclude === true &&
    (badItem.flags || []).some((flag) => flag.kind === 'edit'));

  const natsu = KI.placeOkuri('夏祭りに行く。', '祭り');
  const natsuText = (natsu || []).filter((part) => part.t === 'text').map((part) => part.v).join('');
  record('夏祭り keeps 夏 outside one box for 祭り',
    natsu && natsuText === '夏に行く。' && natsu.filter((part) => part.t === 'box').length === 1 &&
    !natsuText.includes('祭') && !natsu.some((part) => part.v === '夏祭' || part.v === 'り'),
    JSON.stringify(natsu));

  const both = KI.placeOkuri('夏祭りに行く。祭りの日。', '祭り');
  const bothText = (both || []).filter((part) => part.t === 'text').map((part) => part.v).join('');
  record('a compound and a short form both blank 祭り and leave 夏',
    both && both.filter((part) => part.t === 'box').length === 2 && bothText === '夏に行く。の日。' && !bothText.includes('祭'),
    JSON.stringify(both));

  const readingPlace = KI.placeOkuri('まつりの思い出。', 'まつり');
  record('a hiragana sentence blanks the reading, not a split kanji',
    readingPlace && readingPlace.filter((part) => part.t === 'text').map((part) => part.v).join('') === 'の思い出。');

  record('幸せ still splits as 幸 plus せ',
    JSON.stringify(KI.okuriParts('幸せ')) === JSON.stringify({ stem: '幸', okuri: 'せ' }));

  const log = readFileSync(new URL('changelog.html', ROOT), 'utf8');
  const block = (lang) => {
    const start = log.indexOf('data-lang-block="' + lang + '"');
    const end = log.indexOf('data-lang-block=', start + 10);
    return log.slice(start, end === -1 ? undefined : end);
  };
  const ja = block('ja');
  const en = block('en');
  const zh = block('zh');
  record('changelog ja explains the new okurigana questions',
    ja.includes('2026-11-16') && ja.includes('一緒に書く') && ja.includes('苦しい') && ja.includes('夏祭り') && !ja.includes('題庫'));
  record('changelog en explains the new okurigana questions',
    en.includes('2026-11-16') && /kanji and the okurigana/i.test(en) && en.includes('苦しい') && en.includes('夏祭り'));
  record('changelog zh explains the new okurigana questions',
    zh.includes('2026-11-16') && zh.includes('苦しい') && zh.includes('夏祭り') && zh.includes('手動'));
}

function questionPaperFacts(page, answer) {
  return page.evaluate((wantAnswer) => {
    const papers = [...document.querySelectorAll('#paperHost .paper')].filter((paper) => paper.classList.contains('is-answer') === wantAnswer);
    return papers.flatMap((paper) => [...paper.querySelectorAll('.q')].map((q) => {
      const clone = q.querySelector('.q-text').cloneNode(true);
      clone.querySelectorAll('.box, rt, .ans-okuri, .ans-ch, .okuri-unit').forEach((node) => node.remove());
      const unit = q.querySelector('.okuri-unit');
      return {
        visible: (clone.textContent || '').replace(/\s+/g, ''),
        ans: [...q.querySelectorAll('.ans-okuri, .ans-ch')].map((node) => node.textContent).join(''),
        units: q.querySelectorAll('.okuri-unit').length,
        nowrap: unit ? getComputedStyle(unit).whiteSpace : '',
        rects: unit ? unit.getClientRects().length : 0,
        instruction: paper.querySelector('.paper-ins') ? paper.querySelector('.paper-ins').textContent : ''
      };
    }));
  }, !!answer);
}

export async function runOkuriPageChecks({ browser, record, base }) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const old = ELEVEN.map((row, i) => oldQuestion(row, i));
  old.push({ id: 'bad', type: 'okuri', grade: 3, kanji: '祭', reading: '', sentence: '夏祭りに行く。', answer: '', style: 'mas', source: 'custom', base: '' });

  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((data) => {
    localStorage.setItem('kanji-test-maker-v2', JSON.stringify(data));
    localStorage.setItem('kanji-test-maker-lang', 'ja');
  }, { questions: old, format: 'A4-portrait', tiers: '1', showInstructions: true, okuriReadingHint: true, okuriCells: false });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForSelector('#okuriNotice');
  await page.waitForFunction(() => document.querySelectorAll('#questionList .question-item').length === 12);

  const migrated = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('kanji-test-maker-v2'));
    const notice = document.getElementById('okuriNotice');
    const cards = [...document.querySelectorAll('#questionList .question-item')].map((card) => ({
      text: card.innerText.replace(/\s+/g, ' '),
      edit: !!card.querySelector('.chip.is-edit')
    }));
    const labels = {
      custom: [...document.querySelectorAll('#customType option')].map((o) => o.textContent),
      paste: [...document.querySelectorAll('#pasteType option')].map((o) => o.textContent),
      bulk: [...document.querySelectorAll('#bulkTypeSelect option')].map((o) => o.textContent),
      pills: [...document.querySelectorAll('#typePills .tc-name')].map((o) => o.textContent)
    };
    return {
      answers: saved.questions.map((q) => q.answer),
      kanji: saved.questions.map((q) => q.kanji),
      flags: saved.questions.map((q) => !!q.okuriNeedsEdit),
      notice: notice.textContent,
      noticeHidden: notice.hidden,
      cards,
      labels
    };
  });
  record('saved old questions migrate on open and the notice shows once',
    migrated.noticeHidden === false && migrated.notice.includes('漢字と送りがなを一緒に書く') &&
    migrated.notice.includes('問12') &&
    ELEVEN.every((row, i) => migrated.kanji[i] === row[0] && migrated.answers[i] === row[0]) &&
    migrated.flags[11] === true && migrated.answers[11] === '' && migrated.kanji[11] === '祭' &&
    migrated.cards[11].edit === true,
    migrated.notice);

  const optionText = migrated.labels.custom.concat(migrated.labels.paste, migrated.labels.bulk, migrated.labels.pills);
  record('public menus offer only the whole-word okurigana type',
    migrated.labels.custom.includes('漢字と送りがな') &&
    migrated.labels.paste.includes('漢字と送りがな') &&
    migrated.labels.bulk.includes('漢字と送りがな') &&
    migrated.labels.pills.includes('漢字と送りがな') &&
    !optionText.some((text) => text === '送りがな' || text.includes('りる')));

  const questionFacts = await questionPaperFacts(page, false);
  const matsuri = questionFacts.find((row) => row.visible.includes('夏') && row.visible.indexOf('祭') < 0);
  record('question sheet keeps 夏 and does not print 祭り in the box',
    matsuri && matsuri.visible === '夏に行く。' && !matsuri.visible.includes('祭') && !matsuri.visible.includes('り') &&
    matsuri.ans === '' && matsuri.units === 1 && matsuri.nowrap === 'nowrap' && matsuri.rects === 1 &&
    questionFacts.some((row) => row.instruction.includes('漢字と送りがな')),
    JSON.stringify(matsuri));
  record('the eleven question boxes do not show the answer glyphs',
    questionFacts.slice(0, 11).every((row) => row.ans === '' && row.units >= 1));

  await page.evaluate(() => document.querySelectorAll('details.tool').forEach((tool) => { tool.open = false; }));
  await page.locator('#questionList .question-item').nth(5).locator('[data-action="toggle"]').click();
  await page.waitForSelector('#questionList .question-item.is-open .qi-editor');
  await page.evaluate(() => document.querySelector('#questionList .question-item.is-open').scrollIntoView({ block: 'center' }));
  await page.locator('#questionList .question-item.is-open').screenshot({ path: path.join(ARTIFACTS, 'okuri-editor.png') });
  const previewPapers = page.locator('#paperHost .paper');
  const previewCount = await previewPapers.count();
  for (let i = 0; i < previewCount; i += 1) {
    await previewPapers.nth(i).screenshot({ path: path.join(ARTIFACTS, 'okuri-preview-' + (i + 1) + '.png') });
  }
  await page.locator('#paperHost .paper').filter({ hasText: '夏' }).first().screenshot({ path: path.join(ARTIFACTS, 'okuri-preview.png') });

  await page.click('#sheetSeg [data-sheet="answer"]');
  await page.waitForSelector('#paperHost .paper.is-answer');
  const answerFacts = await questionPaperFacts(page, true);
  const answerMatsuri = answerFacts.find((row) => row.visible.includes('夏'));
  const answerWords = answerFacts.slice(0, 11).map((row) => row.ans);
  record('answer sheet prints the whole word, including 祭り',
    answerMatsuri && answerMatsuri.ans === '祭り' && answerMatsuri.ans !== 'り' &&
    answerMatsuri.visible === '夏に行く。' &&
    ELEVEN.every((row, i) => answerWords[i] === row[0]),
    answerWords.join(' '));
  await page.locator('#paperHost .paper.is-answer').first().screenshot({ path: path.join(ARTIFACTS, 'okuri-answers.png') });

  const migratedRaw = await page.evaluate(() => localStorage.getItem('kanji-test-maker-v2'));
  const againCtx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1400, height: 1000 } });
  await againCtx.addInitScript((raw) => {
    localStorage.setItem('kanji-test-maker-v2', raw);
    localStorage.setItem('kanji-test-maker-lang', 'ja');
  }, migratedRaw);
  const againPage = await againCtx.newPage();
  await againPage.goto(base);
  await againPage.waitForSelector('#questionList .question-item');
  const again = await againPage.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('kanji-test-maker-v2'));
    const notice = document.getElementById('okuriNotice');
    return {
      hidden: notice.hidden,
      text: notice.textContent,
      answers: saved.questions.map((q) => q.answer),
      flagged: saved.questions.filter((q) => q.okuriNeedsEdit).length
    };
  });
  record('opening the migrated test again does not repeat the notice or change answers',
    again.hidden === true && again.flagged === 1 && again.answers[0] === '苦しい' && again.answers[5] === '祭り',
    JSON.stringify(again));
  await againCtx.close();

  await page.click('#sheetSeg [data-sheet="question"]');
  await page.click('[data-goto="draw"]');
  await page.click('#typePills [data-type="okuri"]');
  await page.click('#typePills [data-type="kaki"]');
  await page.click('#generateBtn');
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('kanji-test-maker-v2'));
    return saved.questions.some((q) => q.source === 'bank' && q.type === 'okuri');
  });
  const generated = await page.evaluate(() => {
    const KI = window.KanjiImport;
    return JSON.parse(localStorage.getItem('kanji-test-maker-v2')).questions
      .filter((q) => q.source === 'bank' && q.type === 'okuri')
      .map((q) => {
        const parts = KI.okuriParts(q.kanji);
        return { kanji: q.kanji, answer: q.answer, ok: !!(parts && q.answer === q.kanji && q.answer !== parts.okuri) };
      });
  });
  record('grade generation writes the whole word, not only the ending',
    generated.length >= 1 && generated.every((q) => q.ok),
    generated.map((q) => q.answer).slice(0, 6).join(' '));

  record('okurigana pages have no script errors', errors.length === 0, errors.join('; '));
  await ctx.close();

  const fileCtx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
  const filePage = await fileCtx.newPage();
  filePage.on('dialog', (dialog) => dialog.accept());
  await filePage.goto(base);
  await filePage.waitForSelector('#importFile', { state: 'attached' });
  await filePage.locator('details.backup').evaluate((details) => { details.open = true; });
  const v2Path = '/tmp/okuri-v2.json';
  writeFileSync(v2Path, JSON.stringify({
    app: 'kanji-test-maker',
    version: 2,
    state: { questions: ELEVEN.map(oldQuestion), format: 'A4-portrait' }
  }));
  await filePage.setInputFiles('#importFile', v2Path);
  await filePage.waitForFunction(() => {
    const raw = localStorage.getItem('kanji-test-maker-v2');
    if (!raw) return false;
    const saved = JSON.parse(raw);
    return saved.questions && saved.questions[0] && saved.questions[0].answer === '苦しい';
  });
  const imported = await filePage.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('kanji-test-maker-v2'));
    const notice = document.getElementById('okuriNotice');
    return {
      answers: saved.questions.map((q) => q.answer),
      notice: notice.textContent,
      hidden: notice.hidden
    };
  });
  record('a version 2 file imports as whole-word okurigana',
    imported.hidden === false && imported.notice.includes('一緒に書く') &&
    ELEVEN.every((row, i) => imported.answers[i] === row[0]),
    imported.answers.join(' '));

  const v3Path = '/tmp/okuri-v3.json';
  writeFileSync(v3Path, JSON.stringify({
    app: 'kanji-test-maker',
    version: 3,
    kind: 'sets',
    sets: [{
      id: 'set-okuri',
      name: '小3の送り',
      savedAt: Date.now(),
      questions: ELEVEN.map(oldQuestion),
      settings: {}
    }]
  }));
  await filePage.setInputFiles('#importSetsFile', v3Path);
  await filePage.waitForSelector('#setList [data-set-action="load"]');
  await filePage.click('#setList [data-set-action="load"]');
  await filePage.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('kanji-test-maker-v2'));
    return saved.questions && saved.questions.length === 11 && saved.questions[5].answer === '祭り';
  });
  const openedSet = await filePage.evaluate(() => JSON.parse(localStorage.getItem('kanji-test-maker-v2')).questions.map((q) => q.answer));
  record('a version 3 saved-list file migrates when opened',
    ELEVEN.every((row, i) => openedSet[i] === row[0]),
    openedSet.join(' '));

  const fresh = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  await fresh.addInitScript((data) => {
    localStorage.setItem('kanji-test-maker-v2', JSON.stringify(data));
    localStorage.setItem('kanji-test-maker-lang', 'en');
  }, { questions: [oldQuestion(ELEVEN[0], 0)], format: 'A4-portrait' });
  const enPage = await fresh.newPage();
  await enPage.goto(base);
  await enPage.waitForSelector('#okuriNotice');
  const english = await enPage.locator('#okuriNotice').innerText();
  record('the migration notice is in English when the screen is English',
    /kanji and the okurigana/i.test(english), english);
  await fresh.close();
  await fileCtx.close();
}

function standalone() {
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail || '' });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  };
  runOkuriRuleChecks(record);
  const failed = results.filter((row) => !row.ok);
  console.log('\n' + results.length + ' checks, ' + failed.length + ' failed');
  if (failed.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) standalone();
