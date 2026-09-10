#!/bin/sh

# OGP画像を生成
if [ -f "./generate-ogp" ]; then
    ./generate-ogp
fi

# リンクカード用のOGPキャッシュを更新
if [ -f "scripts/fetch-linkcards.mjs" ]; then
    node --watch-path=./content scripts/fetch-linkcards.mjs &
fi

hugo server --buildDrafts --buildFuture --port 2424 &
open http://localhost:2424
