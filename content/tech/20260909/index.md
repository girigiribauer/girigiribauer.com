+++
title = "Ghostty に移行したらたまにプロンプトが返ってこなくなったけど、結局 Ghostty が原因じゃなかった話"
description = "1年半以上 Ghostty の謎の症状に悩まされてきたけど、つい最近問題が解消したのでメモに残しておきます"
date = "2026-09-09T19:45:00+0900"
draft = false
tags = ["Ghostty", "zsh", "tmux", "macOS"]
+++

<script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script>

## 結論

1年半ほど前に Alacritty から Ghostty へターミナルを変更したところ、ターミナル上で明らかにプログラムとしては終わってるのに、処理が戻ってこない、プロンプトが表示されない現象が起きてました。

当初 Ghostty のバグなのかな？とうっすら思っていたのですが、調べてみるうちに **Ghostty + oh-my-zsh + terminal-notifier の掛け合わせで起きるバグ** だというのがつい最近判明し、 **.zshrc の oh-my-zsh の読み込み後に `bgnotify` 関数を上書きしてあげると問題が起きなくなる** という、通知とプロンプトが連動した多層に渡った問題でした。

```zsh
bgnotify() {
  terminal-notifier -message "$2" -title "$1" -activate com.mitchellh.ghostty >/dev/null 2>&1 &!
}
```

こんなんわからんわ。 Ghostty ちゃん疑ってゴメン！ :pray:

これはハマりそうなので、以下で経緯をメモっておきますね。

## Ghostty というターミナルアプリを使ってみたかった

<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:tsvcmd72oxp47wtixs4qllyi/app.bsky.feed.post/3lenjkgizt22q" data-bluesky-cid="bafyreif67qo3kzxtoapo56khptkvu3eom4m6oectuhmceblg4ni53pr56m" data-bluesky-embed-color-mode="system"><p lang="ja">alacritty に特に不満はなかったけど、一旦 ghostty をしばらく使ってみますかあ
まあ新年だし</p>&mdash; girigiribauer (<a href="https://bsky.app/profile/did:plc:tsvcmd72oxp47wtixs4qllyi?ref_src=embed">@girigiribauer.com</a>) <a href="https://bsky.app/profile/did:plc:tsvcmd72oxp47wtixs4qllyi/post/3lenjkgizt22q?ref_src=embed">January 1, 2025 at 11:34 AM</a></blockquote>

ということで、 HashiCorp の創業者の人が作っている、黒い画面ことターミナルアプリが人気そうだったので、ちょっと使ってみようかなと2025年の年始に思い立ったのでした。

https://ghostty.org/

### たまに処理が戻らない違和感

特に不自由なく使えてたのですが、たまにプロンプト（あの入力できますよーの表示）が返ってこないことがありました。なぜ？ 🤔

まあリリースしたばかりだし、すぐに直るでしょと `Ctrl-C` でキャンセルして普通に使ってましたが、
当初はそこまで気にしてなかったものの、時が経つにつれて気になるようになっていきました。

### 問題の切り分けに時間がかかった

そもそもどういうケースで再現するのか？を調べないとバグの報告すらできないので、しばらくちゃんとプロンプトが返ってくるかをしっかり見ることにしてみました。

ただ、ちゃんと見ようとするといつも起きず、普通に処理が返ってくる。なんで...

と、作業の合間を縫ってあれこれ調べてみたら、どうも **ターミナルのフォーカスが当たってないときに実行中のプログラムが終了すると、そのままプロンプトが返ってこない** ようだというのが分かってきました。（この時点で謎なんですけど）

