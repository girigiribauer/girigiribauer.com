# snapshot harness（式年遷宮の物差し）

出力する HTML/CSS はそのままに、生成の仕組み（Static Site Generator やテンプレート）だけを
入れ替える — その「出力が変わっていないこと」を機械的に保証するための比較ハーネス。

## 考え方

1. **正解（golden）** … 本番相当ビルド（`hugo --buildFuture --minify`）を取得。
   - テキスト系（HTML / XML / JSON）は **DOM同値の標準形に正規化**して `golden/normalized/` に保存（diffレビュー可能）。
   - バイナリ系（画像 / フォント / css / js など）は **sha256** を `golden/assets.manifest.json` に保存。
   - **ビルド入力の指紋**（`config.toml` / `data/**` / `content/**.md`）を `golden/meta.json` に保存。
2. **比較（compare）** … 候補ビルドに同じ正規化をかけ、golden と突き合わせる。差分ゼロ＝出力が変わっていない。

## 使い方 — golden は「保存する」ものではなく「触る直前に取る」もの

`golden/` は **gitignore されている**（記事を1本書けば一覧・RSS・タグ・sitemap が全部ずれるので、
保存しても腐るだけ）。テンプレート・CSS・設定・Hugoのバージョンを触るときに、その都度こう使う。

```sh
cd tests/snapshot
npm install          # 初回のみ（parse5 / fast-xml-parser）

node capture.mjs     # ① 触る「前」に現在の出力を正解として取る
                     # ② ここで layouts/ や config.toml、Hugo本体を変更する
node compare.mjs     # ③ 出力が変わっていないことを確認（差分ゼロなら成功）
```

**順序を間違えない**こと。変更した後に `capture` すると、変更後の状態が正解になって
`compare` が無条件に緑になる。取り違えに気づけるよう、`compare` は golden の取得時刻と
そのときの HEAD を必ず表示し、取得時に未コミット変更があった場合は警告する。

```sh
node compare.mjs --only 'tags/'         # ページ種別を絞る（1種別ずつ緑にしたいとき）
node compare.mjs --dir path/to/public   # 既存のビルド済みディレクトリを比較
node compare.mjs --no-minify            # minifyなしで比較（下記「診断用」）
```

`compare.mjs` は差分ゼロで exit 0、差分ありで exit 1。

### 本番の出力と突き合わせる

ローカル(macOS)とVPS(Linux)では tzdata などの差で出力が変わりうる。本番そのものを検証するなら:

```sh
docker build --target builder -t sengu-check .
CID=$(docker create sengu-check); docker cp "$CID:/src/public/." /tmp/prod/; docker rm "$CID"
cd tests/snapshot && node compare.mjs --dir /tmp/prod
```

`capture.mjs` は、生成物が既存goldenの9割未満だと**誤爆とみなして中断**する
（テンプレ建て直し中に正解を壊さないためのガード）。意図的な取り直しは `--force`。

**これは日常のテストではない。** 記事を書けば出力は当然変わるので、常時緑を保つ道具ではなく、
「仕組み側を触るときだけ持ち出す物差し」として使う。

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

1. **ビルド入力の変化** — compare は golden 取得時からの入力変化を検知して警告するので、まずそれを見ること。
   - `content/**.md` … capture の後に記事を書けば当然出力は変わる。**テンプレの回帰ではない。**
   - `data/linkcards.json` … `build.sh` / `dev.sh` 経由の `fetch-linkcards.mjs` が
     ネットワークから暗黙に書き換える。**プレビューしただけで出力が変わる。**
2. **ビルド時刻への依存** — `layouts/page.html` の「1年以上経過」警告のみ `now` に依存する。
   記事が1年境界を跨いだ日に、テンプレ無変更でも差分として現れる。

どちらも「入力が変わった＝goldenを取り直すべき」ケースであって、テンプレの回帰ではない。

## ファイル

- `lib/normalize.mjs` … HTML/XML/JSON の正規化（DOM同値の心臓部）
- `lib/util.mjs` … Hugoビルド・ファイル列挙・ハッシュ・入力指紋
- `capture.mjs` / `compare.mjs` … 取得 / 比較のエントリポイント
- `golden/` … 正解（normalized/ ＋ assets.manifest.json ＋ meta.json）
- `.build/` … 作業ビルド（gitignore）
