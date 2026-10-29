# アプリの公開（まだ出しません）

ストアには、まだ出しません。この文書は、公開するときに **自分で行うこと** と、リポジトリにすでに入っているものの一覧です。

アプリの ID は `io.github.yayacyan.kanjitestmaker` です。**最初にストアへ上げる前なら変えられます。** 一度公開したあとは変えられません。変えるときは `capacitor.config.json` の `appId` と、Android の `applicationId`、iOS の Bundle Identifier を同じ値にそろえてください。

## すでに入っているもの

- いまのウェブサイトを、Capacitor で包んだ Android / iOS のプロジェクト（`android/`、`ios/`）
- 画面の「漢」から作ったアイコンと、起動画面
- デバッグ用 Android APK を作る GitHub Actions（署名の秘密情報は使いません）
- Android では、印刷ボタンから端末の印刷画面を開き、そこから PDF として保存できます
- ウェブサイトの応援リンク（`config.js` の `SPONSOR_URL`）は、アプリの中では出しません。ストアは、外の寄付リンクを禁じています

アプリ内の応援（3段階のチップ）の画面は用意してありますが、`config.js` の `ENABLE_IAP_TIPS` は **false のまま** です。課金のプログラムは、まだつながっていません。

## ウェブサイトの応援リンク

プラットフォーム（Ko-fi など）が決まったら、`config.js` のこの1行だけを変えます。

```js
var SPONSOR_URL = '';
```

空のあいだは、フッターにも更新履歴にも応援は出ません。入れたあとは、サイトだけに出ます。アプリには出ません。リンクを公開したら、`changelog.html` の先頭にある下書きコメントを、各言語の更新履歴に移してください。

## 自分で行うこと

### 1. 開発者アカウント

| ストア | 費用 | 内容 |
| --- | --- | --- |
| Google Play Console | 25米ドル（一度だけ） | 本人確認があります。個人か組織かを選び、名前と住所を出します。確認が終わるまで、アプリは出せません。 |
| Apple Developer Program | 99米ドル（毎年） | 同じく本人確認があります。組織の場合は D-U-N-S 番号が要ることがあります。 |

どちらも、公開する名前（個人名または屋号）がストアに載ります。

### 2. プライバシーポリシーの URL

Play も App Store も、**誰でも開ける URL** が必要です。このリポジトリには、まだそのページがありません。

書くこと（最低限）:

- テストの中身は、端末の中だけに保存し、サーバーには送らない
- 写真の文字認識は、ブラウザの中で処理する（端末の外へ写真を送らない）
- アプリ内で課金を始めたあとは、購入の記録を Google / Apple が扱う
- 連絡先

GitHub Pages のこのサイトに `privacy.html` を置く、で足ります。URL の例: `https://yayacyan.github.io/kanji-test-maker/privacy.html`

### 3. ストアに載せる素材

自分で用意します。

- アプリ名: 漢字テストメーカー / Kanji Test Maker
- 短い説明と、少し長い説明（日本語と、出すなら英語）
- アイコン（リポジトリの `icons/icon-512.png` を土台にできます）
- スマホと、必要ならタブレットのスクリーンショット（印刷の画面、問題を作る画面）
- 対象年齢と、内容の質問票（広告なし、課金はチップのみ、と答える想定）
- 連絡用メールアドレス

### 4. アプリ内の応援（チップ）

外の寄付リンクは、アプリに入れません。入れるなら、それぞれのストアの課金です。

1. Play Console と App Store Connect で、消耗型（または非消耗型）の商品を3つ作る。画面の段階は「お茶を一杯」「おやつ」「食事をごちそう」です。商品 ID の例: `tip_small`、`tip_medium`、`tip_large`（公開前なら変えられます）
2. Android は Google Play Billing、iOS は StoreKit を、`android/` と `ios/` の TODO の位置につなぐ
3. つながってから、`config.js` の `ENABLE_IAP_TIPS` を `true` にする。false のあいだ、その画面は出ません

価格は、ストアのコンソールで決めます。プログラムの中に金額を書き込まないでください。

### 5. 署名（秘密情報はリポジトリに置かない）

- Android: Play アプリ署名を使い、アップロード用の鍵は自分の手元だけに置く。GitHub Actions のデバッグ APK は、署名なしの確認用です。ストアには出せません。
- iOS: Apple の証明書とプロビジョニングプロファイルが要ります。Mac の Xcode で、自分のチームを選んで署名します。

## ビルド

### Android（デバッグ APK）

手元で作るとき:

```bash
npm ci
npm run cap:sync
cd android && ./gradlew assembleDebug
```

APK は `android/app/build/outputs/apk/debug/` に出ます。Android SDK（cmdline-tools、platform、build-tools）と JDK 21 が要ります。`ANDROID_HOME` を設定してください。

GitHub では、Actions の「Android debug APK」が同じものを成果物として残します。署名の秘密情報は使いません。

印刷: アプリの「印刷 / PDF」は、Android の印刷画面を開きます。その画面で「PDF に保存」を選べます。WebView の `window.print()` だけでは印刷画面が出ないため、`KanjiPrint` から `PrintManager` を呼んでいます。

### iOS

Mac が要ります。GitHub の macOS ジョブは、署名せずにシミュレータ向けの確認ビルドだけを試みます。ストア用のビルドは、自分の Mac で行います。

```bash
npm ci
npm run cap:sync
cd ios/App && pod install
open App.xcworkspace
```

Xcode で Signing & Capabilities に自分のチームを設定し、実機かシミュレータで実行します。Archive して App Store Connect へ上げるのは、そのあとです。

iOS の印刷は、まだ Android のようにはつながっていません。公開前に、`window.print()` を `UIPrintInteractionController` へ渡す処理を足してください。それまでは、Safari で開いたサイト側の印刷を使います。

## 公開してはいけないもの

- `ENABLE_IAP_TIPS` を、課金が動く前に true にしない
- アプリの中に、Ko-fi などの外の応援リンクを出さない
- 鍵、証明書、`local.properties`、API の秘密を git に入れない
