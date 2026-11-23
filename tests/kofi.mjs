/**
 * Ko-fi の応援リンク。言語切り替えの横に、同じ形の短いボタンとして出す。
 * 外部ウィジェットは使わない。印刷したテストには出さない。中国語は繁体字だけ。
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const KOFI = 'https://ko-fi.com/kanjicoffee';
const LABEL = {
  ja: '☕ 応援',
  en: '☕ Support',
  zh: '☕ 贊助'
};
const FULL = {
  ja: '役に立ったらコーヒー1杯で応援 ☕',
  en: 'Enjoying it? Buy me a coffee ☕',
  zh: '覺得好用的話，請我喝杯咖啡 ☕'
};
const SIMPLIFIED = ['觉得好用', '请我喝杯咖啡', '赞助', '☕ 赞助'];

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
  const footer = index.slice(index.indexOf('<footer class="site-footer">'), index.indexOf('</footer>'));
  const header = index.slice(index.indexOf('<header class="topbar">'), index.indexOf('</header>'));

  record('sponsor URL is the Ko-fi page', config.includes("var SPONSOR_URL = '" + KOFI + "'"));
  record(
    'page does not load a Ko-fi widget',
    !/ko-fi\.com\/widgets|kofiwidget|storage\.ko-fi\.com|widget\.ko-fi/i.test(shipped) &&
      !/<script[^>]+src=["'][^"']*ko-fi/i.test(index + changelog)
  );
  record('service worker cache version is 2026-11-23-v1', /const VERSION = '2026-11-23-v1'/.test(sw));

  const links = [...index.matchAll(/<a\b[^>]*data-sponsor-link[^>]*>/g)].map((m) => m[0]);
  record('the main page has one support link', links.length === 1, String(links.length));
  record(
    'the support link opens in a new tab without a referrer',
    links.length === 1 && links[0].includes('href="' + KOFI + '"') &&
      links[0].includes('target="_blank"') && links[0].includes('rel="noopener noreferrer"')
  );
  record(
    'the support link sits in the header beside the language switch',
    header.includes('data-sponsor-link') && header.includes('data-set-lang="en"') &&
      header.indexOf('data-set-lang="en"') < header.indexOf('data-sponsor-link') &&
      !footer.includes('data-sponsor') && !index.includes('preview-sponsor')
  );
  record(
    'the visible label is short and the aria-label is the full sentence',
    header.includes('>' + LABEL.ja + '<') && header.includes('aria-label="' + FULL.ja + '"')
  );
  const printStart = css.indexOf('@media print');
  const printCss = css.slice(printStart, printStart + 900);
  record('print CSS hides the support link', printCss.includes('[data-sponsor]') && printCss.includes('display: none !important'));

  Object.entries(LABEL).forEach(([lang, text]) => {
    record('i18n has the short ' + lang + ' support label', i18n.includes(text));
    record('changelog has the short ' + lang + ' support label', changelog.includes(text));
    record('i18n has the full ' + lang + ' support sentence', i18n.includes(FULL[lang]));
    record('changelog has the full ' + lang + ' support sentence', changelog.includes(FULL[lang]));
  });
  record(
    'support copy stays in Traditional Chinese',
    !SIMPLIFIED.some((text) => (i18n + '\n' + changelog).includes(text))
  );
  record('the print area markup does not include the support link', !/#printArea[^>]*>[\s\S]*ko-fi/i.test(index));
}

async function alignDelta(page, linkSelector, buttonSelector) {
  return page.evaluate(({ linkSelector, buttonSelector }) => {
    function metrics(el) {
      const box = el.getBoundingClientRect();
      const textNode = [...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      const holder = document.createElement('span');
      holder.style.cssText = 'display:inline;line-height:inherit;padding:0;margin:0;border:0';
      textNode.parentNode.insertBefore(holder, textNode);
      holder.appendChild(textNode);
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;padding:0;margin:0;border:0';
      holder.appendChild(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      const text = holder.getBoundingClientRect();
      holder.parentNode.insertBefore(textNode, holder);
      holder.remove();
      const round = (n) => Math.round(n * 100) / 100;
      return { top: round(box.top), bottom: round(box.bottom), textTop: round(text.top), textBottom: round(text.bottom), baseline: round(baseline) };
    }
    const link = document.querySelector(linkSelector);
    const button = document.querySelector(buttonSelector);
    const linkBox = metrics(link);
    const buttonBox = metrics(button);
    const delta = {};
    Object.keys(linkBox).forEach((key) => { delta[key] = Math.round((linkBox[key] - buttonBox[key]) * 100) / 100; });
    const centered = Math.abs((linkBox.baseline - linkBox.top) - (buttonBox.baseline - buttonBox.top)) <= 0.5 &&
      Math.abs((linkBox.bottom - linkBox.top) - (buttonBox.bottom - buttonBox.top)) <= 0.5;
    const sameRow = Math.abs(delta.top) <= 0.5 && Math.abs(delta.bottom) <= 0.5 && Math.abs(delta.baseline) <= 0.5;
    return { centered, sameRow, delta };
  }, { linkSelector, buttonSelector });
}

async function linkFacts(page) {
  return page.evaluate(() => {
    const link = document.querySelector('header a[data-sponsor-link]');
    const button = document.querySelector('.lang-switch [data-set-lang="en"]');
    if (!link || !button) return null;
    const keys = ['fontSize', 'fontWeight', 'fontFamily', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'minHeight', 'borderTopWidth', 'borderTopStyle', 'borderRadius', 'backgroundColor', 'color'];
    const linkCss = getComputedStyle(link);
    const buttonCss = getComputedStyle(button);
    const style = {};
    keys.forEach((key) => { if (linkCss[key] !== buttonCss[key]) style[key] = [buttonCss[key], linkCss[key]]; });
    const print = document.getElementById('printBtn').getBoundingClientRect();
    const box = link.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(link);
    const tops = [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5).map((rect) => rect.top);
    return {
      hidden: link.hidden,
      display: linkCss.display,
      position: linkCss.position,
      href: link.href,
      rel: link.rel,
      target: link.target,
      text: link.textContent.trim(),
      aria: link.getAttribute('aria-label'),
      style,
      wrapped: tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 6,
      printOff: print.right > window.innerWidth + 1 || print.left < 0,
      linkOff: box.right > window.innerWidth + 1 || box.left < 0,
      pageScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      beside: link.closest('.lang-switch') === button.closest('.lang-switch')
    };
  });
}

export async function runKofiChecks({ browser, record, base }) {
  runKofiStaticChecks(record);

  const desktop = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  await page.goto(base);
  await page.waitForSelector('#generateBtn');
  let link = await linkFacts(page);
  record(
    'the Japanese header link matches the language buttons and points at Ko-fi',
    !!link && link.hidden === false && link.display !== 'none' && link.position !== 'fixed' &&
      link.href === KOFI && link.rel === 'noopener noreferrer' && link.target === '_blank' &&
      link.text === LABEL.ja && link.aria === FULL.ja && link.beside === true &&
      Object.keys(link.style).length === 0 && !link.wrapped && !link.printOff && !link.pageScroll,
    JSON.stringify(link)
  );
  let align = await alignDelta(page, 'header a[data-sponsor-link]', '.lang-switch [data-set-lang="en"]');
  record('desktop Japanese support text shares the English button baseline', align.centered && align.sameRow, JSON.stringify(align.delta));

  await page.click('#generateBtn');
  await page.waitForSelector('#printArea .paper', { state: 'attached' });
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => ({
    displays: [...document.querySelectorAll('[data-sponsor]')].map((el) => getComputedStyle(el).display),
    sheet: document.getElementById('printArea').textContent
  }));
  record(
    'support link is absent from the printed test',
    printed.displays.length === 1 && printed.displays[0] === 'none' &&
      !printed.sheet.includes('応援') && !/ko-fi/i.test(printed.sheet),
    printed.displays.join(',')
  );
  await page.emulateMedia({ media: 'screen' });

  await page.click('[data-set-lang="en"]');
  link = await linkFacts(page);
  record(
    'the English header label stays short',
    !!link && link.text === LABEL.en && link.aria === FULL.en && link.hidden === false &&
      !link.wrapped && !link.printOff,
    link ? link.text + ' / ' + link.aria : 'missing'
  );
  align = await alignDelta(page, 'header a[data-sponsor-link]', '.lang-switch [data-set-lang="en"]');
  record('desktop English support text shares the English button baseline', align.centered && align.sameRow, JSON.stringify(align.delta));

  await page.setViewportSize({ width: 390, height: 844 });
  link = await linkFacts(page);
  record(
    'the English header link stays on screen beside Print / PDF',
    !!link && !link.wrapped && !link.printOff && !link.linkOff && !link.pageScroll,
    JSON.stringify(link && { wrapped: link.wrapped, printOff: link.printOff, linkOff: link.linkOff, pageScroll: link.pageScroll })
  );
  align = await alignDelta(page, 'header a[data-sponsor-link]', '.lang-switch [data-set-lang="en"]');
  record('mobile English support text shares the English button baseline', align.centered && align.sameRow, JSON.stringify(align.delta));
  await page.click('[data-set-lang="ja"]');
  await page.setViewportSize({ width: 375, height: 812 });
  link = await linkFacts(page);
  record(
    'the Japanese header link fits a 375px phone',
    !!link && link.text === LABEL.ja && !link.wrapped && !link.printOff && !link.linkOff && !link.pageScroll,
    JSON.stringify(link && { text: link.text, wrapped: link.wrapped, printOff: link.printOff, pageScroll: link.pageScroll })
  );
  align = await alignDelta(page, 'header a[data-sponsor-link]', '.lang-switch [data-set-lang="en"]');
  record('mobile Japanese support text shares the English button baseline', align.centered && align.sameRow, JSON.stringify(align.delta));

  await page.evaluate(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    window.KanjiConfig.applySponsor(document);
  });
  const native = await page.evaluate(() => {
    const el = document.querySelector('header [data-sponsor]');
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
  await logPage.waitForSelector('.cl-langs a[data-sponsor-link]');
  async function changelogLabel() {
    return logPage.evaluate(() => {
      const link = document.querySelector('.cl-langs a[data-sponsor-link]');
      const button = document.querySelector('.cl-lang-btn[data-lang="en"]');
      const linkCss = getComputedStyle(link);
      const buttonCss = getComputedStyle(button);
      const keys = ['fontSize', 'fontWeight', 'paddingTop', 'paddingRight', 'paddingLeft', 'minHeight', 'borderTopWidth', 'borderRadius', 'backgroundColor', 'color'];
      const style = {};
      keys.forEach((key) => { if (linkCss[key] !== buttonCss[key]) style[key] = [buttonCss[key], linkCss[key]]; });
      return {
        hidden: link.hidden,
        href: link.href,
        rel: link.rel,
        target: link.target,
        text: link.textContent.trim(),
        aria: link.getAttribute('aria-label'),
        lang: document.documentElement.lang,
        style
      };
    });
  }
  async function recordChangelogAlign(name) {
    const row = await alignDelta(logPage, '.cl-langs a[data-sponsor-link]', '.cl-lang-btn[data-lang="en"]');
    record(name, row.centered && row.sameRow, JSON.stringify(row.delta));
  }
  const jaLog = await changelogLabel();
  record(
    'changelog shows the short Japanese button beside the languages',
    jaLog.hidden === false && jaLog.href === KOFI && jaLog.rel === 'noopener noreferrer' &&
      jaLog.target === '_blank' && jaLog.text === LABEL.ja && jaLog.aria === FULL.ja &&
      jaLog.lang === 'ja' && Object.keys(jaLog.style).length === 0,
    JSON.stringify(jaLog)
  );
  await recordChangelogAlign('changelog Japanese support text shares the English button baseline');
  await logPage.click('[data-lang="en"]');
  const enLog = await changelogLabel();
  record('changelog shows the short English button', enLog.text === LABEL.en && enLog.aria === FULL.en && enLog.lang === 'en', enLog.text);
  await recordChangelogAlign('changelog English support text shares the English button baseline');
  await logPage.setViewportSize({ width: 390, height: 844 });
  const mobileLog = await alignDelta(logPage, '.cl-langs a[data-sponsor-link]', '.cl-lang-btn[data-lang="en"]');
  record('changelog mobile support text is centered like the English button', mobileLog.centered, JSON.stringify(mobileLog.delta));
  await logPage.click('[data-lang="zh"]');
  const zhLog = await changelogLabel();
  record(
    'changelog shows the Traditional Chinese button',
    zhLog.text === LABEL.zh && zhLog.aria === FULL.zh && zhLog.lang === 'zh-TW' &&
      !SIMPLIFIED.some((text) => (zhLog.text + zhLog.aria).includes(text)),
    zhLog.text + ' / ' + zhLog.aria
  );
  await recordChangelogAlign('changelog Traditional Chinese support text shares the English button baseline');
  await log.close();

  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  const shot = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 });
  const shotPage = await shot.newPage();
  await shotPage.goto(base);
  await shotPage.waitForSelector('header a[data-sponsor-link]');
  await shotPage.locator('.lang-switch').screenshot({ path: '/opt/cursor/artifacts/kofi-align-desktop.png' });
  await shot.close();

  const phone = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const phonePage = await phone.newPage();
  await phonePage.goto(base);
  await phonePage.waitForSelector('header a[data-sponsor-link]');
  await phonePage.locator('.lang-switch').screenshot({ path: '/opt/cursor/artifacts/kofi-align-mobile.png' });
  await phonePage.click('[data-set-lang="en"]');
  await phonePage.locator('.lang-switch').screenshot({ path: '/opt/cursor/artifacts/kofi-align-mobile-en.png' });
  await phone.close();

  const logShot = await browser.newContext({ locale: 'ja-JP', viewport: { width: 800, height: 700 }, deviceScaleFactor: 3 });
  const logShotPage = await logShot.newPage();
  await logShotPage.goto(base.replace('index.html', 'changelog.html'));
  await logShotPage.waitForSelector('.cl-langs a[data-sponsor-link]');
  await logShotPage.locator('.cl-langs').screenshot({ path: '/opt/cursor/artifacts/kofi-align-changelog.png' });
  await logShot.close();
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
