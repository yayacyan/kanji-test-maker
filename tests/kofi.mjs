/**
 * Ko-fi の応援リンク。外部ウィジェットは使わず、画面の言葉だけを出す。
 * 印刷したテストには出さない。中国語は繁体字だけ。
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const KOFI = 'https://ko-fi.com/kanjicoffee';
const LABEL = {
  ja: '役に立ったらコーヒー1杯で応援 ☕',
  en: 'Enjoying it? Buy me a coffee ☕',
  zh: '覺得好用的話，請我喝杯咖啡 ☕'
};
const SIMPLIFIED = ['觉得好用', '请我喝杯咖啡', '赞助一下'];

function read(name) {
  return readFileSync(new URL(name, ROOT), 'utf8');
}

export function runKofiStaticChecks(record) {
  const config = read('config.js');
  const i18n = read('i18n.js');
  const index = read('index.html');
  const changelog = read('changelog.html');
  const css = read('styles.css');
  const sw = read('sw.js');
  const shipped = [config, i18n, index, changelog, css, sw, read('app.js')].join('\n');

  record('sponsor URL is the Ko-fi page', config.includes("var SPONSOR_URL = '" + KOFI + "'"));
  record(
    'page does not load a Ko-fi widget',
    !/ko-fi\.com\/widgets|kofiwidget|storage\.ko-fi\.com|widget\.ko-fi/i.test(shipped) &&
      !/<script[^>]+src=["'][^"']*ko-fi/i.test(index + changelog)
  );
  record('service worker cache version is 2026-11-23-v1', /const VERSION = '2026-11-23-v1'/.test(sw));

  const links = [...index.matchAll(/<a\b[^>]*data-sponsor-link[^>]*>/g)].map((m) => m[0]);
  record('the main page has two plain support links', links.length === 2, String(links.length));
  record(
    'support links open in a new tab without a referrer',
    links.length === 2 && links.every((tag) => (
      tag.includes('href="' + KOFI + '"') &&
      tag.includes('target="_blank"') &&
      tag.includes('rel="noopener noreferrer"')
    ))
  );
  const footer = index.slice(index.indexOf('<footer class="site-footer">'), index.indexOf('</footer>'));
  record(
    'one link sits in the footer and one sits by the PDF hint',
    index.indexOf('class="sponsor-line preview-sponsor"') !== -1 &&
      index.indexOf('class="sponsor-line preview-sponsor"') < index.indexOf('id="sheetViewport"') &&
      footer.includes('data-sponsor-link')
  );
  const printStart = css.indexOf('@media print');
  const printCss = css.slice(printStart, printStart + 900);
  record('print CSS hides the support link', printCss.includes('[data-sponsor]') && printCss.includes('display: none !important'));

  Object.entries(LABEL).forEach(([lang, text]) => {
    record('i18n has the ' + lang + ' support label', i18n.includes(text));
    record('changelog has the ' + lang + ' support label', changelog.includes(text));
  });
  record(
    'support copy stays in Traditional Chinese',
    !SIMPLIFIED.some((text) => (i18n + '\n' + changelog).includes(text))
  );
  record('the print area markup does not include the support link', !/#printArea[^>]*>[\s\S]*ko-fi/i.test(index));
}

async function linkFacts(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[data-sponsor-link]')].map((a) => {
    const box = a.closest('[data-sponsor]');
    const cs = getComputedStyle(a);
    const boxCs = getComputedStyle(box);
    return {
      hidden: box.hidden,
      display: boxCs.display,
      position: cs.position,
      href: a.href,
      rel: a.rel,
      target: a.target,
      text: a.textContent.trim(),
      color: cs.color
    };
  }));
}

export async function runKofiChecks({ browser, record, base }) {
  runKofiStaticChecks(record);

  const desktop = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  await page.goto(base);
  await page.waitForSelector('#generateBtn');
  let links = await linkFacts(page);
  const moss = 'rgb(79, 122, 58)';
  record(
    'Japanese support links are visible and point at Ko-fi',
    links.length === 2 && links.every((link) => (
      link.hidden === false &&
      link.display !== 'none' &&
      link.position !== 'fixed' &&
      link.href === KOFI &&
      link.rel === 'noopener noreferrer' &&
      link.target === '_blank' &&
      link.text === LABEL.ja &&
      link.color === moss
    )),
    JSON.stringify(links)
  );

  await page.click('#generateBtn');
  await page.waitForSelector('#printArea .paper', { state: 'attached' });
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => ({
    displays: [...document.querySelectorAll('[data-sponsor]')].map((el) => getComputedStyle(el).display),
    sheet: document.getElementById('printArea').textContent
  }));
  record(
    'support link is absent from the printed test',
    printed.displays.length === 2 && printed.displays.every((value) => value === 'none') &&
      !printed.sheet.includes('コーヒー') && !/ko-fi/i.test(printed.sheet),
    printed.displays.join(',')
  );
  await page.emulateMedia({ media: 'screen' });

  await page.click('[data-set-lang="en"]');
  links = await linkFacts(page);
  record(
    'English support label replaces the Japanese one',
    links.length === 2 && links.every((link) => link.text === LABEL.en && link.hidden === false),
    links.map((link) => link.text).join(' | ')
  );

  await page.evaluate(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    window.KanjiConfig.applySponsor(document);
  });
  const native = await page.evaluate(() => {
    const el = document.querySelector('footer [data-sponsor]');
    return {
      hidden: el.hidden,
      display: getComputedStyle(el).display,
      native: document.documentElement.classList.contains('is-native'),
      support: document.getElementById('supportScreen').hidden
    };
  });
  record(
    'support link stays hidden inside the native app',
    native.hidden === true && native.display === 'none' && native.native === true && native.support === true,
    JSON.stringify(native)
  );
  await desktop.close();

  const cleared = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 800 } });
  const clearedPage = await cleared.newPage();
  await clearedPage.goto(base);
  await clearedPage.waitForSelector('#generateBtn');
  await clearedPage.evaluate(() => {
    window.KanjiConfig.SPONSOR_URL = '   ';
    window.KanjiConfig.applySponsor(document);
  });
  const empty = await clearedPage.evaluate(() => ({
    hidden: [...document.querySelectorAll('[data-sponsor]')].every((el) => el.hidden),
    support: document.getElementById('supportScreen').hidden
  }));
  record('an empty sponsor URL hides the link again', empty.hidden === true && empty.support === true, JSON.stringify(empty));
  await cleared.close();

  const log = await browser.newContext({ locale: 'ja-JP', viewport: { width: 800, height: 700 } });
  const logPage = await log.newPage();
  await logPage.goto(base.replace('index.html', 'changelog.html'));
  await logPage.waitForSelector('.cl-sponsor a');
  async function changelogLabel() {
    return logPage.evaluate(() => {
      const link = document.querySelector('.cl-sponsor a');
      return {
        hidden: document.querySelector('.cl-sponsor').hidden,
        href: link.href,
        rel: link.rel,
        target: link.target,
        text: link.textContent.trim(),
        lang: document.documentElement.lang
      };
    });
  }
  const jaLog = await changelogLabel();
  record(
    'changelog shows the Japanese Ko-fi link',
    jaLog.hidden === false && jaLog.href === KOFI && jaLog.rel === 'noopener noreferrer' &&
      jaLog.target === '_blank' && jaLog.text === LABEL.ja && jaLog.lang === 'ja',
    JSON.stringify(jaLog)
  );
  await logPage.click('[data-lang="en"]');
  const enLog = await changelogLabel();
  record('changelog shows the English Ko-fi link', enLog.text === LABEL.en && enLog.lang === 'en', enLog.text);
  await logPage.click('[data-lang="zh"]');
  const zhLog = await changelogLabel();
  record(
    'changelog shows the Traditional Chinese Ko-fi link',
    zhLog.text === LABEL.zh && zhLog.lang === 'zh-TW' && !SIMPLIFIED.some((text) => zhLog.text.includes(text)),
    zhLog.text + ' lang=' + zhLog.lang
  );
  await log.close();

  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  const shot = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const shotPage = await shot.newPage();
  await shotPage.goto(base);
  await shotPage.waitForSelector('.preview-sponsor a');
  await shotPage.locator('.preview-sponsor').scrollIntoViewIfNeeded();
  await shotPage.screenshot({ path: '/opt/cursor/artifacts/kofi-desktop.png' });
  await shotPage.locator('footer .sponsor-line').scrollIntoViewIfNeeded();
  await shotPage.screenshot({ path: '/opt/cursor/artifacts/kofi-desktop-footer.png' });
  await shot.close();

  const phone = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const phonePage = await phone.newPage();
  await phonePage.goto(base);
  await phonePage.waitForSelector('#generateBtn');
  await phonePage.click('[data-view="preview"]');
  await phonePage.waitForSelector('.preview-sponsor a', { state: 'visible' });
  await phonePage.locator('.preview-sponsor').scrollIntoViewIfNeeded();
  await phonePage.screenshot({ path: '/opt/cursor/artifacts/kofi-mobile.png' });
  await phonePage.click('[data-view="edit"]');
  await phonePage.locator('footer .sponsor-line').scrollIntoViewIfNeeded();
  await phonePage.screenshot({ path: '/opt/cursor/artifacts/kofi-mobile-footer.png' });
  await phone.close();
}

async function standalone() {
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail || '' });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  };
  runKofiStaticChecks(record);
  const failed = results.filter((row) => !row.ok);
  console.log('\n' + results.length + ' checks, ' + failed.length + ' failed');
  if (failed.length) process.exit(1);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) standalone();
