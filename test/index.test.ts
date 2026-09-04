import { strict as assert } from "node:assert";
import { test } from "node:test";

import worker from "../src/index.ts";

type WorkerEnvironment = Parameters<typeof worker.fetch>[1];

interface IngestProduct {
  id: string;
  name: string;
  category: string;
  image: string;
  price: number;
  sizes: string[];
  color: string;
  spec: string;
}

const productRow = {
  id: "bag-01",
  name: "Canvas Bag",
  category: "bag",
  image: "/images/product-bag-01.png",
  price: 12000,
  sizes: JSON.stringify(["M", "L"]),
  color: "brown",
  spec: "SPEC-01",
  description: "軽やかで収納力のあるバッグです。",
};

const expectedProduct = { ...productRow, sizes: ["M", "L"] };

/** D1 の代役。SELECT は渡した行から返し、batch に流れた bind 引数を記録する */
function createDatabase(rows: Record<string, unknown>[]) {
  const written: unknown[][] = [];

  function statement(sql: string, args: unknown[]) {
    return {
      sql,
      args,
      bind: (...next: unknown[]) => statement(sql, next),
      all: async () => ({
        results: sql.includes("WHERE id IN")
          ? args
            .map((id) => rows.find((row) => row.id === id))
            .filter((row): row is Record<string, unknown> => row !== undefined)
          : rows,
      }),
    };
  }

  const database = {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: Array<{ args: unknown[] }>) => {
      for (const prepared of statements) {
        written.push(prepared.args);
      }
    },
  };

  return { database, written };
}

function createEnvironment(
  query: (values: number[], options: Record<string, unknown>) => Promise<unknown>,
  assetResponse = new Response("asset"),
  rows: Record<string, unknown>[] = [],
): WorkerEnvironment {
  return {
    GEMINI_API_KEY: "worker-test-secret",
    VECTORIZE: { query },
    DB: createDatabase(rows).database,
    ASSETS: { fetch: async () => assetResponse },
  } as unknown as WorkerEnvironment;
}

