// 正解スナップショットを取得する。
//   1. Hugo 本番相当（--minify）でビルド
//   2. テキスト系(HTML/XML/JSON)は正規化して golden/normalized/ に保存（diffレビュー可能）
//   3. バイナリ系(画像/フォント/css/js等)は sha256 を golden/assets.manifest.json に保存
//
// 使い方:
//   node capture.mjs            # Hugoでビルドして取得
//   node capture.mjs --dir DIR  # 既存のビルド済みディレクトリから取得

import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR, buildSite, walkFiles, sha256File, hugoVersion, inputFingerprint } from './lib/util.mjs';
import { normalizerFor } from './lib/normalize.mjs';

const GOLDEN = path.join(HARNESS_DIR, 'golden');
const NORMALIZED = path.join(GOLDEN, 'normalized');
const BUILD = path.join(HARNESS_DIR, '.build', 'capture');

function parseArgs(argv) {
  const args = { dir: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') args.dir = path.resolve(argv[++i]);
    else if (argv[i] === '--force') args.force = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const srcDir = args.dir || buildSite(BUILD, { minify: true });

const files = walkFiles(srcDir);

// 建て直し中に誤って capture を叩くと、テンプレ未完成の出力で正解を上書きして
// 復旧不能になる。既存goldenより極端に少ない生成物は事故とみなして止める。
const metaPath = path.join(GOLDEN, 'meta.json');
if (!args.force && existsSync(metaPath)) {
  const prev = JSON.parse(readFileSync(metaPath, 'utf-8'));
  if (files.length < prev.fileCount * 0.9) {
    console.error(
      `中断: 生成物が既存goldenより大幅に少ない (${files.length} < ${prev.fileCount})。\n` +
        'テンプレ建て直し中の誤爆の可能性があります。意図的な取り直しなら --force を付けてください。',
    );
    process.exit(2);
  }
}

// golden をクリーンして作り直す
rmSync(GOLDEN, { recursive: true, force: true });
mkdirSync(NORMALIZED, { recursive: true });
const manifest = {};
let textCount = 0;
let assetCount = 0;

for (const rel of files) {
  const abs = path.join(srcDir, rel);
  const normalize = normalizerFor(rel);
  if (normalize) {
    const normalized = normalize(readFileSync(abs, 'utf-8'));
    const dest = path.join(NORMALIZED, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, normalized);
    textCount++;
  } else {
    manifest[rel] = sha256File(abs);
    assetCount++;
  }
}

// キー順ソートしてマニフェスト書き出し
const sortedManifest = {};
for (const k of Object.keys(manifest).sort()) sortedManifest[k] = manifest[k];
writeFileSync(path.join(GOLDEN, 'assets.manifest.json'), JSON.stringify(sortedManifest, null, 2) + '\n');

const meta = {
  createdAt: new Date().toISOString(),
  source: args.dir ? `dir:${args.dir}` : 'hugo --buildFuture --minify',
  hugoVersion: hugoVersion(),
  fileCount: files.length,
  textCount,
  assetCount,
  inputs: inputFingerprint(),
};
writeFileSync(path.join(GOLDEN, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

console.log(`captured: ${files.length} files (text ${textCount}, assets ${assetCount})`);
console.log(`  -> ${path.relative(process.cwd(), GOLDEN)}`);