<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:tsvcmd72oxp47wtixs4qllyi/app.bsky.feed.post/3lhbajj2o2s2t" data-bluesky-cid="bafyreihjiy7ibkof7bhj6esd6offaixsf7rbnmot6k2l4uuqvdfcplozru" data-bluesky-embed-color-mode="system"><p lang="ja">Ghostty でたまに処理が返ってこない問題のやつ、少し原因絞り込めてきましたね
ターミナルのフォーカスがない状態、かつ処理が概ね5秒以上かかるものだと、 `sleep 5` とかでも処理が返ってこなくなりますね</p>&mdash; girigiribauer (<a href="https://bsky.app/profile/did:plc:tsvcmd72oxp47wtixs4qllyi?ref_src=embed">@girigiribauer.com</a>) <a href="https://bsky.app/profile/did:plc:tsvcmd72oxp47wtixs4qllyi/post/3lhbajj2o2s2t?ref_src=embed">February 3, 2025 at 6:36 PM</a></blockquote>

Ghostty の方にもそのようなバグは上がってきてないみたいで、一応再現はするけどこちらでもまだ実態が把握しきれてないという状況でした。

ちなみに再現手順は以下の通りです。

1. Ghostty + tmux のペインで `sleep 15` を実行する
2. 別ウィンドウにフォーカスを移す
3. Space を切り替えて20秒ほど放置する
4. 戻って確認

### ここまでで力尽き...

ぶっちゃけ `Ctrl-C` ですぐプロンプト返ってくるのでそんなに困ってなくて、再現方法が出せたところで満足しちゃって、その先の調査までは力が及んでませんでした。まあ、めんどいよね...w

## 腰を上げてしっかり調査してみることに

さて、プロセスが絡んだ調査をするのがやりやすい時代になったので、そろそろ重い腰を上げて調査しようと思い立ちました。

1. **zsh** そもそも本当にプロンプトを出してないのか
2. **tmux** tmux の画面バッファ上にはプロンプトがあるのか
3. **Ghostty** tmux から受け取ったものをちゃんと描いてるのか
4. **macOS** フォーカスのないウィンドウの描画を止めてたりしないか

### 切り分け1: そもそも本当に終わっているのか

「プログラムは終わっているのにプロンプトが出ない」と思っていたけど、それをまず確認します。

```bash
tmux list-panes -a -F "#{pane_tty} #{pane_current_command}"
```

`tmux list-panes -a -F` ですべてのペインに対してそのフォーマットに沿った内容を列挙してくれます。

- **`zsh` と出ている** -> 何も動いていない。入力待ちの状態
- **それ以外が出ている** -> そのコマンドがまだ動いている

結果はこのように出力され、 zsh や node のほかに terminal-notifier （欠けてるけど）が動いてることがわかります。

```sh
/dev/ttys001 zsh
/dev/ttys002 zsh
/dev/ttys003 zsh
/dev/ttys004 zsh
/dev/ttys005 zsh
/dev/ttys006 node
/dev/ttys007 node
/dev/ttys008 terminal-notifi
/dev/ttys009 zsh
/dev/ttys010 zsh
/dev/ttys011 zsh
/dev/ttys012 zsh
/dev/ttys014 zsh
/dev/ttys015 zsh
/dev/ttys020 zsh
/dev/ttys021 node
/dev/ttys022 terminal-notifi
/dev/ttys023 zsh
/dev/ttys024 zsh
```

これは **macOS の通知（画面の右上に出てくるアレ）を、コマンドから出すためのツール**です。通知を出したら終わるはずのもので、居座るような性質のものではありません。

要するに、自分が打ったコマンドは終わっていたけど、代わりに通知が終了してない状態です。

### 切り分け2: terminal-notifier がプロンプトをブロックしているかどうか

これを打つと `sleep` は15秒間動き続けますが、プロンプトは普通に出ます。

```bash
sleep 15 &
```

**「動いている」ことと「プロンプトを止めている」ことは別** です。
ここで調べたいのは `terminal-notifier` がプロンプトをブロックしているかどうかです。

```bash
ps -eo pid,etime,stat,command | grep terminal-notifier
```

- `ps -eo` は動いているプロセスを指定した項目だけ並べて出す
- `etime` が起動してからの経過時間（ `ELAPSED` ）
- `stat` がそのプロセスの状態（ `STAT` ）

