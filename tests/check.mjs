/**
 * 画面と印刷の確認。Playwright が /tmp/print-audit にある前提。
 *   node tests/check.mjs
 */
const playwrightMod = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const { chromium, webkit } = playwrightMod.chromium ? playwrightMod : playwrightMod.default;
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = '/workspace';
const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const SHOT = path.join(OUT, 'screenshots');
const PDF = path.join(OUT, 'print');
mkdirSync(SHOT, { recursive: true });
mkdirSync(PDF, { recursive: true });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

function startServer() {
  return spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
}
async function waitServer() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(BASE)).ok) return; } catch (error) { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server');
}

const FORMATS = {
  'A4-portrait': [210, 297, 595, 842],
  'A4-landscape': [297, 210, 842, 595],
  'Letter-portrait': [215.9, 279.4, 612, 792],
  'Letter-landscape': [279.4, 215.9, 792, 612],
  'A3-landscape': [420, 297, 1191, 842]
};

async function fresh(browser, locale, extra) {
  const ctx = await browser.newContext({ locale, viewport: { width: 1400, height: 900 }, ...(extra || {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

const server = startServer();
const banks = {};
try {
  await waitServer();
  const browser = await chromium.launch();

  // --- locale defaults ---
  {
    const { ctx, page, errors } = await fresh(browser, 'ja-JP');
    await page.goto(BASE);
    await page.waitForSelector('#generateBtn');
    const info = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      make: document.getElementById('generateBtn').textContent,
      format: document.getElementById('gradeFormatSelect').value,
      preview: document.getElementById('printFormat').value
    }));
    record('ja-JP defaults to Japanese and A4 portrait', info.lang === 'ja' && info.make === '問題を作る' && info.format === 'A4-portrait' && info.preview === 'A4-portrait', JSON.stringify(info));
    record('ja-JP has no page errors', errors.length === 0, errors.join('; '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await fresh(browser, 'en-US');
    await page.goto(BASE);
    await page.waitForSelector('#generateBtn');
    const info = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      make: document.getElementById('generateBtn').textContent,
      format: document.getElementById('gradeFormatSelect').value,
      paperLabel: document.querySelector('.preview-bar .bar-label')?.textContent,
      display: getComputedStyle(document.querySelector('.preview-bar .bar-field')).display
    }));
    record('en-US defaults to English and Letter portrait', info.lang === 'en' && info.make === 'Make questions' && info.format === 'Letter-portrait', JSON.stringify(info));
    record('paper size is visible beside the preview', info.display !== 'none' && info.paperLabel === 'Paper', JSON.stringify(info));
    record('en-US has no page errors', errors.length === 0, errors.join('; '));
    await page.screenshot({ path: path.join(SHOT, 'english_ui.png') });
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser, 'en-CA');
    await page.goto(BASE);
    await page.waitForSelector('#gradeFormatSelect');
    const format = await page.locator('#gradeFormatSelect').inputValue();
    record('en-CA defaults to Letter portrait', format === 'Letter-portrait', format);
    await ctx.close();
  }

  // --- saved choice wins, old data loads ---
  {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('kanji-test-maker-v2', JSON.stringify({
        format: 'A4-landscape',
        title: '漢字テスト',
        questions: [{ id: 'old-1', type: 'kaki', grade: 3, kanji: '山', reading: 'やま', sentence: '山にのぼる。', answer: '山', style: 'mas', source: 'custom', base: '山' }],
        gen: { range: '3', count: 10, types: ['kaki'], counts: { kaki: 10 }, countsDirty: false, replace: true, avoidRecent: false }
      }));
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => document.querySelector('#gradeFormatSelect')?.value === 'A4-landscape');
    const info = await page.evaluate(() => ({
      format: document.getElementById('gradeFormatSelect').value,
      preview: document.getElementById('printFormat').value,
      kanji: document.querySelector('.qi-kanji')?.textContent,
      n: document.querySelectorAll('#printArea .q').length
    }));
    record('saved A4 landscape wins over en-US default', info.format === 'A4-landscape' && info.preview === 'A4-landscape', JSON.stringify(info));
    record('old saved question still loads', info.kanji === '山' && info.n === 1, JSON.stringify(info));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(() => localStorage.setItem('kanji-test-maker-lang', 'en'));
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForSelector('#generateBtn');
    const make = await page.locator('#generateBtn').innerText();
    record('saved English wins over ja-JP locale', make === 'Make questions', make);
    await ctx.close();
  }

  // --- build question banks and check pagination, toast, language on the sheet ---
  {
    const { ctx, page } = await fresh(browser, 'ja-JP');
    await page.goto(BASE);
    await page.selectOption('#gradeRange', '3');
    const yomi = page.locator('#typePills [data-type="yomi"]');
    if ((await yomi.getAttribute('aria-pressed')) !== 'true') await page.click('#typePills [data-type="yomi"]');
    for (const n of [10, 15, 50]) {
      await page.click('#countPills [data-count="' + n + '"]');
      await page.click('#generateBtn');
      await page.waitForFunction((n) => {
        const raw = localStorage.getItem('kanji-test-maker-v2');
        return raw && JSON.parse(raw).questions.length === n && document.querySelectorAll('#printArea .paper').length >= 1;
      }, n, { timeout: 60000 });
      banks[n] = await page.evaluate(() => JSON.parse(localStorage.getItem('kanji-test-maker-v2')).questions);
      const layout = await page.evaluate(() => {
        const papers = [...document.querySelectorAll('#printArea .paper')];
        const nums = papers.map((p) => [...p.querySelectorAll('.q-no')].map((el) => Number(el.textContent)));
        return {
          pages: papers.length,
          counts: nums.map((a) => a.length),
          first: nums.map((a) => a[0]),
          info: document.getElementById('sheetInfo').textContent,
          toastHidden: document.getElementById('toast').hidden,
          status: document.getElementById('drawStatus').textContent
        };
      });
      if (n === 15) {
        record('15 questions stay on one page', layout.pages === 1, JSON.stringify(layout.counts));
        record('desktop uses the status under the button, not a floating toast', layout.toastHidden === true && layout.status.includes('作りました'), layout.status.slice(0, 80));
        await page.setViewportSize({ width: 1024, height: 900 });
        await page.evaluate(() => document.querySelector('.size-hint').scrollIntoView({ block: 'start' }));
        const covered = await page.evaluate(noticeHits);
        record('notice covers no visible text', covered.length === 0, covered.join(' | ') || 'none');
        await page.screenshot({ path: path.join(SHOT, 'toast_not_over_preview.png') });
        await page.setViewportSize({ width: 1400, height: 900 });
      }
      if (n === 50) {
        const flat = layout.first;
        const ordered = layout.counts.length > 1 && flat[0] === 1 && flat[1] === layout.counts[0] + 1;
        record('50 questions split across pages', layout.pages >= 2, JSON.stringify(layout.counts));
        record('question numbers continue across pages', ordered, JSON.stringify(layout));
        record('split keeps a readable box size', /約([0-9.]+)mm/.test(layout.info) && Number(layout.info.match(/約([0-9.]+)mm/)[1]) >= 6.5, layout.info.slice(0, 80));
        await page.screenshot({ path: path.join(SHOT, 'fifty_questions_split.png') });
      }
      if (n === 10) record('10 questions stay on one page', layout.pages === 1, JSON.stringify(layout.counts));
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.click('#viewTabs [data-view="edit"]');
    await page.click('#generateBtn');
    await page.waitForFunction(() => document.getElementById('toast') && !document.getElementById('toast').hidden);
    const phoneHits = await page.evaluate(noticeHits);
    record('phone toast covers no visible text', phoneHits.length === 0, phoneHits.join(' | ') || 'none');
    await page.waitForTimeout(7500);
    const gone = await page.evaluate(() => document.getElementById('toast').hidden);
    record('toast auto-dismisses', gone === true, String(gone));
    await page.setViewportSize({ width: 1400, height: 900 });

    await page.click('#sheetSeg [data-sheet="answer"]');
    await page.waitForTimeout(400);
    const ans = await page.evaluate(() => ({
      pages: document.querySelectorAll('#printArea .paper.is-answer').length,
      stamp: document.querySelector('.stamp')?.textContent,
      q: document.querySelectorAll('#printArea .q').length
    }));
    record('answer sheets use the same page split', ans.pages === 2 && ans.q === 50 && ans.stamp === '解答', JSON.stringify(ans));

    await page.click('[data-set-lang="en"]');
    await page.waitForTimeout(600);
    const enSheet = await page.evaluate(() => ({
      brand: document.querySelector('.paper-brand')?.textContent,
      stamp: document.querySelector('.stamp')?.textContent,
      name: document.querySelector('.paper-fields')?.textContent || '',
      make: document.getElementById('generateBtn').textContent,
      paperClass: document.querySelector('#paperHost .paper')?.className || ''
    }));
    record('English sheet chrome', enSheet.brand === 'Kanji Test Maker' && enSheet.stamp === 'Answers' && enSheet.make === 'Make questions' && /\blang-en\b/.test(enSheet.paperClass || ''), JSON.stringify(enSheet));
    await page.screenshot({ path: path.join(SHOT, 'english_answer_sheet.png') });
    await ctx.close();
  }

  function noticeHits() {
    function clipped(el) {
      const cs = getComputedStyle(el);
      return /(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowY + cs.overflowX);
    }
    function visiblePart(rect, el) {
      let box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      let node = el;
      while (node && node !== document.documentElement) {
        if (clipped(node)) {
          const c = node.getBoundingClientRect();
          box = {
            left: Math.max(box.left, c.left),
            top: Math.max(box.top, c.top),
            right: Math.min(box.right, c.right),
            bottom: Math.min(box.bottom, c.bottom)
          };
        }
        node = node.parentElement;
      }
      box.left = Math.max(box.left, 0);
      box.top = Math.max(box.top, 0);
      box.right = Math.min(box.right, window.innerWidth);
      box.bottom = Math.min(box.bottom, window.innerHeight);
      if (box.right - box.left < 1 || box.bottom - box.top < 1) return null;
      return box;
    }
    const layers = [];
    ['toast', 'inlineNotice'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const t = el.getBoundingClientRect();
      if (t.width < 2 || t.height < 2) return;
      layers.push(t);
    });
    if (!layers.length) return [];
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const raw = textNode.textContent.replace(/\s+/g, ' ').trim();
      if (raw.length < 2) continue;
      const parent = textNode.parentElement;
      if (!parent || parent.closest('#toast, #inlineNotice, .sr-only, [hidden]')) continue;
      const pcs = getComputedStyle(parent);
      if (pcs.display === 'none' || pcs.visibility === 'hidden' || Number(pcs.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      for (const r of range.getClientRects()) {
        const vis = visiblePart(r, parent);
        if (!vis) continue;
        for (const t of layers) {
          const overlap = !(t.right <= vis.left + 0.5 || t.left >= vis.right - 0.5 || t.bottom <= vis.top + 0.5 || t.top >= vis.bottom - 0.5);
          if (overlap) hits.push(raw.slice(0, 42));
        }
      }
    }
    return [...new Set(hits)].slice(0, 8);
  }

  function layoutProblems() {
    const problems = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 2) problems.push('page-hscroll');
    const name = document.querySelector('.brand-name');
    const actions = document.querySelector('.header-actions');
    if (name && actions && name.offsetParent && actions.offsetParent) {
      const nr = document.querySelector('.brand-block').getBoundingClientRect();
      const ar = actions.getBoundingClientRect();
      const separated = ar.left >= nr.right - 1 || ar.top >= nr.bottom - 1;
      if (!separated) problems.push('header-overlap');
    }
    const langBtn = document.querySelector('[data-set-lang="ja"]');
    if (langBtn && langBtn.offsetParent && langBtn.getBoundingClientRect().height > 44) problems.push('lang-wrap');
    document.querySelectorAll('.hero-line').forEach((el) => {
      if (!el.offsetParent) return;
      const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
      if (el.getBoundingClientRect().height > line * 1.7) problems.push('hero-wrap');
    });
    document.querySelectorAll('.save-state').forEach((el) => {
      if (!el.offsetParent) return;
      if (el.scrollWidth > el.clientWidth + 2 || el.getBoundingClientRect().height > 40) problems.push('save-badge');
    });
    document.querySelectorAll('#typePills .tv').forEach((tv) => {
      const box = tv.getBoundingClientRect();
      if (box.width < 2) return;
      const type = tv.closest('[data-type]')?.getAttribute('data-type') || '?';
      tv.querySelectorAll('*').forEach((child) => {
        const r = child.getBoundingClientRect();
        if (r.width < 0.5 || r.height < 0.5) return;
        if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) problems.push('icon-' + type);
      });
    });
    const bar = document.querySelector('.preview-bar');
    if (bar && window.innerWidth >= 1000 && bar.getBoundingClientRect().width > 40) {
      if (bar.scrollWidth > bar.clientWidth + 2) problems.push('bar-overflow');
      if (bar.getBoundingClientRect().height > 64) problems.push('bar-tall');
    }
    const saved = document.querySelector('.saved-sets');
    if (saved && saved.offsetParent && saved.scrollWidth > saved.clientWidth + 2) problems.push('sets-overflow');
    const countBtns = [...document.querySelectorAll('#countPills .pill-btn')].filter((b) => b.offsetParent);
    if (countBtns.length >= 5) {
      const tops = countBtns.map((b) => b.getBoundingClientRect().top);
      if (Math.max(...tops) - Math.min(...tops) > 6) problems.push('count-wrap');
    }
    document.querySelectorAll('#paperHost .paper').forEach((paper) => {
      const pb = paper.getBoundingClientRect();
      if (pb.width < 30) return;
      if (document.documentElement.lang === 'en' && !paper.classList.contains('lang-en')) problems.push('missing-lang-en');
      const fields = [...paper.querySelectorAll('.paper-fields .field')];
      fields.forEach((field) => {
        const r = field.getBoundingClientRect();
        if (r.width < 2) return;
        if (r.right > pb.right + 1.5 || r.left < pb.left - 1.5) problems.push('field-clip');
      });
      for (let a = 0; a < fields.length; a += 1) {
        const ra = fields[a].getBoundingClientRect();
        for (let b = a + 1; b < fields.length; b += 1) {
          const rb = fields[b].getBoundingClientRect();
          const ov = ra.width > 2 && rb.width > 2 && !(ra.right < rb.left + 0.5 || ra.left > rb.right - 0.5 || ra.bottom < rb.top + 0.5 || ra.top > rb.bottom - 0.5);
          if (ov) problems.push('field-overlap');
        }
      }
      let outside = 0;
      paper.querySelectorAll('.q').forEach((q) => {
        const qr = q.getBoundingClientRect();
        q.querySelectorAll('.box, .cell, .q-ans, .q-main').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 1) return;
          if (r.left < qr.left - 2 || r.right > qr.right + 2 || r.top < qr.top - 2 || r.bottom > qr.bottom + 2) outside += 1;
        });
      });
      if (outside) problems.push('q-outside-' + outside);
    });
    return [...new Set(problems)];
  }

  async function layoutSweep(engineBrowser, engine) {
    for (const lang of ['ja', 'en']) {
      const ctx = await engineBrowser.newContext({
        locale: lang === 'ja' ? 'ja-JP' : 'en-US',
        viewport: { width: 1280, height: 900 }
      });
      await ctx.addInitScript((saved, langKey) => {
        localStorage.setItem('kanji-test-maker-v2', JSON.stringify(saved));
        localStorage.setItem('kanji-test-maker-lang', langKey);
      }, {
        format: lang === 'ja' ? 'A4-portrait' : 'Letter-portrait',
        title: '漢字テスト',
        showName: true, showScore: true, showClass: true, showDate: true, showInstructions: true,
        pointsEach: '2',
        strokeText: '水木日上花祭',
        questions: banks[15],
        view: 'edit'
      }, lang);
      await ctx.addInitScript(() => {
        localStorage.setItem('kanji-test-maker-sets', JSON.stringify([{
          id: 'layout-set',
          name: '2026-10-29 Grade 3 15',
          savedAt: Date.now(),
          questions: [{ id: 'layout-q', type: 'kaki', grade: 3, kanji: '山', reading: 'やま', sentence: '山にのぼる。', answer: '山', style: 'mas', source: 'custom', base: '山' }],
          settings: { format: 'A4-portrait', gen: { range: '3', count: 15, types: ['kaki'], counts: { kaki: 15 } } }
        }]));
      });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#paperHost .paper', { timeout: 20000 });
      await page.waitForSelector('#typePills .tv');
      for (const w of [375, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width: w, height: w < 800 ? 812 : 900 });
        await page.waitForTimeout(100);
        if (w < 1000) await page.click('#viewTabs [data-view="edit"]');
        if (w === 375) {
          const phone = await page.evaluate(() => {
            const sel = document.getElementById('gradeFormatSelect');
            sel.scrollIntoView({ block: 'end' });
            const nav = document.querySelector('.view-tabs').getBoundingClientRect();
            const sr = sel.getBoundingClientRect();
            const label = sel.parentElement.querySelector('.field-label').getBoundingClientRect();
            const buttons = [...document.querySelectorAll('#countPills .pill-btn')].map((b) => b.getBoundingClientRect());
            const tops = buttons.map((b) => b.top);
            const scroller = document.scrollingElement;
            scroller.scrollTop = scroller.scrollHeight;
            const paneBottom = document.getElementById('paneEdit').getBoundingClientRect().bottom;
            const navEnd = document.querySelector('.view-tabs').getBoundingClientRect().top;
            return {
              oneRow: tops.length === 5 && Math.max(...tops) - Math.min(...tops) <= 6,
              selClear: sr.bottom <= nav.top + 1 && sr.top >= 0,
              labelClear: label.bottom <= nav.top + 1 && label.top >= 0,
              endClear: paneBottom <= navEnd + 1,
              detail: [Math.round(sr.bottom), Math.round(nav.top), Math.round(label.top), Math.round(paneBottom), Math.round(navEnd)].join(',')
            };
          });
          record(engine + ' phone counts ' + lang, phone.oneRow && phone.selClear && phone.labelClear && phone.endClear, JSON.stringify(phone));
          if (engine === 'chromium' && lang === 'ja') {
            await page.evaluate(() => document.getElementById('gradeFormatSelect').scrollIntoView({ block: 'end' }));
            await page.screenshot({ path: path.join(SHOT, 'phone_ja_counts.png') });
          }
        }
        const edit = await page.evaluate(layoutProblems);
        const editHits = (await page.evaluate(noticeHits)).map((hit) => 'covers-text ' + hit);
        if (w < 1000) await page.click('#viewTabs [data-view="preview"]');
        await page.waitForTimeout(80);
        const preview = await page.evaluate(layoutProblems);
        const previewHits = (await page.evaluate(noticeHits)).map((hit) => 'covers-text ' + hit);
        const probs = [...new Set([...edit, ...editHits, ...preview, ...previewHits])];
        record(engine + ' layout ' + lang + ' ' + w, probs.length === 0, probs.join(', ') || 'ok');
        if (w < 1000) await page.click('#viewTabs [data-view="edit"]');
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.click('#sheetSeg [data-sheet="stroke"]');
      await page.waitForFunction(() => document.querySelector('#paperHost')?.dataset.strokeReady === '1', null, { timeout: 20000 });
      await page.waitForTimeout(200);
      const stroke = await page.evaluate(layoutProblems);
      record(engine + ' stroke layout ' + lang, stroke.length === 0, stroke.join(', ') || 'ok');
      await ctx.close();
    }
  }

  await layoutSweep(browser, 'chromium');

  async function savedSetsAndOffline() {
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('kanji-test-maker-lang', 'ja');
      localStorage.setItem('kanji-test-maker-v2', JSON.stringify({
        format: 'A4-portrait',
        title: '漢字テスト',
        questions: [
          { id: 'a', type: 'kaki', grade: 3, kanji: '山', reading: 'やま', sentence: '山にのぼる。', answer: '山', style: 'mas', source: 'custom', base: '山' },
          { id: 'b', type: 'yomi', grade: 3, kanji: '川', reading: 'かわ', sentence: '川をわたる。', answer: 'かわ', style: 'mas', source: 'custom', base: '川' }
        ],
        gen: { range: '3', count: 15, types: ['kaki', 'yomi'], counts: { kaki: 8, yomi: 7 }, countsDirty: true, replace: true, avoidRecent: false }
      }));
    });
    const page = await ctx.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#saveSetBtn');
    const pwa = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || '',
      apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || '',
      capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content || '',
      title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content || ''
    }));
    record('install meta for home screen', pwa.manifest === 'manifest.webmanifest' && pwa.apple === 'icons/apple-touch-icon.png' && pwa.capable === 'yes' && pwa.title === '漢字テストメーカー', JSON.stringify(pwa));
    await page.click('#saveSetBtn');
    await page.waitForFunction(() => document.querySelectorAll('#setList .set-item').length === 1);
    const savedName = await page.locator('#setList .set-info strong').innerText();
    const savedMeta = await page.locator('#setList .set-info span').innerText();
    record('default name is date, grade, and count', /^\d{4}-\d{2}-\d{2} 小学3年 2問$/.test(savedName), savedName);
    record('saved list shows the count', savedMeta.includes('2問'), savedMeta);
    const usage = await page.locator('#storageUsage').innerText();
    record('storage usage is shown', /KB/.test(usage), usage);
    await page.click('#setList [data-set-action="rename"]');
    await page.fill('#setList [data-set-rename-input]', '春のテスト');
    await page.click('#setList [data-set-action="rename-save"]');
    record('rename saved test', await page.locator('#setList .set-info strong').innerText() === '春のテスト');
    await page.selectOption('#gradeFormatSelect', 'Letter-portrait');
    await page.click('#setList [data-set-action="load"]');
    await page.waitForFunction(() => document.getElementById('gradeFormatSelect').value === 'A4-portrait');
    const reopened = await page.evaluate(() => ({
      format: document.getElementById('gradeFormatSelect').value,
      kanji: [...document.querySelectorAll('.qi-kanji')].map((el) => el.textContent)
    }));
    record('reopen restores questions and paper', reopened.format === 'A4-portrait' && reopened.kanji.includes('山') && reopened.kanji.includes('川'), JSON.stringify(reopened));
    await page.click('#setList [data-set-action="duplicate"]');
    await page.waitForFunction(() => document.querySelectorAll('#setList .set-item').length === 2);
    const dup = await page.evaluate(() => ({
      name: document.querySelector('#setList .set-info strong')?.textContent || '',
      kaki: document.querySelector('#typePills [data-type="kaki"]')?.getAttribute('aria-pressed'),
      yomi: document.querySelector('#typePills [data-type="yomi"]')?.getAttribute('aria-pressed'),
      types: [...document.querySelectorAll('.question-item')].map((el) => el.textContent).join(' ')
    }));
    record('duplicate keeps both question types', dup.name.includes('コピー') && dup.kaki === 'true' && dup.yomi === 'true', JSON.stringify(dup));
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
    await page.click('#setList [data-set-action="print"]');
    await page.waitForTimeout(400);
    const printed = await page.evaluate(() => ({ n: window.__printed, confirm: !document.getElementById('printConfirm').hidden }));
    record('reprint does not ask to retype', printed.n > 0 || printed.confirm, JSON.stringify(printed));
    const downloadPromise = page.waitForEvent('download');
    await page.click('#exportSetsBtn');
    const download = await downloadPromise;
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
    record('export saved list as JSON', exported.kind === 'sets' && exported.version === 3 && exported.sets.length === 2, 'n=' + (exported.sets || []).length);
    writeFileSync('/tmp/kanji-sets.json', JSON.stringify(exported));
    await page.evaluate(() => localStorage.removeItem('kanji-test-maker-sets'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#importSetsBtn');
    await page.setInputFiles('#importSetsFile', '/tmp/kanji-sets.json');
    await page.waitForFunction(() => document.querySelectorAll('#setList .set-item').length === 2);
    record('import saved list', true);
    const beforeDelete = await page.locator('#setList .set-item').count();
    await page.locator('#setList [data-set-action="delete"]').first().click();
    await page.waitForFunction((n) => document.querySelectorAll('#setList .set-item').length === n - 1, beforeDelete);
    record('delete saved test', true);
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'kanji-test-maker-sets') throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, key, value);
      };
    });
    await page.fill('#setName', '入らないセット');
    await page.click('#saveSetBtn');
    await page.waitForFunction(() => {
      const note = document.getElementById('inlineNotice');
      return note && !note.hidden && note.textContent.includes('いっぱい');
    });
    const still = await page.locator('#setList .set-info strong').allInnerTexts();
    record('quota error keeps the list and explains', !still.includes('入らないセット'), still.join(','));
    await page.evaluate(() => document.getElementById('savedSets').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(SHOT, 'saved_list_ja_desktop.png') });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => document.getElementById('savedSets').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(SHOT, 'saved_list_ja_phone.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click('[data-set-lang="en"]');
    await page.waitForFunction(() => document.querySelector('#savedSets h2')?.textContent === 'My saved tests');
    record('saved list has English labels', (await page.locator('#setList [data-set-action="duplicate"]').first().innerText()) === 'Duplicate and edit');
    await page.evaluate(() => document.getElementById('savedSets').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(SHOT, 'saved_list_en_desktop.png') });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => document.getElementById('savedSets').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(SHOT, 'saved_list_en_phone.png') });
    await ctx.close();

    const old = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
    await old.addInitScript(() => {
      localStorage.setItem('kanji-test-maker-lang', 'ja');
      localStorage.setItem('kanji-test-maker-sets', JSON.stringify([{
        id: 'old-set',
        name: '昔のセット',
        savedAt: 1,
        questions: [{ id: 'old-q', type: 'yomi', grade: 3, kanji: '山', reading: 'やま', sentence: '山にのぼる。', answer: 'やま', style: 'mas', source: 'custom', base: '山' }],
        settings: { format: 'Letter-portrait' }
      }]));
    });
    const oldPage = await old.newPage();
    oldPage.on('dialog', (dialog) => dialog.accept());
    await oldPage.goto(BASE, { waitUntil: 'domcontentloaded' });
    await oldPage.waitForSelector('#setList [data-set-action="load"]');
    record('old saved set is listed', (await oldPage.locator('#setList .set-info strong').innerText()) === '昔のセット');
    await oldPage.click('#setList [data-set-action="load"]');
    await oldPage.waitForFunction(() => document.querySelector('.qi-kanji')?.textContent === '山');
    const oldInfo = await oldPage.evaluate(() => ({
      format: document.getElementById('gradeFormatSelect').value,
      yomi: document.querySelector('#typePills [data-type="yomi"]')?.getAttribute('aria-pressed')
    }));
    record('old saved set reopens with its type and paper', oldInfo.format === 'Letter-portrait' && oldInfo.yomi === 'true', JSON.stringify(oldInfo));
    await old.close();

    const swCtx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
    const swPath = path.join(ROOT, 'sw.js');
    const swOriginal = readFileSync(swPath, 'utf8');
    const swPage = await swCtx.newPage();
    try {
      await swPage.goto(BASE, { waitUntil: 'domcontentloaded' });
      await swPage.waitForSelector('#generateBtn');
      await swPage.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 20000 });
      await swPage.reload({ waitUntil: 'domcontentloaded' });
      await swPage.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
      record('service worker controls the page', true);
      await swCtx.setOffline(true);
      await swPage.reload({ waitUntil: 'domcontentloaded' });
      await swPage.waitForSelector('#generateBtn', { timeout: 15000 });
      record('offline reload shows the app', (await swPage.locator('#generateBtn').innerText()) === '問題を作る');
      await swCtx.setOffline(false);
      writeFileSync(swPath, swOriginal.replace('2026-10-29-sets-1', '2026-10-29-sets-2'));
      await swPage.evaluate(() => navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()));
      await swPage.waitForSelector('#updateNotice:not([hidden])', { timeout: 20000 });
      record('new version notice appears', true);
    } finally {
      writeFileSync(swPath, swOriginal);
      await swCtx.close();
    }
  }
  await savedSetsAndOffline();

  // --- print PDFs ---
  async function printCase(engineBrowser, engine, lang, format, questions, kind) {
    const ctx = await engineBrowser.newContext({
      locale: lang === 'en' ? 'en-US' : 'ja-JP',
      viewport: { width: 1400, height: 900 },
      deviceScaleFactor: engine === 'webkit' ? 2 : 1
    });
    const data = {
      format,
      title: '漢字テスト',
      sheetMode: kind === 'stroke' ? 'stroke' : 'question',
      printBoth: kind === 'both',
      strokeText: kind === 'stroke' ? '水 木 日 上 花 祭 曜 鏡' : '',
      questions: kind === 'stroke' ? [] : questions,
      showName: true, showScore: true, showClass: true, showDate: true, showInstructions: true,
      font: 'kyokasho', tiers: 'auto', view: 'preview'
    };
    await ctx.addInitScript((saved, lang) => {
      localStorage.setItem('kanji-test-maker-v2', JSON.stringify(saved));
      localStorage.setItem('kanji-test-maker-lang', lang);
    }, data, lang);
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    if (kind === 'stroke') {
      await page.waitForFunction(() => document.querySelector('#paperHost')?.dataset.strokeReady === '1', null, { timeout: 30000 });
    } else {
      await page.waitForFunction(() => document.querySelectorAll('#printArea .paper').length >= 1, null, { timeout: 60000 });
    }
    await page.emulateMedia({ media: 'print' });
    const dom = await page.evaluate(() => ({
      pages: document.querySelectorAll('#printArea .paper').length,
      brand: document.querySelector('#printArea .paper-brand')?.textContent || ''
    }));
    const tag = engine + '_' + lang + '_' + format + '_' + (kind === 'stroke' ? 'stroke' : (questions.length + (kind === 'both' ? 'both' : 'q')));
    const file = path.join(PDF, tag + '.pdf');
    if (engine === 'chromium') {
      await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
    } else {
      const shots = [];
      const n = await page.locator('#printArea .paper').count();
      for (let i = 0; i < n; i += 1) {
        const png = path.join(PDF, tag + '_p' + (i + 1) + '.png');
        await page.locator('#printArea .paper').nth(i).screenshot({ path: png });
        shots.push(png);
      }
      writeFileSync(path.join(PDF, tag + '.shots.json'), JSON.stringify({ shots, w: FORMATS[format][0], h: FORMATS[format][1], file }));
    }
    await ctx.close();
    return { tag, file, dom, format, engine, lang, kind, n: kind === 'stroke' ? 0 : questions.length };
  }

  const jobs = [];
  const formats = Object.keys(FORMATS);
  for (const lang of ['ja', 'en']) {
    for (const format of formats) {
      for (const n of [10, 15, 50]) jobs.push(['chromium', lang, format, banks[n], 'q']);
    }
    jobs.push(['chromium', lang, 'A4-portrait', banks[15], 'both']);
    jobs.push(['chromium', lang, 'Letter-portrait', banks[15], 'stroke']);
    jobs.push(['chromium', lang, 'A4-portrait', banks[50], 'both']);
  }
  for (const job of jobs) {
    const row = await printCase(browser, ...job);
    jobs; // keep
    const expectPages = row.kind === 'stroke' ? row.dom.pages : (row.kind === 'both' ? null : row.dom.pages);
    let pdfPages = 0;
    let sizeOk = false;
    let inset = null;
    try {
      const text = execFileSync('pdfinfo', [row.file], { encoding: 'utf8' });
      pdfPages = Number((text.match(/Pages:\s+(\d+)/) || [])[1] || 0);
      const size = text.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
      const exp = FORMATS[row.format];
      sizeOk = size && Math.abs(Number(size[1]) - exp[2]) < 4 && Math.abs(Number(size[2]) - exp[3]) < 4;
    } catch (error) {
      record('pdf ' + row.tag, false, String(error.message || error).slice(0, 120));
      continue;
    }
    const pageOk = row.kind === 'both' ? pdfPages === row.dom.pages : pdfPages === row.dom.pages;
    const brandOk = row.lang === 'en' ? row.dom.brand === 'Kanji Test Maker' : row.dom.brand === '漢字テストメーカー';
    record('pdf ' + row.tag, pageOk && sizeOk && brandOk && pdfPages >= 1, 'pages=' + pdfPages + ' sizeOk=' + sizeOk + ' brand=' + row.dom.brand);
    if (row.n === 50 && row.kind === 'q' && row.format !== 'A3-landscape') record('50q splits in pdf ' + row.tag, pdfPages >= 2, String(pdfPages));
    if (row.n === 50 && row.kind === 'q' && row.format === 'A3-landscape') record('A3 50 stays on readable pages ' + row.tag, pdfPages >= 1 && pdfPages <= 3, String(pdfPages));
    if ((row.n === 10 || row.n === 15) && row.kind === 'q') record('short sheet is one page ' + row.tag, pdfPages === 1, String(pdfPages));
  }

  let wk = null;
  try { wk = await webkit.launch(); } catch (error) { record('webkit launch', false, error.message); }
  if (wk) {
    const wkJobs = [
      ['ja', 'A4-portrait', 15], ['ja', 'A4-portrait', 50], ['ja', 'Letter-portrait', 15],
      ['ja', 'Letter-landscape', 10], ['ja', 'A3-landscape', 15], ['ja', 'A4-landscape', 15],
      ['en', 'Letter-portrait', 15], ['en', 'Letter-portrait', 50], ['en', 'A4-portrait', 10]
    ];
    for (const [lang, format, n] of wkJobs) {
      const row = await printCase(wk, 'webkit', lang, format, banks[n], 'q');
      record('webkit layout ' + row.tag, row.dom.pages >= 1 && (n === 50 ? row.dom.pages >= 2 : row.dom.pages === 1), 'domPages=' + row.dom.pages + ' brand=' + row.dom.brand);
    }
    const stroke = await printCase(wk, 'webkit', 'en', 'Letter-portrait', [], 'stroke');
    record('webkit stroke ' + stroke.tag, stroke.dom.pages >= 1, 'pages=' + stroke.dom.pages);
    await layoutSweep(wk, 'webkit');
    await wk.close();
  }

  await browser.close();
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, 'test-results.json'), JSON.stringify(results, null, 2));
console.log('\n' + results.length + ' checks, ' + failed.length + ' failed');
if (failed.length) process.exit(1);
