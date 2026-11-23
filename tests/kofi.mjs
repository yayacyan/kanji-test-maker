/**
 * Ko-fi の応援リンク。外部ウィジェットは使わず、画面の言葉だけを出し、印刷には出さない。
 *   node tests/kofi.mjs
 */
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'http://127.0.0.1:8765/index.html';
const ROOT = '/workspace';
const OUT = '/opt/cursor/artifacts';
const KOFI = 'https://ko-fi.com/kanjicoffee';
const JA = '役に立ったらコーヒー1杯で応援 ☕';
const EN = 'Enjoying it? Buy me a coffee ☕';
const ZH = '覺得好用的話，請我喝杯咖啡 ☕';
const MOSS = 'rgb(79, 122, 58)';

function read(name) {
  return readFileSync(new URL('../' + name, import.meta.url), 'utf8');
}

export async function runKofiChecks({ browser, record, base }) {
  mkdirSync(OUT, { recursive: true });
  const pageUrl = base || BASE;

  const index = read('index.html');
  const changelog = read('changelog.html');
  const i18n = read('i18n.js');
  const config = read('config.js');
  const shipped = index + '\n' + changelog + '\n' + i18n + '\n' + config;
  record('ko-fi address is only the plain support link',
    config.includes("SPONSOR_URL = 'https://ko-fi.com/kanjicoffee'") &&
    !/ko-fi\.com\/widgets|storage\.ko-fi\.com|widget_2\.js/i.test(shipped) &&
    !/觉得好用的话|请我喝杯咖啡/.test(shipped),
    '');
  record('sponsor copy exists in ja, en, and traditional chinese',
    i18n.includes(JA) && i18n.includes(EN) && changelog.includes(ZH) && changelog.includes(JA) && changelog.includes(EN),
    '');

  async function open(locale, viewport, extra) {
    const ctx = await browser.newContext({ locale, viewport, deviceScaleFactor: 2, ...(extra || {}) });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page, errors };
  }

  async function links(page) {
    return page.evaluate(() => [...document.querySelectorAll('a[data-sponsor-link]')].map((a) => {
      const row = a.closest('[data-sponsor]');
      const cs = getComputedStyle(a);
      const box = a.getBoundingClientRect();
      return {
        text: a.textContent.trim(),
        href: a.href,
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel'),
        hidden: !!(row && row.hidden),
        display: row ? getComputedStyle(row).display : '',
        color: cs.color,
        position: cs.position,
        shadow: cs.boxShadow,
        bg: cs.backgroundColor,
        inPrint: !!a.closest('#printArea'),
        nearPdf: !!a.closest('.sponsor-near-pdf'),
        inFooter: !!a.closest('footer, .cl-sponsor'),
        w: Math.round(box.width),
        h: Math.round(box.height)
      };
    }));
  }

  async function shot(page, selector, file) {
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const vp = page.viewportSize();
    const x = Math.max(0, box.x - 32);
    const y = Math.max(0, box.y - 150);
    await page.screenshot({
      path: path.join(OUT, file),
      clip: {
        x,
        y,
        width: Math.min(vp.width - x, Math.max(box.width + 64, 360)),
        height: Math.min(vp.height - y, box.height + 230)
      }
    });
  }

  {
    const { ctx, page, errors } = await open('ja-JP', { width: 1440, height: 900 });
    await page.goto(pageUrl);
    await page.waitForSelector('footer a[data-sponsor-link]', { state: 'visible' });
    const shown = await links(page);
    const footer = shown.find((row) => row.inFooter && !row.nearPdf);
    const near = shown.find((row) => row.nearPdf);
    const widgets = await page.evaluate(() => ({
      scripts: [...document.scripts].map((s) => s.src).filter((src) => /ko-fi|kofi/i.test(src)),
      frames: document.querySelectorAll('iframe').length,
      supportHidden: document.getElementById('supportScreen').hidden
    }));
    record('desktop shows the ko-fi link in the footer and beside the pdf hint',
      shown.length === 2 &&
      footer && near &&
      !footer.hidden && footer.display !== 'none' && footer.w > 40 &&
      !near.hidden && near.display !== 'none' && near.w > 40 &&
      [footer, near].every((row) => row.href === KOFI && row.target === '_blank' && row.rel === 'noopener noreferrer' && row.text === JA && row.color === MOSS && row.position === 'static' && row.shadow === 'none' && row.bg === 'rgba(0, 0, 0, 0)' && !row.inPrint) &&
      widgets.scripts.length === 0 && widgets.frames === 0 && widgets.supportHidden === true &&
      errors.length === 0,
      JSON.stringify({ shown, widgets, errors }));
    await shot(page, '.sponsor-near-pdf', 'kofi-desktop-ja.png');
    await page.screenshot({ path: path.join(OUT, 'kofi-desktop-ja-page.png') });

    await page.click('[data-set-lang="en"]');
    await page.waitForFunction((label) => document.querySelector('.sponsor-near-pdf a').textContent.trim() === label, EN);
    const english = await links(page);
    record('english label is used when the language is english',
      english.length === 2 && english.every((row) => row.text === EN && row.href === KOFI),
      english.map((row) => row.text).join(' | '));
    await shot(page, '.sponsor-near-pdf', 'kofi-desktop-en.png');

    await page.click('[data-set-lang="ja"]');
    await page.click('#generateBtn');
    await page.waitForFunction(() => document.querySelectorAll('#printArea .paper').length >= 1, null, { timeout: 30000 });
    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => ({
      displays: [...document.querySelectorAll('[data-sponsor]')].map((el) => getComputedStyle(el).display),
      printText: document.getElementById('printArea').innerText
    }));
    const pdfPath = '/tmp/kofi-print.pdf';
    await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    let pdfText = '';
    try { pdfText = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' }); } catch (error) { pdfText = 'PDFTOTEXT ' + error.message; }
    record('ko-fi link is left out of the printed test',
      printed.displays.length === 2 && printed.displays.every((value) => value === 'none') &&
      !printed.printText.includes('コーヒー') && !printed.printText.includes('ko-fi') &&
      !pdfText.includes('コーヒー') && !pdfText.includes('ko-fi') && !pdfText.includes('Buy me a coffee') && !/PDFTOTEXT/.test(pdfText),
      'displays=' + printed.displays.join(',') + ' pdf=' + JSON.stringify(pdfText.slice(0, 80)));
    await page.emulateMedia({ media: 'screen' });

    await page.evaluate(() => {
      window.KanjiConfig.SPONSOR_URL = '';
      window.KanjiConfig.applySponsor(document);
    });
    const emptied = await page.evaluate(() => ({
      hidden: [...document.querySelectorAll('[data-sponsor]')].every((el) => el.hidden),
      support: document.getElementById('supportScreen').hidden
    }));
    record('clearing the sponsor url hides the link again', emptied.hidden === true && emptied.support === true, JSON.stringify(emptied));
    await page.evaluate(() => {
      window.KanjiConfig.SPONSOR_URL = 'https://example.test/support';
      window.KanjiConfig.applySponsor(document);
    });
    const swapped = await page.evaluate(() => document.querySelector('footer a[data-sponsor-link]').href);
    record('sponsor href follows the configured url', swapped === 'https://example.test/support', swapped);
    await page.evaluate(() => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
      window.KanjiConfig.SPONSOR_URL = 'https://ko-fi.com/kanjicoffee';
      window.KanjiConfig.applySponsor(document);
    });
    const native = await page.evaluate(() => {
      const el = document.querySelector('footer [data-sponsor]');
      return { hidden: el.hidden, display: getComputedStyle(el).display, native: document.documentElement.classList.contains('is-native') };
    });
    record('ko-fi link stays hidden inside the native app',
      native.hidden === true && native.display === 'none' && native.native === true,
      JSON.stringify(native));
    await ctx.close();
  }

  {
    const { ctx, page } = await open('ja-JP', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    await page.goto(pageUrl);
    await page.waitForSelector('footer a[data-sponsor-link]', { state: 'visible' });
    await shot(page, 'footer .sponsor-line', 'kofi-mobile-footer.png');
    await page.click('[data-view="preview"]');
    await page.waitForSelector('.sponsor-near-pdf', { state: 'visible' });
    const preview = await links(page);
    const near = preview.find((row) => row.nearPdf);
    record('phone preview shows the ko-fi link beside the pdf hint',
      near && !near.hidden && near.display !== 'none' && near.text === JA && near.href === KOFI && near.h > 0,
      JSON.stringify(near));
    await shot(page, '.sponsor-near-pdf', 'kofi-mobile-ja.png');
    await page.screenshot({ path: path.join(OUT, 'kofi-mobile-ja-page.png') });
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 800, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(pageUrl.replace('index.html', 'changelog.html'));
    await page.waitForSelector('.cl-sponsor a[data-sponsor-link]', { state: 'visible' });
    async function label() {
      return page.evaluate(() => {
        const a = document.querySelector('.cl-sponsor a[data-sponsor-link]');
        const active = document.querySelector('[data-lang-block].is-active');
        return {
          text: a.textContent.trim(),
          href: a.href,
          rel: a.getAttribute('rel'),
          target: a.getAttribute('target'),
          hidden: document.querySelector('.cl-sponsor').hidden,
          block: active ? active.textContent : ''
        };
      });
    }
    const ja = await label();
    await page.screenshot({ path: path.join(OUT, 'kofi-changelog-ja.png'), clip: { x: 0, y: 0, width: 800, height: 420 } });
    await page.click('[data-lang="en"]');
    await page.waitForFunction((text) => document.querySelector('.cl-sponsor a').textContent.includes(text), EN);
    const en = await label();
    await page.click('[data-lang="zh"]');
    await page.waitForFunction((text) => document.querySelector('.cl-sponsor a').textContent.includes('喝杯咖啡'), ZH);
    const zh = await label();
    await page.screenshot({ path: path.join(OUT, 'kofi-changelog-zh.png'), clip: { x: 0, y: 0, width: 800, height: 420 } });
    record('changelog ko-fi link is localized in ja, en, and traditional chinese',
      ja.hidden === false && ja.href === KOFI && ja.rel === 'noopener noreferrer' && ja.target === '_blank' && ja.text === JA && ja.block.includes('この道具を応援できるようにしました。') &&
      en.text === EN && en.block.includes('You can now support this tool.') &&
      zh.text === ZH && zh.block.includes('現在可以贊助這個工具。') && !zh.block.includes('赞助') && !zh.text.includes('请'),
      JSON.stringify({ ja: ja.text, en: en.text, zh: zh.text }));
    await ctx.close();
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
    await runKofiChecks({ browser, record, base: BASE });
    await browser.close();
  } finally {
    server.kill();
  }
  const failed = results.filter((row) => !row.ok);
  console.log('\n' + results.length + ' checks, ' + failed.length + ' failed');
  if (failed.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
