/* 漢字テストメーカーのオフライン用。バージョンが変わると、古い保存分は消して新しいファイルを取りにいく。
   置いてある場所（/ でも /kanji-test-maker/ でも）からの相対パスだけを使う。 */
const VERSION = '2026-10-29-sets-1';
const CACHE = 'kanji-test-maker-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './changelog.html',
  './styles.css',
  './paper.css',
  './app.js',
  './i18n.js',
  './import.js',
  './config.js',
  './kanji-db.js',
  './kanji-strokes-base.js',
  './kanji-strokes-g1.js',
  './kanji-strokes-g2.js',
  './kanji-strokes-g3.js',
  './kanji-strokes-g4.js',
  './kanji-strokes-g5.js',
  './kanji-strokes-g6.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('kanji-test-maker-') && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (error) {
      const cached = await caches.match(req) || (req.mode === 'navigate' ? await caches.match('./index.html') : null);
      if (cached) return cached;
      throw error;
    }
  })());
});