`stat` はここだけ見れば判定できます。

- **末尾に `+` が付く** -> プロンプトをブロックしている
- **末尾に `+` が付かない** -> ブロックしていない（`sleep 15 &` はこちら）

結果はこうでした。

```sh
  PID     ELAPSED STAT COMMAND
90507  03-18:56:15 S+   .../terminal-notifier -message xxxxxx -title #fail (took 1h 1m 46s) -activate com.mitchellh.ghostty -sender com.mitchellh.ghostty
56106  02-23:00:28 S+   .../terminal-notifier -message xxxxxx -title #fail (took 21h 6m 15s) -activate com.mitchellh.ghostty -sender com.mitchellh.ghostty
```

通知を出すだけのコマンドが3日近く動きっぱなしで、 `terminal-notifier` がプロンプトをブロックしている側でした。

### 切り分け3: 誰が terminal-notifier を起動しているのか

自分は `terminal-notifier` なんて打っていないので、誰が起動しているのか探します。

シェルの設定から探すのが早いので、`.zshrc` を見ます。

```bash
grep -n notif ~/.zshrc
```

```sh
73:  bgnotify
```

ここで出てきたのが `oh-my-zsh` の `bgnotify` プラグインでした。
**時間のかかったコマンドが終わったら、デスクトップ通知を出してくれる** やつです。

全く記憶にございません...。 🥹

ここまでくれば後は `bgnotify` プラグインを詳しく調べるだけです。
以下、分かったことまとめです。

- `bgnotify` プラグインは **プロンプトを出す直前に走る** フック（ `precmd` ）を利用している
- **5秒以上かかる** 、かつ **開始時と終了時で最前面のアプリが変わっている** ときだけ動く
    - まさにこれだ...！
- `bgnotify` が `terminal-notifier` を呼ぶところに **`&` が付いていない** 、つまり終わるまで待つ書き方だった

ここまでで、なぜプロンプトが返ってこなかったのか？の謎は一定解決できました。

```zsh
bgnotify() {
  terminal-notifier -message "$2" -title "$1" -activate com.mitchellh.ghostty >/dev/null 2>&1 &!
}
```

`bgnotify` を上書きすれば解消する、というところまで辿り着けました。長かった...

## 余談: なぜ Alacritty はうまくいって Ghostty は固まるのか

`bgnotify` は通知を出すとき、**そのとき最前面にいたアプリの識別子を自動で拾って `-sender` に渡す** ため、そこで Alacritty と Ghostty とで挙動が異なる現象が起きていたようです。

Alacritty なら `io.alacritty` 、 Ghostty なら `com.mitchellh.ghostty` が渡されます。

で、ここからがややこしいのですが、新しい通知 API を使う場合はそこにアプリを登録する仕組みになっていて、
Ghostty は比較的新しいアプリなので、普通に登録して、そのせいで弾かれていたということのようです。

`terminal-notifier` は古い通知の仕組みに沿って作られていて、ここの引数である `-sender` は、
**「この通知は、この名前のアプリが出したことにしてくれ」** という通知の送信者を指定できるオプションだったりします。
本当は `terminal-notifier` が出しているのに、別のアプリが出したように見せかけられる。なるほど？

つまり端的に言うと、今まで使っていた発信元の偽装工作が、新しい macOS では通用しなくなって弾かれていた。
とでも考えておけば分かりやすいでしょうか。

## まとめ

ちゃんと調査して問題切り分けるの大事だね、という話とともに、今回の大きな学びとして挙げられるのは...

古い設定やらなんやらが溜まってきてるので **さっさとクリーンインストールしろ！** ってことです。はい...。

## 参考URL {#ref}

- https://ghostty.org/
- https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/bgnotify
- https://github.com/julienXX/terminal-notifier
- https://developer.apple.com/documentation/foundation/nsusernotification
- https://developer.apple.com/documentation/usernotifications
