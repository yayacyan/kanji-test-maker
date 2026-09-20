/*
 * import.js — テキスト／JSON／OCR からの題目取り込み（画面に依存しない部品）
 *
 * - parseBulk(text, { type, source })  … 貼り付けテキスト・AI出力・OCR結果を題目の配列にする
 * - runOcr(file, provider, hooks, opts) … OCR プロバイダーのアダプター。
 *     OCR_PROVIDERS に { label, run(file, hooks, opts) → { text } } を足せば、
 *     Google Cloud Vision や自前サーバーなど別の OCR にも差し替えられる。
 */
(function (global) {
  'use strict';

  const TYPES = ['kaki', 'yomi', 'sentence', 'okuri', 'mas', 'trace', 'free'];
  const TYPE_LABELS = {
    kaki: '書き（線のひらがな）',
    yomi: '読み（線の漢字）',
    sentence: '書き（文中の□）',
    okuri: '送りがな',
    mas: '練習マス',
    trace: 'なぞり書き',
    free: '自由入力'
  };
  const STYLES = ['mas', 'kakko', 'line'];
  const STYLE_LABELS = { mas: 'マス', kakko: 'かっこ', line: '線' };

  const TYPE_ALIASES = {
    kaki: 'kaki', write: 'kaki', writing: 'kaki', '書き': 'kaki', '書き問題': 'kaki', '書': 'kaki', '書き（線のひらがな）': 'kaki',
    yomi: 'yomi', read: 'yomi', reading: 'yomi', '読み': 'yomi', '読み問題': 'yomi', '読': 'yomi', '読み（線の漢字）': 'yomi',
    sentence: 'sentence', ana: 'sentence', blank: 'sentence', fill: 'sentence', '例文穴埋め': 'sentence', '穴埋め': 'sentence',
    '書き（文中の□）': 'sentence', '文中': 'sentence',
    okuri: 'okuri', okurigana: 'okuri', '送りがな': 'okuri', '送り仮名': 'okuri', '送り': 'okuri',
    mas: 'mas', practice: 'mas', '練習マス': 'mas', '練習': 'mas',
    trace: 'trace', 'なぞり書き': 'trace', 'なぞり': 'trace',
    free: 'free', '自由入力': 'free', '自由': 'free'
  };
  const STYLE_ALIASES = {
    mas: 'mas', box: 'mas', 'マス': 'mas',
    kakko: 'kakko', bracket: 'kakko', paren: 'kakko', 'かっこ': 'kakko', '括弧': 'kakko',
    line: 'line', '線': 'line'
  };

  const RE_HAS_KANJI = /[一-鿿々]/;
  const RE_KANA_ONLY = /^[ぁ-ゖァ-ヺー]+$/;
  const RE_BLANK = /[（(][\s　]*[）)]|[＿_]{2,}|[□■]+/;
  const RE_KANJI_TOKEN = /^[一-鿿々]+[ぁ-ゖ]{0,4}$/;

  function normType(value) {
    if (!value) return null;
    return TYPE_ALIASES[String(value).trim().toLowerCase()] || TYPE_ALIASES[String(value).trim()] || null;
  }
  function normStyle(value) {
    if (!value) return 'mas';
    return STYLE_ALIASES[String(value).trim().toLowerCase()] || STYLE_ALIASES[String(value).trim()] || 'mas';
  }

  /**
   * 送りがな問題の分解：「借りる」→ { stem:'借', okuri:'りる' }。漢字＋かな（1〜4字）の語だけが対象。
   * 「一つ」「大きい」のように、漢字のあとにかなが続く語は、答えはかなの部分だけになる。
   */
  function okuriParts(word) {
    const m = String(word || '').trim().match(/^([一-鿿々]+)([ぁ-ゖ]{1,4})$/);
    return m ? { stem: m[1], okuri: m[2] } : null;
  }

  /** 題型ごとの「答え」の既定値（先生が空欄にしたとき自動で入る） */
  function defaultAnswer(q, type) {
    switch (type || q.type) {
      case 'yomi': return q.reading || '';
      case 'free': return q.answer || '';
      case 'okuri': { const p = okuriParts(q.kanji); return p ? p.okuri : (q.kanji || ''); }
      default: return q.kanji || '';
    }
  }

  function hasBlank(sentence) { return RE_BLANK.test(sentence || ''); }
  /** 例文中の空欄（　）を答えで埋めて、「例文には必ず答えが入っている」形にそろえる */
  function fillBlank(sentence, fill) {
    return fill && RE_BLANK.test(sentence || '') ? sentence.replace(RE_BLANK, fill) : sentence;
  }

  /** 1題ぶんの入力ミスを、画面に「⚠」で出すための警告リスト */
  function checkQuestion(q) {
    const warns = [];
    const sentence = q.sentence || '';
    if (/[／|｜]/.test(sentence)) warns.push('例文に「／」が残っています（よみがなや答えとの区切りを間違えていないか、確認してください）');
    const hasBlank = RE_BLANK.test(sentence);
    const inSentence = !!q.kanji && sentence.includes(q.kanji);
    if (q.type === 'kaki') {
      if (!q.kanji && !hasBlank) warns.push('漢字が空です');
      if (!q.reading) warns.push('よみがなが空です（書き問題は、例文の中のひらがなを漢字に直す問題です）');
      if (q.kanji && sentence && !inSentence && !hasBlank) warns.push('例文に「' + q.kanji + '」が含まれていません');
    } else if (q.type === 'yomi') {
      if (!q.kanji) warns.push('漢字が空です');
      if (!q.answer && !q.reading) warns.push('読みが空です');
      if (q.kanji && sentence && !inSentence) warns.push('例文に「' + q.kanji + '」が含まれていません（漢字だけを出題します）');
    } else if (q.type === 'sentence') {
      if (!sentence) warns.push('例文が空です');
      else if (!inSentence && !hasBlank) warns.push('例文に「' + (q.kanji || '答え') + '」が含まれていません');
    } else if (q.type === 'okuri') {
      if (!okuriParts(q.kanji)) warns.push('送りがな問題は「借りる」のように、漢字のあとにひらがなが続く語を入れてください');
      if (!q.reading) warns.push('よみがなが空です');
      if (q.kanji && sentence && !inSentence) warns.push('例文に「' + q.kanji + '」が含まれていません');
    } else if (q.type === 'mas' || q.type === 'trace') {
      if (!q.kanji) warns.push('漢字が空です');
    } else if (q.type === 'free') {
      if (!sentence) warns.push('問題文が空です');
    }
    return warns;
  }

  // ---- 1 行のパース ---------------------------------------------------------

  const RE_NUMBERING = /^\s*(?:[①-⑳㉑-㉟❶-❿]|[（(]?[0-9０-９]{1,2}[)）]|[0-9０-９]{1,2}\s*[.．、:：)）]|問\s*[0-9０-９]+\s*[.．:：]?|[・●○◯■□▪・]\s)\s*/;

  function stripNumbering(line) {
    return line.replace(RE_NUMBERING, '');
  }

  function makeItem(fields, opts) {
    let kanji = (fields.kanji || '').trim();
    let reading = (fields.reading || '').trim();
    let sentence = (fields.sentence || '').trim();
    let grade = fields.grade;
    let enriched = false;

    // 漢字だけ（または読みだけ）の入力は、題庫（opts.lookup）から読みと例文を自動で補う
    let note = '';
    if (opts.lookup && kanji && (!reading || !sentence)) {
      const entry = opts.lookup(kanji);
      if (!entry && !reading && !sentence && RE_HAS_KANJI.test(kanji)) {
        note = '「' + kanji + '」は小学校の漢字の問題データにないため、よみがな・例文は入りません（手入力できます）。';
      }
      if (entry) {
        if (sentence) {
          if (sentence.includes(entry.word) && !reading) {
            kanji = entry.word;
            reading = entry.reading;
            enriched = true;
          }
        } else if (!reading || reading === entry.reading) {
          kanji = entry.word;
          reading = entry.reading;
          sentence = entry.sentence;
          enriched = true;
        }
        if (enriched && (grade === undefined || grade === null || grade === '')) grade = entry.grade;
      }
    }
    let type = normType(fields.type);
    if (!type) {
      if (opts.type && opts.type !== 'auto') type = opts.type;
      else if (kanji && reading && sentence) type = 'kaki';
      else if (kanji && sentence) type = 'sentence';
      else if (kanji && reading) type = 'yomi';
      else if (kanji) type = 'mas';
      else type = 'free';
    }
    const item = {
      type,
      grade: grade === undefined || grade === null || grade === '' ? '' : Number(grade) || '',
      kanji,
      reading,
      sentence,
      answer: '',
      style: normStyle(fields.style),
      source: opts.source || 'paste'
    };
    item.answer = (fields.answer !== undefined && fields.answer !== null && String(fields.answer).trim() !== '')
      ? String(fields.answer).trim()
      : defaultAnswer(item, type);
    item._enriched = enriched;
    if (note) item._note = note;
    return item;
  }

  /** 戻り値: { items: [{...}], weak?: true } もしくは { skip: '理由' } */
  function parseLine(rawLine, opts) {
    let line = rawLine.replace(/^﻿/, '').trim();
    if (!line) return null;
    if (/^```/.test(line)) return null;
    line = stripNumbering(line).trim();
    if (!line) return null;
    // 表計算から貼ったときの見出し行（漢字,よみ,例文）は題目にしない
    if (/^(漢字|語|単語)[\s　,，、\t|｜]+(よみ|読み|ふりがな|読み方)/.test(line)) return { skip: '見出し行' };
    if (/^[#＃※*＊=＝]/.test(line)) return { skip: 'メモ・見出しの行' };

    // 1) 例文（　）|答え   /   例文|答え   /   漢字|よみ|例文
    if (/[|｜]/.test(line)) {
      const parts = line.split(/\s*[|｜]\s*/).map((s) => s.trim());
      const a = parts[0];
      const b = parts[1];
      const c = parts[2] || '';
      if (a && b) {
        if (RE_BLANK.test(a)) {
          // 案内にある「花の（　）が出る。|芽」は、□に書く問題（種類を選んでいないとき）
          return { items: [makeItem({ kanji: b, reading: RE_KANA_ONLY.test(c) ? c : '', sentence: a.replace(RE_BLANK, b), answer: b, type: !opts.type || opts.type === 'auto' ? 'sentence' : '' }, opts)] };
        }
        if (a.includes(b)) {
          return { items: [makeItem({ kanji: b, reading: RE_KANA_ONLY.test(c) ? c : '', sentence: a, answer: b }, opts)] };
        }
        if (RE_HAS_KANJI.test(a) && RE_KANA_ONLY.test(b) && a.length <= 8) {
          return { items: [makeItem({ kanji: a, reading: b, sentence: c }, opts)] };
        }
        return { items: [makeItem({ kanji: b, sentence: a, answer: b }, opts)] };
      }
    }

    // 2) 例文に空欄だけ（答えなし）
    if (RE_BLANK.test(line)) {
      return { items: [makeItem({ sentence: line, type: 'sentence' }, opts)], weak: true };
    }

    // 3-0) 送りがな付き「借（か）りる／例文」：かなが（読み）の外に出ている書き方も、「借りる／かりる」として受ける
    let m = line.match(/^([\u4e00-\u9fff々]+)\s*[（(]\s*([ぁ-ゖ]+)\s*[）)]\s*([ぁ-ゖ]{1,4})\s*(?:プア|[／/\\|｜丿ノ]{1,2})\s*(.+)$/);
    if (m) {
      return { items: [makeItem({ kanji: m[1] + m[3], reading: m[2] + m[3], sentence: m[4] }, opts)] };
    }

    // 3) 漢字（よみ）／例文
    // 区切りは「／」のほか、OCR が読み違えやすい「/ \\ | ノ 丿」も許す
    m = line.match(/^(.+?)\s*[（(]\s*([^（()）]+?)\s*[）)]\s*(?:プア|[／/\\|｜丿ノ]{1,2})\s*(.+)$/);
    if (m && RE_KANA_ONLY.test(m[2])) {
      return { items: [makeItem({ kanji: m[1], reading: m[2], sentence: m[3] }, opts)] };
    }
    // 区切りなし「巣（す）くもの巣がはる。」：漢字だけの見出し語＋読み＋その語を含む例文
    m = line.match(/^([\u4e00-\u9fff々]+[\u3041-\u3096]{0,3})\s*[（(]\s*([^（()）]+?)\s*[）)]\s*(.+)$/);
    if (m && RE_KANA_ONLY.test(m[2]) && m[3].includes(m[1])) {
      const item = makeItem({ kanji: m[1], reading: m[2], sentence: m[3] }, opts);
      const junk = m[3].match(/^([ァ-ヶノ丿]{1,2})(?=[ぁ-ゖ一-鿿])/);
      if (junk) {
        item._note = '例文の先頭の「' + junk[1] + '」は、「／」の読み間違いかもしれません。確認してください。';
        return { items: [item], weak: true };
      }
      return { items: [item] };
    }
    // 漢字（よみ）だけ
    m = line.match(/^(.+?)\s*[（(]\s*([^（()）]+?)\s*[）)]\s*$/);
    if (m && RE_KANA_ONLY.test(m[2]) && RE_HAS_KANJI.test(m[1]) && m[1].length <= 8) {
      return { items: [makeItem({ kanji: m[1], reading: m[2] }, opts)] };
    }

    // 4) 漢字,よみ,例文 / 漢字、読み、例文 / タブ区切り
    m = line.match(/^([^,，、\t]+?)\s*[,，、\t]\s*([^,，、\t]+?)(?:\s*[,，、\t]\s*(.+))?$/);
    if (m && RE_HAS_KANJI.test(m[1]) && m[1].length <= 8 && RE_KANA_ONLY.test(m[2])) {
      return { items: [makeItem({ kanji: m[1], reading: m[2], sentence: m[3] || '' }, opts)] };
    }
    // 空白区切り「巣 す くもの巣がはる。」
    m = line.match(/^(\S+)[ 　]+([ぁ-ゖァ-ヺー]+)(?:[ 　]+(.+))?$/);
    if (m && RE_HAS_KANJI.test(m[1]) && m[1].length <= 8) {
      return { items: [makeItem({ kanji: m[1], reading: m[2], sentence: m[3] || '' }, opts)] };
    }

    // 5) 漢字だけの一覧（空白・読点・中黒区切り）
    const tokens = line.split(/[\s　、,，・／/]+/).filter(Boolean);
    if (tokens.length && tokens.every((t) => RE_KANJI_TOKEN.test(t) && t.length <= 8)) {
      const items = [];
      tokens.forEach((t) => {
        const onlyKanji = /^[\u4e00-\u9fff々]+$/.test(t);
        // 「巣歩観」のように区切りなしで並んだ、題庫にない語は1字ずつに分ける
        if (opts.lookup && onlyKanji && t.length >= 2 && !opts.lookup(t) && Array.from(t).every((c) => opts.lookup(c))) {
          Array.from(t).forEach((c) => {
            const item = makeItem({ kanji: c }, opts);
            item._note = '「' + t + '」を1字ずつに分けました。熟語として使うときは、1語だけで入力してください。';
            items.push(item);
          });
        } else {
          items.push(makeItem({ kanji: t }, opts));
        }
      });
      return { items };
    }

    // 6) 文だけ（かな・漢字を含む）
    if (/[ぁ-ゖァ-ヺ一-鿿]/.test(line)) {
      return { items: [makeItem({ sentence: line, type: 'free' }, opts)], weak: true };
    }
    return { skip: '読み取れない行' };
  }

  // ---- JSON ------------------------------------------------------------------

  function stripFences(text) {
    return text
      .replace(/^\s*```[a-zA-Z]*\s*$/gm, '')
      .trim();
  }

  function parseJsonText(text, opts) {
    let data;
    const body = text;
    try {
      data = JSON.parse(body);
    } catch (e) {
      try {
        data = JSON.parse(body.replace(/,\s*([\]}])/g, '$1'));
      } catch (e2) {
        return { items: [], skipped: [], error: 'JSON の形式が正しくありません（' + e2.message + '）' };
      }
    }
    if (!Array.isArray(data)) data = data.questions || data.items || data.data || [data];
    const items = [];
    const skipped = [];
    data.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') { skipped.push({ line: '#' + (index + 1), reason: '題目ではありません' }); return; }
      const fields = {
        type: raw.type || raw.kind,
        grade: raw.grade,
        kanji: raw.kanji || raw.word || raw['漢字'],
        reading: raw.reading || raw.yomi || raw['よみ'] || raw['読み'],
        sentence: raw.sentence || raw.example || raw['例文'],
        answer: raw.answer || raw['答え'],
        style: raw.style
      };
      if (!fields.kanji && !fields.sentence) { skipped.push({ line: '#' + (index + 1), reason: 'kanji も sentence もありません' }); return; }
      const item = makeItem(fields, opts);
      item._line = 'json#' + (index + 1);
      items.push(item);
    });
    return { items, skipped };
  }

  // ---- まとめ ----------------------------------------------------------------

  /**
   * テキスト全体を解析する。
   * 戻り値: { items: [{ ...題目, _line, _weak }], skipped: [{line, reason}], error? }
   */
  function parseBulk(text, options) {
    const opts = Object.assign({ type: 'auto', source: 'paste' }, options || {});
    const cleaned = stripFences(String(text || ''));
    if (!cleaned) return { items: [], skipped: [] };

    if (/^[\[{]/.test(cleaned)) {
      return parseJsonText(cleaned, opts);
    }

    const items = [];
    const skipped = [];
    cleaned.split(/\r?\n/).forEach((rawLine) => {
      const parsed = parseLine(rawLine, opts);
      if (!parsed) return;
      if (parsed.skip) { skipped.push({ line: rawLine.trim(), reason: parsed.skip }); return; }
      parsed.items.forEach((item) => {
        item._line = rawLine.trim();
        item._weak = !!parsed.weak;
        items.push(item);
      });
    });
    return { items, skipped };
  }

  // ---- OCR アダプター --------------------------------------------------------

  /** 日本語は認識結果の文字間に空白が入りやすいので、かなを含む行だけ詰める。 */
  function cleanOcrText(text) {
    const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff々ー（）()／/、。！？「」『』・,，|｜';
    const re = new RegExp('([' + CJK + '])[ \\t\\u3000]+(?=[' + CJK + '])', 'g');
    return String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => {
        line = line.trim();
        if (/[ぁ-ゖァ-ヺ]/.test(line)) {
          let prev;
          do { prev = line; line = line.replace(re, '$1'); } while (line !== prev);
        }
        return line;
      })
      .filter(Boolean)
      .join('\n');
  }

  /** 大きな写真は長辺 2000px に縮めてから OCR に渡す（スマホ写真は重いため）。失敗したら元のまま。 */
  async function prepareImage(file) {
    try {
      if (!global.createImageBitmap) return file;
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const longest = Math.max(bitmap.width, bitmap.height);
      if (longest <= 2000) { bitmap.close && bitmap.close(); return file; }
      const scale = 2000 / longest;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close && bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      return blob || file;
    } catch (error) {
      return file;
    }
  }

  let tesseractPromise = null;
  function loadTesseract() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (!tesseractPromise) {
      tesseractPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = () => resolve(global.Tesseract);
        script.onerror = () => {
          tesseractPromise = null;
          reject(new Error('読み取りの部品を読み込めませんでした。インターネットにつながっているか確認してください。'));
        };
        document.head.appendChild(script);
      });
    }
    return tesseractPromise;
  }

  const OCR_PROVIDERS = {
    tesseract: {
      label: 'このブラウザで読み取る（初期設定）',
      isMock: false,
      async run(file, hooks, opts) {
        const Tesseract = await loadTesseract();
        const lang = opts && opts.vertical ? 'jpn_vert' : 'jpn';
        const worker = await Tesseract.createWorker(lang, 1, {
          logger: (message) => hooks && hooks.onProgress && hooks.onProgress(message)
        });
        try {
          if (opts && opts.vertical) await worker.setParameters({ tessedit_pageseg_mode: '5' });
          const result = await worker.recognize(file);
          return { text: result.data.text || '' };
        } finally {
          await worker.terminate();
        }
      }
    },
    mock: {
      label: 'デモ（サンプルを表示。写真は読みません）',
      isMock: true,
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return {
          text: [
            '巣（す）／くもの巣がはる。',
            '歩く,あるく,公園を歩く。',
            '観光、かんこう、観光地を見学した。',
            '花の（　）が出る。|芽',
            '山 川 空'
          ].join('\n')
        };
      }
    }
    // 例）外部 API に差し替えるときは、ここに追加する:
    // cloudVision: { label: 'Google Cloud Vision', async run(file) { /* fetch(...) */ return { text: '...' }; } }
  };

  /**
   * OCR の入口。file（画像）→ { text, provider, mock }
   * hooks: { onProgress({status, progress}) }   opts: { vertical: boolean }
   */
  async function runOcr(file, provider, hooks, opts) {
    const name = provider || 'tesseract';
    const adapter = OCR_PROVIDERS[name];
    if (!adapter) throw new Error('未対応の OCR エンジンです: ' + name);
    const image = adapter.isMock ? file : await prepareImage(file);
    const result = await adapter.run(image, hooks || {}, opts || {});
    return { provider: name, mock: !!adapter.isMock, text: cleanOcrText(result.text) };
  }

  global.KanjiImport = {
    TYPES, TYPE_LABELS, STYLES, STYLE_LABELS, okuriParts,
    normType, normStyle, defaultAnswer, checkQuestion, hasBlank, fillBlank,
    parseBulk, cleanOcrText, runOcr, OCR_PROVIDERS
  };
  global.runOcr = runOcr;
})(window);
