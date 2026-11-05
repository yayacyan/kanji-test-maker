/**
 * 問題一覧の「全部の種類をまとめて変える」欄。
 * 選んだ種類がプレースホルダに戻らず、今の問題と合うこと。
 *   node tests/bulk-type.mjs
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BASE = 'http://127.0.0.1:8765/index.html';
const ROOT = '/workspace';

function question(id, type, kanji, reading, sentence, answer, style) {
  return {
    id, type, grade: 4, kanji, reading, sentence,
    answer: answer == null ? kanji : answer,
    style: style || 'mas', source: 'custom', base: ''
  };
}

const KAKI = question('a', 'kaki', '競', 'きそ', '友だちと、走る速さを競う。', '競');
const YOMI = question('b', 'yomi', '校庭', 'こうてい', '学校の校庭で遊ぶ。', 'こうてい');
const KAKI_B = question('c', 'kaki', '巣', 'す', 'くもの巣がはる。', '巣');

export async function runBulkTypeChecks({ browser, record, base }) {
  async function open(locale, saved, lang) {
    const ctx = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((data, langKey) => {
      if (data) localStorage.setItem('kanji-test-maker-v2', JSON.stringify(data));
      if (langKey) localStorage.setItem('kanji-test-maker-lang', langKey);
    }, saved || null, lang || '');
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base || BASE);
    await page.waitForSelector('#bulkTypeSelect');
    return { ctx, page, errors };
  }

  async function bulkState(page) {
    return page.evaluate(() => {
      const sel = document.getElementById('bulkTypeSelect');
      const note = document.getElementById('bulkTypeNote');
      const opt = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
      const types = [...document.querySelectorAll('#questionList .question-item .chip')].map((el) => el.textContent);
      return {
        value: sel ? sel.value : '',
        text: opt ? opt.textContent : '',
        disabled: sel ? sel.disabled : false,
        note: note ? note.textContent : '',
        noteHidden: note ? note.hidden : true,
        hasNote: !!note,
        types
      };
    });
  }

  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  record('service worker cache version is notebook-2', /VERSION = '2026-11-05-notebook-2'/.test(sw), (sw.match(/VERSION = '[^']+'/) || [''])[0]);

  {
    const { ctx, page, errors } = await open('ja-JP', { questions: [KAKI, YOMI] });
    let state = await bulkState(page);
    record('mixed questions show （混在） instead of the placeholder', state.value === 'mixed' && state.text === '（混在）' && state.noteHidden === true, JSON.stringify(state));

    await page.selectOption('#bulkTypeSelect', 'kaki');
    await page.waitForFunction(() => {
      const note = document.getElementById('bulkTypeNote');
      return note && !note.hidden && note.textContent.includes('変更しました');
    });
    state = await bulkState(page);
    const look = await page.evaluate(() => {
      const note = document.getElementById('bulkTypeNote');
      const cs = getComputedStyle(note);
      return { bg: cs.backgroundColor, color: cs.color, shadow: cs.boxShadow, position: cs.position };
    });
    record('chosen type stays selected after applying', state.value === 'kaki' && state.text === '書き（線のひらがな）' && !state.text.includes('種類を選ぶ'), JSON.stringify(state));
    record('inline note reports how many questions changed', state.note === '1問を「書き（線のひらがな）」に変更しました' && state.noteHidden === false, state.note);
    record('note uses the notebook ink and moss, without a shadow', look.bg === 'rgb(232, 240, 225)' && look.color === 'rgb(26, 26, 26)' && look.shadow === 'none' && (look.position === 'static' || look.position === 'relative'), JSON.stringify(look));
    record('every question is the type that was applied', state.types.filter((t) => t.includes('書き（線のひらがな）')).length === 2, state.types.join(' | '));

    await page.selectOption('#bulkTypeSelect', 'yomi');
    await page.waitForFunction(() => document.getElementById('bulkTypeNote').textContent.includes('読み（線の漢字）'));
    state = await bulkState(page);
    record('a second apply replaces the note and keeps the new type', state.value === 'yomi' && state.text === '読み（線の漢字）' && state.note === '2問を「読み（線の漢字）」に変更しました', JSON.stringify(state));

    const first = page.locator('#questionList .question-item').first();
    await first.locator('[data-action="toggle"]').click();
    await first.locator('[data-field="type"]').selectOption('kaki');
    await page.waitForFunction(() => document.getElementById('bulkTypeSelect').value === 'mixed');
    state = await bulkState(page);
    record('editing one question to a different type shows （混在） and clears the note', state.value === 'mixed' && state.text === '（混在）' && state.noteHidden === true, JSON.stringify(state));

    await first.locator('[data-field="type"]').selectOption('yomi');
    await page.waitForFunction(() => document.getElementById('bulkTypeSelect').value === 'yomi');
    state = await bulkState(page);
    record('editing questions back to one type shows that type', state.value === 'yomi' && state.text === '読み（線の漢字）' && state.noteHidden === true, JSON.stringify(state));

    await page.locator('#questionList .question-item').nth(1).locator('[data-action="delete"]').click();
    await page.waitForFunction(() => document.getElementById('listCount').textContent === '1');
    state = await bulkState(page);
    record('deleting a question keeps the remaining shared type', state.value === 'yomi' && state.text === '読み（線の漢字）', JSON.stringify(state));

    await page.locator('#questionList [data-action="delete"]').click();
    await page.waitForFunction(() => document.getElementById('listCount').textContent === '0');
    state = await bulkState(page);
    record('deleting the last question returns the placeholder', state.value === '' && state.text === '種類を選ぶ…' && state.disabled === true && state.noteHidden === true, JSON.stringify(state));

    await page.locator('#tool-custom').evaluate((el) => { el.open = true; });
    await page.evaluate(() => { document.getElementById('customType').value = 'yomi'; });
    await page.fill('#customKanji', '山');
    await page.fill('#customReading', 'やま');
    await page.fill('#customSentence', '山にのぼる。');
    await page.click('#addQuestionBtn');
    await page.waitForFunction(() => document.getElementById('listCount').textContent === '1');
    state = await bulkState(page);
    record('adding a question shows that question’s type', state.value === 'yomi' && state.text === '読み（線の漢字）' && state.disabled === false && state.noteHidden === true, JSON.stringify(state));

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#clearAllBtn');
    await page.waitForFunction(() => document.getElementById('listCount').textContent === '0');
    state = await bulkState(page);
    record('clearing every question resets the select to the placeholder', state.value === '' && state.text === '種類を選ぶ…' && state.disabled === true, JSON.stringify(state));
    record('bulk type flow has no page errors', errors.length === 0, errors.join('; '));
    await page.locator('#listPanel').scrollIntoViewIfNeeded();
    await ctx.close();
  }

  {
    const { ctx, page } = await open('ja-JP', { questions: [KAKI, KAKI_B] });
    const state = await bulkState(page);
    record('a list that already shares one type shows that type before any apply', state.value === 'kaki' && state.text === '書き（線のひらがな）' && state.noteHidden === true && state.text !== '種類を選ぶ…', JSON.stringify(state));
    await ctx.close();
  }

  {
    const { ctx, page } = await open('en-US', { questions: [KAKI, YOMI] }, 'en');
    let state = await bulkState(page);
    record('English mixed state is labeled (Mixed)', state.value === 'mixed' && state.text === '(Mixed)', JSON.stringify(state));
    await page.selectOption('#bulkTypeSelect', 'kaki');
    await page.waitForFunction(() => {
      const note = document.getElementById('bulkTypeNote');
      return note && !note.hidden && note.textContent.includes('Changed');
    });
    state = await bulkState(page);
    record('English note names the type and the count', state.value === 'kaki' && state.text === 'Write (underlined hiragana)' && state.note === 'Changed 1 to “Write (underlined hiragana)”', state.note);
    await page.click('[data-set-lang="ja"]');
    await page.waitForFunction(() => document.getElementById('bulkTypeNote').textContent.includes('変更しました'));
    state = await bulkState(page);
    record('switching language keeps the type and translates the note', state.value === 'kaki' && state.text === '書き（線のひらがな）' && state.note === '1問を「書き（線のひらがな）」に変更しました', JSON.stringify(state));
    await ctx.close();
  }

  {
    const borrow = question('o', 'kaki', '借りる', 'かりる', '図書館で本を借りる。', '借りる');
    const { ctx, page } = await open('ja-JP', { questions: [borrow, KAKI] });
    await page.selectOption('#bulkTypeSelect', 'okuri');
    await page.waitForFunction(() => {
      const note = document.getElementById('bulkTypeNote');
      return note && !note.hidden;
    });
    const state = await bulkState(page);
    record('skipped questions leave the select on （混在） and the note explains them', state.value === 'mixed' && state.text === '（混在）' && state.note === '1問を「送りがな」に変更しました（1問は、漢字のあとにひらがなが続く語ではないので、そのままです）', state.note);
    await ctx.close();
  }

  {
    const free = question('f', 'free', '', '', '「花」をつかって、文をつくりましょう。', '春になると、花がさく。', 'line');
    const { ctx, page } = await open('ja-JP', { questions: [free] });
    let state = await bulkState(page);
    record('a free-only list shows 自由入力', state.value === 'free' && state.text === '自由入力', JSON.stringify(state));
    await page.selectOption('#bulkTypeSelect', 'kaki');
    await page.waitForFunction(() => !document.getElementById('toast').hidden);
    state = await bulkState(page);
    const toast = await page.locator('#toast').innerText();
    record('free questions are not bulk-changed and the select stays on 自由入力', state.value === 'free' && state.text === '自由入力' && state.noteHidden === true && toast.includes('変える問題がありません'), JSON.stringify({ state, toast }));
    await ctx.close();
  }

  {
    const free = question('f', 'free', '', '', '「花」をつかって、文をつくりましょう。', '春になると、花がさく。', 'line');
    const { ctx, page } = await open('ja-JP', { questions: [KAKI, free] });
    await page.selectOption('#bulkTypeSelect', 'yomi');
    await page.waitForFunction(() => {
      const note = document.getElementById('bulkTypeNote');
      return note && !note.hidden;
    });
    const state = await bulkState(page);
    record('free questions stay put, so a partial apply remains （混在）', state.value === 'mixed' && state.note === '1問を「読み（線の漢字）」に変更しました', JSON.stringify(state));
    await ctx.close();
  }

  {
    const log = await browser.newContext({ locale: 'ja-JP', viewport: { width: 800, height: 700 } });
    const page = await log.newPage();
    await page.goto((base || BASE).replace('index.html', 'changelog.html'));
    await page.waitForSelector('[data-lang-block="zh"]', { state: 'attached' });
    const blocks = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('[data-lang-block]').forEach((el) => { out[el.dataset.langBlock] = el.textContent; });
      return out;
    });
    record('changelog mentions the bulk type fix in Japanese', blocks.ja.includes('選んだ種類が欄に残ります'), (blocks.ja || '').slice(0, 80));
    record('changelog mentions the bulk type fix in English', blocks.en.includes('the menu keeps that type'), (blocks.en || '').slice(0, 80));
    record('changelog mentions the bulk type fix in Chinese', blocks.zh.includes('選過的題型會留在欄位上'), (blocks.zh || '').slice(0, 80));
    await log.close();
  }
}

async function main() {
  const playwrightMod = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
  const { chromium } = playwrightMod.chromium ? playwrightMod : playwrightMod.default;
  const results = [];
  function record(name, ok, detail) {
    results.push({ name, ok, detail: detail || '' });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  }
  const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i += 1) {
      try { if ((await fetch(BASE)).ok) break; } catch (error) { /* retry */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const browser = await chromium.launch();
    await runBulkTypeChecks({ browser, record, base: BASE });
    await browser.close();
  } finally {
    server.kill();
  }
  const failed = results.filter((row) => !row.ok);
  console.log('\n' + results.length + ' checks, ' + failed.length + ' failed');
  if (failed.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
