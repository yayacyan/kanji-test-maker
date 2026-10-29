/*
 * 画面の言葉。日本語が既定（日本）。English は外から来た人向け。
 * 漢字・読み・例文そのものは訳さない。ボタンや見出し、用紙の欄だけを切り替える。
 */
(function (global) {
  'use strict';

  const LANG_KEY = 'kanji-test-maker-lang';

  const TEXT = {
    'doc-title': { ja: '漢字テストメーカー', en: 'Kanji Test Maker' },
    'brand-name': { ja: '漢字テストメーカー', en: 'Kanji Test Maker' },
    'brand-sub': { ja: '小学校 漢字テスト作成', en: 'Elementary kanji worksheets' },
    'save-idle': { ja: 'この端末に自動保存', en: 'Saved on this device' },
    'print': { ja: '印刷 / PDF', en: 'Print / PDF' },
    'eyebrow': { ja: '小学校の漢字テスト作成', en: 'Elementary kanji worksheets' },
    'hero-title': { ja: '<span class="hero-line">縦書きの漢字テストを、</span><span class="hero-line">その場で作る。</span>', en: '<span class="hero-line">A vertical kanji test,</span><span class="hero-line">ready to print.</span>', html: true },
    'hero-sub': { ja: '学年から選ぶ・自分で入れる・写真から。できたら、そのまま印刷できます。<br />書きじゅんをおぼえる「筆順練習プリント」も作れます。', en: 'Pick by grade, type your own, or start from a photo. Then print it.<br />You can also make a stroke-order practice sheet.', html: true },
    'sample-cap': { ja: '見本', en: 'Sample' },
    'tile-grade': { ja: '学年から', en: 'By grade' },
    'tile-grade-sub': { ja: '小1〜6を自動で', en: 'Grades 1–6, automatic' },
    'tile-custom': { ja: '自分で', en: 'Your own' },
    'tile-custom-sub': { ja: '打つ・貼り付け', en: 'Type or paste' },
    'tile-import': { ja: '写真・AI', en: 'Photo / AI' },
    'tile-import-sub': { ja: '写真やAIから', en: 'From a photo or AI' },
    'tile-preview': { ja: 'プレビュー', en: 'Preview' },
    'qs-divider': { ja: 'テストではなく、練習プリント', en: 'Not a test — a practice sheet' },
    'tile-stroke': { ja: '筆順練習プリント', en: 'Stroke-order practice' },
    'tile-stroke-sub': { ja: '書きじゅんの番号・なぞり書き・書き取りマス入り', en: 'Stroke numbers, tracing, and writing boxes' },
    'sum-import': { ja: '写真・AIから取り込む', en: 'From a photo or AI' },
    'ocr-title': { ja: '写真から読み取る', en: 'Read a photo' },
    'ocr-camera': { ja: '写真を撮る', en: 'Take a photo' },
    'ocr-pick': { ja: '画像を選ぶ', en: 'Choose an image' },
    'ocr-settings': { ja: '読み取りの設定', en: 'Reading settings' },
    'ocr-method': { ja: '読み取り方法', en: 'How to read' },
    'ocr-vertical': { ja: '縦書きの写真のときはチェック', en: 'Check this for vertical writing' },
    'ocr-status': { ja: '写真を選ぶと、読み取りを始めます。', en: 'Choose a photo to start reading.' },
    'ocr-result': { ja: '読み取り結果（この欄で直接直せます）', en: 'What was read (you can fix it here)' },
    'q-type': { ja: '問題の種類', en: 'Question type' },
    'add-questions': { ja: '問題に追加', en: 'Add to the test' },
    'ai-title': { ja: 'AIに問題を作ってもらう', en: 'Ask an AI to write questions' },
    'ai-hint': { ja: 'お使いのAI（ChatGPTなど）に「お願い文」を貼り付けて、返ってきた答えをこの下の欄に貼り付けます。', en: 'Paste the request into your AI (ChatGPT or similar), then paste its answer below.' },
    'ai-theme': { ja: 'テーマ（なくてもOK）', en: 'Theme (optional)' },
    'ai-copy': { ja: 'AIへのお願い文をコピー', en: 'Copy the request for the AI' },
    'ai-see': { ja: 'コピーされる内容を見る', en: 'See what will be copied' },
    'ai-paste': { ja: 'AIの答えを貼り付け（形式：漢字（よみ）／例文）', en: 'Paste the AI’s answer (kanji (reading) / sentence)' },
    'sum-draw': { ja: '学年から問題を作る', en: 'Make questions by grade' },
    'grade': { ja: '学年', en: 'Grade' },
    'g1': { ja: '小学1年', en: 'Grade 1' },
    'g2': { ja: '小学2年', en: 'Grade 2' },
    'g3': { ja: '小学3年', en: 'Grade 3' },
    'g4': { ja: '小学4年', en: 'Grade 4' },
    'g5': { ja: '小学5年', en: 'Grade 5' },
    'g6': { ja: '小学6年', en: 'Grade 6' },
    'g12': { ja: '小学1〜2年', en: 'Grades 1–2' },
    'g13': { ja: '小学1〜3年', en: 'Grades 1–3' },
    'g16': { ja: '小学1〜6年', en: 'Grades 1–6' },
    'q-count': { ja: '問題の数', en: 'How many' },
    'n10': { ja: '10問', en: '10' },
    'n15': { ja: '15問', en: '15' },
    'n20': { ja: '20問', en: '20' },
    'n30': { ja: '30問', en: '30' },
    'n50': { ja: '50問', en: '50' },
    'paper-size': { ja: '用紙の大きさ', en: 'Paper size' },
    'paper-size-short': { ja: '用紙', en: 'Paper' },
    'size-hint': {
      html: true,
      ja: '書きやすい大きさにするには、A4縦・レター縦なら10問くらいまでがおすすめです（問題の種類や文の長さで変わります。作ったあと、大きさの目安が出ます）。マスを大きくしたいときは、まず用紙をA4横かレター横にして試してみてください。多くの場合は同じ問題数でも大きくなりますが、練習マス・なぞり書きのようにマスを下へ積む種類では、かえって小さくなることもあります。それでも小さいときはA3横も試せます（A3は大きな紙なので、家庭用プリンターでは印刷できないことがあります。コンビニなどの印刷が必要です）。レターは、アメリカなどでよく使う用紙の大きさです。問題を作ったあとは、用紙を変えるとマスが何mmになるかを実際に測って案内します。',
      en: 'For boxes that are easy to write in, about 10 questions is a good start on A4 portrait or Letter portrait (it depends on the question types and how long the sentences are. After you make them, the page shows the size). To make the boxes bigger, try A4 landscape or Letter landscape first. That usually helps, but practice grids and tracing stack downward, so landscape can make those smaller. If they are still small, try A3 landscape (A3 is a large sheet; many home printers cannot print it, so a copy shop may be needed). Letter is the size most homes in the US use. After the questions are made, changing the paper shows the real box size in millimeters.'
    },
    'types-label': { ja: '問題の種類（複数選べます）', en: 'Question types (pick more than one)' },
    'make': { ja: '問題を作る', en: 'Make questions' },
    'draw-status': { ja: '同じ漢字は重ならないように選びます。', en: 'The same kanji will not be repeated.' },
    'more-settings': { ja: 'くわしい設定', en: 'More settings' },
    'replace': { ja: '前回に作った問題を入れ替える（自分で作った問題・写真・AIの問題は残します）', en: 'Replace the questions made last time (questions you typed, or added from a photo or AI, stay)' },
    'avoid': { ja: '以前に出した漢字はなるべくさける', en: 'Try to skip kanji used before' },
    'history': { ja: '出した漢字の記録：', en: 'Kanji used so far:' },
    'history-unit': { ja: '字', en: '' },
    'clear-history': { ja: '記録を消す', en: 'Clear' },
    'sum-custom': { ja: '自分で問題を作る', en: 'Write your own questions' },
    'custom-type': { ja: '1問ずつ入れる問題の種類（できあがりの絵で選べます）', en: 'Type for one question (pick from the picture)' },
    'answer-place': { ja: '答えを書く場所', en: 'Where to write the answer' },
    'kanji': { ja: '漢字', en: 'Kanji' },
    'reading': { ja: 'よみがな', en: 'Reading' },
    'sentence': { ja: '例文', en: 'Sentence' },
    'answer-auto': { ja: '答え（空欄なら自動で入ります）', en: 'Answer (filled in if you leave it blank)' },
    'add': { ja: '追加', en: 'Add' },
    'clear': { ja: 'クリア', en: 'Clear' },
    'bulk-title': { ja: 'まとめて貼り付け', en: 'Paste several at once' },
    'bulk-hint': {
      html: true,
      ja: '1行に1問。<strong>漢字だけ書いても大丈夫</strong>です（例：巣 歩 観）。小学校の漢字なら、よみがなと例文が自動で入ります。次の形も使えます。',
      en: 'One question per line. <strong>Kanji alone is fine</strong> (for example: 巣 歩 観). Grade-school kanji get a reading and a sentence automatically. These shapes work too.'
    },
    'bulk-type': { ja: 'まとめて追加する問題の種類', en: 'Type for the pasted questions' },
    'sum-stroke': { ja: '筆順練習プリントを作る', en: 'Make a stroke-order sheet' },
    'stroke-lead': {
      html: true,
      ja: '漢字の<strong>書きじゅん（赤い数字）</strong>と読み、なぞり書き・書き取りのマスが入った、横書きの練習プリントを作ります。小学1〜6年の1026字が使えます。',
      en: 'A horizontal practice sheet with <strong>stroke-order numbers in red</strong>, readings, tracing boxes, and blank writing boxes. All 1,026 elementary-school kanji are available.'
    },
    'stroke-kanji': { ja: '練習する漢字', en: 'Kanji to practice' },
    'stroke-status': { ja: '練習したい漢字を入れてください。下の一覧から選べます。', en: 'Type the kanji to practice, or tap them in the list below.' },
    'pick-grade': { ja: '学年から選ぶ', en: 'Pick from a grade' },
    'chip-hint': { ja: '下の字を押すと、上の欄に出たり消えたりします。', en: 'Tap a character below to add or remove it.' },
    'stroke-clear': { ja: 'えらんだ字を全部消す', en: 'Clear all' },
    'stroke-sample': { ja: '見本の字を入れる', en: 'Use the sample' },
    'sheet-name': { ja: 'プリントの名前', en: 'Sheet title' },
    'trace-count': { ja: 'なぞり書きのマス', en: 'Tracing boxes' },
    'blank-count': { ja: '書き取りのマス', en: 'Writing boxes' },
    'none': { ja: 'なし', en: 'None' },
    'cell1': { ja: '1マス', en: '1' },
    'cell2': { ja: '2マス', en: '2' },
    'cell3': { ja: '3マス', en: '3' },
    'cell4': { ja: '4マス', en: '4' },
    'cell5': { ja: '5マス', en: '5' },
    'cell6': { ja: '6マス', en: '6' },
    'cell8': { ja: '8マス', en: '8' },
    'cell10': { ja: '10マス', en: '10' },
    'cell-hint': { ja: 'マスを増やすと1マスが小さくなります。小さくなりすぎるときは、用紙をA4横・レター横・A3横にしてください。', en: 'More boxes means each box is smaller. If they get too small, try A4 landscape, Letter landscape, or A3 landscape.' },
    'stroke-about': { ja: '筆順データについて（出典と、確かめた範囲）', en: 'About the stroke-order data (source and what was checked)' },
    'stroke-about-1': {
      html: true,
      ja: 'このプリントの筆順は、公開されている筆順データ「<strong>KanjiVG</strong>」（作成者：Ulrich Apel 氏ほか／CC BY-SA 3.0）をもとにしています。日英辞典サイトの Jisho.org など、漢字の学習サイトやアプリでも使われているデータで、誤りの指摘を受けながら修正が続けられています。読みは <strong>KANJIDIC2</strong>（電子辞書研究開発グループ／CC BY-SA 4.0）をもとに、そのうち<strong>常用漢字表</strong>（平成22年内閣告示第2号）の音訓欄に挙げられているものだけを載せています。',
      en: 'Stroke order comes from <strong>KanjiVG</strong> (Ulrich Apel and others / CC BY-SA 3.0), the same data used by sites such as Jisho.org. It is corrected when mistakes are reported. Readings come from <strong>KANJIDIC2</strong> (CC BY-SA 4.0), limited to the readings listed in the official Jōyō Kanji table (2010).'
    },
    'stroke-about-2': {
      html: true,
      ja: '<strong>確かめたこと</strong><br />・小学校で習う漢字1026字すべてについて、KanjiVG の画数と KANJIDIC2 の画数が一致すること<br />・同じ1026字すべてについて、プリントに描かれる画の数と、筆順を示す赤い番号の数が一致すること<br />・筆順を迷いやすい「確」「成」の2字について、文部省『筆順指導の手びき』（昭和33年）に示された筆順と一致すること',
      en: '<strong>What was checked</strong><br />・For all 1,026 elementary kanji, the KanjiVG stroke count matches KANJIDIC2.<br />・For the same 1,026, the strokes drawn on the sheet match the red stroke numbers.<br />・For 確 and 成, the order matches the Ministry of Education stroke-order guide (1958).'
    },
    'stroke-about-3': {
      html: true,
      ja: '<strong>確かめていないこと</strong><br />教科書の筆順表と1字ずつ照らし合わせる作業は行っていません。お子さんやクラスに渡す前に、お手元の教科書の筆順表と見比べていただけると、より確実です。',
      en: '<strong>What was not checked</strong><br />These have not been compared, one by one, with a textbook stroke chart. Please check your textbook before handing the sheet to a child or a class.'
    },
    'stroke-about-4': { ja: 'また、筆順は教科書によって異なることがあります。『筆順指導の手びき』にも、そこで取り上げていない筆順を誤りとするものではない、という趣旨の記述があります。違いにお気づきの場合は、お使いの教科書の筆順を優先してください。', en: 'Stroke order can differ by textbook. The official guide also says that an order it does not list is not automatically wrong. If you notice a difference, follow your textbook.' },
    'stroke-make': { ja: '筆順練習プリントを作る', en: 'Make the practice sheet' },
    'list-title': { ja: '問題一覧', en: 'Questions' },
    'shuffle': { ja: 'シャッフル', en: 'Shuffle' },
    'group-type': { ja: '種類ごと', en: 'By type' },
    'group-type-title': { ja: '同じ種類の問題を、続けて並べます', en: 'Keep questions of the same type together' },
    'sort-grade': { ja: '学年順', en: 'By grade' },
    'clear-all': { ja: '全部消す', en: 'Delete all' },
    'bulk-change': { ja: '全部の問題の種類を、まとめて変える', en: 'Change every question to one type' },
    'sets-title': { ja: '保存した問題', en: 'My saved tests' },
    'sets-hint': { ja: 'いまのテスト、または筆順練習を、名前をつけてこの端末に残せます。名前を空のまま保存すると、日付・学年・問題数が入ります。別の端末へは、一覧のファイルで移せます。', en: 'Save this test, or a stroke-order sheet, on this device under a name. Leave the name empty and the date, grade, and count are used. Move the list to another device by exporting the file.' },
    'save': { ja: '保存', en: 'Save' },
    'set-name': { ja: 'セットの名前', en: 'Name of the set' },
    'set-open': { ja: '開く', en: 'Open' },
    'set-print': { ja: '印刷', en: 'Print' },
    'set-duplicate': { ja: 'コピーして編集', en: 'Duplicate and edit' },
    'set-rename': { ja: '名前', en: 'Rename' },
    'set-rename-save': { ja: '決定', en: 'Save name' },
    'set-rename-cancel': { ja: 'やめる', en: 'Cancel' },
    'set-delete': { ja: '消す', en: 'Delete' },
    'set-empty': { ja: 'まだ保存した問題はありません。', en: 'No saved tests yet.' },
    'set-stroke-tag': { ja: '筆順', en: 'Strokes' },
    'export-sets': { ja: '一覧を書き出す', en: 'Export the list' },
    'import-sets': { ja: '一覧を読み込む', en: 'Import a list' },
    'ph-set': { ja: '空なら日付・学年・問題数', en: 'Empty uses date, grade, and count' },
    'update-msg': { ja: '新しい版があります。読み込むと、最新の画面になります。', en: 'A new version is ready. Load it to get the latest screen.' },
    'update-btn': { ja: '読み込む', en: 'Load it' },
    'backup-sum': { ja: 'いまの問題をファイルにする（別の端末で使うとき）', en: 'Export this test (to use on another device)' },
    'backup-hint': { ja: 'いま開いている問題と設定は、この端末のブラウザにも自動で残ります。ファイルにすると、別のスマホやパソコンへ移せます。保存した一覧は、上の「一覧を書き出す」を使います。', en: 'The test you have open is also kept in this browser. A file lets you move it to another phone or computer. For the saved list, use Export the list above.' },
    'export': { ja: 'ファイルに書き出す', en: 'Export a file' },
    'import': { ja: 'ファイルから読み込む', en: 'Import a file' },
    'sheet-kind': { ja: '用紙の種類', en: 'Which sheet' },
    'zoom': { ja: '拡大縮小', en: 'Zoom' },
    'tabs': { ja: '表示切り替え', en: 'Switch view' },
    'viewport': { ja: 'テスト用紙のプレビュー（横にスクロールできます）', en: 'Worksheet preview (you can scroll sideways)' },
    'how': { ja: 'つくり方をえらぶ', en: 'How to make it' },
    'ph-theme': { ja: '例：春の生きもの、学校生活', en: 'Example: spring, school' },
    'ph-sub': { ja: '例：3年 第2回', en: 'Example: Grade 3, week 2' },
    'ph-stroke': { ja: '水 花 祭（つづけて「水花祭」と打ってもかまいません）', en: '水 花 祭 (or type 水花祭 with no spaces)' },
    'ph-points': { ja: '例：2', en: 'Example: 2' },
    'sheet-q': { ja: '問題用紙', en: 'Questions' },
    'sheet-a': { ja: '解答用紙', en: 'Answers' },
    'sheet-s': { ja: '筆順練習', en: 'Strokes' },
    'zoom-out': { ja: '縮小', en: 'Zoom out' },
    'zoom-in': { ja: '拡大', en: 'Zoom in' },
    'zoom-fit': { ja: '画面に合わせる', en: 'Fit' },
    'zoom-fit-short': { ja: '合わせる', en: 'Fit' },
    'layout-sum': { ja: '用紙と並び方の設定', en: 'Paper and layout' },
    'test-name': { ja: 'テストの名前', en: 'Test title' },
    'subtitle': { ja: '見出しの補足（学年・単元など）', en: 'Subtitle (grade, unit, and so on)' },
    'tiers': { ja: '並べる段の数', en: 'Rows' },
    'tier-auto': { ja: 'おまかせ', en: 'Automatic' },
    'tier1': { ja: '1段', en: '1 row' },
    'tier2': { ja: '2段', en: '2 rows' },
    'tier3': { ja: '3段', en: '3 rows' },
    'tier4': { ja: '4段', en: '4 rows' },
    'tier5': { ja: '5段', en: '5 rows' },
    'font': { ja: '書体', en: 'Typeface' },
    'font-kyo': { ja: '教科書体', en: 'Textbook' },
    'font-min': { ja: '明朝体', en: 'Mincho (serif)' },
    'font-goth': { ja: 'ゴシック体', en: 'Gothic (sans)' },
    'points': { ja: '1問あたりの点数（合計を「点／◯点」と表示）', en: 'Points per question (the total is shown as “Score / N”)' },
    'reps': { ja: '練習マス・なぞり書きで、同じ字を書く回数（1列10マスまで）', en: 'How many times to write the same character (up to 10 boxes in a column)' },
    'rep1': { ja: '1回', en: '1' },
    'rep2': { ja: '2回', en: '2' },
    'rep3': { ja: '3回', en: '3' },
    'rep4': { ja: '4回', en: '4' },
    'rep5': { ja: '5回', en: '5' },
    'opt-ins': { ja: '問題の種類ごとの説明文を入れる', en: 'Add a short instruction for each question type' },
    'opt-name': { ja: '名前の欄を入れる', en: 'Name line' },
    'opt-class': { ja: '学年・組の欄を入れる', en: 'Grade and class line' },
    'opt-date': { ja: '日付の欄を入れる', en: 'Date line' },
    'opt-score': { ja: '点数の欄を入れる', en: 'Score line' },
    'opt-ruby': { ja: '例文の空欄に、読みがなを小さく付ける', en: 'Show a small reading beside fill-in boxes' },
    'opt-okuri': { ja: '送りがなのマスを字数どおりにする（字数から答えがわかります）', en: 'Make okurigana boxes match the number of letters (that gives the answer away)' },
    'opt-both': { ja: '印刷するとき、問題用紙と解答用紙を続けて出す', en: 'When printing, include the question sheet and the answer sheet' },
    'pdf-hint': { ja: 'PDFにするとき：印刷の画面で「PDFに保存」を選びます（用紙サイズは自動で合います）。端が切れるときは、余白を「なし」、倍率を「100%」にして、用紙を画面で選んだ大きさ（A4・レター・A3）に合わせてください。', en: 'To make a PDF: in the print dialog, choose “Save as PDF” (the paper size should match). If the edges are cut off, set margins to None, scale to 100%, and choose the same paper (A4, Letter, or A3).' },
    'print-hint': { ja: 'できたら右上の「印刷 / PDF」を押します。印刷画面で「PDFとして保存」を選ぶと、ファイルにも残せます。', en: 'When it looks right, press Print / PDF. Choose “Save as PDF” if you want a file.' },
    'tab-edit': { ja: '編集', en: 'Edit' },
    'tab-preview': { ja: 'プレビュー', en: 'Preview' },
    'tab-answer': { ja: '解答', en: 'Answers' },
    'changelog': { ja: '更新履歴 ／ Changelog ／ 更新日誌', en: 'Changelog' },
    'sponsor-note': { ja: 'この道具が役に立ったら、制作を', en: 'If this tool helps, you can' },
    'sponsor': { ja: '応援する', en: 'support it' },
    'support-title': { ja: '応援する', en: 'Support this tool' },
    'support-stub': { ja: 'アプリの中からの応援は、まだ準備中です。', en: 'Support from inside the app is not ready yet.' },
    'support-tier-1': { ja: 'お茶を一杯', en: 'A cup of tea' },
    'support-tier-2': { ja: 'おやつ', en: 'A snack' },
    'support-tier-3': { ja: '食事をごちそう', en: 'A meal' },
    'confirm-title': { ja: '印刷する前に、確かめてください', en: 'Check this before you print' },
    'confirm-back': { ja: '戻って直す', en: 'Go back and fix' },
    'confirm-go': { ja: 'このまま印刷する', en: 'Print anyway' },
    'credit-1': {
      html: true,
      ja: '筆順データ：KanjiVG（著作者 Ulrich Apel）CC BY-SA 3.0<br />　<a href="https://kanjivg.tagaini.net" target="_blank" rel="noopener">https://kanjivg.tagaini.net</a>／ <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">https://creativecommons.org/licenses/by-sa/3.0/</a><br />　※小学校で学ぶ1026字ぶんのデータを抽出し、本サイトの表示用に加工しています。',
      en: 'Stroke data: KanjiVG (Ulrich Apel) CC BY-SA 3.0<br />　<a href="https://kanjivg.tagaini.net" target="_blank" rel="noopener">https://kanjivg.tagaini.net</a> / <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">https://creativecommons.org/licenses/by-sa/3.0/</a><br />　The 1,026 elementary-school characters were extracted and adapted for this site.'
    },
    'credit-2': {
      html: true,
      ja: '読みデータ：KANJIDIC2 — Electronic Dictionary Research and Development Group の所有物であり、<br />　同グループのライセンスに従って使用しています。CC BY-SA 4.0<br />　<a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noopener">https://www.edrdg.org/wiki/index.php/KANJIDIC_Project</a>／ <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noopener">https://www.edrdg.org/edrdg/licence.html</a><br />　※音読み・訓読みのみを抽出し、表示用に加工しています。',
      en: 'Reading data: KANJIDIC2 is the property of the Electronic Dictionary Research and Development Group,<br />　and is used under that group’s license. CC BY-SA 4.0<br />　<a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noopener">https://www.edrdg.org/wiki/index.php/KANJIDIC_Project</a> / <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noopener">https://www.edrdg.org/edrdg/licence.html</a><br />　Only on and kun readings were extracted and adapted for display.'
    }
  };

  const TYPE = {
    kaki: { ja: '書き（線のひらがな）', en: 'Write (underlined hiragana)', descJa: 'ひらがなを漢字で書く', descEn: 'Write the kanji for the hiragana', shortJa: 'ひらがな→漢字', shortEn: 'Hiragana → kanji' },
    yomi: { ja: '読み（線の漢字）', en: 'Read (underlined kanji)', descJa: '漢字の読みを書く', descEn: 'Write the reading', shortJa: '漢字→ひらがな', shortEn: 'Kanji → hiragana' },
    sentence: { ja: '書き（文中の□）', en: 'Fill the box in the sentence', descJa: '□に入る漢字を書く', descEn: 'Write the kanji for the box', shortJa: '□に漢字を書く', shortEn: 'Kanji in the box' },
    okuri: { ja: '送りがな', en: 'Okurigana', descJa: '漢字のあとに続くひらがなを書く（「借りる」の「りる」）', descEn: 'Write the hiragana after the kanji (the りる in 借りる)', shortJa: '「借りる」の「りる」', shortEn: 'The ending of 借りる' },
    mas: { ja: '練習マス', en: 'Practice boxes', descJa: 'お手本を見て練習する', descEn: 'Copy the model into the boxes', shortJa: 'お手本を練習', shortEn: 'Copy the model' },
    trace: { ja: 'なぞり書き', en: 'Trace', descJa: 'うすい字をなぞる', descEn: 'Trace the light gray character', shortJa: 'うすい字をなぞる', shortEn: 'Trace the gray one' },
    free: { ja: '自由入力', en: 'Your own prompt', descJa: '問題文を、そのまま出す', descEn: 'Print the sentence as written', shortJa: '問題文のまま', shortEn: 'The sentence as-is' },
    auto: { ja: '自動判定', en: 'Choose automatically', descJa: '文を見て自動で選ぶ', descEn: 'Choose from the sentence', shortJa: '自動', shortEn: 'Auto' }
  };

  const STYLE = {
    mas: { ja: 'マス', en: 'Boxes' },
    kakko: { ja: 'かっこ', en: 'Brackets' },
    line: { ja: '線', en: 'Lines' }
  };

  const FORMAT = {
    'A4-portrait': { ja: 'A4 縦', en: 'A4 portrait', shortJa: 'A4縦', shortEn: 'A4 portrait' },
    'A4-landscape': { ja: 'A4 横', en: 'A4 landscape', shortJa: 'A4横', shortEn: 'A4 landscape' },
    'Letter-portrait': { ja: 'レター 縦（米国）', en: 'Letter portrait', shortJa: 'レター縦', shortEn: 'Letter portrait' },
    'Letter-landscape': { ja: 'レター 横（米国）', en: 'Letter landscape', shortJa: 'レター横', shortEn: 'Letter landscape' },
    'A3-landscape': { ja: 'A3 横', en: 'A3 landscape', shortJa: 'A3横', shortEn: 'A3 landscape' }
  };

  const HINT = {
    kaki: {
      ja: { kanji: '橋', reading: 'はし', kanjiLabel: '漢字（書けるようにしたい語）', readingLabel: 'よみがな', hint: '「漢字」に答えの語、「よみがな」にその読みを入れてください。例文には、読みのほう（ひらがな）を書きます（自動でも変換されます）。' },
      en: { kanji: '橋', reading: 'はし', kanjiLabel: 'Kanji (the word to write)', readingLabel: 'Reading', hint: 'Put the answer word in Kanji and its reading in Reading. The sentence should use the hiragana reading (it is converted for you if needed).' }
    },
    yomi: {
      ja: { kanji: '橋', reading: 'はし', kanjiLabel: '漢字（読み方を答えさせたい語）', readingLabel: 'よみがな（答え）', hint: '「漢字」に読ませたい語、「よみがな」にその読み（答え）を入れてください。例文には、漢字のほうを書きます。' },
      en: { kanji: '橋', reading: 'はし', kanjiLabel: 'Kanji (the word to read)', readingLabel: 'Reading (the answer)', hint: 'Put the word in Kanji and the reading (the answer) in Reading. The sentence should use the kanji.' }
    },
    sentence: {
      ja: { kanji: '芽', reading: '', kanjiLabel: '漢字（□に入る語）', readingLabel: 'よみがな（あれば）', hint: '「漢字」に□に入る語を入れてください。例文に□がなくても、その語がそのまま入っていれば、自動で□になります。' },
      en: { kanji: '芽', reading: '', kanjiLabel: 'Kanji (what goes in the box)', readingLabel: 'Reading (optional)', hint: 'Put the word that belongs in the box in Kanji. If the sentence contains that word, the box is added for you.' }
    },
    okuri: {
      ja: { kanji: '借りる', reading: 'かりる', kanjiLabel: '漢字（送りがなを含む語、そのまま）', readingLabel: 'よみがな（語全体）', hint: '「借りる」のように、漢字のあとにひらがなが続く語を、そのまま「漢字」に入れてください（「借」と「りる」に分けて別の欄に入れる必要はありません）。送りがなの部分だけが、自動で答えの四角になります。' },
      en: { kanji: '借りる', reading: 'かりる', kanjiLabel: 'Kanji (the whole word, including the ending)', readingLabel: 'Reading (the whole word)', hint: 'Type the whole word, such as 借りる, in Kanji. You do not need to split 借 and りる. Only the ending becomes the answer boxes.' }
    },
    mas: {
      ja: { kanji: '鏡', reading: 'かがみ', kanjiLabel: '漢字（練習させたい語）', readingLabel: 'よみがな（あれば）', hint: '「漢字」に、くり返し書かせたい語を入れてください。' },
      en: { kanji: '鏡', reading: 'かがみ', kanjiLabel: 'Kanji (the word to practice)', readingLabel: 'Reading (optional)', hint: 'Put the word you want written again and again in Kanji.' }
    },
    trace: {
      ja: { kanji: '雪', reading: 'ゆき', kanjiLabel: '漢字（なぞらせたい語）', readingLabel: 'よみがな（あれば）', hint: '「漢字」に、うすい字でなぞらせたい語を入れてください。' },
      en: { kanji: '雪', reading: 'ゆき', kanjiLabel: 'Kanji (the word to trace)', readingLabel: 'Reading (optional)', hint: 'Put the word to trace in light gray in Kanji.' }
    },
    free: {
      ja: { kanji: '', reading: '', kanjiLabel: '漢字（あれば）', readingLabel: 'よみがな（あれば）', hint: '「例文」に問題文をそのまま入れてください（そのまま出題され、□や線は付きません）。' },
      en: { kanji: '', reading: '', kanjiLabel: 'Kanji (optional)', readingLabel: 'Reading (optional)', hint: 'Put the question itself in Sentence. It is printed as written, with no box or line.' }
    }
  };

  let lang = 'ja';

  function fill(str, vars) {
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, (all, key) => (vars[key] == null ? all : String(vars[key])));
  }

  function localeTag() {
    const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    return String(list[0] || '');
  }

  function localeParts(tag) {
    try {
      const loc = new Intl.Locale(tag);
      return { language: String(loc.language || '').toLowerCase(), region: String(loc.region || '').toUpperCase() };
    } catch (error) {
      const bits = String(tag || '').split('-');
      return { language: (bits[0] || '').toLowerCase(), region: (bits[1] || '').toUpperCase() };
    }
  }

  /** 日本（ja、または地域 JP）なら true。空のときは日本扱い（今までの既定を守る） */
  function isJapanLocale() {
    const tag = localeTag();
    if (!tag) return true;
    const parts = localeParts(tag);
    return parts.language === 'ja' || parts.region === 'JP';
  }

  function defaultLang() {
    return isJapanLocale() ? 'ja' : 'en';
  }

  function defaultPaper() {
    return isJapanLocale() ? 'A4-portrait' : 'Letter-portrait';
  }

  function readSavedLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'ja' || saved === 'en') return saved;
    } catch (error) { /* 読めなくても既定で進む */ }
    return null;
  }

  function t(id, vars) {
    const item = TEXT[id];
    if (!item) return id;
    return fill(lang === 'en' ? item.en : item.ja, vars);
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const item = TEXT[el.getAttribute('data-i18n')];
      if (!item) return;
      const value = lang === 'en' ? item.en : item.ja;
      if (item.html || el.hasAttribute('data-i18n-html')) el.innerHTML = value;
      else el.textContent = value;
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    document.documentElement.lang = lang === 'en' ? 'en' : 'ja';
    document.title = t('doc-title');
    document.querySelectorAll('[data-set-lang]').forEach((btn) => {
      const on = btn.getAttribute('data-set-lang') === lang;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'ja';
    try { localStorage.setItem(LANG_KEY, lang); } catch (error) { /* 覚えられなくても表示は切り替わる */ }
    apply(document);
    return lang;
  }

  function initLang() {
    lang = readSavedLang() || defaultLang();
    return lang;
  }

  global.KanjiI18n = {
    t: t,
    apply: apply,
    setLang: setLang,
    initLang: initLang,
    lang: function () { return lang; },
    isJapanLocale: isJapanLocale,
    defaultPaper: defaultPaper,
    typeLabel: function (id) { const row = TYPE[id]; return row ? (lang === 'en' ? row.en : row.ja) : id; },
    typeDesc: function (id, short) {
      const row = TYPE[id] || TYPE.auto;
      if (short) return lang === 'en' ? row.shortEn : row.shortJa;
      return lang === 'en' ? row.descEn : row.descJa;
    },
    styleLabel: function (id) { const row = STYLE[id]; return row ? (lang === 'en' ? row.en : row.ja) : id; },
    formatChoice: function (id) { const row = FORMAT[id]; return row ? (lang === 'en' ? row.en : row.ja) : id; },
    formatShort: function (id) { const row = FORMAT[id]; return row ? (lang === 'en' ? row.shortEn : row.shortJa) : id; },
    customHint: function (id) {
      const row = HINT[id] || HINT.kaki;
      return lang === 'en' ? row.en : row.ja;
    },
    TEXT: TEXT
  };
})(window);
