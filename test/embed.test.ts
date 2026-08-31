import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  DESCRIPTION_MODEL,
  describeProduct,
  embedImage,
  embedProduct,
  embedText,
} from "../src/embed.ts";

const embedding = Array.from({ length: 768 }, (_, index) => index / 768);

test("describeProduct sends product context and joins response parts", async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const fetchFn: typeof fetch = async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "上質な素材で、" }, { text: "毎日に使いやすい商品です。" }] } }],
    }), { status: 200 });
  };

  const description = await describeProduct(
    new Uint8Array([1, 2, 3]),
    "image/png",
    "Canvas Bag",
    "bag",
    "test-api-key",
    fetchFn,
  );

  assert.equal(description, "上質な素材で、毎日に使いやすい商品です。");
  assert.ok(request);
  assert.equal(
    request.input,
    `https://generativelanguage.googleapis.com/v1beta/models/${DESCRIPTION_MODEL}:generateContent`,
  );
  assert.equal(new Headers(request.init?.headers).get("x-goog-api-key"), "test-api-key");

  const body = JSON.parse(String(request.init?.body)) as {
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
  };
  assert.deepEqual(body.contents[0].parts[0], {
    inline_data: { mime_type: "image/png", data: "AQID" },
  });
  assert.equal(
    body.contents[0].parts[1].text,
    "あなたはECサイトのコピーライターです。この商品（商品名: Canvas Bag / カテゴリ: bag）の商品説明文を日本語で書いてください。2〜3文、80〜150字。商品の特徴・素材感・使いどころ・魅力を購入者向けに述べる。写真そのものへの言及（「写真には」「写っている」「画像は」等）は禁止。説明文のみを出力。",
  );
});

test("describeProduct rejects an empty generated description", async () => {
  const fetchFn: typeof fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "  " }] } }],
  }), { status: 200 });

  await assert.rejects(
    describeProduct(new Uint8Array([1]), "image/png", "Bag", "bag", "test-api-key", fetchFn),
    /product description/,
  );
});

test("describeProduct preserves an upstream HTTP status", async () => {
  const fetchFn: typeof fetch = async () => new Response("model not found", { status: 404 });

  await assert.rejects(
    describeProduct(new Uint8Array([1]), "image/png", "Bag", "bag", "secret-key", fetchFn),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 404);
      assert.match(String((error as Error).message), /404/);
      assert.match(String((error as Error).message), /model not found/);
      assert.doesNotMatch(String((error as Error).message), /secret-key/);
      return true;
    },
  );
});

test("embedProduct sends image and description as a compound embedding", async () => {
  let body: Record<string, unknown> | undefined;
  const fetchFn: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ embedding: { values: embedding } }), { status: 200 });
  };

  await embedProduct(
    new Uint8Array([1, 2, 3]),
    "image/jpeg",
    "軽やかで収納力のあるバッグです。",
    "test-api-key",
    fetchFn,
  );

  const content = body?.content as { parts: Array<Record<string, unknown>> };
  assert.deepEqual(content.parts, [
    { inline_data: { mime_type: "image/jpeg", data: "AQID" } },
    { text: "軽やかで収納力のあるバッグです。" },
  ]);
});

test("embedText sends a text-only embedding request", async () => {
  let body: Record<string, unknown> | undefined;
  const fetchFn: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ embedding: { values: embedding } }), { status: 200 });
  };

  const values = await embedText("収納力のあるバッグ", "test-api-key", fetchFn);

  assert.deepEqual(values, embedding);
  assert.deepEqual((body?.content as { parts: unknown[] }).parts, [
    { text: "収納力のあるバッグ" },
  ]);
});

test("embedImage posts inline image data and returns the embedding", async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const fetchFn: typeof fetch = async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({ embedding: { values: embedding } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const values = await embedImage(
    new Uint8Array([0, 1, 2, 250, 255]),
    "image/png",
    "test-api-key",
    fetchFn,
  );

  assert.deepEqual(values, embedding);
  assert.ok(request);
  assert.equal(
    request.input,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent",
  );
  assert.equal(new Headers(request.init?.headers).get("x-goog-api-key"), "test-api-key");
  assert.equal(new Headers(request.init?.headers).get("content-type"), "application/json");

  const body = JSON.parse(String(request.init?.body)) as {
    content: { parts: Array<{ inline_data: { mime_type: string; data: string } }> };
    embedContentConfig: { outputDimensionality: number };
  };
  assert.deepEqual(body.content.parts[0].inline_data, {
    mime_type: "image/png",
    data: "AAEC+v8=",
  });
  assert.equal(body.embedContentConfig.outputDimensionality, 768);
});

test("embedImage accepts JPEG inline data", async () => {
  let body: Record<string, unknown> | undefined;
  const fetchFn: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ embedding: { values: embedding } }), { status: 200 });
  };

  await embedImage(new Uint8Array([1, 2, 3]), "image/jpeg", "test-api-key", fetchFn);

  const content = body?.content as {
    parts: Array<{ inline_data: { mime_type: string; data: string } }>;
  };
  assert.equal(content.parts[0].inline_data.mime_type, "image/jpeg");
  assert.equal(content.parts[0].inline_data.data, "AQID");
});

test("embedImage accepts the legacy batch-shaped response", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response(JSON.stringify({ embeddings: [{ values: embedding }] }), { status: 200 });

  const values = await embedImage(
    new Uint8Array([1, 2, 3]),
    "image/png",
    "test-api-key",
    fetchFn,
  );

  assert.deepEqual(values, embedding);
});

test("embedImage rejects an embedding with the wrong dimensionality", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response(JSON.stringify({ embeddings: [{ values: [0, 1, 2] }] }), { status: 200 });

  await assert.rejects(
    embedImage(new Uint8Array([1]), "image/png", "test-api-key", fetchFn),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /次元不一致/);
      assert.match(error.message, /768/);
      assert.match(error.message, /3/);
      return true;
    },
  );
});

test("embedImage exposes the HTTP status and short body for rate limits", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response("rate limit: try again later", { status: 429 });

  await assert.rejects(
    embedImage(new Uint8Array([1]), "image/png", "test-api-key", fetchFn),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 429);
      assert.match(String((error as Error).message), /429/);
      assert.match(String((error as Error).message), /rate limit/);
      assert.doesNotMatch(String((error as Error).message), /test-api-key/);
      assert.doesNotMatch(String((error as Error).message), /at .*:\d+/);
      return true;
    },
  );
});

test("embedImage reports non-rate-limit HTTP failures without exposing secrets", async () => {
  const fetchFn: typeof fetch = async () =>
    new Response("invalid request details", { status: 400 });

  await assert.rejects(
    embedImage(new Uint8Array([1]), "image/png", "secret-key", fetchFn),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 400);
      assert.match(String((error as Error).message), /400/);
      assert.match(String((error as Error).message), /invalid request details/);
      assert.doesNotMatch(String((error as Error).message), /secret-key/);
      return true;
    },
  );
});
