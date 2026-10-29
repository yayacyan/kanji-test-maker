import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');
const files = [
  'index.html',
  'changelog.html',
  'styles.css',
  'paper.css',
  'app.js',
  'i18n.js',
  'import.js',
  'config.js',
  'kanji-db.js',
  'kanji-strokes-base.js',
  'kanji-strokes-g1.js',
  'kanji-strokes-g2.js',
  'kanji-strokes-g3.js',
  'kanji-strokes-g4.js',
  'kanji-strokes-g5.js',
  'kanji-strokes-g6.js',
  'manifest.webmanifest',
  'sw.js'
];

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
for (const file of files) cpSync(join(root, file), join(www, file));
cpSync(join(root, 'icons'), join(www, 'icons'), { recursive: true });
