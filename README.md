# 商品画像の類似検索デモ

Gemini の画像・テキスト埋め込みと Cloudflare Vectorize を使って、商品画像や商品の特徴から似た商品を検索するデモです。素人目には区別しにくい機械部品（ベアリング・歯車・ボルト・ナット・ばね・ブッシュ）を題材に、アップロードした 1 枚の写真から似た品番を引き当てる想定です。商品画像は無地背景のカタログ写真を模した自前のレンダリングで、`public/images/` と `public/products.json` に含まれています。

## セットアップと実行

依存関係をインストールします。

```sh
npm install
```

商品画像と商品一覧を再生成します（同じ入力からは常に同じ画像が出ます）。生成済みの PNG と商品一覧を利用する場合は省略できます。

```sh
npm run generate:images
```

## 商品データのメタデータ

`public/products.json` の各商品には、価格（`price`）、サイズ展開（`sizes`）、色（`color`）が含まれます。色は画像生成時の表面処理（`steel` / `zinc` / `black-oxide` / `brass`）から決まります。ID から決定的に価格・サイズを再生成する場合は次を実行します。

```sh
npm run enrich:products
```

商品マスタは D1 の `products` テーブルです。`public/products.json` は投入用のシードで、Vectorize にはベクトルと ID しか入りません。検索は Vectorize で ID を引き、D1 から商品情報を取得して返します（`GET /api/products` はカタログ表示用、UI もここから読みます）。

ベクトルは商品画像と商品テキストの複合埋め込みです。このデモは商品テキストを用意する手間を省くため、投入時に説明文を生成させています。実運用では既存の商品説明をそのまま渡してください。

## 画像の生成方法

画像は外部から取得せず、`scripts/render/` の符号付き距離関数（SDF）レイマーチャで生成しています。部品ごとの寸法バリエーションは `scripts/render/parts.ts` のカタログ定義にあり、カメラ・照明・背景は全点で共通です。生成物は CC0-1.0 で、寸法と表面処理は `public/products.json` の `credit` フィールドに入っています。

Vectorize のインデックスと D1 のデータベースを作成します。この操作は人間が Cloudflare に対して明示的に実行してください。

```sh
wrangler vectorize create i2i-search --dimensions=768 --metric=cosine
wrangler d1 create i2i-search   # 出力された database_id を wrangler.jsonc に設定する
wrangler d1 execute i2i-search --remote --file schema/products.sql
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

UI をビルドして Worker をデプロイし、Worker エンドポイントから商品画像を投入します。投入では商品ごとに説明文の生成と複合埋め込みを行うため、画像埋め込みだけの場合より時間がかかります。

```sh
npm run deploy
# 投入（48件を10件ずつ）
for offset in 0 10 20 30 40; do
  curl -X POST "https://<worker>/api/ingest?offset=$offset&limit=10" \
    -H "x-ingest-token: <INGEST_TOKEN の値>"
done
```

ローカル開発（`wrangler dev`）でも `.dev.vars` に `GEMINI_API_KEY` と `INGEST_TOKEN` を書けば同じ手順で投入できます。API キーをソースコードや設定ファイルへ書き込まないでください。

## テキスト検索

検索パネルの入力欄から商品名や特徴を入力して検索すると、`POST /api/search` のテキスト埋め込み経由で Vectorize を検索します。単純な部分一致ではなく、商品説明文を含むセマンティック検索です。価格帯・サイズ・色のフィルタは画像検索と共通で適用されます。
