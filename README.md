# 商品画像の類似検索デモ

Gemini の画像埋め込みと Cloudflare Vectorize を使って、商品画像から似た商品を検索するデモです。商品画像は Wikimedia Commons から取得した写真で、`public/images/` と `public/products.json` に含まれています。

## セットアップと実行

依存関係をインストールします。

```sh
npm install
```

Commons から実写を取得して画像と商品一覧を再生成します（結果は実行時点の検索結果に依存します）。生成済みの PNG と商品一覧を利用する場合は省略できます。

```sh
npm run generate:images
```

## 商品データのメタデータ

`public/products.json` の各商品には、価格（`price`）、サイズ展開（`sizes`）、色（`color`）が含まれます。画像から色を再抽出し、IDから決定的に価格・サイズを再生成する場合は次を実行します。

```sh
npm run enrich:products
```

## 画像の出所と帰属

画像は Wikimedia Commons から取得しています。各画像のライセンス・作者・出典は `public/products.json` の `credit` フィールドを参照してください。

Vectorize のインデックスを作成します。この操作は人間が Cloudflare に対して明示的に実行してください。

```sh
wrangler vectorize create i2i-search --dimensions=768 --metric=cosine
```

ローカル用の変数ファイルを作成し、Gemini API キーを設定します。

```sh
cp .dev.vars.example .dev.vars
# .dev.vars の GEMINI_API_KEY と INGEST_TOKEN を設定する
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
wrangler secret put INGEST_TOKEN     # 任意のランダム文字列
```

UI をビルドして Worker をデプロイし、Worker エンドポイントから商品画像を投入します。

```sh
npm run deploy
# 投入（48件を10件ずつ）
for offset in 0 10 20 30 40; do
  curl -X POST "https://<worker>/api/ingest?offset=$offset&limit=10" \
    -H "x-ingest-token: <INGEST_TOKEN の値>"
done
```

ローカル開発（`wrangler dev`）でも `.dev.vars` に `GEMINI_API_KEY` と `INGEST_TOKEN` を書けば同じ手順で投入できます。API キーをソースコードや設定ファイルへ書き込まないでください。
