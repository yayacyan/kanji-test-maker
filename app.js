/*
 * 漢字テストメーカー — 画面ロジック
 *   データ: kanji-db.js（学年別漢字配当表ベースの問題データ）
 *   取り込み・OCR: import.js（KanjiImport）
 *
 * 問題の形（localStorage にもこの形で保存）:
 *   { id, type, grade, kanji, reading, sentence, answer, style, source, base }
 *   type   : kaki 書き(線のかな) / yomi 読み / sentence 書き(文中の□) / okuri 送りがな / mas 練習マス / trace なぞり書き / free 自由入力
 *   style  : mas マス / kakko かっこ / line 線（解答欄の形）
 *   source : bank 学年から作成 / ocr / ai / paste 貼り付け / custom 手入力
 *   base   : 学年から作成したときの配当漢字1字（重複防止に使う）
 */
(function () {
  'use strict';

  const KI = window.KanjiImport;
  const { TYPES, TYPE_LABELS, STYLES, STYLE_LABELS } = KI;

  const STORAGE_KEY = 'kanji-test-maker-v2';
  const LEGACY_KEY = 'kanji-test-maker-v1';
  const MM = 96 / 25.4; // 1mm = 3.78px

  const SOURCE_LABELS = { bank: '学年から作成', ocr: '写真', ai: 'AI', paste: '貼り付け', custom: '手入力' };
  const GRADE_GROUPS = {
    '1': [1], '2': [2], '3': [3], '4': [4], '5': [5], '6': [6],
    '1-2': [1, 2], '1-3': [1, 2, 3], '1-6': [1, 2, 3, 4, 5, 6]
  };
  const RANGE_LABELS = {
    '1': '小学1年', '2': '小学2年', '3': '小学3年', '4': '小学4年', '5': '小学5年', '6': '小学6年',
    '1-2': '小学1〜2年', '1-3': '小学1〜3年', '1-6': '小学1〜6年'
  };
  const FORMATS = {
    'A4-portrait': { w: 210, h: 297, cap: 8, minCols: 5 },
    'A4-landscape': { w: 297, h: 210, cap: 8, minCols: 6 },
    'A3-landscape': { w: 420, h: 297, cap: 10, minCols: 6 }
  };
  const FONT_STACKS = {
    kyokasho: "'UD Digi Kyokasho N-R','UD デジタル 教科書体 N-R','UD デジタル 教科書体 NK-R','YuKyokasho','游教科書体','Kyokasho ICA','Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif",
    mincho: "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif",
    gothic: "'Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP',sans-serif"
  };
  const ZOOM_STEPS = [0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5];
  const DESKTOP_MIN = 1000;

  // ---- 問題データ -----------------------------------------------------------------

  const KANJI_DB = (window.KANJI_DB_ROWS || []).map((row) => ({
    grade: row[0], kanji: row[1], word: row[2], reading: row[3], sentence: row[4]
  }));

  // ---- 状態 -----------------------------------------------------------------

  function defaultState() {
    return {
      view: 'edit',
      sheetMode: 'question',
      zoom: 'auto',
      format: 'A4-portrait',
      tiers: 'auto',
      title: '漢字テスト',
      showName: true,
      showScore: true,
      font: 'kyokasho',
      readingHint: true,
      okuriCells: false,
      practiceReps: '4',
      showInstructions: true,
      showClass: false,
      showDate: false,
      subtitle: '',
      pointsEach: '',
      printBoth: false,
      history: [],
      openTool: 'draw',
      gen: { range: '1-6', count: 10, types: ['kaki'], counts: {}, countsDirty: false, replace: true, avoidRecent: false },
      ocrProvider: 'tesseract',
      ocrVertical: false,
      ocrText: '',
      aiText: '',
      aiTheme: '',
      bulkText: '',
      importTypes: { ocr: 'auto', ai: 'auto', bulk: 'auto' },
      questions: []
    };
  }

  const state = defaultState();
  const ui = { openId: null };

  const $ = (id) => document.getElementById(id);
  const el = {};

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  const str = (v) => (v == null ? '' : String(v));
  const uid = () => 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const chars = (s) => Array.from(str(s));

  function shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ---- 保存・復元 ------------------------------------------------------------

  function normalizeQuestion(raw) {
    const type = TYPES.includes(raw.type) ? raw.type : (KI.normType(raw.type) || 'kaki');
    let source = raw.source;
    if (source === 'generated') source = 'bank';
    if (!SOURCE_LABELS[source]) source = 'custom';
    const gradeNum = Number(raw.grade);
    return {
      id: raw.id || uid(),
      type,
      grade: gradeNum >= 1 && gradeNum <= 6 ? gradeNum : '',
      kanji: str(raw.kanji),
      reading: str(raw.reading),
      sentence: str(raw.sentence),
      answer: str(raw.answer),
      style: STYLES.includes(raw.style) ? raw.style : 'mas',
      source,
      base: str(raw.base)
    };
  }

  function applyStored(data) {
    const defaults = defaultState();
    Object.keys(defaults).forEach((key) => {
      if (data[key] === undefined) return;
      if (key === 'gen') state.gen = Object.assign({}, defaults.gen, data.gen);
      else if (key === 'importTypes') state.importTypes = Object.assign({}, defaults.importTypes, data.importTypes);
      else if (key === 'questions') state.questions = (Array.isArray(data.questions) ? data.questions : []).map(normalizeQuestion);
      else state[key] = data[key];
    });
    if (!FORMATS[state.format]) state.format = 'A4-portrait';
    if (!FONT_STACKS[state.font]) state.font = 'kyokasho';
    if (!Array.isArray(state.gen.types) || !state.gen.types.length) state.gen.types = ['kaki'];
    if (!GRADE_GROUPS[state.gen.range]) state.gen.range = '1-6';
    if (![10, 20, 30, 50].includes(Number(state.gen.count))) state.gen.count = 10;
    state.gen.types = TYPES.filter((t) => state.gen.types.includes(t));
    if (!state.gen.types.length) state.gen.types = ['kaki'];
    if (!state.gen.counts || typeof state.gen.counts !== 'object') state.gen.counts = {};
    if (!state.gen.types.every((t) => Number.isFinite(Number(state.gen.counts[t])))) resetCounts();
    if (!Array.isArray(state.history)) state.history = [];
    state.history = state.history.filter((k) => typeof k === 'string').slice(-400);
    if (!['edit', 'preview', 'answer'].includes(state.view)) state.view = 'edit';
    state.sheetMode = state.sheetMode === 'answer' ? 'answer' : 'question';
  }

  /** 戻り値: true = 保存データあり（初回ではない） */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        applyStored(JSON.parse(raw));
        return true;
      }
      // 旧バージョン（v1）からの引き継ぎ
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const old = (JSON.parse(legacy) || {}).state || {};
        applyStored({
          questions: old.questions,
          format: old.printFormat,
          sheetMode: old.sheetMode,
          ocrText: old.ocrText,
          aiText: old.aiText,
          gen: {
            range: old.gradeRange,
            count: old.questionCount,
            types: old.questionType && old.questionType !== 'mixed' ? [old.questionType] : undefined
          }
        });
        return state.questions.length > 0;
      }
    } catch (error) {
      console.warn('保存データを読み込めませんでした', error);
    }
    return false;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const now = new Date();
      const label = 'この端末に保存済み ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      document.querySelectorAll('.save-state').forEach((e) => { e.textContent = label; e.classList.remove('is-error'); });
    } catch (error) {
      document.querySelectorAll('.save-state').forEach((e) => { e.textContent = '保存できません'; e.classList.add('is-error'); });
    }
  }
  const save = debounce(persist, 250);

  // ---- 通知 -----------------------------------------------------------------

  let toastTimer;
  /** action があると、メッセージの横にボタンが付く（例：「プレビューを見る」） */
  function toast(message, kind, action) {
    el.toast.textContent = message;
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = action.label;
      button.addEventListener('click', () => { el.toast.hidden = true; action.run(); });
      el.toast.appendChild(button);
    }
    el.toast.className = 'toast' + (kind ? ' is-' + kind : '');
    el.toast.title = 'タップで消えます';
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, action ? 9000 : 6000);
  }

  // ---- 問題を作る（学年から選ぶ） ---------------------------------------------

  function questionFromEntry(entry, type) {
    const q = {
      id: uid(),
      type,
      grade: entry.grade,
      kanji: entry.word,
      reading: entry.reading,
      sentence: entry.sentence,
      answer: entry.word,
      style: 'mas',
      source: 'bank',
      base: entry.kanji
    };
    if (type === 'yomi') q.answer = entry.reading;
    if (type === 'okuri') q.answer = KI.defaultAnswer(q, 'okuri');
    if (type === 'free') {
      q.sentence = '「' + entry.word + '」をつかって、文をつくりましょう。';
      q.answer = entry.sentence;
      q.style = 'line';
    }
    return q;
  }

  /** 題庫から、漢字1字（または語）で1件を引く（漢字だけの入力に、読みと例文を補うため） */
  const dbByKanji = new Map();
  const dbByWord = new Map();
  KANJI_DB.forEach((e) => { dbByKanji.set(e.kanji, e); if (!dbByWord.has(e.word)) dbByWord.set(e.word, e); });
  function lookupEntry(token) {
    return dbByWord.get(token) || dbByKanji.get(token) || null;
  }

  /**
   * 学年ごとにほぼ同数ずつ、重複なしで選ぶ。
   * 同じ語（例：「岐」と「阜」がどちらも岐阜県）が1枚に2回出ないようにする。
   * avoid の漢字はなるべく避け、足りないときだけ fallback（最低限さけるもの）まで広げる。
   */
  function pickEntries(range, count, avoid, fallback, accept) {
    const grades = GRADE_GROUPS[range];
    const seenKanji = new Set();
    const seenWords = new Set();
    const picked = [];
    const run = (blocked) => {
      const pools = grades.map((g) => shuffle(KANJI_DB.filter((e) => e.grade === g && !blocked.has(e.kanji) && !seenKanji.has(e.kanji) && (!accept || accept(e)))));
      let progressed = true;
      while (picked.length < count && progressed) {
        progressed = false;
        for (const pool of pools) {
          while (pool.length && (seenKanji.has(pool[pool.length - 1].kanji) || seenWords.has(pool[pool.length - 1].word))) pool.pop();
          if (pool.length && picked.length < count) {
            const entry = pool.pop();
            seenKanji.add(entry.kanji);
            seenWords.add(entry.word);
            picked.push(entry);
            progressed = true;
          }
        }
      }
    };
    run(avoid);
    if (picked.length < count) run(fallback);
    return picked;
  }

  /** 送りがな問題にできる語（「借りる」のように漢字＋かな。例文にその語がそのまま入っている） */
  const NOT_OKURI = new Set(['王さま', '田んぼ', '子ども', '名まえ', '友だち', '原っぱ', '割ると', '済んだら', '久しぶり', '精いっぱい']);
  function isOkuriEntry(e) {
    const p = KI.okuriParts(e.word);
    // 自動で出すのは「漢字1字＋送りがな（2字まで。枠の大きさを全問そろえるため）」の語だけ。「王さま」「子ども」など送りがなでないものは除く
    return !!p && chars(p.stem).length === 1 && p.okuri.length <= 2 && !NOT_OKURI.has(e.word) &&
      e.reading.length > p.okuri.length && e.reading.endsWith(p.okuri) && e.sentence.includes(e.word);
  }

  /** 問題の数を、選んだ種類に均等に分ける（余りは前の種類から1つずつ） */
  function evenSplit(total, types) {
    const out = {};
    let rest = total % types.length;
    types.forEach((t) => {
      out[t] = Math.floor(total / types.length) + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
    });
    return out;
  }

  function resetCounts() {
    state.gen.counts = evenSplit(Number(state.gen.count), TYPES.filter((t) => state.gen.types.includes(t)));
    state.gen.countsDirty = false;
  }

  function countsTotal() {
    return state.gen.types.reduce((sum, t) => sum + (Math.max(0, Math.floor(Number(state.gen.counts[t]) || 0))), 0);
  }

  function renderTypeCounts() {
    const types = TYPES.filter((t) => state.gen.types.includes(t));
    el.typeCounts.innerHTML = '<div class="tc-title">種類ごとの問題数</div><div class="tc-grid">' +
      types.map((t) => '<label class="tc-item"><span>' + esc(TYPE_LABELS[t]) + '</span>' +
        '<input type="number" inputmode="numeric" min="0" max="100" data-count-type="' + t + '" value="' + (Number(state.gen.counts[t]) || 0) + '"></label>').join('') +
      '</div><div class="tc-total">合計 <strong>' + countsTotal() + '</strong>問</div>';
  }

  /**
   * 書き取りの答え（漢字）が、同じ用紙の別の問題文や、用紙上部の説明文に出てしまうと、答えが見えてしまう。
   * 語ぜんたいが出るのはもちろん、答えの一部の漢字（「病気」の「気」など）が出るのも、なるべく避ける。
   * そういう組み合わせを、同じ学年の別の漢字に入れ替えて減らす（完全にゼロにできるとは限らない）。
   */
  const INSTRUCTION_KANJI = '問線漢字書読送手本同右小';
  const KANJI_CHAR = /[\u4e00-\u9fff々]/g;

  function repairLeaks(items, candidates) {
    const allKana = items.length > 0 && items.every((it) => it.entry.grade <= 2); // 説明文がかなだけのとき
    const answerKanji = (it) => (it.type === 'kaki' || it.type === 'sentence' ? (it.entry.word.match(KANJI_CHAR) || []) : []);
    const visibleOf = (it) => {
      const e = it.entry;
      if (it.type === 'yomi') return e.sentence;
      if (it.type === 'mas' || it.type === 'trace') return e.word;
      const p = it.type === 'okuri' ? KI.okuriParts(e.word) : null;
      return e.sentence.replace(e.word, p ? p.stem : '');
    };
    const score = (list) => {
      const vis = list.map(visibleOf);
      let total = 0;
      list.forEach((it, i) => {
        const cs = answerKanji(it);
        if (!cs.length) return;
        vis.forEach((v, j) => {
          if (j === i) return;
          cs.forEach((c) => { if (v.includes(c)) total += 1; });
          if (v.includes(it.entry.word)) total += 4;
        });
        if (!allKana) cs.forEach((c) => { if (INSTRUCTION_KANJI.includes(c)) total += 1; });
      });
      return total;
    };
    // 入れ替えの対象は、漏れに関わっている問題（答えの側も、見える側も）
    const involved = (list, i) => {
      const vis = list.map(visibleOf);
      const mine = answerKanji(list[i]);
      if (mine.some((c) => vis.some((v, j) => j !== i && v.includes(c)))) return true;
      if (!allKana && mine.some((c) => INSTRUCTION_KANJI.includes(c))) return true;
      return list.some((o, k) => k !== i && answerKanji(o).some((c) => vis[i].includes(c)));
    };
    let list = items.slice();
    let best = score(list);
    for (let pass = 0; pass < 4 && best > 0; pass += 1) {
      for (let i = 0; i < list.length && best > 0; i += 1) {
        if (!involved(list, i)) continue;
        const grade = list[i].entry.grade;
        const pool = shuffle(candidates.filter((e) => e.grade === grade &&
          (list[i].type !== 'okuri' || isOkuriEntry(e)) &&
          !list.some((it) => it.entry.kanji === e.kanji || it.entry.word === e.word))).slice(0, 40);
        for (const cand of pool) {
          const trial = list.slice();
          trial[i] = { entry: cand, type: list[i].type };
          const value = score(trial);
          if (value < best) { list = trial; best = value; break; }
        }
      }
    }
    return list;
  }

  function updateHistoryCount() {
    if (el.historyCount) el.historyCount.textContent = state.history.length;
  }

  function drawQuestions() {
    if (!KANJI_DB.length) { toast('問題データを読み込めませんでした。ページを開き直してください。', 'warn'); return; }
    const { range, types, replace, avoidRecent } = state.gen;
    const plan = TYPES.filter((t) => types.includes(t))
      .map((t) => ({ type: t, n: Math.max(0, Math.floor(Number(state.gen.counts[t]) || 0)) }));
    const total = plan.reduce((sum, p) => sum + p.n, 0);
    if (!total) { toast('問題の数を1以上にしてください', 'warn'); return; }

    const base = replace ? state.questions.filter((q) => q.source !== 'bank') : state.questions.slice();
    const replacedCount = replace ? state.questions.length - base.length : 0;
    const used = new Set();
    base.forEach((q) => chars(q.kanji).forEach((c) => used.add(c)));
    const avoid = new Set(used);
    if (avoidRecent) state.history.forEach((k) => avoid.add(k));

    // 送りがな問題は、送りがなのある語からだけ選ぶ（先に取り、ほかの種類はその残りから）
    const okuriPlan = plan.find((p) => p.type === 'okuri');
    const okuriEntries = okuriPlan && okuriPlan.n ? pickEntries(range, okuriPlan.n, avoid, used, isOkuriEntry) : [];
    const takenAvoid = new Set(avoid);
    const takenUsed = new Set(used);
    okuriEntries.forEach((e) => { takenAvoid.add(e.kanji); takenUsed.add(e.kanji); });
    const restCount = total - (okuriPlan ? okuriPlan.n : 0);
    const restEntries = restCount > 0 ? pickEntries(range, restCount, takenAvoid, takenUsed) : [];
    // 種類ごとにまとめて並べる（書き取り → 読み …）。各まとまりの中は学年の低い順。
    const shuffled = shuffle(restEntries);
    let items = [];
    let offset = 0;
    plan.forEach(({ type, n }) => {
      const group = type === 'okuri' ? okuriEntries.slice() : shuffled.slice(offset, offset + n);
      if (type !== 'okuri') offset += n;
      group.sort((a, b) => a.grade - b.grade).forEach((entry) => items.push({ entry, type }));
    });
    const grades = GRADE_GROUPS[range];
    const candidates = KANJI_DB.filter((e) => grades.includes(e.grade) && !avoid.has(e.kanji));
    items = repairLeaks(items, candidates);
    const drawn = items.map((it) => questionFromEntry(it.entry, it.type));

    const recentHits = avoidRecent ? items.filter((it) => state.history.includes(it.entry.kanji)).length : 0;
    state.history = state.history.concat(items.map((it) => it.entry.kanji)).slice(-400);
    state.questions = base.concat(drawn);
    ui.openId = null;
    updateHistoryCount();

    const short = drawn.length < total;
    const okuriShort = okuriPlan && okuriEntries.length < okuriPlan.n;
    el.drawStatus.textContent = (short
      ? drawn.length + '問になりました（この範囲で、重ならない' + (okuriShort ? '漢字や送りがなのある語' : '漢字') + 'が足りませんでした）。'
      : drawn.length + '問を作りました。' + (replacedCount ? '（前回に作った問題' + replacedCount + '問は入れ替えました）' : '')) +
      (recentHits ? ' 以前に出した漢字を' + recentHits + '字さけきれませんでした（「くわしい設定」で記録を消せます）。' : '');
    afterQuestionsChanged();
    toast(drawn.length + '問を作りました（合計 ' + state.questions.length + '問）', '', {
      label: 'プレビューを見る', run: () => setView('preview')
    });
  }

  // ---- 問題の操作 -----------------------------------------------------------

  function afterQuestionsChanged() {
    renderList();
    renderPaper();
    updateCounts();
    save();
  }

  function updateCounts() {
    const n = state.questions.length;
    el.listCount.textContent = n;
    el.tabCount.textContent = n ? '（' + n + '）' : '';
  }

  /** 全部の問題の種類をまとめて変える（自由入力は文だけの問題なので、そのまま） */
  function changeAllTypes(type) {
    let changed = 0;
    let skipped = 0;
    state.questions.forEach((q) => {
      if (q.type === 'free' || q.type === type) return;
      if (type === 'okuri' && !KI.okuriParts(q.kanji)) { skipped += 1; return; }
      const oldDefault = KI.defaultAnswer(q, q.type);
      q.type = type;
      if (!q.answer || q.answer === oldDefault) q.answer = KI.defaultAnswer(q, type);
      changed += 1;
    });
    if (!changed && !skipped) { toast('変える問題がありません', 'warn'); return; }
    afterQuestionsChanged();
    toast(changed + '問を「' + TYPE_LABELS[type] + '」に変えました' +
      (skipped ? '（' + skipped + '問は、漢字のあとにひらがなが続く語ではないので、そのままです）' : ''), skipped ? 'warn' : '');
  }

  function findQuestion(id) { return state.questions.find((q) => q.id === id); }

  function moveQuestion(id, delta) {
    const i = state.questions.findIndex((q) => q.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.questions.length) return;
    const next = state.questions.slice();
    [next[i], next[j]] = [next[j], next[i]];
    state.questions = next;
    afterQuestionsChanged();
    const card = el.questionList.querySelector('[data-id="' + id + '"]');
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  function copyQuestion(id) {
    const i = state.questions.findIndex((q) => q.id === id);
    if (i < 0) return;
    const copy = Object.assign({}, state.questions[i], { id: uid(), source: 'custom' });
    state.questions.splice(i + 1, 0, copy);
    ui.openId = copy.id;
    afterQuestionsChanged();
  }

  function removeQuestion(id) {
    const before = state.questions.slice();
    state.questions = state.questions.filter((q) => q.id !== id);
    if (ui.openId === id) ui.openId = null;
    afterQuestionsChanged();
    toast('1問を消しました', '', { label: '元に戻す', run: () => { state.questions = before; afterQuestionsChanged(); } });
  }

  /** 見本：7種類を1問ずつ（プレビューが空のときに見せる。「問題を作る」で入れ替わる） */
  function loadSample() {
    const q = (type, kanji, reading, sentence, answer, grade, style) => ({
      id: uid(), type, grade, kanji, reading, sentence, answer, style: style || 'mas', source: 'bank', base: ''
    });
    state.questions = [
      q('kaki', '巣', 'す', 'くもの巣がはる。', '巣', 4),
      q('yomi', '校庭', 'こうてい', '学校の校庭で遊ぶ。', 'こうてい', 2),
      q('sentence', '歌', 'うた', '大きな声で歌う。', '歌', 2),
      q('okuri', '借りる', 'かりる', '図書館で本を借りる。', 'りる', 4),
      q('mas', '鏡', 'かがみ', '', '鏡', 4),
      q('trace', '雪', 'ゆき', '', '雪', 2),
      q('free', '', '', '「花」をつかって、文をつくりましょう。', '春になると、花がさく。', 4, 'line')
    ];
    ui.openId = null;
    afterQuestionsChanged();
    toast('見本の問題（7種類）を入れました。自分の問題を作ると入れ替わります', '');
  }

  function addQuestions(items, source, dedupe) {
    const keyOf = (q) => q.type + '|' + q.kanji + '|' + q.sentence;
    const seen = new Set(state.questions.map(keyOf));
    let skipped = 0;
    const created = [];
    items.forEach((item) => {
      const q = normalizeQuestion(Object.assign({}, item, { id: uid(), source }));
      if (dedupe && seen.has(keyOf(q))) { skipped += 1; return; }
      seen.add(keyOf(q));
      created.push(q);
    });
    state.questions = state.questions.concat(created);
    created.skipped = skipped;
    afterQuestionsChanged();
    return created;
  }

  // ---- 問題一覧（編集） -----------------------------------------------------

  function gradeText(q) { return q.grade ? '小' + q.grade : '—'; }

  function optionsHtml(values, labels, selected) {
    return values.map((v) => '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(labels[v]) + '</option>').join('');
  }

  function cardBodyHtml(q) {
    return '<dl class="qi-fields">' +
      '<div><dt>学年</dt><dd>' + esc(gradeText(q)) + '</dd></div>' +
      '<div><dt>漢字</dt><dd class="qi-kanji">' + esc(q.kanji || '—') + '</dd></div>' +
      '<div><dt>よみがな</dt><dd>' + esc(q.reading || '—') + '</dd></div>' +
      '<div><dt>答え</dt><dd>' + esc(q.answer || '—') + '</dd></div>' +
      '<div class="wide"><dt>例文</dt><dd>' + esc(q.sentence || '—') + '</dd></div>' +
      '</dl>';
  }

  function warnHtml(q) {
    const warns = KI.checkQuestion(q);
    return warns.length ? '<div class="qi-warn">⚠ ' + esc(warns.join(' ／ ')) + '</div>' : '';
  }

  function editorHtml(q) {
    const gradeOptions = ['<option value="">なし</option>'].concat([1, 2, 3, 4, 5, 6].map((g) =>
      '<option value="' + g + '"' + (q.grade === g ? ' selected' : '') + '>小学' + g + '年</option>')).join('');
    return '<div class="qi-editor">' +
      '<div class="grid-two qi-types">' +
        '<label><span class="field-label">問題の種類</span><select class="select-input" data-field="type">' + optionsHtml(TYPES, TYPE_LABELS, q.type) + '</select></label>' +
        '<label><span class="field-label">答えを書く場所</span><select class="select-input" data-field="style">' + optionsHtml(STYLES, STYLE_LABELS, q.style) + '</select></label>' +
      '</div>' +
      '<div class="grid-two">' +
        '<label><span class="field-label">漢字</span><input class="text-input" type="text" data-field="kanji" value="' + esc(q.kanji) + '" autocomplete="off"></label>' +
        '<label><span class="field-label">よみがな</span><input class="text-input" type="text" data-field="reading" value="' + esc(q.reading) + '" autocomplete="off"></label>' +
      '</div>' +
      '<label><span class="field-label">例文</span><textarea class="text-input" rows="2" data-field="sentence">' + esc(q.sentence) + '</textarea></label>' +
      '<div class="grid-two">' +
        '<label><span class="field-label">答え</span><input class="text-input" type="text" data-field="answer" value="' + esc(q.answer) + '" autocomplete="off"></label>' +
        '<label><span class="field-label">学年</span><select class="select-input" data-field="grade">' + gradeOptions + '</select></label>' +
      '</div>' +
      '<button type="button" class="ghost-btn full-width" data-action="toggle" data-id="' + q.id + '">閉じる</button>' +
    '</div>';
  }

  function cardHtml(q, index) {
    const open = ui.openId === q.id;
    return '<article class="question-item' + (open ? ' is-open' : '') + '" data-id="' + q.id + '">' +
      '<div class="qi-head">' +
        '<span class="qi-no">' + (index + 1) + '</span>' +
        '<span class="chip type-' + q.type + '">' + esc(TYPE_LABELS[q.type]) + '</span>' +
        '<span class="chip src">作り方：' + esc(SOURCE_LABELS[q.source]) + '</span>' +
      '</div>' +
      '<div class="qi-body" data-role="body">' + cardBodyHtml(q) + warnHtml(q) + '</div>' +
      '<div class="qi-actions">' +
        '<button type="button" class="inline-action" data-action="up" data-id="' + q.id + '" aria-label="上へ">↑</button>' +
        '<button type="button" class="inline-action" data-action="down" data-id="' + q.id + '" aria-label="下へ">↓</button>' +
        '<button type="button" class="inline-action" data-action="copy" data-id="' + q.id + '">コピー</button>' +
        '<button type="button" class="inline-action" data-action="toggle" data-id="' + q.id + '">' + (open ? '閉じる' : '編集') + '</button>' +
        '<button type="button" class="inline-action danger" data-action="delete" data-id="' + q.id + '">削除</button>' +
      '</div>' +
      (open ? editorHtml(q) : '') +
    '</article>';
  }

  function renderList() {
    updateCounts();
    if (!state.questions.length) {
      el.questionList.innerHTML = '<div class="empty-note">問題がまだありません。上の「学年から問題を作る」「写真・AIから取り込む」「自分で問題を作る」から追加できます。</div>';
      return;
    }
    el.questionList.innerHTML = state.questions.map(cardHtml).join('');
  }

  function refreshCard(card, q) {
    const body = card.querySelector('[data-role="body"]');
    if (body) body.innerHTML = cardBodyHtml(q) + warnHtml(q);
  }

  const schedulePaper = debounce(() => renderPaper(), 140);

  function onListInput(event) {
    const field = event.target.dataset.field;
    const card = event.target.closest('[data-id]');
    if (!field || !card) return;
    const q = findQuestion(card.dataset.id);
    if (!q) return;
    if (field === 'type') return; // change イベントで処理
    q[field] = field === 'grade' ? (Number(event.target.value) || '') : event.target.value;
    refreshCard(card, q);
    schedulePaper();
    save();
  }

  function onListChange(event) {
    const field = event.target.dataset.field;
    const card = event.target.closest('[data-id]');
    if (!field || !card) return;
    const q = findQuestion(card.dataset.id);
    if (!q) return;
    if (field === 'type') {
      const oldDefault = KI.defaultAnswer(q, q.type);
      q.type = event.target.value;
      if (!q.answer || q.answer === oldDefault) q.answer = KI.defaultAnswer(q, q.type);
      afterQuestionsChanged();
      return;
    }
    if (field === 'style') {
      q.style = event.target.value;
      renderPaper();
      save();
    }
  }

  function onListClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const { action, id } = target.dataset;
    if (action === 'up') moveQuestion(id, -1);
    else if (action === 'down') moveQuestion(id, 1);
    else if (action === 'copy') copyQuestion(id);
    else if (action === 'delete') removeQuestion(id);
    else if (action === 'toggle') {
      ui.openId = ui.openId === id ? null : id;
      renderList();
      if (ui.openId) {
        const card = el.questionList.querySelector('[data-id="' + id + '"]');
        if (card) card.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  // ---- 用紙の組み立て -------------------------------------------------------

  const RE_BLANK = /[（(][\s　]*[）)]|[＿_]{2,}|[□■]+/;

  /** 例文の中で「出題する語」がどこかを探す */
  function locate(q) {
    const s = str(q.sentence);
    const w = str(q.kanji);
    if (w && s.includes(w)) {
      const i = s.indexOf(w);
      return { before: s.slice(0, i), target: w, after: s.slice(i + w.length) };
    }
    const m = s.match(RE_BLANK);
    if (m) return { before: s.slice(0, m.index), target: '', after: s.slice(m.index + m[0].length) };
    return null;
  }

  /**
   * 1題ぶんの中身を「部品のリスト」にする（描画と文字数の計測の両方で使う）
   *   seg: { t:'text'|'tgt'|'box'|'big'|'small', v, n, hint, chars }
   *   ans: { kind:'cells'|'free'|'practice', chars:[...], count }
   */
  /** 送りがなの枠の高さ（マス数）：既定は2。送りがなが3字以上の問題が1つでもあれば、字数が枠の大きさでわからないよう、全問その高さにそろえる */
  function okuriBoxCells() {
    let m = 2;
    state.questions.forEach((q) => {
      if (q.type !== 'okuri') return;
      const p = KI.okuriParts(q.kanji);
      const a = String(q.answer || '');
      const ok = p ? (a.startsWith(p.stem) ? a.slice(p.stem.length) : (a || p.okuri)) : a;
      m = Math.max(m, Math.min(6, chars(ok).length));
    });
    return m;
  }

  function describe(q) {
    const answer = q.answer || KI.defaultAnswer(q);
    const answerChars = chars(answer);
    const loc = locate(q);
    const segs = [];
    let ans = { kind: 'cells', chars: answerChars, count: Math.max(1, Math.min(answerChars.length, 12)) };

    const pushText = (v) => { if (v) segs.push({ t: 'text', v }); };
    // 線を引いた語のすぐ横に、答えを書く欄（方格）を付ける。欄は文の流れの中に入るので、折り返しても語の横に付く
    const side = (list, max) => ({ style: q.style, chars: list, n: Math.min(Math.max(list.length, 1), max) });

    switch (q.type) {
      case 'kaki':
        if (loc && q.reading) {
          pushText(loc.before);
          segs.push({ t: 'tgt', v: q.reading, side: side(answerChars, 10) });
          pushText(loc.after);
          ans = null;
        } else if (loc) {
          pushText(loc.before);
          segs.push({ t: 'box', n: Math.min(Math.max(answerChars.length, 1), 10), chars: answerChars });
          pushText(loc.after);
          ans = null;
        } else if (q.reading) {
          segs.push({ t: 'tgt', v: q.reading, side: side(answerChars, 10) });
          ans = null;
        } else {
          pushText(q.sentence || q.kanji);
        }
        break;
      case 'yomi': {
        const readingChars = chars(answer || q.reading);
        ans = { kind: 'cells', chars: readingChars, count: Math.max(1, Math.min(readingChars.length, 12)) };
        if (loc && loc.target) {
          pushText(loc.before);
          segs.push({ t: 'tgt', v: loc.target, side: side(readingChars, 12) });
          pushText(loc.after);
          ans = null;
        } else if (q.kanji) {
          segs.push({ t: 'tgt', v: q.kanji, side: side(readingChars, 12) });
          ans = null;
        } else {
          pushText(q.sentence);
        }
        break;
      }
      case 'sentence': {
        const n = Math.min(Math.max(answerChars.length, 1), 10);
        if (loc) {
          pushText(loc.before);
          segs.push({ t: 'box', n, chars: answerChars, hint: q.reading });
          pushText(loc.after);
        } else {
          pushText(q.sentence);
          segs.push({ t: 'box', n, chars: answerChars, hint: q.reading });
        }
        ans = null;
        break;
      }
      case 'okuri': {
        // 「借りる」→ 「借」は見せて、送りがな「りる」のぶんだけ□にする。読みは全体の上に小さく付ける
        const parts = KI.okuriParts(q.kanji);
        const stem = parts ? parts.stem : q.kanji;
        const okChars = chars(parts && answer.startsWith(stem) ? answer.slice(stem.length) : answer);
        // 読みは「漢字の部分」だけを付ける（全体の読みを付けると、送りがながそのまま見えてしまう）
        const okStr = okChars.join('');
        const stemReading = okStr && q.reading && q.reading.endsWith(okStr) && q.reading.length > okStr.length ? q.reading.slice(0, -okStr.length) : '';
        const n = Math.min(Math.max(okChars.length, 1), 6);
        // 既定は、字数がわからない1つの長い枠（□が2つだと「変る」でなく「変わる」とわかってしまう）。枠の高さは、用紙の全問でそろえる
        const seg = { t: 'okuri', stem, n: state.okuriCells ? n : okuriBoxCells(), one: !state.okuriCells, chars: okChars, hint: stemReading };
        if (loc) { pushText(loc.before); segs.push(seg); pushText(loc.after); } else { pushText(q.sentence); segs.push(seg); }
        ans = null;
        break;
      }
      case 'mas':
      case 'trace':
        segs.push({ t: 'big', v: q.kanji || answer });
        if (q.reading) segs.push({ t: 'small', v: '（' + q.reading + '）' });
        // 練習マスの数 ＝ 字数 × 書く回数（1列に入る 10 マスまで）
        ans = { kind: 'practice', chars: answerChars, trace: q.type === 'trace',
          count: (() => {
            const len = Math.max(1, answerChars.length);
            const reps = Math.min(5, Math.max(1, Number(state.practiceReps) || 4));
            return len * Math.max(1, Math.min(reps, Math.floor(10 / len)));
          })() };
        break;
      default: // free
        pushText(q.sentence || q.kanji);
        ans = { kind: 'free', chars: answerChars, count: 6, lineUnits: 6 };
        break;
    }

    // 方格・線を引いた語の直後の句読点は、その語と一体にする（「。」だけが次の列の先頭に落ちないように）
    for (let i = 0; i + 1 < segs.length; i += 1) {
      const cur = segs[i];
      const next = segs[i + 1];
      if (next.t !== 'text' || !(cur.t === 'box' || cur.t === 'okuri' || (cur.t === 'tgt' && cur.side))) continue;
      const m = next.v.match(/^[。、．，！？」』）〕]+/);
      if (!m) continue;
      cur.tail = m[0];
      next.v = next.v.slice(m[0].length);
      if (!next.v) segs.splice(i + 1, 1);
    }

    if (ans && ans.kind !== 'free' && ans.chars.length > 12) {
      ans = { kind: 'free', chars: ans.chars, count: 6, lineUnits: 6 };
    }

    const textLen = segs.reduce((sum, s) => {
      if (s.t === 'tgt') return sum + Math.max(chars(s.v).length, s.side ? s.side.n * 1.25 : 0);
      if (s.t === 'box') return sum + s.n * 1.3;
      if (s.t === 'okuri') return sum + chars(s.stem).length + s.n * 1.3;
      if (s.t === 'big') return sum + chars(s.v).length * 1.5;
      if (s.t === 'small') return sum + chars(s.v).length * 0.55;
      return sum + chars(s.v).length;
    }, 0) + segs.reduce((n, s) => n + chars(s.tail || '').length, 0);
    return { q, segs, ans, textLen };
  }

  function textHtml(value) {
    return esc(value).replace(/[0-9０-９]{1,2}/g, '<span class="tcy">$&</span>');
  }

  function boxesHtml(seg, answerMode) {
    return Array.from({ length: seg.n }, (_, i) =>
      '<span class="box">' + (answerMode && seg.chars[i] ? '<span class="ans-ch">' + esc(seg.chars[i]) + '</span>' : '') + '</span>').join('');
  }

  /** 線を引いた語の横に付ける、答えを書く欄（マス・かっこ・線） */
  function sideHtml(side, answerMode) {
    const shown = answerMode ? side.chars.join('') : '';
    if (side.style === 'kakko' || side.style === 'line') {
      const cls = side.style === 'kakko' ? 'kakko' : 'lineans';
      return '<span class="' + cls + '" style="--n:' + side.n + '">' + (shown ? '<span class="ans-vert">' + esc(shown) + '</span>' : '') + '</span>';
    }
    return Array.from({ length: side.n }, (_, i) =>
      '<span class="cell">' + (answerMode && side.chars[i] ? '<span class="ans-ch">' + esc(side.chars[i]) + '</span>' : '') + '</span>').join('');
  }

  function segHtml(seg, answerMode) {
    const html = segCoreHtml(seg, answerMode);
    return seg.tail && !(seg.t === 'tgt' && seg.side) ? '<span class="nb">' + html + esc(seg.tail) + '</span>' : html;
  }

  function segCoreHtml(seg, answerMode) {
    switch (seg.t) {
      case 'tgt': {
        const line = '<span class="tgt">' + textHtml(seg.v) + '</span>';
        // 語の直後の句読点は、方格の高さぶんの空きの手前（語のすぐ後ろ）に置く
        return seg.side
          ? '<span class="tgt-wrap" style="--n:' + seg.side.n + '"><span class="tgt-col">' + line + esc(seg.tail || '') + '</span><span class="side">' + sideHtml(seg.side, answerMode) + '</span></span>'
          : line;
      }
      case 'okuri': {
        const stem = seg.hint && state.readingHint ? '<ruby class="hint-ruby">' + esc(seg.stem) + '<rt>' + esc(seg.hint) + '</rt></ruby>' : esc(seg.stem);
        if (!seg.one) return stem + boxesHtml(seg, answerMode);
        return stem + '<span class="box okuri-one" style="--k:' + seg.n + '">' +
          (answerMode ? '<span class="ans-okuri">' + esc(seg.chars.join('')) + '</span>' : '') + '</span>';
      }
      case 'big': return '<span class="mas-kanji">' + esc(seg.v) + '</span>';
      case 'small': return '<span class="mas-yomi">' + esc(seg.v) + '</span>';
      case 'box': {
        const boxes = boxesHtml(seg, answerMode);
        return seg.hint && state.readingHint ? '<ruby class="hint-ruby">' + boxes + '<rt>' + esc(seg.hint) + '</rt></ruby>' : boxes;
      }
      default: return textHtml(seg.v);
    }
  }

  /** 自由入力の答え文の字の大きさ（長いほど小さく）。高さは枠の残りいっぱい（CSS）で、折り返しに任せる */
  function freeAnswerScale(len) {
    return len <= 14 ? 1 : len <= 26 ? 0.8 : 0.65;
  }

  function answerColumnHtml(d, answerMode, lay) {
    const { ans, q } = d;
    if (!ans) return '';
    if (ans.kind === 'practice') {
      const count = Math.max(ans.chars.length, 2, Math.min(ans.count, lay.maxCells));
      const cells = Array.from({ length: count }, (_, i) =>
        '<span class="cell practice">' + (answerMode && ans.chars.length ? '<span class="ans-ch">' + esc(ans.chars[i % ans.chars.length]) + '</span>'
          : (!answerMode && ans.trace && ans.chars.length && i < ans.chars.length ? '<span class="trace-ch">' + esc(ans.chars[i % ans.chars.length]) + '</span>' : '')) + '</span>').join('');
      return '<div class="q-ans">' + cells + '</div>';
    }
    const free = ans.kind === 'free';
    if (free && answerMode) {
      // 解答用紙：範例（正解が1つとは限らない）であることを「（例）」で示す
      const text = '（例）' + ans.chars.join('');
      return '<div class="q-ans"><span class="free-ans" style="font-size:' + freeAnswerScale(chars(text).length) + 'em">' +
        esc(text) + '</span></div>';
    }
    const style = free && q.style === 'mas' ? 'line' : q.style;
    // 自由入力の線・かっこは、答えの長さに関係なく枠いっぱい（答えの長さが分からないように）
    const units = ans.count;
    const fill = free ? ' fill' : '';
    const shown = answerMode ? ans.chars.join('') : '';
    if (style === 'kakko') {
      return '<div class="q-ans"><span class="kakko' + fill + '" style="--n:' + units + '">' +
        (shown ? '<span class="ans-vert">' + esc(shown) + '</span>' : '') + '</span></div>';
    }
    if (style === 'line') {
      // 文を書く欄は2本並べて、書く幅を広くする
      const lines = free && lay.colW >= 8 * lay.f ? 2 : 1;
      return '<div class="q-ans' + (lines > 1 ? ' free-lines' : '') + '">' +
        Array.from({ length: lines }, () => '<span class="lineans' + fill + '" style="--n:' + units + '">' +
          (shown ? '<span class="ans-vert">' + esc(shown) + '</span>' : '') + '</span>').join('') + '</div>';
    }
    const cells = Array.from({ length: ans.count }, (_, i) =>
      '<span class="cell">' + (answerMode && ans.chars[i] ? '<span class="ans-ch">' + esc(ans.chars[i]) + '</span>' : '') + '</span>').join('');
    return '<div class="q-ans">' + cells + '</div>';
  }

  function questionHtml(d, index, answerMode, lay) {
    const sec = sectionTags()[index];
    return '<div class="q t-' + d.q.type + '">' +
      (sec ? '<div class="q-sec">' + esc(sec[0]) + '<br>' + esc(sec[1]) + '</div>' : '') +
      '<div class="q-main"><span class="q-no">' + (index + 1) + '</span>' +
        '<span class="q-text">' + d.segs.map((s) => segHtml(s, answerMode)).join('') + '</span></div>' +
      answerColumnHtml(d, answerMode, lay) +
    '</div>';
  }

  // ---- 問題の種類ごとの説明文（用紙の上に入れる） ---------------------------

  // 1〜2年の問題だけのときは、習っていない漢字（線・読・書 など）をかなにする
  const INSTRUCTIONS_KANA = {
    kaki: 'せんの ひいてある ひらがなを、かん字で かきましょう。',
    yomi: 'せんの ひいてある かん字の よみがなを、ひらがなで かきましょう。',
    sentence: '□に あてはまる かん字を かきましょう。',
    okuri: '□に おくりがなを かきましょう。',
    mas: 'おてほんの かん字を、マスに くりかえし ていねいに かきましょう。',
    trace: 'うすい 字を なぞってから、のこりの マスにも おなじ 字を かきましょう。'
  };
  const INSTRUCTIONS = {
    kaki: '線のひいてある ひらがなを、漢字で 書きましょう。',
    yomi: '線のひいてある 漢字の 読みがなを、ひらがなで 書きましょう。',
    sentence: '□に あてはまる 漢字を 書きましょう。',
    okuri: '□に 送りがなを 書きましょう。',
    mas: 'お手本の 漢字を、マスに くりかえし ていねいに 書きましょう。',
    trace: 'うすい字を なぞってから、のこりのマスにも 同じ字を 書きましょう。'
  };

  // 種類が変わる最初の問題の上に付ける、「ここから ○○」の小さな札（種類のまとまりが2つ以上で、同じ種類が2か所に分かれていないときだけ。交錯しているときは上の説明文だけ）
  const SECTION_LABELS = {
    kanji: { kaki: '書き取り', yomi: '読みがな', sentence: '文中の□', okuri: '送りがな', mas: '練習マス', trace: 'なぞり' },
    kana: { kaki: 'かきとり', yomi: 'よみがな', sentence: 'ぶんの□', okuri: 'おくりがな', mas: 'れんしゅう', trace: 'なぞり' }
  };
  let secCache = { key: '', tags: [] };

  /** 問題ごとの札（なければ null）。[ '1行目', '2行目' ] */
  function sectionTags() {
    const qs = state.questions;
    const key = state.showInstructions + '|' + qs.map((q) => q.type + (Number(q.grade) || 0)).join(',');
    if (secCache.key === key) return secCache.tags;
    const tags = qs.map(() => null);
    if (state.showInstructions) {
      const runs = [];
      qs.forEach((q, i) => {
        if (!INSTRUCTIONS[q.type]) return;
        const last = runs[runs.length - 1];
        if (last && last.type === q.type && last.end === i - 1) last.end = i;
        else runs.push({ type: q.type, start: i, end: i });
      });
      // 同じ種類が2か所に分かれている（交錯している）ときは、札を付けない
      const interleaved = new Set(runs.map((r) => r.type)).size < runs.length;
      if (runs.length >= 2 && !interleaved) {
        const kana = qs.length > 0 && qs.every((q) => Number(q.grade) >= 1 && Number(q.grade) <= 2);
        runs.slice(1).forEach((r) => { tags[r.start] = ['ここから', SECTION_LABELS[kana ? 'kana' : 'kanji'][r.type]]; });
      }
    }
    secCache = { key, tags };
    return tags;
  }

  /** 連続する同じ種類をまとめて、「問1〜10　説明」のリストにする（自由入力は問題文が説明を兼ねる） */
  function instructionItems(questions) {
    const grades = questions.map((q) => Number(q.grade) || 0);
    const kana = questions.length > 0 && grades.every((g) => g >= 1 && g <= 2);
    const texts = kana ? INSTRUCTIONS_KANA : INSTRUCTIONS;
    const runs = [];
    questions.forEach((q, i) => {
      if (!INSTRUCTIONS[q.type]) return;
      const last = runs[runs.length - 1];
      if (last && last.type === q.type && last.end === i - 1) { last.end = i; last.hint = last.hint || !!q.reading; }
      else runs.push({ type: q.type, start: i, end: i, hint: !!q.reading });
    });
    const items = [];
    const hintText = (r) => {
      let text = texts[r.type];
      if (r.type === 'sentence' && state.readingHint && r.hint) text += kana ? '（□の みぎの ちいさい じは よみがなです）' : '（□の右の小さい字は 読みがなです）';
      if (r.type === 'okuri' && state.readingHint) text += kana ? '（かん字の みぎの ちいさい じは よみがなです）' : '（右の小さい字は 読みがなです）';
      return text;
    };
    // 同じ種類が離れた場所にも出るとき（交錯）は、種類ごとに「問1・3・5〜6」と番号をまとめて1行にする
    if (new Set(runs.map((r) => r.type)).size < runs.length) {
      const byType = new Map();
      runs.forEach((r) => {
        const g = byType.get(r.type) || { type: r.type, hint: false, spans: [] };
        g.hint = g.hint || r.hint;
        g.spans.push(r.start === r.end ? String(r.start + 1) : (r.start + 1) + '〜' + (r.end + 1));
        byType.set(r.type, g);
      });
      byType.forEach((g) => {
        const label = '問' + g.spans.join('・');
        const text = hintText(g);
        // 番号が長くて1行に収まらないときは、番号の行と説明の行を分ける（途中で折り返して読みにくくならないように）
        items.push({ label, text, stack: chars(label + text).length > 40 });
      });
      return items;
    }
    // 問題が多くて紙面に余裕がないとき（30問超で6種類）は、範囲を付けず種類ごとに1回だけ
    const compact = runs.length > 5 && questions.length > 30;
    const seen = new Set();
    runs.forEach((r) => {
      if (compact) {
        if (seen.has(r.type)) return;
        seen.add(r.type);
      }
      const text = hintText(r);
      const label = compact ? '' : (r.start === r.end ? '問' + (r.start + 1) : '問' + (r.start + 1) + '〜' + (r.end + 1));
      items.push({ label, text });
    });
    return items;
  }

  function instructionHtml(items) {
    if (!items.length) return '';
    return '<div class="paper-ins">' + items.map((it) =>
      '<span class="ins-item' + (it.stack ? ' stack' : '') + '">' + (it.label ? '<b>' + esc(it.label) + '</b>' : '') + esc(it.text) + '</span>').join('') + '</div>';
  }

  /** 説明文が何行になるか（3.9mm の文字を幅いっぱいに詰める）から、必要な高さ(mm)を見積もる */
  function instructionHeight(items, bodyW) {
    if (!items.length) return 0;
    let lines = 1;
    let used = 0;
    items.forEach((it) => {
      const w = (chars(it.label + it.text).length) * 4.0 + 5;
      if (it.stack) { // 番号の行＋説明の行
        if (used) lines += 1;
        lines += Math.ceil(chars(it.text).length * 4.0 / bodyW);
        used = bodyW;
        return;
      }
      if (w > bodyW) { // 1項目が1行に入らないとき（交錯で番号が長いなど）は、折り返した行数も数える
        if (used) lines += 1;
        lines += Math.ceil(w / bodyW) - 1;
        used = bodyW;
        return;
      }
      if (used && used + w > bodyW) { lines += 1; used = 0; }
      used += w;
    });
    return lines * 6.0 + 2.5;
  }

  // ---- 段・文字サイズの決定 ---------------------------------------------------

  function autoTiers(format, n) {
    if (format === 'A3-landscape') return n <= 10 ? 1 : n <= 20 ? 2 : 4;
    if (format === 'A4-landscape') return n <= 14 ? 1 : n <= 28 ? 2 : n <= 42 ? 3 : 4;
    return n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5;
  }

  /** 見出しの高さ(mm)：名前・点数のほかに学年・組や日付を入れると2行になる */
  function headHeight() {
    return state.showClass || state.showDate ? 22 : 15;
  }

  /** 段数を決めたときの、段数・列数・文字サイズ（推定）を返す */
  function layoutFor(descs, wantedTiers, insH) {
    const fmt = FORMATS[state.format];
    const n = Math.max(descs.length, 1);
    const perTier = Math.max(1, Math.ceil(n / wantedTiers));
    const tiers = Math.ceil(n / perTier);
    const cols = Math.max(perTier, fmt.minCols);

    const padX = 10;
    const bodyW = fmt.w - padX * 2;
    const bodyH = fmt.h - 10 - 13 - headHeight() - insH; // 上余白・下余白・見出し・説明文
    const gap = 3;
    const tierH = (bodyH - gap * (tiers - 1)) / tiers;
    const colW = bodyW / cols;

    // 全問がこの文字サイズで収まるか（長い文は次の列へ折り返す前提で、幅と高さを数える）
    const tags = sectionTags();
    const fits = (f) => {
      return descs.every((d, i) => {
        // 札のある段は、番号の高さがそろうよう、その段の全問の上に札ぶんの余白をあける
        const t0 = Math.floor(i / perTier) * perTier;
        const pad = tags.length === descs.length && tags.slice(t0, t0 + perTier).some(Boolean) ? 2.6 * Math.max(0.6 * f, Math.min(2.4, (f - 2.8) * 12)) + 0.34 * f : 0;
        const firstCol = (tierH - pad - 1.5 * f) / f; // 1列目は番号ぶん短い
        const nextCol = (tierH - pad) / f;
        const textCols = d.textLen <= firstCol ? 1 : 1 + Math.ceil((d.textLen - firstCol) / nextCol);
        const ruby = d.segs.some((seg) => seg.hint) && state.readingHint ? 0.6 * f : 0;
        const ansW = d.ans ? (d.ans.kind === 'free' ? (colW >= 8 * f ? 3.4 : 2.2) : 1.75) * f : 0;
        const sideW = d.segs.some((seg) => seg.side) ? 1.5 * f : 0; // 語の横に付く欄の幅
        const ansH = d.ans ? pad + 1.75 * f + d.ans.count * 1.3 * f : 0;
        return textCols * 1.6 * f + ruby + ansW + sideW + 0.6 * f <= colW && ansH <= tierH;
      });
    };
    let raw = fmt.cap;
    while (raw > 0.5 && !fits(raw)) raw -= 0.1; // 下限で切る前の「本当に入る大きさ」（段数の比較に使う）
    const f = Math.max(2.8, raw);
    const maxCells = Math.floor((tierH - 2.2 * f) / (1.3 * f));
    return { fmt, perTier, tiers, cols, tierH, colW, f, raw, maxCells };
  }

  /**
   * 段数の決め方
   *  - 手動指定があればそれに従う
   *  - A3 横：20問は上下2段（各10問）、21問以上は4段（ご指定の仕様）
   *  - A4：1〜5段を試して、文字（＝解答マス）が大きくなる並びを選ぶ（差が1割以内なら段の少ない方）
   */
  function computeLayout(descs, insH) {
    const n = Math.max(descs.length, 1);
    if (state.tiers !== 'auto') {
      const want = Math.min(Number(state.tiers) || 1, n);
      const lay = layoutFor(descs, want, insH);
      if (lay.raw >= 3.0) return lay;
      // 指定の段数では文字が小さすぎて読めないときは、おまかせと同じ選び方に切り替えて知らせる
      const auto = autoLayout(descs, insH);
      if (auto.tiers !== lay.tiers) auto.note = '「並べる段の数」を' + want + '段にすると文字が小さすぎて読めないため、' + auto.tiers + '段にしました。';
      return auto;
    }
    return autoLayout(descs, insH);
  }

  function autoLayout(descs, insH) {
    const n = Math.max(descs.length, 1);
    if (state.format === 'A3-landscape') return layoutFor(descs, autoTiers(state.format, n), insH);
    const options = [];
    for (let t = 1; t <= Math.min(5, n); t += 1) options.push(layoutFor(descs, t, insH));
    const top = Math.max(...options.map((o) => o.raw));
    // いちばん大きい文字の9割以上なら、段の少ない（＝テストらしい）並びを選ぶ
    return options.find((o) => o.raw >= top * 0.9);
  }

  /** 推定した文字サイズ f で描画し直したとき、問題の列の外にはみ出す部品があるか */
  function overflowing(root) {
    return Array.from(root.querySelectorAll('.q')).some((q) => {
      const box = q.getBoundingClientRect();
      return Array.from(q.querySelectorAll('.q-main, .q-text, .q-ans, .q-ans > *, .tgt-wrap, .side, .side > *')).some((e) => {
        const r = e.getBoundingClientRect();
        return r.left < box.left - 0.3 || r.right > box.right + 0.3 || r.bottom > box.bottom + 0.3;
      });
    });
  }

  const fontCache = { key: '', f: 0, tiers: 0 };

  /**
   * 文字サイズの決定：寸法から推定した値を上限に、実際に(画面外で)描画して
   * はみ出しがなくなるまで少しずつ下げる。問題用紙と解答用紙で同じ大きさにそろえる。
   */
  function fittedFont() {
    const key = JSON.stringify([state.questions, state.format, state.tiers, state.font, state.readingHint,
      state.showInstructions, state.showClass, state.showDate, state.okuriCells, state.practiceReps]);
    if (fontCache.key === key) return fontCache.f;
    const items = state.showInstructions ? instructionItems(state.questions) : [];
    let f = computeLayout(state.questions.map(describe), instructionHeight(items, FORMATS[state.format].w - 20)).f;
    if (state.questions.length) {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none';
      document.body.appendChild(probe);
      try {
        while (f > 2.8) {
          const bad = ['question', 'answer'].some((m) => { probe.innerHTML = buildSheet(m, f); return overflowing(probe); });
          if (!bad) break;
          f = Math.max(2.8, f * 0.96);
        }
      } finally {
        probe.remove();
      }
    }
    f = Math.max(2.8, f * 0.985); // 画面と印刷の微差に備え、わずかに余裕を持たせる
    fontCache.key = key;
    fontCache.f = f;
    return f;
  }

  function buildSheet(mode, fontMm) {
    const answerMode = mode === 'answer';
    const descs = state.questions.map(describe);
    const items = state.showInstructions ? instructionItems(state.questions) : [];
    const lay = computeLayout(descs, instructionHeight(items, FORMATS[state.format].w - 20));
    if (fontMm) {
      lay.f = fontMm;
      lay.maxCells = Math.floor((lay.tierH - 2.2 * fontMm) / (1.3 * fontMm));
    }
    const n = state.questions.length;

    let body;
    if (!n) {
      body = '<div class="paper-empty">まだ問題がありません。<br>上の「学年から」「自分で」「写真・AI」のどれかで問題を作ると、ここに用紙が出ます。<br><button type="button" class="soft-btn sample-btn">見本の用紙を見る</button></div>';
    } else {
      const rows = [];
      for (let t = 0; t < lay.tiers; t += 1) {
        const slice = descs.slice(t * lay.perTier, (t + 1) * lay.perTier);
        const tags = sectionTags();
        const tierHasTag = slice.some((d, i) => tags[t * lay.perTier + i]);
        rows.push('<div class="tier' + (tierHasTag ? ' has-sec' : '') + '">' + slice.map((d, i) => questionHtml(d, t * lay.perTier + i, answerMode, lay)).join('') + '</div>');
      }
      body = rows.join('');
    }

    const points = Number(state.pointsEach) > 0 ? Number(state.pointsEach) * n : 0;
    const fields = answerMode ? '' : ((state.showClass ? '<span class="field">学年・組<i class="fill short"></i></span>' : '') +
      (state.showDate ? '<span class="field">日付<i class="fill short"></i></span>' : '') +
      (state.showName ? '<span class="field">名前<i class="fill"></i></span>' : '') +
      (state.showScore ? '<span class="field">点<i class="fill short"></i>' + (points ? '<span class="of-total">／' + points + '点</span>' : '') + '</span>' : ''));
    const sub = str(state.subtitle).trim();

    return '<div class="paper ' + (answerMode ? 'is-answer' : 'is-question') + '" style="' +
      '--W:' + lay.fmt.w + 'mm;--H:' + lay.fmt.h + 'mm;--f:' + lay.f.toFixed(2) + 'mm;--cols:' + lay.cols + ';--head:' + headHeight() + 'mm;' +
      'font-family:' + FONT_STACKS[state.font] + '">' +
      '<div class="paper-head">' +
        '<div class="paper-title">' + esc(state.title || '漢字テスト') + (answerMode ? '<span class="stamp">解答</span>' : '') + '</div>' +
        (sub ? '<div class="paper-sub">' + esc(sub) + '</div>' : '') +
        '<div class="paper-count">' + n + '問</div>' +
        '<div class="paper-fields">' + fields + '</div>' +
      '</div>' +
      instructionHtml(items) +
      '<div class="paper-body">' + body + '</div>' +
      '<div class="paper-brand">漢字テストメーカー</div>' +
    '</div>';
  }

  function insHeightFor(list) {
    const items = state.showInstructions ? instructionItems(list) : [];
    return instructionHeight(items, FORMATS[state.format].w - 20);
  }

  /** 解答マスが8mm以上になる、いまの用紙での問題数（おおよそ） */
  function recommendCount(descs) {
    for (let m = descs.length - 1; m >= 1; m -= 1) {
      const lay = computeLayout(descs.slice(0, m), insHeightFor(state.questions.slice(0, m)));
      if (lay.f * 1.25 >= 8.9) return m; // 実測は推定より1割ほど小さくなるので、余裕を見て数える
    }
    return 0;
  }

  /** 用紙に出る文字（答えが見えてしまうかどうかの判定に使う） */
  function visibleText(q) {
    return describe(q).segs.map((s) => (s.t === 'okuri' ? s.stem : s.t === 'box' ? '' : s.v || '')).join('');
  }

  /** 同じ問題が2つある／ある問題の答えが別の問題に出ている、を探す */
  function findConflicts() {
    const list = state.questions;
    const vis = list.map(visibleText);
    const dupes = [];
    const leaks = [];
    const seen = new Map();
    list.forEach((q, i) => {
      const key = q.type + '|' + q.kanji + '|' + q.sentence;
      if (seen.has(key)) dupes.push({ a: seen.get(key) + 1, b: i + 1, kanji: q.kanji });
      else seen.set(key, i);
    });
    list.forEach((a, i) => {
      if (!['kaki', 'sentence', 'okuri'].includes(a.type) || !a.kanji) return;
      const j = vis.findIndex((v, k) => k !== i && v.includes(a.kanji));
      if (j >= 0) leaks.push({ a: i + 1, b: j + 1, kanji: a.kanji });
    });
    return { dupes, leaks };
  }

  function conflictsText() {
    const { dupes, leaks } = findConflicts();
    const parts = [];
    if (dupes.length) parts.push('問' + dupes[0].a + 'と問' + dupes[0].b + '（「' + dupes[0].kanji + '」）は同じ問題です' + (dupes.length > 1 ? '（ほか' + (dupes.length - 1) + '件）' : '') + '。');
    if (leaks.length) {
      parts.push(leaks.slice(0, 2).map((l) => '問' + l.a + 'の答え「' + l.kanji + '」が、問' + l.b + 'の問題に出ています').join('。') +
        (leaks.length > 2 ? '（ほか' + (leaks.length - 2) + '件）' : '') + '。答えが見えてしまうので、どちらかを入れ替えるか消すか、別のプリントに分けてください。');
    }
    return parts.join(' ');
  }

  /** プレビューの下に出す「解答マスの大きさ」の目安と、直したほうがよい点 */
  function sheetInfoFor(f) {
    if (!state.questions.length) return { text: '', warn: false };
    const descs = state.questions.map(describe);
    const lay = computeLayout(descs, insHeightFor(state.questions));
    const cell = f * 1.25;
    const pt = f / 0.3528;
    const writes = state.questions.some((q) => ['kaki', 'yomi', 'mas', 'trace'].includes(q.type));
    let text = '解答マス 約' + cell.toFixed(1) + 'mm／文字 約' + Math.round(pt) + 'pt';
    let warn = false;
    if (writes && cell < 7.5) {
      const rec = recommendCount(descs);
      text += '　小学生が鉛筆で書くには小さめです。' +
        (rec && rec < descs.length ? 'いまの用紙なら、約' + rec + '問までにすると書きやすい大きさになります。' : '') +
        (state.format === 'A3-landscape' ? '問題の数を減らすと大きくなります。'
          : state.format === 'A4-landscape' ? '問題の数を減らすか、A3にすると大きくなります。'
          : '問題の数を減らすか、A3や横向きにすると大きくなります。');
      warn = true;
    }
    if (lay.note) { text += '　' + lay.note; warn = true; }
    const conflicts = conflictsText();
    if (conflicts) { text += '　⚠ ' + conflicts; warn = true; }
    return { text, warn, conflicts };
  }

  // ---- プレビュー・印刷 -----------------------------------------------------

  function currentScale() {
    const fmt = FORMATS[state.format];
    const box = getComputedStyle(el.viewport); // 枠の内側の余白は、デザインを変えても合うように実際の値を引く
    const padX = (parseFloat(box.paddingLeft) || 0) + (parseFloat(box.paddingRight) || 0);
    const padY = (parseFloat(box.paddingTop) || 0) + (parseFloat(box.paddingBottom) || 0);
    const avail = el.viewport.clientWidth - padX;
    let fit = avail > 60 ? Math.min(1.6, avail / (fmt.w * MM)) : 0.5;
    // デスクトップでは用紙1枚が高さにも収まる大きさを「全体」とする
    if (window.innerWidth >= DESKTOP_MIN && el.viewport.clientHeight > 100) {
      fit = Math.min(fit, (el.viewport.clientHeight - padY) / (fmt.h * MM));
    }
    if (state.zoom === 'fit') return fit;
    if (state.zoom === 'auto') return fit; // 最初は用紙が全部見える大きさ（拡大は＋ボタン）
    return Number(state.zoom) || fit;
  }

  function applyZoom() {
    const scaler = el.paperHost.querySelector('.sheet-scaler');
    if (!scaler) return;
    const fmt = FORMATS[state.format];
    const s = currentScale();
    scaler.style.width = (fmt.w * MM * s) + 'px';
    scaler.style.height = (fmt.h * MM * s) + 'px';
    scaler.firstElementChild.style.transform = 'scale(' + s + ')';
    el.zoomLabel.textContent = Math.round(s * 100) + '%';
  }

  function zoomBy(direction) {
    const current = currentScale();
    let next;
    if (direction > 0) next = ZOOM_STEPS.find((z) => z > current * 1.02) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
    else next = [...ZOOM_STEPS].reverse().find((z) => z < current * 0.98) || ZOOM_STEPS[0];
    state.zoom = next;
    applyZoom();
    save();
  }

  function updatePageStyle() {
    const fmt = FORMATS[state.format];
    el.pageStyle.textContent = '@page { size: ' + fmt.w + 'mm ' + fmt.h + 'mm; margin: 0; }';
  }

  function renderPrintArea() {
    const modes = state.printBoth ? ['question', 'answer'] : [state.sheetMode];
    const f = fittedFont();
    el.printArea.innerHTML = modes.map((m) => '<div class="print-sheet">' + buildSheet(m, f) + '</div>').join('');
    updatePageStyle();
  }

  function updateSheetInfo(f) {
    const info = sheetInfoFor(f);
    el.sheetInfo.textContent = info.text;
    el.sheetInfo.className = 'sheet-info' + (info.warn ? ' is-warn' : '');
    el.sheetInfo.hidden = !info.text;
    if (el.listNotice) {
      // 直し方も一緒に出す：答えが見えてしまう（または同じ）問題のほうを消すボタン
      const c = info.conflicts ? findConflicts() : null;
      const first = c && (c.dupes[0] ? c.dupes[0].b : c.leaks[0] ? c.leaks[0].b : 0);
      const target = first ? state.questions[first - 1] : null;
      el.listNotice.innerHTML = info.conflicts
        ? '<span>⚠ ' + esc(info.conflicts) + '</span>' + (target ? '<button type="button" class="notice-fix" data-remove-id="' + esc(target.id) + '">問' + first + 'を消す</button>' : '')
        : '';
      el.listNotice.hidden = !info.conflicts;
    }
  }

  /** 「印刷 / PDF」ボタンに、いま印刷される用紙の種類を小さく添える */
  function updatePrintLabels() {
    const label = state.printBoth ? '問題用紙＋解答用紙' : (state.sheetMode === 'answer' ? '解答用紙' : '問題用紙');
    document.querySelectorAll('.print-sub').forEach((e) => { e.textContent = label; });
  }

  function renderPaper() {
    const f = fittedFont();
    el.paperHost.innerHTML = '<div class="sheet-scaler"><div class="paper-wrap">' + buildSheet(state.sheetMode, f) + '</div></div>';
    applyZoom();
    renderPrintArea();
    updateSheetInfo(f);
    updatePrintLabels();
  }

  /** 縦書きは右から読むので、スマホで拡大表示しているときは右端（1問目）を見せる */
  function scrollPreviewToStart() {
    if (window.innerWidth < DESKTOP_MIN) el.viewport.scrollLeft = el.viewport.scrollWidth;
  }

  function doPrint() {
    if (!state.questions.length) { toast('印刷する問題がありません。先に問題を作ってください。', 'warn'); return; }
    const conflicts = conflictsText();
    if (conflicts && !window.confirm('⚠ ' + conflicts + '\n\nこのまま印刷しますか？')) return;
    renderPrintArea();
    window.print();
  }

  // ---- 表示切り替え・アコーディオン ------------------------------------------

  function applyView() {
    el.workspace.dataset.view = state.view;
    document.querySelectorAll('#viewTabs .view-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.view));
    document.querySelectorAll('#sheetSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.sheet === state.sheetMode));
  }

  function setView(view, fromHistory) {
    state.view = view;
    if (view !== 'edit') state.sheetMode = view === 'answer' ? 'answer' : 'question';
    applyView();
    renderPaper();
    window.scrollTo({ top: 0 });
    if (view !== 'edit') scrollPreviewToStart();
    if (!fromHistory) { try { history.pushState({ view }, ''); } catch (error) { /* 履歴が使えなくても動く */ } }
    save();
  }

  function setSheetMode(mode) {
    state.sheetMode = mode;
    if (state.view !== 'edit') state.view = mode === 'answer' ? 'answer' : 'preview';
    applyView();
    renderPaper();
    save();
  }

  /** 上の3つの選択（学年から／自分で／写真・AI）の、選ばれている状態を合わせる */
  function syncTiles() {
    document.querySelectorAll('#quickActions .tile[data-goto]').forEach((tile) => {
      const on = tile.dataset.goto === state.openTool;
      tile.classList.toggle('is-active', on);
      tile.setAttribute('aria-selected', String(on));
    });
  }

  function openTool(name) {
    document.querySelectorAll('details.tool').forEach((d) => { d.open = d.id === 'tool-' + name; });
    state.openTool = name;
    syncTiles();
    save();
  }

  // ---- 取り込み（OCR・AI・まとめて貼り付け） --------------------------------

  function createImporter(cfg) {
    const textarea = $(cfg.textId);
    const preview = $(cfg.previewId);
    const typeSelect = $(cfg.typeId);
    const overrides = new Map();
    let parsed = { items: [], skipped: [] };

    const included = (item) => (overrides.has(item._line) ? overrides.get(item._line) : !item._weak);

    function render() {
      parsed = KI.parseBulk(textarea.value, { type: typeSelect.value, source: cfg.source, lookup: lookupEntry });
      if (parsed.error) {
        preview.innerHTML = '<div class="ip-summary is-error">' + esc(parsed.error) + '</div>';
        return;
      }
      if (!parsed.items.length && !parsed.skipped.length) { preview.innerHTML = ''; return; }
      const active = parsed.items.filter(included).length;
      const rows = parsed.items.map((item, i) => {
        const main = item.kanji ? esc(item.kanji) + (item.reading ? '（' + esc(item.reading) + '）' : '') : '';
        const warns = KI.checkQuestion(item);
        const note = item._note || (warns.length ? warns[0] : '');
        return '<li class="ip-item' + (included(item) ? '' : ' is-off') + '"><label>' +
          '<input type="checkbox" data-idx="' + i + '"' + (included(item) ? ' checked' : '') + '>' +
          '<span class="chip type-' + item.type + '">' + esc(TYPE_LABELS[item.type]) + '</span>' +
          (main ? '<span class="ip-main">' + main + '</span>' : '') +
          (item.sentence ? '<span class="ip-sentence">' + esc(item.sentence) + '</span>' : '') +
          (item._enriched ? '<span class="ip-auto">よみがな・例文は自動で入れました</span>' : '') +
          (note ? '<span class="ip-warn">⚠ ' + esc(note) + '</span>' : '') +
          '</label></li>';
      }).join('');
      const skipped = parsed.skipped.map((s) => '<li class="ip-skip">読み取れなかった行：' + esc(s.line) + '（' + esc(s.reason) + '）</li>').join('');
      preview.innerHTML = '<div class="ip-summary">' + parsed.items.length + '問見つかりました。<strong>追加する問題：' + active + '問</strong>' +
        '<span class="ip-note">（追加したくない問題は、チェックを外します）</span></div><ul class="ip-list">' + rows + skipped + '</ul>';
    }

    preview.addEventListener('change', (event) => {
      const idx = event.target.dataset.idx;
      if (idx === undefined) return;
      overrides.set(parsed.items[Number(idx)]._line, event.target.checked);
      render();
    });
    textarea.addEventListener('input', () => { cfg.onText(textarea.value); render(); });
    typeSelect.addEventListener('change', () => { state.importTypes[cfg.key] = typeSelect.value; save(); render(); });
    $(cfg.addId).addEventListener('click', () => {
      const chosen = parsed.items.filter(included);
      if (!chosen.length) {
        toast(parsed.error || (parsed.items.length
          ? '追加する問題にチェックが入っていません。'
          : '問題として読み取れる行がありません。1行に1問、「巣（す）／くもの巣がはる。」の形か、漢字だけを並べて入れてください。'), 'warn');
        return;
      }
      const created = addQuestions(chosen, cfg.source, true);
      if (!created.length) {
        toast('同じ問題がすでに入っているので、追加しませんでした。', 'warn');
        return;
      }
      const noData = Math.min(created.length, chosen.filter((c) => c._note).length);
      const auto = Math.min(created.length, chosen.filter((c) => c._enriched).length);
      textarea.value = '';
      overrides.clear();
      cfg.onText('');
      render();
      toast(created.length + '問を追加しました（合計 ' + state.questions.length + '問）' +
        (created.skipped ? '　同じ問題' + created.skipped + '問は追加していません。' : '') +
        (auto ? '　' + auto + '問は、読みと例文を自動で入れました。' : '') +
        (noData ? '　' + noData + '問は、小学校の漢字の問題データにないため、読み・例文が空です。' : ''), noData ? 'warn' : '', {
        label: '問題一覧を見る', run: () => $('listPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })
      });
    });

    return { render };
  }

  // ---- OCR -----------------------------------------------------------------

  let ocrToken = 0;
  let thumbUrl = null;

  function setOcrStatus(message, kind) {
    el.ocrStatus.textContent = message;
    el.ocrStatus.className = 'status-box' + (kind ? ' is-' + kind : '');
  }

  const OCR_STATUS_TEXT = {
    'loading tesseract core': '読み取りの準備をしています',
    'initializing tesseract': '読み取りの準備をしています',
    'loading language traineddata': '日本語データを読み込み中（初回は時間がかかります）',
    'initializing api': '読み取りの準備をしています',
    'recognizing text': '文字を読み取っています'
  };

  async function handleOcrFile(file) {
    if (!file) return;
    const token = ++ocrToken;
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(file);
    el.ocrThumb.src = thumbUrl;
    el.ocrThumb.hidden = false;
    setOcrStatus('読み取り中…', 'busy');
    [el.ocrCameraBtn, el.ocrPickBtn].forEach((b) => { b.disabled = true; });

    try {
      const result = await KI.runOcr(file, state.ocrProvider, {
        onProgress: (m) => {
          if (token !== ocrToken) return;
          const label = OCR_STATUS_TEXT[m.status] || m.status || '処理中';
          const pct = typeof m.progress === 'number' ? ' ' + Math.round(m.progress * 100) + '%' : '';
          setOcrStatus(label + pct, 'busy');
        }
      }, { vertical: state.ocrVertical });
      if (token !== ocrToken) return;
      el.ocrText.value = result.text;
      state.ocrText = result.text;
      ocrImporter.render();
      save();
      if (result.mock) setOcrStatus('デモの結果です（写真は読み取っていません）。下の欄を直して動作を試せます。', 'warn');
      else if (!result.text) setOcrStatus('文字を読み取れませんでした。明るい場所で真上から撮り直すか、下の欄に直接入力してください。', 'warn');
      else setOcrStatus('読み取りが完了しました。文字の読み間違いがないか確認してから、「問題に追加」を押してください。', 'ok');
    } catch (error) {
      console.error(error);
      if (token === ocrToken) setOcrStatus('読み取りに失敗しました：' + error.message + ' 「自分で」から手入力もできます。', 'error');
    } finally {
      [el.ocrCameraBtn, el.ocrPickBtn].forEach((b) => { b.disabled = false; });
      el.ocrFile.value = '';
      el.ocrCamera.value = '';
    }
  }

  // ---- AI プロンプト --------------------------------------------------------

  function buildAiPrompt() {
    const range = RANGE_LABELS[state.gen.range] || '小学1〜6年';
    const theme = (state.aiTheme || '').trim();
    return [
      'あなたは日本の小学校の国語の先生です。漢字テスト用の問題を作ってください。',
      '',
      '【条件】',
      '・対象：' + range + '（学年別漢字配当表の漢字）',
      '・問題数：' + (countsTotal() || state.gen.count) + '問',
      '・同じ漢字を重複して出さない',
      '・例文は自然な日本語で、その学年までに習う漢字とひらがな・カタカナだけで書く（習っていない漢字はひらがなにする）',
      '・出題する語は、例文の中にそのままの形で1回だけ入れる',
      theme ? '・テーマ：' + theme : null,
      '',
      '【出力形式】説明文は不要です。次の形式で1行に1問ずつ出力してください。',
      '漢字（よみ）／例文',
      '',
      '例：',
      '巣（す）／くもの巣がはる。',
      '歩く（あるく）／公園を歩く。',
      '',
      '（JSON配列で出力する場合）',
      '[{"type":"kaki","grade":4,"kanji":"巣","reading":"す","sentence":"くもの巣がはる。","answer":"巣"}]',
      'type は kaki(書き) / yomi(読み) / sentence(文中の□に書く) / okuri(送りがな) / mas(練習マス) / trace(なぞり書き) / free(自由入力) のいずれか。'
    ].filter((line) => line !== null).join('\n');
  }

  function refreshPromptText() { el.aiPromptText.value = buildAiPrompt(); }

  async function copyPrompt() {
    refreshPromptText();
    const text = el.aiPromptText.value;
    try {
      await navigator.clipboard.writeText(text);
      toast('AIへのお願い文をコピーしました。AIに貼り付けてください。');
    } catch (error) {
      el.aiPromptText.closest('details').open = true;
      el.aiPromptText.focus();
      el.aiPromptText.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      toast(ok ? 'AIへのお願い文をコピーしました。' : '自動コピーできませんでした。選択されている文章を長押しでコピーしてください。', ok ? '' : 'warn');
    }
  }

  // ---- 自分で作る（フォーム） ---------------------------------------------------------

  function resetCustomForm(keepFocus) {
    el.customKanji.value = '';
    el.customReading.value = '';
    el.customSentence.value = '';
    el.customAnswer.value = '';
    if (keepFocus) el.customKanji.focus();
  }

  /** 題庫の1件から問題を作って追加する（漢字だけを入力したとき） */
  function addFromEntry(entry, type, style, answer) {
    const q = questionFromEntry(entry, type);
    q.source = 'custom';
    q.style = style || q.style;
    if (answer) q.answer = answer;
    addQuestions([q], 'custom');
    resetCustomForm(true);
    toast('「' + entry.word + '」の読みと例文を自動で入れて追加しました（合計 ' + state.questions.length + '問）', '', {
      label: '問題一覧を見る', run: () => $('listPanel').scrollIntoView({ behavior: 'smooth', block: 'start' })
    });
  }

  function addCustomQuestion() {
    const type = el.customType.value;
    let kanji = el.customKanji.value.trim();
    const reading = el.customReading.value.trim();
    let sentence = el.customSentence.value.trim();
    let answer = el.customAnswer.value.trim();

    if (!kanji && !sentence) { toast('漢字か例文を入力してください', 'warn'); el.customKanji.focus(); return; }

    // 「花の（　）が出る。」+ 答え「芽」→ 例文を「花の芽が出る。」にそろえる
    if (KI.hasBlank(sentence)) {
      const fill = answer || kanji;
      if (fill) { sentence = KI.fillBlank(sentence, fill); kanji = kanji || fill; }
    }
    // 漢字だけの入力なら、小学校の漢字は読みと例文を題庫から補う
    if (kanji && !reading && !sentence) {
      const entry = lookupEntry(kanji);
      if (entry) { addFromEntry(entry, type, el.customStyle.value, answer); return; }
    }
    const draft = { type, kanji, reading, sentence, answer, style: el.customStyle.value };
    if (!draft.answer) draft.answer = KI.defaultAnswer(draft, type);

    const [created] = addQuestions([draft], 'custom');
    resetCustomForm(true);
    const warns = KI.checkQuestion(created);
    toast('追加しました（合計 ' + state.questions.length + '問）' + (warns.length ? ' ⚠ ' + warns[0] : ''), warns.length ? 'warn' : '');
  }

  // ---- コントロールの同期 ---------------------------------------------------

  // 問題の種類は、名前だけでは違いが分かりにくいので、用紙に出る形の小さな絵と一言を添える
  // 答えを書く場所（マス／かっこ／線）の見た目。種類カードの絵も、これに合わせて変わる
  const sideMark = (style, tall) => style === 'kakko' ? '<i class="tv-k' + (tall ? ' tv-tk' : '') + '"></i>'
    : style === 'line' ? '<i class="tv-ln' + (tall ? ' tv-tk' : '') + '"></i>' : '<i class="tv-b' + (tall ? ' tv-tall' : '') + '"></i>';
  const TYPE_INFO = {
    auto: { desc: '文を見て自動で選ぶ', thumb: '<span class="tv-word">自動</span>' },
    kaki: { desc: 'ひらがなを漢字で書く', short: 'ひらがな→漢字',
      thumb: (st) => '<span class="tv-t">くもの<i class="tv-u">す</i></span>' + sideMark(st) },
    yomi: { desc: '漢字の読みを書く', short: '漢字→ひらがな',
      thumb: (st) => '<span class="tv-t">くもの<i class="tv-u">巣</i></span>' + sideMark(st) },
    sentence: { desc: '□に入る漢字を書く', short: '□に漢字を書く',
      thumb: '<span class="tv-t">花の<i class="tv-b"></i>が</span>' },
    okuri: { desc: '送りがなも書く', short: '送りがなを書く',
      thumb: '<span class="tv-t"><ruby>借<rt>か</rt></ruby><i class="tv-b tv-tall"></i></span>' },
    mas: { desc: 'お手本を見て練習する', short: 'お手本を練習',
      thumb: '<span class="tv-t"><i class="tv-b tv-m">巣</i><i class="tv-b"></i><i class="tv-b"></i></span>' },
    trace: { desc: 'うすい字をなぞる', short: 'うすい字をなぞる',
      thumb: '<span class="tv-t"><i class="tv-b tv-g">巣</i><i class="tv-b tv-g">巣</i><i class="tv-b"></i></span>' },
    free: { desc: '問題文を、そのまま出す', short: '問題文のまま',
      thumb: (st) => '<span class="tv-t">問題文</span>' + sideMark(st === 'kakko' ? 'kakko' : 'line', true) }
  };

  function typeThumb(value, style) {
    const info = TYPE_INFO[value] || { thumb: '' };
    return typeof info.thumb === 'function' ? info.thumb(style || 'mas') : info.thumb;
  }

  function typeCardInner(value, label, short, style) {
    const info = TYPE_INFO[value] || { desc: '' };
    return '<span class="tv" aria-hidden="true">' + typeThumb(value, style) + '</span>' +
      '<span class="tc-text"><span class="tc-name">' + esc(label).replace('（', '<wbr>（') + '</span>' +
      '<span class="tc-desc">' + esc(short && info.short ? info.short : info.desc) + '</span></span>';
  }

  function renderTypePills() {
    el.typePills.innerHTML = TYPES.map((t) =>
      '<button type="button" class="pill-btn type-card" data-type="' + t + '" aria-pressed="false" title="' + esc(TYPE_INFO[t].desc) + '">' + typeCardInner(t, TYPE_LABELS[t], true) + '</button>').join('');
  }

  /**
   * 種類の select（値の保管場所として残す）の上に、絵のカードで選ぶ部品を作る。
   * 部品の値は select と同じ：クリックで select.value を変えて change を出す。
   * compact のものは、いまの選択だけを見せ、「変える」で一覧を開く。
   */
  function buildTypePicker(host) {
    const select = $(host.dataset.for);
    const compact = host.classList.contains('is-compact');
    const options = Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent }));
    // 「自分で」の種類カードは、「答えを書く場所」の選択（マス／かっこ／線）に合わせて絵を変える
    const styleOf = () => (host.dataset.for === 'customType' && el.customStyle ? el.customStyle.value : 'mas');
    host.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'type-cards';
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-labelledby', host.dataset.label);
    list.innerHTML = options.map((o) =>
      '<button type="button" class="type-card" role="radio" aria-checked="false" data-value="' + esc(o.value) + '">' +
      typeCardInner(o.value, o.label, false, styleOf()) + '</button>').join('');
    let box = null;
    if (compact) {
      box = document.createElement('details');
      box.className = 'type-fold';
      box.innerHTML = '<summary class="type-now"></summary>';
      box.appendChild(list);
      host.appendChild(box);
    } else {
      host.appendChild(list);
    }
    const refresh = () => {
      list.querySelectorAll('.type-card').forEach((b) => {
        const on = b.dataset.value === select.value;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
        const tv = b.querySelector('.tv');
        if (tv) tv.innerHTML = typeThumb(b.dataset.value, styleOf());
      });
      if (box) {
        const now = options.find((o) => o.value === select.value) || options[0];
        box.querySelector('summary').innerHTML = typeCardInner(now.value, now.label, false, styleOf()) + '<span class="tc-change">変える</span>';
      }
    };
    list.addEventListener('click', (event) => {
      const b = event.target.closest('.type-card');
      if (!b) return;
      select.value = b.dataset.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      refresh();
      if (box) box.open = false;
    });
    host.refreshPicker = refresh;
    refresh();
  }

  function refreshTypePickers() {
    document.querySelectorAll('.type-picker').forEach((h) => { if (h.refreshPicker) h.refreshPicker(); });
  }

  function fillSelect(select, values, labels) {
    select.innerHTML = values.map((v) => '<option value="' + esc(v) + '">' + esc(labels[v]) + '</option>').join('');
  }

  function syncControls() {
    el.gradeRange.value = state.gen.range;
    el.genReplace.checked = !!state.gen.replace;
    el.avoidRecent.checked = !!state.gen.avoidRecent;
    updateHistoryCount();
    document.querySelectorAll('#countPills .pill-btn').forEach((b) => {
      const on = Number(b.dataset.count) === countsTotal();
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('#typePills .pill-btn').forEach((b) => {
      const on = state.gen.types.includes(b.dataset.type);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    el.printFormat.value = state.format;
    renderTypeCounts();
    el.ocrProvider.value = state.ocrProvider;
    el.ocrVertical.checked = !!state.ocrVertical;
    el.ocrText.value = state.ocrText;
    el.aiInput.value = state.aiText;
    el.aiTheme.value = state.aiTheme;
    el.bulkText.value = state.bulkText;
    el.ocrType.value = state.importTypes.ocr;
    el.aiType.value = state.importTypes.ai;
    el.bulkType.value = state.importTypes.bulk;
    refreshTypePickers();
    document.querySelectorAll('[data-setting]').forEach((input) => {
      const value = state[input.dataset.setting];
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = value;
    });
    document.querySelectorAll('details.tool').forEach((d) => { d.open = d.id === 'tool-' + state.openTool; });
    syncTiles();
    refreshPromptText();
  }

  // ---- 名前をつけて保存・呼び出し（学年・回ごとに使い分ける） ------------------------

  const SETS_KEY = 'kanji-test-maker-sets';
  const SET_SETTINGS = ['format', 'tiers', 'title', 'subtitle', 'pointsEach', 'font', 'showName', 'showScore', 'showClass', 'showDate',
    'showInstructions', 'readingHint'];

  function readSets() {
    try {
      const list = JSON.parse(localStorage.getItem(SETS_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function writeSets(list) {
    try {
      localStorage.setItem(SETS_KEY, JSON.stringify(list));
      return true;
    } catch (error) {
      toast('保存できませんでした（このブラウザの保存場所がいっぱいです）', 'warn');
      return false;
    }
  }

  function renderSets() {
    const list = readSets();
    el.setList.innerHTML = list.length ? list.map((set) => {
      const d = new Date(set.savedAt || 0);
      return '<div class="set-item" data-set-id="' + esc(set.id) + '"><div class="set-info"><strong>' + esc(set.name) + '</strong>' +
        '<span>' + (set.questions || []).length + '問／' + (d.getMonth() + 1) + '月' + d.getDate() + '日</span></div>' +
        '<button type="button" class="soft-btn" data-set-action="load">呼び出す</button>' +
        '<button type="button" class="inline-action danger" data-set-action="delete">消す</button></div>';
    }).join('') : '<p class="hint">まだ保存したセットはありません。</p>';
  }

  function saveSet() {
    const name = el.setName.value.trim();
    if (!name) { toast('セットの名前を入れてください（例：小3 第5回 A）', 'warn'); el.setName.focus(); return; }
    if (!state.questions.length) { toast('問題がありません。先に問題を作ってください。', 'warn'); return; }
    const list = readSets();
    const settings = {};
    SET_SETTINGS.forEach((k) => { settings[k] = state[k]; });
    const snap = { id: uid(), name, savedAt: Date.now(), questions: state.questions.map((q) => Object.assign({}, q)), settings };
    const i = list.findIndex((s) => s.name === name);
    if (i >= 0) {
      if (!window.confirm('「' + name + '」はすでに保存されています。上書きしますか？')) return;
      snap.id = list[i].id;
      list[i] = snap;
    } else {
      list.unshift(snap);
    }
    if (writeSets(list)) {
      renderSets();
      toast('「' + name + '」を保存しました（' + state.questions.length + '問）');
    }
  }

  function loadSet(id) {
    const set = readSets().find((s) => s.id === id);
    if (!set) return;
    const before = { questions: state.questions.slice(), settings: {} };
    SET_SETTINGS.forEach((k) => { before.settings[k] = state[k]; });
    state.questions = (set.questions || []).map(normalizeQuestion);
    Object.keys(set.settings || {}).forEach((k) => { if (SET_SETTINGS.includes(k)) state[k] = set.settings[k]; });
    ui.openId = null;
    syncControls();
    afterQuestionsChanged();
    toast('「' + set.name + '」を呼び出しました（' + state.questions.length + '問）', '', {
      label: '元に戻す', run: () => {
        state.questions = before.questions;
        Object.assign(state, before.settings);
        syncControls();
        afterQuestionsChanged();
      }
    });
  }

  function deleteSet(id) {
    const list = readSets();
    const set = list.find((s) => s.id === id);
    if (!set || !window.confirm('保存したセット「' + set.name + '」を消します。よろしいですか？')) return;
    if (writeSets(list.filter((s) => s.id !== id))) renderSets();
  }

  // ---- 保存・読み込み（ファイル） ---------------------------------------------

  /** 問題と設定を JSON ファイルにして書き出す（別の端末へ移すため） */
  function exportFile() {
    const data = { app: 'kanji-test-maker', version: 2, exportedAt: new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kanji-test-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('ファイルに書き出しました（' + state.questions.length + '問）');
  }

  async function importFileFrom(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const source = data && data.state ? data.state : data;
      if (!source || !Array.isArray(source.questions)) throw new Error('このアプリで書き出したファイルではありません');
      if (!window.confirm('今ある問題と設定を、読み込むファイルの内容（' + source.questions.length + '問）に置き換えます。よろしいですか？')) return;
      Object.assign(state, defaultState());
      applyStored(source);
      ui.openId = null;
      syncControls();
      applyView();
      [ocrImporter, aiImporter, bulkImporter].forEach((imp) => imp.render());
      renderList();
      renderPaper();
      persist();
      toast('読み込みました（' + state.questions.length + '問）');
    } catch (error) {
      const message = error instanceof SyntaxError ? 'ファイルの中身を読み取れませんでした。このアプリで書き出したファイルを選んでください。' : error.message;
      toast('読み込めませんでした：' + message, 'warn');
    }
  }

  // ---- 書体 -----------------------------------------------------------------

  /** この端末に教科書体があるかを調べる。なければ選択肢に正直に書く（実際は明朝体で表示される） */
  function detectKyokasho() {
    const option = document.querySelector('#setFont option[value="kyokasho"]');
    if (!option) return;
    let installed = false;
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      const sample = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const width = (family) => { ctx.font = '72px ' + family; return ctx.measureText(sample).width; };
      const baseMono = width('monospace');
      const baseSerif = width('serif');
      installed = ['UD Digi Kyokasho N-R', 'UD デジタル 教科書体 N-R', 'UD デジタル 教科書体 NK-R', 'YuKyokasho', '游教科書体', 'Kyokasho ICA']
        .some((name) => width("'" + name + "', monospace") !== baseMono || width("'" + name + "', serif") !== baseSerif);
    } catch (error) {
      return;
    }
    option.textContent = installed ? '教科書体' : '教科書体（この端末では明朝体）';
  }

  // ---- イベント -------------------------------------------------------------

  let ocrImporter;
  let aiImporter;
  let bulkImporter;

  function attachEvents() {
    // 表示切り替え
    document.querySelectorAll('#viewTabs .view-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    document.querySelectorAll('#sheetSeg button').forEach((b) => b.addEventListener('click', () => setSheetMode(b.dataset.sheet)));
    document.querySelectorAll('#quickActions .tile').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.goto === 'preview') setView('preview');
      else openTool(b.dataset.goto);
    }));

    // アコーディオン（1つだけ開く）
    document.querySelectorAll('details.tool').forEach((d) => d.addEventListener('toggle', () => {
      if (!d.open) return;
      document.querySelectorAll('details.tool').forEach((o) => { if (o !== d) o.open = false; });
      state.openTool = d.id.replace('tool-', '');
      syncTiles();
      save();
    }));

    // 印刷
    el.printBtn.addEventListener('click', doPrint);
    $('printBtn2').addEventListener('click', doPrint);
    window.addEventListener('beforeprint', renderPrintArea);

    // 問題を作る
    el.gradeRange.addEventListener('change', () => { state.gen.range = el.gradeRange.value; refreshPromptText(); save(); });
    el.genReplace.addEventListener('change', () => { state.gen.replace = el.genReplace.checked; save(); });
    el.avoidRecent.addEventListener('change', () => { state.gen.avoidRecent = el.avoidRecent.checked; save(); });
    $('countPills').addEventListener('click', (event) => {
      const b = event.target.closest('.pill-btn');
      if (!b) return;
      state.gen.count = Number(b.dataset.count);
      resetCounts();
      syncControls();
      refreshPromptText();
      save();
    });
    el.typePills.addEventListener('click', (event) => {
      const b = event.target.closest('.pill-btn');
      if (!b) return;
      const set = new Set(state.gen.types);
      if (set.has(b.dataset.type)) { if (set.size > 1) set.delete(b.dataset.type); else { toast('問題の種類は、少なくとも1つ選んでください', 'warn'); return; } } else set.add(b.dataset.type);
      state.gen.types = TYPES.filter((t) => set.has(t));
      resetCounts();
      syncControls();
      save();
    });
    $('clearHistoryBtn').addEventListener('click', () => { state.history = []; updateHistoryCount(); save(); toast('出した漢字の記録を消しました'); });
    // 種類ごとの問題数（手で変えたら、その数の合計で作る）
    el.typeCounts.addEventListener('input', (event) => {
      const type = event.target.dataset.countType;
      if (!type) return;
      state.gen.counts[type] = Math.max(0, Math.min(100, Math.floor(Number(event.target.value) || 0)));
      state.gen.countsDirty = true;
      const strong = el.typeCounts.querySelector('.tc-total strong');
      if (strong) strong.textContent = countsTotal();
      document.querySelectorAll('#countPills .pill-btn').forEach((b) => {
        const on = Number(b.dataset.count) === countsTotal();
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      save();
    });
    $('generateBtn').addEventListener('click', drawQuestions);

    // 自作
    $('addQuestionBtn').addEventListener('click', addCustomQuestion);
    $('resetFormBtn').addEventListener('click', () => resetCustomForm(true));

    // 一覧
    el.questionList.addEventListener('click', onListClick);
    el.questionList.addEventListener('input', onListInput);
    el.questionList.addEventListener('change', onListChange);
    $('shuffleBtn').addEventListener('click', () => { state.questions = shuffle(state.questions); afterQuestionsChanged(); });
    $('groupTypeBtn').addEventListener('click', () => {
      const order = [];
      state.questions.forEach((q) => { if (!order.includes(q.type)) order.push(q.type); });
      state.questions = state.questions
        .map((q, i) => ({ q, i }))
        .sort((a, b) => order.indexOf(a.q.type) - order.indexOf(b.q.type) || a.i - b.i)
        .map((x) => x.q);
      afterQuestionsChanged();
    });
    $('sortGradeBtn').addEventListener('click', () => {
      state.questions = state.questions
        .map((q, i) => ({ q, i }))
        .sort((a, b) => (a.q.grade || 9) - (b.q.grade || 9) || a.i - b.i)
        .map((x) => x.q);
      afterQuestionsChanged();
    });
    $('bulkTypeSelect').addEventListener('change', (event) => {
      const type = event.target.value;
      event.target.value = '';
      if (type) changeAllTypes(type);
    });
    $('clearAllBtn').addEventListener('click', () => {
      if (!state.questions.length) return;
      if (!window.confirm('問題を ' + state.questions.length + '問すべて消します。よろしいですか？')) return;
      state.questions = [];
      ui.openId = null;
      afterQuestionsChanged();
    });

    el.listNotice.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-id]');
      if (button) removeQuestion(button.dataset.removeId);
    });

    // 通知はタップで消せる（プレビューの操作バーを隠したままにしない）
    el.toast.addEventListener('click', (event) => { if (!event.target.closest('.toast-action')) el.toast.hidden = true; });

    // 名前をつけて保存・呼び出し
    $('saveSetBtn').addEventListener('click', saveSet);
    el.setName.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); saveSet(); } });
    el.setList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-set-action]');
      const item = event.target.closest('[data-set-id]');
      if (!button || !item) return;
      if (button.dataset.setAction === 'load') loadSet(item.dataset.setId);
      else deleteSet(item.dataset.setId);
    });
    el.paperHost.addEventListener('click', (event) => { if (event.target.closest('.sample-btn')) loadSample(); });

    // ブラウザの「戻る」で、サイトから出ずに前の画面（編集⇔プレビュー）へ戻る
    window.addEventListener('popstate', (event) => {
      const view = event.state && event.state.view;
      if (view && view !== state.view) setView(view, true);
    });

    // 保存・読み込み（別の端末へ移す）
    $('exportBtn').addEventListener('click', exportFile);
    $('importBtn').addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', () => { importFileFrom(el.importFile.files && el.importFile.files[0]); el.importFile.value = ''; });

    // OCR
    $('ocrCameraBtn').addEventListener('click', () => el.ocrCamera.click());
    $('ocrPickBtn').addEventListener('click', () => el.ocrFile.click());
    [el.ocrCamera, el.ocrFile].forEach((input) => input.addEventListener('change', () => handleOcrFile(input.files && input.files[0])));
    el.ocrProvider.addEventListener('change', () => { state.ocrProvider = el.ocrProvider.value; save(); });
    el.ocrVertical.addEventListener('change', () => { state.ocrVertical = el.ocrVertical.checked; save(); });

    // AI
    $('copyPromptBtn').addEventListener('click', copyPrompt);
    el.aiTheme.addEventListener('input', () => { state.aiTheme = el.aiTheme.value; refreshPromptText(); save(); });

    // 用紙設定
    el.printFormat.addEventListener('change', () => { state.format = el.printFormat.value; renderPaper(); save(); });
    document.querySelectorAll('[data-setting]').forEach((input) => {
      const handler = () => {
        state[input.dataset.setting] = input.type === 'checkbox' ? input.checked : input.value;
        schedulePaper();
        save();
      };
      input.addEventListener(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', handler);
    });
    $('zoomIn').addEventListener('click', () => zoomBy(1));
    $('zoomOut').addEventListener('click', () => zoomBy(-1));
    $('zoomFit').addEventListener('click', () => { state.zoom = 'fit'; applyZoom(); scrollPreviewToStart(); save(); });

    if (window.ResizeObserver) new ResizeObserver(debounce(applyZoom, 60)).observe(el.viewport);
    window.addEventListener('resize', debounce(applyZoom, 100));
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
  }

  // ---- 起動 -----------------------------------------------------------------

  function cacheElements() {
    [
      'saveState', 'printBtn', 'workspace', 'toast', 'listCount', 'tabCount', 'questionList', 'paperHost', 'printArea', 'pageStyle',
      'sheetViewport', 'gradeRange', 'genReplace', 'avoidRecent', 'typePills', 'typeCounts', 'drawStatus', 'printFormat', 'zoomFit', 'zoomLabel',
      'sheetInfo', 'importFile', 'historyCount', 'listNotice', 'setName', 'setList',
      'ocrProvider', 'ocrVertical', 'ocrText', 'ocrStatus', 'ocrThumb', 'ocrFile', 'ocrCamera', 'ocrCameraBtn', 'ocrPickBtn', 'ocrType',
      'aiInput', 'aiTheme', 'aiType', 'aiPromptText', 'bulkText', 'bulkType',
      'customType', 'customStyle', 'customKanji', 'customReading', 'customSentence', 'customAnswer'
    ].forEach((id) => { el[id] = $(id); });
    el.viewport = el.sheetViewport;
  }

  function initialize() {
    cacheElements();
    fillSelect(el.customType, TYPES, TYPE_LABELS);
    $('bulkTypeSelect').innerHTML = '<option value="">種類を選ぶ…</option>' +
      TYPES.filter((t) => t !== 'free').map((t) => '<option value="' + t + '">すべて「' + esc(TYPE_LABELS[t]) + '」にする</option>').join('');
    fillSelect(el.customStyle, STYLES, STYLE_LABELS);
    el.customStyle.addEventListener('change', refreshTypePickers);
    const importTypes = { auto: '自動判定' };
    TYPES.forEach((t) => { importTypes[t] = TYPE_LABELS[t]; });
    ['ocrType', 'aiType', 'bulkType'].forEach((id) => fillSelect(el[id], Object.keys(importTypes), importTypes));
    el.ocrProvider.innerHTML = Object.keys(KI.OCR_PROVIDERS).map((k) => '<option value="' + k + '">' + esc(KI.OCR_PROVIDERS[k].label) + '</option>').join('');
    renderTypePills();
    document.querySelectorAll('.type-picker').forEach(buildTypePicker);

    const hadSaved = loadState();
    if (!state.gen.types.every((t) => Number.isFinite(Number(state.gen.counts[t])))) resetCounts();
    syncControls();
    applyView();

    ocrImporter = createImporter({
      key: 'ocr', textId: 'ocrText', previewId: 'ocrPreview', typeId: 'ocrType', addId: 'ocrAddBtn', source: 'ocr',
      onText: (v) => { state.ocrText = v; save(); }
    });
    aiImporter = createImporter({
      key: 'ai', textId: 'aiInput', previewId: 'aiPreview', typeId: 'aiType', addId: 'aiAddBtn', source: 'ai',
      onText: (v) => { state.aiText = v; save(); }
    });
    bulkImporter = createImporter({
      key: 'bulk', textId: 'bulkText', previewId: 'bulkPreview', typeId: 'bulkType', addId: 'bulkAddBtn', source: 'paste',
      onText: (v) => { state.bulkText = v; save(); }
    });
    [ocrImporter, aiImporter, bulkImporter].forEach((imp) => imp.render());

    attachEvents();

    detectKyokasho();
    renderSets();
    try { history.replaceState({ view: state.view }, ''); } catch (error) { /* 何もしない */ }
    renderList();
    renderPaper();
    if (state.view !== 'edit') scrollPreviewToStart();
    persist();
  }

  initialize();
})();