async function withGeminiResponse<T>(
  response: Response,
  action: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function callWorker(request: Request, env: WorkerEnvironment): Promise<Response> {
  return worker.fetch(request, env);
}

function createIngestEnvironment(products: IngestProduct[]) {
  const assetPaths: string[] = [];
  const upsertedVectors: unknown[][] = [];
  const { database, written } = createDatabase([]);
  const environment = {
    GEMINI_API_KEY: "worker-test-secret",
    INGEST_TOKEN: "ingest-test-token",
    DB: database,
    VECTORIZE: {
      query: async () => ({ matches: [] }),
      upsert: async (vectors: unknown[]) => {
        upsertedVectors.push(vectors);
      },
    },
    ASSETS: {
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        assetPaths.push(url.pathname);
        if (url.pathname === "/products.json") {
          return new Response(JSON.stringify(products), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      },
    },
  } as unknown as WorkerEnvironment;

  return { environment, assetPaths, upsertedVectors, writtenRows: written };
}

async function withGeminiEmbeddingResponse<T>(action: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ embedding: { values: Array(768).fill(0.25) } }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withGeminiIngestResponses<T>(action: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const endpoint = String(input);
    if (endpoint.endsWith(":generateContent")) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "毎日に寄り添う魅力的な商品です。" }] } }],
      }), { status: 200 });
    }

    return new Response(
      JSON.stringify({ embedding: { values: Array(768).fill(0.25) } }),
      { status: 200 },
    );
  };
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("GET /api/search returns 405", async () => {
  const response = await callWorker(
    new Request("https://example.test/api/search"),
    createEnvironment(async () => ({ matches: [] })),
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("non-search paths are served by the Assets binding", async () => {
  const response = await callWorker(
    new Request("https://example.test/"),
    createEnvironment(async () => ({ matches: [] }), new Response("from assets")),
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "from assets");
});

test("POST /api/ingest rejects a mismatched token", async () => {
  const { environment } = createIngestEnvironment([]);
  const response = await callWorker(
    new Request("https://example.test/api/ingest", {
      method: "POST",
      headers: { "x-ingest-token": "wrong-token" },
    }),
    environment,
  );

  assert.equal(response.status, 401);
});

test("POST /api/ingest rejects a missing token", async () => {
  const { environment } = createIngestEnvironment([]);
  const response = await callWorker(
    new Request("https://example.test/api/ingest", { method: "POST" }),
    environment,
  );

  assert.equal(response.status, 401);
});

test("POST /api/ingest embeds and upserts the selected products", async () => {
  const products: IngestProduct[] = [
    { id: "bag-01", name: "Bag 01", category: "bag", image: "/images/bag-01.png", price: 1000, sizes: ["S"], color: "black", spec: "SPEC-01" },
    { id: "bag-02", name: "Bag 02", category: "bag", image: "/images/bag-02.png", price: 2000, sizes: ["M", "L"], color: "brown", spec: "SPEC-02" },
    { id: "bag-03", name: "Bag 03", category: "bag", image: "/images/bag-03.png", price: 3000, sizes: ["S", "M"], color: "white", spec: "SPEC-03" },
    { id: "bag-04", name: "Bag 04", category: "bag", image: "/images/bag-04.png", price: 4000, sizes: ["L"], color: "red", spec: "SPEC-04" },
  ];
  const { environment, assetPaths, upsertedVectors, writtenRows } = createIngestEnvironment(products);

  const response = await withGeminiIngestResponses(() => callWorker(
    new Request("https://example.test/api/ingest?offset=1&limit=2", {
      method: "POST",
      headers: { "x-ingest-token": "ingest-test-token" },
    }),
    environment,
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    processed: 2,
    total: 4,
    ids: ["bag-02", "bag-03"],
  });
  assert.deepEqual(assetPaths, [
    "/products.json",
    "/images/bag-02.png",
    "/images/bag-03.png",
  ]);
  assert.equal(upsertedVectors.length, 1);
  assert.deepEqual(upsertedVectors[0], [
    { id: "bag-02", values: Array(768).fill(0.25) },
    { id: "bag-03", values: Array(768).fill(0.25) },
  ]);
  assert.deepEqual(writtenRows, [
    [
      "bag-02",
      "Bag 02",
      "bag",
      "/images/bag-02.png",
      2000,
      JSON.stringify(["M", "L"]),
      "brown",
      "SPEC-02",
      "毎日に寄り添う魅力的な商品です。",
    ],
    [
      "bag-03",
      "Bag 03",
      "bag",
      "/images/bag-03.png",
      3000,
      JSON.stringify(["S", "M"]),
      "white",
      "SPEC-03",
      "毎日に寄り添う魅力的な商品です。",
    ],
  ]);
});

test("POST /api/ingest returns zero processed when offset reaches the total", async () => {
  const products: IngestProduct[] = [
    { id: "bag-01", name: "Bag 01", category: "bag", image: "/images/bag-01.png", price: 1000, sizes: ["S"], color: "black", spec: "SPEC-01" },
    { id: "bag-02", name: "Bag 02", category: "bag", image: "/images/bag-02.png", price: 2000, sizes: ["M"], color: "white", spec: "SPEC-02" },
  ];
  const { environment, assetPaths, upsertedVectors } = createIngestEnvironment(products);

  const response = await callWorker(
    new Request("https://example.test/api/ingest?offset=2", {
      method: "POST",
      headers: { "x-ingest-token": "ingest-test-token" },
    }),
    environment,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 0, total: 2, ids: [] });
  assert.deepEqual(assetPaths, ["/products.json"]);
  assert.deepEqual(upsertedVectors, []);
});

test("POST /api/ingest reports the upstream status when description generation fails", async () => {
  const products: IngestProduct[] = [
    { id: "bag-01", name: "Bag 01", category: "bag", image: "/images/bag-01.png", price: 1000, sizes: ["S"], color: "black", spec: "SPEC-01" },
  ];
  const { environment } = createIngestEnvironment(products);
  const response = await withGeminiResponse(
    new Response("upstream secret details", { status: 404 }),
    () => callWorker(
      new Request("https://example.test/api/ingest", {
        method: "POST",
        headers: { "x-ingest-token": "ingest-test-token" },
      }),
      environment,
    ),
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "ingest failed (upstream 404)" });
});

test("POST /api/search rejects a request without an image", async () => {
  const response = await callWorker(
    new Request("https://example.test/api/search", {
      method: "POST",
      body: new FormData(),
    }),
    createEnvironment(async () => ({ matches: [] })),
  );

  assert.equal(response.status, 400);
  assert.ok((await response.json() as { error?: string }).error);
});

test("POST /api/search rejects non-image MIME types", async () => {
  const form = new FormData();
  form.append("image", new File(["not an image"], "note.txt", { type: "text/plain" }));

  const response = await callWorker(
    new Request("https://example.test/api/search", { method: "POST", body: form }),
    createEnvironment(async () => ({ matches: [] })),
  );

  assert.equal(response.status, 400);
  assert.ok((await response.json() as { error?: string }).error);
});

test("POST /api/search rejects images larger than 8 MB", async () => {
  const form = new FormData();
  form.append(
    "image",
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  );

  const response = await withGeminiResponse(
    new Response(JSON.stringify({ embedding: { values: Array(768).fill(0.25) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    () => callWorker(
      new Request("https://example.test/api/search", { method: "POST", body: form }),
      createEnvironment(async () => ({ matches: [] })),
    ),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "image is too large" });
});

test("POST /api/search joins Vectorize hits with the D1 product master", async () => {
  let queriedValues: number[] | undefined;
  let queriedOptions: Record<string, unknown> | undefined;
  const env = createEnvironment(
    async (values, options) => {
      queriedValues = values;
      queriedOptions = options;
      return { matches: [{ id: "bag-01", score: 0.987654 }] };
    },
    new Response("asset"),
    [productRow],
  );
  const form = new FormData();
  form.append("image", new File([new Uint8Array([1, 2, 3])], "input.png", { type: "image/png" }));

  const response = await withGeminiResponse(
    new Response(JSON.stringify({ embeddings: [{ values: Array(768).fill(0.25) }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    () => callWorker(
      new Request("https://example.test/api/search", { method: "POST", body: form }),
      env,
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    results: [{ ...expectedProduct, score: 0.987654 }],
  });
  assert.deepEqual(queriedValues, Array(768).fill(0.25));
  assert.deepEqual(queriedOptions, { topK: 12 });
});

test("POST /api/search accepts JSON text and returns the D1 product master", async () => {
  let queriedValues: number[] | undefined;
  const env = createEnvironment(
    async (values) => {
      queriedValues = values;
      return { matches: [{ id: "bag-01", score: 0.876543 }] };
    },
    new Response("asset"),
    [productRow],
  );

  const response = await withGeminiResponse(
    new Response(JSON.stringify({ embedding: { values: Array(768).fill(0.5) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    () => callWorker(
      new Request("https://example.test/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "収納力のあるバッグ" }),
      }),
      env,
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    results: [{ ...expectedProduct, score: 0.876543 }],
  });
  assert.deepEqual(queriedValues, Array(768).fill(0.5));
});

test("GET /api/products returns the product master from D1", async () => {
  const response = await callWorker(
    new Request("https://example.test/api/products"),
    createEnvironment(async () => ({ matches: [] }), new Response("asset"), [productRow]),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [expectedProduct]);
});

test("GET /api/products rejects a non-GET method", async () => {
  const response = await callWorker(
    new Request("https://example.test/api/products", { method: "POST" }),
    createEnvironment(async () => ({ matches: [] })),
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});

test("POST /api/search rejects an empty JSON text query", async () => {
  const response = await callWorker(
    new Request("https://example.test/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "" }),
    }),
    createEnvironment(async () => ({ matches: [] })),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "q must be 1 to 200 characters" });
});

test("POST /api/search rejects a JSON text query longer than 200 characters", async () => {
  const response = await callWorker(
    new Request("https://example.test/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "a".repeat(201) }),
    }),
    createEnvironment(async () => ({ matches: [] })),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "q must be 1 to 200 characters" });
});

test("external search failures return a generic 502 without secrets or stack traces", async () => {
  const form = new FormData();
  form.append("image", new File([new Uint8Array([1])], "input.png", { type: "image/png" }));

  const response = await withGeminiResponse(
    new Response("upstream internal details worker-test-secret", { status: 503 }),
    () => callWorker(
      new Request("https://example.test/api/search", { method: "POST", body: form }),
      createEnvironment(async () => ({ matches: [] })),
    ),
  );

  assert.equal(response.status, 502);
  const body = JSON.stringify(await response.json());
  assert.doesNotMatch(body, /worker-test-secret/);
  assert.doesNotMatch(body, /upstream internal details/);
  assert.doesNotMatch(body, /stack|upstream|at /i);
});
