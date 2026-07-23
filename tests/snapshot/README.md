# snapshot harness（式年遷宮の物差し）

出力する HTML/CSS はそのままに、生成の仕組み（Static Site Generator やテンプレート）だけを
入れ替える — その「出力が変わっていないこと」を機械的に保証するための比較ハーネス。

## 考え方

1. **正解（golden）** … 本番相当ビルド（`hugo --buildFuture --minify`）を取得。
   - テキスト系（HTML / XML / JSON）は **DOM同値の標準形に正規化**して `golden/normalized/` に保存（diffレビュー可能）。
   - バイナリ系（画像 / フォント / css / js など）は **sha256** を `golden/assets.manifest.json` に保存。
   - **ビルド入力の指紋**（`config.toml` と `data/**`）を `golden/meta.json` に保存。
2. **比較（compare）** … 候補ビルドに同じ正規化をかけ、golden と突き合わせる。差分ゼロ＝出力が変わっていない。

## 使い方

```sh
cd tests/snapshot
npm install            # 初回のみ（parse5 / fast-xml-parser）

node capture.mjs                 # 現行ビルドから正解を取得（golden/ を作り直す）
node compare.mjs                 # 候補をビルドして比較
node compare.mjs --only 'tags/'  # ページ種別を絞って比較（建て直し中に1種別ずつ緑にする）
node compare.mjs --dir path/to/public   # 既存のビルド済みディレクトリを比較
node compare.mjs --no-minify            # minifyなしで比較（下記「診断用」）
```

`compare.mjs` は差分ゼロで exit 0、差分ありで exit 1。CIの合否に使える。

`capture.mjs` は、生成物が既存goldenの9割未満だと**誤爆とみなして中断**する
（テンプレ建て直し中に正解を壊さないためのガード）。意図的な取り直しは `--force`。

## 正規化が「吸収する差」と「しない差」

| 層 | 例 | 正規化の扱い |
|----|----|-------------|
| ① 純粋な整形差 | 空白・改行・インデント、属性の順序、引用符、自己終了記法、doctypeの大小 | **吸収する**（＝DOM同値） |
| ② minifierの値/エンコード変換 | `initial-scale=1.0`→`1`、URLのパーセントエンコード、`&#xA;`→改行、インラインJS/CSSのminify、インライン要素間の空白除去 | **吸収しない**（あえて） |
| ③ 本物の差 | 文言・構造・リンク・画像の変化 | **検出する**（これが目的） |

②を吸収しないのは意図的。再現するには Hugo の minifier 全体を再実装することになり、
際限がなく壊れやすい。また②を潰すと本物の差（例: 文中リンク間の空白の欠落）まで隠れる。
検証ツールとしては「見逃す」より「余分に拾って人が判断する」方が安全。

**比較は「本番相当（minify）同士」で行うのが正しい契約。** `--no-minify` は合否ゲートではなく、
minifier が何をしているかを可視化する診断用のレンズ。

## 差分が出たとき、まず疑うこと

テンプレートを触っていないのに差分が出る既知の要因が2つある。

1. **ビルド入力の変化** — とくに `data/linkcards.json` は `build.sh` / `dev.sh` 経由の
   `fetch-linkcards.mjs` がネットワークから暗黙に書き換える。**プレビューしただけで出力が変わる。**
   compare は golden 取得時からの入力変化を検知して警告するので、まずそれを見ること。
2. **ビルド時刻への依存** — `layouts/page.html` の「1年以上経過」警告のみ `now` に依存する。
   記事が1年境界を跨いだ日に、テンプレ無変更でも差分として現れる。

どちらも「入力が変わった＝goldenを取り直すべき」ケースであって、テンプレの回帰ではない。

## ファイル

- `lib/normalize.mjs` … HTML/XML/JSON の正規化（DOM同値の心臓部）
- `lib/util.mjs` … Hugoビルド・ファイル列挙・ハッシュ・入力指紋
- `capture.mjs` / `compare.mjs` … 取得 / 比較のエントリポイント
- `golden/` … 正解（normalized/ ＋ assets.manifest.json ＋ meta.json）
- `.build/` … 作業ビルド（gitignore）
