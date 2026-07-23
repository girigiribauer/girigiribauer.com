// 候補ビルドを正解スナップショットと比較する。差分ゼロ=遷宮完了。
//
// 使い方:
//   node compare.mjs                # Hugo(--minify)でビルドして比較
//   node compare.mjs --no-minify    # minifyなしでビルドして比較（正規化の較正用）
//   node compare.mjs --dir DIR      # 既存ビルド済みディレクトリを比較
//   node compare.mjs --max 40       # 表示する差分ファイル数の上限（既定 20）

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR, buildSite, walkFiles, sha256File, inputFingerprint } from './lib/util.mjs';
import { normalizerFor } from './lib/normalize.mjs';

const GOLDEN = path.join(HARNESS_DIR, 'golden');
const NORMALIZED = path.join(GOLDEN, 'normalized');
const BUILD = path.join(HARNESS_DIR, '.build', 'compare');

function parseArgs(argv) {
  const a = { dir: null, minify: true, max: 20, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') a.dir = path.resolve(argv[++i]);
    else if (argv[i] === '--no-minify') a.minify = false;
    else if (argv[i] === '--max') a.max = Number(argv[++i]);
    else if (argv[i] === '--only') a.only = argv[++i];
  }
  return a;
}

// --only は先頭一致のグロブ（* のみ対応）。建て直し中に1ページ種別ずつ緑にするため。
function scopeMatcher(pattern) {
  if (!pattern) return () => true;
  const re = new RegExp(
    '^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'),
  );
  return (rel) => re.test(rel);
}

// 2つの文字列の最初の相違行を返す（レビュー用の軽量diff）
function firstDiff(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return { line: i + 1, golden: la[i] ?? '(なし)', candidate: lb[i] ?? '(なし)' };
    }
  }
  return null;
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(GOLDEN)) {
  console.error('golden がありません。先に `node capture.mjs` を実行してください。');
  process.exit(2);
}

const srcDir = args.dir || buildSite(BUILD, { minify: args.minify });

const inScope = scopeMatcher(args.only);

const allManifest = JSON.parse(readFileSync(path.join(GOLDEN, 'assets.manifest.json'), 'utf-8'));
const manifest = Object.fromEntries(Object.entries(allManifest).filter(([rel]) => inScope(rel)));
const goldenTextFiles = (existsSync(NORMALIZED) ? walkFiles(NORMALIZED) : []).filter(inScope);
const goldenPaths = new Set([...goldenTextFiles, ...Object.keys(manifest)]);

const candidateFiles = new Set(walkFiles(srcDir).filter(inScope));

const missing = []; // golden にあって candidate にない
const extra = []; // candidate にあって golden にない
const textDiffs = [];
const assetDiffs = [];

// golden 側を基準に突き合わせ
for (const rel of goldenPaths) {
  if (!candidateFiles.has(rel)) { missing.push(rel); continue; }
}
for (const rel of candidateFiles) {
  if (!goldenPaths.has(rel)) extra.push(rel);
}

// テキスト差分
for (const rel of goldenTextFiles) {
  if (!candidateFiles.has(rel)) continue;
  const normalize = normalizerFor(rel);
  const goldenText = readFileSync(path.join(NORMALIZED, rel), 'utf-8');
  const candText = normalize(readFileSync(path.join(srcDir, rel), 'utf-8'));
  if (goldenText !== candText) {
    textDiffs.push({ rel, diff: firstDiff(goldenText, candText) });
  }
}

// アセット差分（ハッシュ）
for (const rel of Object.keys(manifest)) {
  if (!candidateFiles.has(rel)) continue;
  const h = sha256File(path.join(srcDir, rel));
  if (h !== manifest[rel]) assetDiffs.push(rel);
}

// ---- レポート ----
const total = missing.length + extra.length + textDiffs.length + assetDiffs.length;
const label = args.dir ? `dir:${args.dir}` : `hugo ${args.minify ? '--minify' : '(no minify)'}`;
console.log(`比較対象: ${label}${args.only ? `  [--only ${args.only}]` : ''}`);
console.log(`golden: text ${goldenTextFiles.length} / assets ${Object.keys(manifest).length}`);

const meta = JSON.parse(readFileSync(path.join(GOLDEN, 'meta.json'), 'utf-8'));

// goldenがいつの状態かを常に見せる。古い正解に対して緑でも意味がない。
if (meta.createdAt) {
  const mins = Math.round((Date.now() - Date.parse(meta.createdAt)) / 60000);
  const age = mins < 60 ? `${mins}分前` : mins < 1440 ? `${Math.round(mins / 60)}時間前` : `${Math.round(mins / 1440)}日前`;
  console.log(`golden取得: ${age}${meta.head ? ` (HEAD ${meta.head})` : ''}`);
}
if (meta.dirtyAtCapture?.length) {
  console.log(`  ※ 取得時に未コミット変更あり: ${meta.dirtyAtCapture.slice(0, 3).join(', ')}${meta.dirtyAtCapture.length > 3 ? ' 他' : ''}`);
}

// ビルド入力がgolden取得時から変わっていれば、差分の原因はテンプレではない可能性が高い
if (meta.inputs) {
  const now = inputFingerprint();
  const drifted = Object.keys({ ...meta.inputs, ...now }).filter((k) => meta.inputs[k] !== now[k]);
  if (drifted.length) {
    console.log('');
    console.log('⚠ ビルド入力が golden 取得時から変化しています:');
    for (const k of drifted) console.log(`    ${k}`);
    console.log('  以下の差分はテンプレートではなく入力変更が原因かもしれません。');
  }
}
console.log('');

const show = (title, items, fmt = (x) => x) => {
  if (!items.length) return;
  console.log(`■ ${title}: ${items.length}`);
  for (const it of items.slice(0, args.max)) console.log('  ' + fmt(it));
  if (items.length > args.max) console.log(`  … 他 ${items.length - args.max} 件`);
  console.log('');
};

show('欠落 (goldenにあるが未生成)', missing.sort());
show('余分 (goldenに無い生成物)', extra.sort());
show('アセット差分 (hash不一致)', assetDiffs.sort());
show('テキスト差分 (DOM非同値)', textDiffs.sort((a, b) => a.rel.localeCompare(b.rel)), (d) => {
  const at = d.diff ? ` @${d.diff.line}行目` : '';
  let s = `${d.rel}${at}`;
  if (d.diff) {
    s += `\n      - golden : ${d.diff.golden.slice(0, 200)}`;
    s += `\n      + candid : ${d.diff.candidate.slice(0, 200)}`;
  }
  return s;
});

if (total === 0) {
  console.log('✅ 差分ゼロ — DOM同値です（式年遷宮成立）');
  process.exit(0);
} else {
  console.log(`❌ 差分 ${total} 件`);
  process.exit(1);
}
