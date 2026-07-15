# snapshot harness（式年遷宮の物差し）

出力する HTML/CSS はそのままに、生成の仕組み（Static Site Generator）だけを入れ替える —
その「出力が変わっていないこと」を機械的に保証するための比較ハーネス。

## 考え方

1. **正解（golden）** … 現行 Hugo の本番相当ビルド（`hugo --buildFuture --minify`）を取得。
   - テキスト系（HTML / XML / JSON）は **DOM同値の標準形に正規化**して `golden/normalized/` に保存（diffレビュー可能）。
   - バイナリ系（画像 / フォント / css / js など）は **sha256** を `golden/assets.manifest.json` に保存。
2. **比較（compare）** … 候補ビルドに同じ正規化をかけ、golden と突き合わせる。差分ゼロ＝出力が変わっていない＝遷宮成立。

## 使い方

```sh
cd tests/snapshot
npm install            # 初回のみ（parse5 / fast-xml-parser）

node capture.mjs       # 現行Hugoから正解を取得（golden/ を作り直す）
node compare.mjs        # 候補(既定=Hugo --minify)をビルドして比較
node compare.mjs --dir path/to/public   # 既存のビルド済みディレクトリを比較
node compare.mjs --no-minify            # minifyなしで比較（下記「診断用」）
```

`compare.mjs` は差分ゼロで exit 0、差分ありで exit 1。CIの合否に使える。

## 正規化が「吸収する差」と「しない差」

較正（現行Hugoの minify版 vs 非minify版）で切り分けた結果、差は3層に分かれる。

| 層 | 例 | 正規化の扱い |
|----|----|-------------|
| ① 純粋な整形差 | 空白・改行・インデント、属性の順序、引用符、自己終了記法、doctypeの大小 | **吸収する**（＝DOM同値） |
| ② minifierの値/エンコード変換 | `initial-scale=1.0`→`1`、URLのパーセントエンコード、`&#xA;`→改行、インラインJS/CSSのminify、インライン要素間の空白除去 | **吸収しない**（あえて） |
| ③ 本物の差 | 文言・構造・リンク・画像の変化 | **検出する**（これが目的） |

②を吸収しないのは意図的:

- ②を再現するには Hugo の minifier 全体を再実装することになり、際限がなく壊れやすい。
- ②を無理に「同じ」と潰すと、本物の差（例: 文中リンク間の空白の欠落）まで隠してしまう（false equality）。
  検証ツールとしては「見逃す」より「余分に拾って人が判断する」方が安全。

### 運用上の含意（重要）

**比較は「本番相当（minify）同士」で行うのが正しい契約。** 現行Hugo → Hugo最新はどちらも
`--minify` なので、②は発生せず差分ゼロになる（実測済み）。

`--no-minify` は合否ゲートではなく**診断用のレンズ**。「minifierが何をしているか」＝
「将来minifyしない別SSGに乗り換えたら②のどこがズレるか」を可視化する用途。
非Hugoなり別SSGへ移るときは、そのSSGの本番設定でビルドして比較し、残った②を個別に判断する。

## ファイル

- `lib/normalize.mjs` … HTML/XML/JSON の正規化（DOM同値の心臓部）
- `lib/util.mjs` … Hugoビルド・ファイル列挙・ハッシュ
- `capture.mjs` / `compare.mjs` … 取得 / 比較のエントリポイント
- `golden/` … 正解（normalized/ ＋ assets.manifest.json ＋ meta.json）
- `.build/` … 作業ビルド（gitignore）
