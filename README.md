# 商品画像の類似検索デモ

Gemini の画像埋め込みと Cloudflare Vectorize を使って、商品画像から似た商品を検索するデモです。商品画像は決定的な SVG から生成した PNG で、`public/images/` と `public/products.json` に含まれています。

## セットアップと実行

依存関係をインストールします。

```sh
npm install
```

画像を生成します。生成済みの PNG と商品一覧を利用する場合は省略できます。

```sh
npm run generate:images
```

Vectorize のインデックスを作成します。この操作は人間が Cloudflare に対して明示的に実行してください。

```sh
wrangler vectorize create image-search-demo --dimensions=768 --metric=cosine
```

ローカル用の変数ファイルを作成し、Gemini API キーを設定します。

```sh
cp .dev.vars.example .dev.vars
# .dev.vars の GEMINI_API_KEY を実際のキーに置き換える
```

商品画像を順番に埋め込み、Vectorize への投入ファイルを作成します。API キーはプロセス環境変数で渡します。

```sh
GEMINI_API_KEY=... npm run ingest
```

作成した NDJSON を Vectorize に投入します。この操作も人間が明示的に実行してください。

```sh
wrangler vectorize insert image-search-demo --file data/vectors.ndjson
```

本番に近い形でビルドし、Worker と Assets を起動します。

```sh
npm run build && npm run dev
```

ブラウザで表示された URL を開き、画像をドロップするか、登録済みの商品をクリックして検索します。

### UI を開発する場合

`npm run dev:ui` は Vite の UI 開発サーバーを起動するためのコマンドです。Worker の代わりではなく、`wrangler dev` と併用してください。

```sh
# ターミナル A
npm run dev

# ターミナル B
npm run dev:ui
```

Vite 開発サーバーの `/api` は `http://localhost:8787` の Wrangler にプロキシされます。`wrangler.jsonc` の Vectorize binding は `remote: true` なので、検索とローカル Worker の動作確認にはネットワーク接続が必要です。Vectorize への投入直後は反映に時間がかかり、検索結果が一時的に空になることがあります。

## デプロイ

デプロイ前に、API キーを secret として登録します。

```sh
wrangler secret put GEMINI_API_KEY
```

その後、UI をビルドして Worker をデプロイします。

```sh
npm run deploy
```

`npm run ingest` は Gemini の呼び出しと `data/vectors.ndjson` の生成だけを行い、Vectorize のインデックス作成・削除・投入は行いません。Vectorize の操作とデプロイは、必要なタイミングで人間が明示的に実行してください。API キーをソースコードや設定ファイルへ書き込まないでください。
