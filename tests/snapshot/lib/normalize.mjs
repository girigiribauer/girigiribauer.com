// DOM同値のための正規化。
// 目的: 同じ意味のHTML/XML/JSONを、整形差（minify/pretty・属性順・空白・引用符）に
// 依存しない「標準形テキスト」に落とす。golden と candidate に同じ関数を適用して
// テキスト比較すれば、残った差分だけが本物の差分になる。

import * as parse5 from 'parse5';
import { XMLParser } from 'fast-xml-parser';

// ---- HTML ----

// 中身の空白を保持する要素（この配下ではテキストを一切いじらない）
const RAW_TEXT_ELEMENTS = new Set(['pre', 'textarea', 'script', 'style']);
// 閉じタグを持たない要素
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
// インライン要素（前後の空白が意味を持ちうる）
const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'datalist',
  'dfn', 'em', 'i', 'img', 'kbd', 'label', 'mark', 'output', 'picture',
  'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const isElement = (n) => n && typeof n.tagName === 'string';
const isText = (n) => n && n.nodeName === '#text';
const isBlockElement = (n) => isElement(n) && !INLINE_ELEMENTS.has(n.tagName);
// 前後の空白の有意性判定に使う「インライン内容を持つ隣接ノードか」
const isInlineish = (n) => {
  if (!n) return false;
  if (isText(n)) return /\S/.test(n.value);
  if (isElement(n)) return INLINE_ELEMENTS.has(n.tagName);
  return false;
};

const openTag = (el) => {
  const attrs = (el.attrs || []).slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let s = '<' + el.tagName;
  for (const { name, value } of attrs) s += ` ${name}="${escapeAttr(value)}"`;
  return s + '>';
};

// コメントを除いた子ノード列
const realChildren = (node) => (node.childNodes || []).filter((c) => c.nodeName !== '#comment');

// インライン文脈: 子を1行にまとめてシリアライズ（空白の有意/無意を隣接で判定）
function serializeInline(children, rawContext) {
  let out = '';
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isText(child)) {
      if (rawContext) { out += child.value; continue; }
      const prev = children[i - 1] || null;
      const next = children[i + 1] || null;
      let t = child.value.replace(/\s+/g, ' ');
      if (t === ' ') {
        // 空白のみ: 両隣がインライン内容のときだけ意味を持つ
        if (isInlineish(prev) && isInlineish(next)) out += ' ';
      } else if (t.length) {
        // ブロック境界・端に接する前後空白は落とす（minify相当）
        if (t.startsWith(' ') && !isInlineish(prev)) t = t.slice(1);
        if (t.endsWith(' ') && !isInlineish(next)) t = t.slice(0, -1);
        out += escapeText(t);
      }
    } else if (isElement(child)) {
      out += serializeElement(child, rawContext, 0);
    }
  }
  return out;
}

const indent = (n) => '  '.repeat(n);

function serializeElement(el, rawContext, depth) {
  const raw = rawContext || RAW_TEXT_ELEMENTS.has(el.tagName);
  const tag = el.tagName;
  const open = openTag(el);
  if (VOID_ELEMENTS.has(tag)) return open;

  const children = tag === 'template' && el.content ? realChildren(el.content) : realChildren(el);

  // ブロックレイアウト: ブロック子要素を含み、rawでないときだけ改行整形する。
  // ここで挿入する改行はブロック境界の「無意味な空白」なので同値性を壊さない。
  const blockLayout = !raw && children.some(isBlockElement);
  if (!blockLayout) {
    return open + serializeInline(children, raw) + `</${tag}>`;
  }

  const lines = [];
  let inlineRun = [];
  const flush = () => {
    if (inlineRun.length) {
      const s = serializeInline(inlineRun, raw);
      if (s.length) lines.push(indent(depth + 1) + s);
      inlineRun = [];
    }
  };
  for (const child of children) {
    if (isBlockElement(child)) {
      flush();
      lines.push(indent(depth + 1) + serializeElement(child, raw, depth + 1));
    } else {
      inlineRun.push(child);
    }
  }
  flush();
  return open + '\n' + lines.join('\n') + '\n' + indent(depth) + `</${tag}>`;
}

export function normalizeHtml(html) {
  const doc = parse5.parse(html);
  const parts = [];
  for (const child of doc.childNodes) {
    if (child.nodeName === '#documentType') parts.push('<!doctype html>');
    else if (isElement(child)) parts.push(serializeElement(child, false, 0));
  }
  return parts.join('\n').trim() + '\n';
}

// ---- XML (RSS / sitemap) ----
// 構造をパースしてキー順ソートで再シリアライズ。属性順・空白・自己終了記法の差を吸収。

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  cdataPropName: '__cdata',
  // 比較目的ではエンティティ展開は不要（両側で同じ生表現のまま突き合わせる）。
  // RSSに記事本文HTMLが埋まると &amp; 等が多く、展開上限にも当たるため無効化。
  processEntities: false,
});

function stableStringify(value, depth = 0) {
  const pad = '  '.repeat(depth);
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => '  '.repeat(depth + 1) + stableStringify(v, depth + 1));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return '{}';
    const items = keys.map(
      (k) => '  '.repeat(depth + 1) + JSON.stringify(k) + ': ' + stableStringify(value[k], depth + 1),
    );
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  return JSON.stringify(value);
}

export function normalizeXml(xml) {
  const obj = xmlParser.parse(xml);
  return stableStringify(obj) + '\n';
}

// ---- JSON (standardsite.json) ----

export function normalizeJson(json) {
  return stableStringify(JSON.parse(json)) + '\n';
}

// 拡張子でディスパッチ。テキスト正規化の対象外は null（=バイナリ扱い・ハッシュ比較へ）
export function normalizerFor(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'html' || ext === 'htm') return normalizeHtml;
  if (ext === 'xml') return normalizeXml;
  if (ext === 'json') return normalizeJson;
  return null;
}
