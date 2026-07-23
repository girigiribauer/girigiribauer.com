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

// golden が正しいのは「取得時と同じビルド入力」のときだけ。ずれる経路は2つある。
//   1. data/linkcards.json … build.sh / dev.sh 経由の fetch-linkcards.mjs が
//      ネットワークから暗黙に書き換える（プレビューしただけで出力が変わる）。
//   2. content/**.md … capture の後に記事を書けば、当然出力が変わる。
// どちらもテンプレの回帰ではないので、指紋を残して「入力が動いた」と言えるようにする。
export function inputFingerprint() {
  const out = {};

  const targets = ['config.toml'];
  const dataDir = path.join(PROJECT_ROOT, 'data');
  if (existsSync(dataDir)) {
    for (const rel of walkFiles(dataDir)) targets.push(`data/${rel}`);
  }
  for (const rel of targets.sort()) {
    const abs = path.join(PROJECT_ROOT, rel);
    if (existsSync(abs)) out[rel] = sha256File(abs);
  }

  // 記事は数が多いので、1本の集約ハッシュにまとめる（meta.json を肥大させない）
  const contentDir = path.join(PROJECT_ROOT, 'content');
  if (existsSync(contentDir)) {
    const h = createHash('sha256');
    let n = 0;
    for (const rel of walkFiles(contentDir)) {
      if (!rel.endsWith('.md')) continue;
      h.update(rel).update(sha256File(path.join(contentDir, rel)));
      n++;
    }
    out['content/**.md'] = `${n}files:${h.digest('hex').slice(0, 16)}`;
  }

  return out;
}

// golden がいつ・どの状態で取られたかを残す。「変更した後に capture してしまい、
// compare が無条件に緑になる」という取り違えを、後から見て気づけるようにする。
export function captureContext() {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf-8' });
    return r.status === 0 ? r.stdout.trim() : '';
  };
  const head = git(['rev-parse', '--short', 'HEAD']);
  const dirty = git(['status', '--porcelain', '--', 'layouts', 'config.toml', 'static'])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3));
  return { head, dirtyAtCapture: dirty };
}

export function hugoVersion() {
  const res = spawnSync('hugo', ['version'], { encoding: 'utf-8' });
  return (res.stdout || '').trim();
}
