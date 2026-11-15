/**
 * PR-A の画面テスト。站内 OCR がないこと、三步、一つの貼り付け欄、印、学年。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const ARTIFACTS = '/opt/cursor/artifacts';

export async function runPrAChecks({ browser, record, base }) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 430, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector('#generateBtn');
  await page.click('[data-goto="import"]');
  await page.waitForSelector('#aiPrivacy');

  const absent = await page.evaluate(() => ({
    provider: !!document.getElementById('ocrProvider'),
    vertical: !!document.getElementById('ocrVertical'),
    camera: !!document.getElementById('ocrCameraBtn'),
    imageInputs: document.querySelectorAll('input[type="file"][accept*="image"]').length,
    body: document.body.innerText
  }));
  record('the page has no in-browser photo reader',
    !absent.provider && !absent.vertical && !absent.camera && absent.imageInputs === 0 &&
    !absent.body.includes('読み取りが完了') && !absent.body.includes('デモ（サンプル') && !absent.body.includes('縦書きの写真'),
    JSON.stringify({ provider: absent.provider, vertical: absent.vertical, camera: absent.camera, imageInputs: absent.imageInputs }));

  const boxes = await page.evaluate(() => [...document.querySelectorAll('textarea')]
    .filter((el) => !el.readOnly && el.id !== 'customSentence' && el.id !== 'strokeText')
    .map((el) => el.id));
  record('there is one paste box', boxes.length === 1 && boxes[0] === 'pasteText', boxes.join(','));

  const flow = await page.evaluate(() => {
    const privacy = document.getElementById('aiPrivacy');
    const copy = document.getElementById('copyPromptBtn');
    const gpt = document.getElementById('openChatGpt');
    const gemini = document.getElementById('openGemini');
    const cs = getComputedStyle(privacy);
    const prompt = document.getElementById('aiPromptText').value;
    return {
      beforeCopy: !!(privacy.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING),
      beforeGpt: !!(privacy.compareDocumentPosition(gpt) & Node.DOCUMENT_POSITION_FOLLOWING),
      shown: cs.display !== 'none' && privacy.hidden === false && document.getElementById('tool-import').open && !privacy.closest('.mini-details'),
      text: privacy.textContent,
      gpt: gpt.href,
      gemini: gemini.href,
      gptTarget: gpt.target,
      geminiTarget: gemini.target,
      prompt
    };
  });
  record('privacy is visible before copying or opening an AI',
    flow.beforeCopy && flow.beforeGpt && flow.shown &&
    flow.text.includes('サーバーには送られません') && flow.text.includes('ChatGPT') && flow.text.includes('Gemini'),
    flow.text.slice(0, 80));
  record('the buttons open only the official sites',
    flow.gpt === 'https://chatgpt.com/' && flow.gemini === 'https://gemini.google.com/' &&
    flow.gptTarget === '_blank' && flow.geminiTarget === '_blank',
    flow.gpt + ' ' + flow.gemini);
  record('the photo prompt refuses handwriting and red ink',
    flow.prompt.includes('印刷') && flow.prompt.includes('手書き') && flow.prompt.includes('赤') && !/api[_-]?key/i.test(flow.prompt));

  const moss = await page.evaluate(() => getComputedStyle(document.getElementById('pasteAddBtn')).backgroundColor);
  record('the main button stays moss green', moss === 'rgb(79, 122, 58)', moss);

  await page.addStyleTag({ content: '.topbar{position:static !important} .view-tabs{position:static !important}' });
  await page.locator('#tool-import').screenshot({ path: path.join(ARTIFACTS, 'pr-a-create-flow.png') });

  await page.click('[data-prompt-mode="write"]');
  const writePrompt = await page.locator('#aiPromptText').inputValue();
  record('the write prompt does not ask for a photo', !writePrompt.includes('手書き') && writePrompt.includes('漢字（よみ）／例文'));
  await page.click('[data-prompt-mode="photo"]');

  const sample = await page.evaluate(() => {
    const budget = window.KanjiImport.columnBudget({ format: 'A4-portrait', questionCount: 4, headMm: 22 });
    return [
      '客（きゃく）／お客さん',
      '客（きゃく）／お客さん',
      '### メモ',
      '旅（たび）／' + 'あ'.repeat(budget + 12)
    ].join('\n');
  });
  await page.fill('#pasteText', sample);
  await page.waitForSelector('#pastePreview .ip-flag');
  const review = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#pastePreview .ip-item')].map((row) => ({
      text: row.innerText.replace(/\s+/g, ' ').slice(0, 160),
      flags: [...row.querySelectorAll('.ip-flag')].map((el) => el.textContent),
      checked: row.querySelector('input') ? row.querySelector('input').checked : null,
      flagged: row.classList.contains('is-flagged')
    }));
    const firstClean = rows.findIndex((row) => !row.flagged);
    return { rows, firstClean, flagsFirst: firstClean === -1 || rows.slice(0, firstClean).every((row) => row.flagged) };
  });
  record('flagged rows come first and are not checked',
    review.flagsFirst && review.rows.some((row) => row.flags.includes('重複') && row.checked === false) &&
    review.rows.some((row) => row.flags.includes('形式') && row.checked !== true) &&
    review.rows.some((row) => row.flags.includes('長すぎ') && row.checked === false) &&
    review.rows.some((row) => row.text.includes('小3') && row.checked === true),
    JSON.stringify(review.rows));

  await page.addStyleTag({ content: '.ip-list{max-height:none}' });
  await page.locator('#pastePreview').screenshot({ path: path.join(ARTIFACTS, 'pr-a-import-review.png') });

  await page.click('#pasteAddBtn');
  await page.waitForFunction(() => document.querySelectorAll('#questionList .question-item').length === 1);
  const added = await page.evaluate(() => {
    const card = document.querySelector('#questionList .question-item');
    return { n: document.querySelectorAll('#questionList .question-item').length, text: card ? card.innerText : '' };
  });
  record('only the clean row is added, with grade 3',
    added.n === 1 && added.text.includes('客') && added.text.includes('小3') && !added.text.includes('—'),
    added.text.replace(/\s+/g, ' ').slice(0, 120));

  await page.click('[data-goto="custom"]');
  const custom = await page.evaluate(() => ({
    paste: !!document.getElementById('pasteText'),
    bulk: !!document.getElementById('bulkText'),
    opener: document.getElementById('openPasteBtn').textContent
  }));
  record('your own questions still reach the same paste box',
    custom.paste && !custom.bulk && custom.opener.includes('貼り付け'), JSON.stringify(custom));
  await page.click('#openPasteBtn');
  await page.waitForFunction(() => document.getElementById('tool-import').open && document.activeElement && document.activeElement.id === 'pasteText');

  await page.click('[data-set-lang="en"]');
  const english = await page.locator('#aiPrivacy').innerText();
  record('english privacy names the AI and this site',
    /not sent to this site/i.test(english) && /ChatGPT/.test(english) && /Gemini/.test(english),
    english.slice(0, 80));

  record('the create flow has no page errors', errors.length === 0, errors.join('; '));
  await ctx.close();
}
