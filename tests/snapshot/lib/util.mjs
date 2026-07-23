import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// tests/snapshot/lib/util.mjs → プロジェクトルートは3つ上
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const HARNESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// dir 配下の全ファイルを POSIX 相対パスで列挙（ソート済み）
export function walkFiles(dir) {
  const out = [];
  const rec = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      const full = path.join(abs, name);
      const st = statSync(full);
      if (st.isDirectory()) rec(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  rec(dir);
  return out.sort();
}

export function sha256File(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

// Hugo 本番相当ビルド。決定論のためネットワーク系（fetch-linkcards）は回さず、
// コミット済みキャッシュ・生成物を前提にする。
export function buildSite(destAbs, { minify = true } = {}) {
  // --quiet はテンプレートのパースエラーまで潰してしまうので付けない（失敗時のみ出力を見せる）
  const args = ['--buildFuture', '--destination', destAbs, '--cleanDestinationDir'];
  if (minify) args.push('--minify');
  const res = spawnSync('hugo', args, { cwd: PROJECT_ROOT, encoding: 'utf-8' });
  if (res.status !== 0) {
    throw new Error(`hugo build failed (status ${res.status}):\n${res.stderr || res.stdout}`);
  }
  return destAbs;
}

// golden が正しいのは「取得時と同じビルド入力」のときだけ。とくに data/linkcards.json は
// build.sh / dev.sh 経由の fetch-linkcards.mjs がネットワークから暗黙に書き換えるため、
// 記事もテンプレも触っていないのに差分が出る原因になる。取得時の指紋を残して検知する。
export function inputFingerprint() {
  const targets = ['config.toml'];
  const dataDir = path.join(PROJECT_ROOT, 'data');
  if (existsSync(dataDir)) {
    for (const rel of walkFiles(dataDir)) targets.push(`data/${rel}`);
  }
  const out = {};
  for (const rel of targets.sort()) {
    const abs = path.join(PROJECT_ROOT, rel);
    if (existsSync(abs)) out[rel] = sha256File(abs);
  }
  return out;
}

export function hugoVersion() {
  const res = spawnSync('hugo', ['version'], { encoding: 'utf-8' });
  return (res.stdout || '').trim();
}
