#!/bin/sh

# リンクカード用のOGPキャッシュを更新
if [ -f "scripts/fetch-linkcards.mjs" ]; then
    node scripts/fetch-linkcards.mjs
fi

# 本番（Dockerfile）と同じ条件で出力する。--minify を外すと整形が本番と食い違い、
# クリーンしないと過去ビルド（dev.sh の --buildDrafts 含む）の残骸が public/ に居座る。
hugo --buildFuture --minify --cleanDestinationDir
