/*
 * import.js — 貼り付けテキスト／JSON からの問題取り込み（画面に依存しない部品）
 *
 * - parseBulk(text, options) … 貼り付けた文章を問題の配列にする。学年の推定、長すぎ・重複・形式の印も付ける
 * - buildPrompt(options) … 利用者が自分の ChatGPT / Gemini に渡すお願い文
 * 写真の読み取りはこのファイルでは行わない。
 */
(function (global) {
  'use strict';

  const TYPES = ['kaki', 'yomi', 'sentence', 'okuri', 'mas', 'trace', 'free'];
  const TYPE_LABELS = {
    kaki: '書き（線のひらがな）',
    yomi: '読み（線の漢字）',
    sentence: '書き（文中の□）',
    okuri: '漢字と送りがな',
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
    '漢字と送りがな': 'okuri',
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
   * 送りがなの境目：「借りる」→ { stem:'借', okuri:'りる' }、「幸せ」→ { stem:'幸', okuri:'せ' }。
   * 漢字のあとにひらがな（1〜4字）が続く語だけ。答えそのものは語全体を使う。
   */
  function okuriParts(word) {
    const m = String(word || '').trim().match(/^([一-鿿々]+)([ぁ-ゖ]{1,4})$/);
    return m ? { stem: m[1], okuri: m[2] } : null;
  }

  /**
   * 例文の中に、答えの語を一つのまとまりとして置く。
   * 「夏祭りに行く。」の「祭り」は、「夏」を残して語全体を枠にする。「夏祭」と「り」には分けない。
   * 同じ語が何度あっても、すべて枠にする。語が文に無いときは null。
   */
  function placeOkuri(sentence, word) {
    const s = String(sentence || '');
    const w = String(word || '').trim();
    if (!w || s.indexOf(w) < 0) return null;
    const parts = [];
    let i = 0;
    while (i < s.length) {
      const at = s.indexOf(w, i);
      if (at < 0) {
        parts.push({ t: 'text', v: s.slice(i) });
        break;
      }
      if (at > i) parts.push({ t: 'text', v: s.slice(i, at) });
      parts.push({ t: 'box' });
      i = at + w.length;
    }
    return parts;
  }

  const RE_KANJI_RUN = /^[一-鿿々]+$/;
  const RE_HIRA_END = /^[ぁ-ゖ]{1,4}$/;

  /**
   * 古い「送りがなだけを書かせる」問題を、漢字と送りがなを一緒に書く形へ直す。
   * もう一度呼んでも、直したあとの問題は変わらない。
   * 語を確実に戻せないときは okuriNeedsEdit を付け、漢字と答えは別の語に書き換えない。
   */
  function migrateOkuriQuestion(q) {
    if (!q || typeof q !== 'object') return { question: q, changed: false, needsEdit: false };
    const type = normType(q.type) || q.type;
    if (type !== 'okuri') {
      if (q.okuriNeedsEdit) {
        const question = Object.assign({}, q);
        delete question.okuriNeedsEdit;
        return { question, changed: true, needsEdit: false };
      }
      return { question: q, changed: false, needsEdit: false };
    }
    const kanji = String(q.kanji || '').trim();
    const answer = String(q.answer || '').trim();
    const reading = String(q.reading || '').trim();
    const sentence = String(q.sentence || '');
    const parts = okuriParts(kanji);

    function finish(nextKanji, nextAnswer, needsEdit) {
      const changed = q.type !== 'okuri' || String(q.kanji || '') !== nextKanji || String(q.answer || '') !== nextAnswer || !!q.okuriNeedsEdit !== !!needsEdit;
      if (!changed) return { question: q, changed: false, needsEdit: !!needsEdit };
      const question = Object.assign({}, q, { type: 'okuri', kanji: nextKanji, answer: nextAnswer });
      if (needsEdit) question.okuriNeedsEdit = true;
      else delete question.okuriNeedsEdit;
      return { question, changed: true, needsEdit: !!needsEdit };
    }

    if (parts && answer === kanji) return finish(kanji, kanji, false);
    if (parts && (answer === parts.okuri || answer === '')) return finish(kanji, kanji, false);

    const answerParts = okuriParts(answer);
    if (RE_KANJI_RUN.test(kanji) && answerParts && answerParts.stem === kanji) return finish(answer, answer, false);

    if (RE_KANJI_RUN.test(kanji) && RE_HIRA_END.test(answer) && answer !== reading) {
      const combined = kanji + answer;
      const combinedParts = okuriParts(combined);
      if (combinedParts && combinedParts.stem === kanji && combinedParts.okuri === answer) {
        const readingOk = !reading || (reading.endsWith(answer) && reading.length > answer.length);
        const sentenceOk = !sentence || sentence.includes(combined) || (!!reading && sentence.includes(reading));
        if (readingOk && sentenceOk) return finish(combined, combined, false);
      }
    }

    return finish(kanji, answer, true);
  }

  function migrateOkuriList(questions) {
    const needs = [];
    let changed = false;
    const next = (Array.isArray(questions) ? questions : []).map((q, index) => {
      const result = migrateOkuriQuestion(q);
      if (result.changed) changed = true;
      if (result.needsEdit) needs.push(index + 1);
      return result.question;
    });
    return { questions: next, changed, needs };
  }

  /** 題型ごとの「答え」の既定値（先生が空欄にしたとき自動で入る） */
  function defaultAnswer(q, type) {
    switch (type || q.type) {
      case 'yomi': return q.reading || '';
      case 'free': return q.answer || '';
      case 'okuri': {
        const word = String((q && q.kanji) || '').trim();
        if (okuriParts(word)) return word;
        return word;
      }
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
      if (q.okuriNeedsEdit) warns.push('この送りがなの問題は、漢字と送りがなの語を確実に戻せませんでした。漢字と答えを手で直してください。');
      else if (!okuriParts(q.kanji)) warns.push('送りがなの問題は「苦しい」のように、漢字のあとにひらがなが続く語を入れてください。答えは語全体です。');
      if (!q.reading) warns.push('よみがなが空です');
      const inReading = !!q.reading && sentence.includes(q.reading);
      if (q.kanji && sentence && !inSentence && !inReading && !q.okuriNeedsEdit) warns.push('例文に「' + q.kanji + '」も、そのよみも含まれていません');
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
    const supplied = fields.grade !== undefined && fields.grade !== null && String(fields.grade).trim() !== '';
    if (!supplied) {
      const found = inferGrade(item.kanji, opts.lookup);
      if (found) {
        item.grade = found.grade;
        if (found.inferred) item.gradeInferred = true;
      }
    }
    if (item.type === 'okuri') return migrateOkuriQuestion(item).question;
    return item;
  }

  /**
   * 題庫から学年を読む。1字はその字の学年。熟語は、どの字も題庫にあるときだけ、いちばん高い学年。
   * 返り値: { grade, inferred } または null（題庫にない字が混ざるとき）。
   */
  function inferGrade(word, lookup) {
    if (!lookup) return null;
    const chars = Array.from(String(word || '')).filter((c) => RE_HAS_KANJI.test(c));
    if (!chars.length) return null;
    const grades = [];
    for (let i = 0; i < chars.length; i += 1) {
      const entry = lookup(chars[i]);
      const grade = entry && Number(entry.grade);
      if (!(grade >= 1 && grade <= 6)) return null;
      grades.push(grade);
    }
    return { grade: Math.max.apply(null, grades), inferred: chars.length > 1 };
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
    // 区切りは「／」のほか、貼り付けでゆれやすい「/ \\ | ノ 丿」「プア」も受ける
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
      const parsed = parseJsonText(cleaned, opts);
      if (parsed.error) return parsed;
      return annotateImport(parsed, opts);
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
    return annotateImport({ items, skipped }, opts);
  }

  // ---- 学年の推定のあと、長すぎ・重複・形式の印 --------------------------------

  // describe() がマスに載せられる字数。これより長い答えは、用紙のマスに入りきらない。
  const BOX_CAP = { kaki: 10, yomi: 12, sentence: 10, okuri: 6, mas: 12, trace: 12, free: 12 };
  // app.js の FORMATS / PAD / MIN_FONT / 段の分け方と同じ。用紙の「読める下限」に入る例文の長さ。
  const PAPER = {
    'A4-portrait': { w: 210, h: 297, minCols: 5 },
    'A4-landscape': { w: 297, h: 210, minCols: 6 },
    'Letter-portrait': { w: 215.9, h: 279.4, minCols: 5 },
    'Letter-landscape': { w: 279.4, h: 215.9, minCols: 6 },
    'A3-landscape': { w: 420, h: 297, minCols: 6 }
  };
  const PAD_TOP = 10;
  const PAD_X = 10;
  const PAD_BOTTOM = 22;
  const MIN_FONT_MM = 2.8;
  const TIER_GAP = 3;

  function autoTiers(format, n) {
    if (format === 'A3-landscape') return n <= 10 ? 1 : n <= 20 ? 2 : 4;
    if (format === 'A4-landscape') return n <= 14 ? 1 : n <= 28 ? 2 : n <= 42 ? 3 : 4;
    return n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5;
  }

  /** いまの用紙で、文字を MIN_FONT_MM まで小さくしたときに1問の列へ入る例文の字数。 */
  function columnBudget(options) {
    const opts = options || {};
    const format = PAPER[opts.format] ? opts.format : 'A4-portrait';
    const fmt = PAPER[format];
    const n = Math.max(1, Number(opts.questionCount) || 1);
    const perTier = Math.max(1, Math.ceil(n / autoTiers(format, n)));
    const tiers = Math.ceil(n / perTier);
    const cols = Math.max(perTier, fmt.minCols);
    const head = Number(opts.headMm) > 0 ? Number(opts.headMm) : 22;
    const bodyW = fmt.w - PAD_X * 2;
    const bodyH = fmt.h - PAD_TOP - PAD_BOTTOM - head;
    const tierH = (bodyH - TIER_GAP * (tiers - 1)) / tiers;
    const colW = bodyW / cols;
    const f = MIN_FONT_MM;
    const usableW = colW - 1.5 * f - 0.6 * f;
    const textCols = Math.max(1, Math.floor(usableW / (1.6 * f)));
    const firstCol = Math.max(1, (tierH - 1.5 * f) / f);
    const nextCol = Math.max(1, tierH / f);
    return Math.floor(firstCol + (textCols - 1) * nextCol);
  }

  function duplicateKey(item) {
    if (!item || item._skip) return '';
    const kanji = String(item.kanji || '').trim();
    const reading = String(item.reading || '').trim();
    const sentence = String(item.sentence || '').trim();
    if (kanji && reading) return 'kr:' + kanji + '\n' + reading;
    if (kanji && sentence) return 'ks:' + kanji + '\n' + sentence;
    if (kanji) return 'k:' + kanji;
    if (sentence) return 's:' + sentence;
    return '';
  }

  function annotateImport(parsed, opts) {
    const items = (parsed.items || []).map((item) => item);
    const skipped = parsed.skipped || [];
    skipped.forEach((row) => {
      items.push({
        _line: row.line,
        _skip: true,
        type: 'free',
        grade: '',
        kanji: '',
        reading: '',
        sentence: row.line,
        answer: '',
        style: 'mas',
        source: opts.source || 'paste',
        flags: [{ kind: 'malformed', detail: row.reason || '読み取れない行' }]
      });
    });

    const seen = new Map();
    items.forEach((item) => {
      if (item._skip) return;
      item.flags = item.flags || [];
      const key = duplicateKey(item);
      if (key) {
        if (seen.has(key)) item.flags.push({ kind: 'duplicate' });
        else seen.set(key, true);
      }
      const cap = BOX_CAP[item.type] || 12;
      const answerLen = Array.from(String(item.answer || '')).length;
      if (item.type !== 'free' && answerLen > cap) {
        item.flags.push({ kind: 'long', part: 'answer', length: answerLen, limit: cap });
      }
      if (item.type !== 'mas' && item.type !== 'trace') {
        const sentenceLen = Array.from(String(item.sentence || '')).length;
        const limit = columnBudget({
          format: opts.format,
          questionCount: opts.questionCount || items.filter((row) => !row._skip).length || 1,
          headMm: opts.headMm
        });
        if (sentenceLen > limit) item.flags.push({ kind: 'long', part: 'sentence', length: sentenceLen, limit: limit, fontMm: MIN_FONT_MM });
      }
      if (item._weak) item.flags.push({ kind: 'malformed', detail: item._note || 'この行は、問題の形として読み取れません。' });
      if (item.okuriNeedsEdit) item.flags.push({ kind: 'edit', detail: '送りがなの語を確実に戻せませんでした。漢字と答えを手で直してください。' });
    });

    const seenLine = new Map();
    items.forEach((item) => {
      const line = item._line || '';
      const n = (seenLine.get(line) || 0) + 1;
      seenLine.set(line, n);
      item._key = line + '#' + n;
      item._exclude = !!(item.flags && item.flags.length);
    });
    items.sort((a, b) => ((a.flags && a.flags.length) ? 0 : 1) - ((b.flags && b.flags.length) ? 0 : 1));
    return { items, skipped, error: parsed.error };
  }

  // ---- お願い文 --------------------------------------------------------------

  const AI_SITES = [
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/' }
  ];

  /**
   * 利用者が自分で開いた AI に渡す文章。他のサイトの文面は使わない。
   * mode: 'photo' は写真を添付し、印刷された読み・例文だけを使う。'write' は文章だけで作る。
   * 学校テスト風の50問の内訳は、その用紙ができてから書く（ここでは書かない）。
   */
  function buildPrompt(options) {
    const opts = options || {};
    const photo = opts.mode === 'photo';
    const range = opts.rangeLabel || '小学1〜6年';
    const count = opts.count || 10;
    const paper = opts.paperLabel || 'A4縦';
    const theme = String(opts.theme || '').trim();
    const lines = [
      'あなたは日本の小学校の国語の先生です。漢字テストの問題を、指定の形で出してください。',
      ''
    ];
    if (photo) {
      lines.push(
        '【写真】',
        'この文章と一緒に、漢字のドリルかテストの写真を添付してください。',
        '印刷されている読み、例文、問題番号だけを使ってください。',
        '児童が枠の中に書いた手書きの答えは、使わないでください。',
        '赤ペンの採点や直しも、使わないでください。',
        '名前、顔、関係のない背景が写っていても、問題にはしないでください。',
        ''
      );
    }
    lines.push(
      '【条件】',
      '・対象：' + range + '（学年別漢字配当表の漢字）',
      '・問題数：' + count + '問',
      '・用紙：' + paper + '（例文は短くする。書きの答えは10字まで、読みの答えは12字まで、漢字と送りがなの答えは6字まで）',
      '・同じ漢字を重ねて出さない',
      '・例文は自然な日本語で、その学年までに習う漢字とひらがな・カタカナだけで書く（まだ習っていない漢字はひらがなにする）',
      '・出題する語は、例文の中にそのままの形で1回だけ入れる',
      '・送りがなの問題は、漢字と送りがなを一緒に書かせる。語全体を漢字の位置に書き、答えも語全体にする（例：苦しい（くるしい）／いきがくるしい。）',
      theme ? '・テーマ：' + theme : null,
      '',
      '【出力】説明は要りません。1行に1問、次の形だけを出してください。',
      '漢字（よみ）／例文',
      '',
      '例：',
      '巣（す）／くもの巣がはる。',
      '歩く（あるく）／公園を歩く。',
      '',
      '（JSONの配列で出す場合）',
      '[{"type":"kaki","grade":3,"kanji":"巣","reading":"す","sentence":"くもの巣がはる。","answer":"巣"}]',
      'type は kaki（書き） / yomi（読み） / sentence（文中の□） / okuri（漢字と送りがな） / mas（練習マス） / trace（なぞり書き） / free（自由入力） のいずれか。'
    );
    return lines.filter((line) => line !== null).join('\n');
  }

  /** かなを含む行の、文字と文字のあいだに入った空白を詰める。貼り付けのゆれ用。解析の区切りには使わない。 */
  function cleanPastedText(text) {
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

  global.KanjiImport = {
    TYPES, TYPE_LABELS, STYLES, STYLE_LABELS, okuriParts, placeOkuri,
    migrateOkuriQuestion, migrateOkuriList,
    normType, normStyle, defaultAnswer, checkQuestion, hasBlank, fillBlank,
    parseBulk, cleanPastedText, inferGrade, columnBudget, buildPrompt, AI_SITES, BOX_CAP
  };
})(typeof window !== 'undefined' ? window : globalThis);
