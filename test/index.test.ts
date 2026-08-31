import { strict as assert } from "node:assert";
import { test } from "node:test";

import worker from "../src/index.ts";

type WorkerEnvironment = Parameters<typeof worker.fetch>[1];

interface IngestProduct {
  id: string;
  name: string;
  category: string;
  image: string;
}

function createEnvironment(
  query: (values: number[], options: Record<string, unknown>) => Promise<unknown>,
  assetResponse = new Response("asset"),
): WorkerEnvironment {
  return {
    GEMINI_API_KEY: "worker-test-secret",
    VECTORIZE: { query },
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
  const environment = {
    GEMINI_API_KEY: "worker-test-secret",
    INGEST_TOKEN: "ingest-test-token",
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

  return { environment, assetPaths, upsertedVectors };
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
    { id: "bag-01", name: "Bag 01", category: "bag", image: "/images/bag-01.png" },
    { id: "bag-02", name: "Bag 02", category: "bag", image: "/images/bag-02.png" },
    { id: "bag-03", name: "Bag 03", category: "bag", image: "/images/bag-03.png" },
    { id: "bag-04", name: "Bag 04", category: "bag", image: "/images/bag-04.png" },
  ];
  const { environment, assetPaths, upsertedVectors } = createIngestEnvironment(products);

  const response = await withGeminiEmbeddingResponse(() => callWorker(
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
    {
      id: "bag-02",
      values: Array(768).fill(0.25),
      metadata: { name: "Bag 02", category: "bag", image: "/images/bag-02.png" },
    },
    {
      id: "bag-03",
      values: Array(768).fill(0.25),
      metadata: { name: "Bag 03", category: "bag", image: "/images/bag-03.png" },
    },
  ]);
});

test("POST /api/ingest returns zero processed when offset reaches the total", async () => {
  const products: IngestProduct[] = [
    { id: "bag-01", name: "Bag 01", category: "bag", image: "/images/bag-01.png" },
    { id: "bag-02", name: "Bag 02", category: "bag", image: "/images/bag-02.png" },
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

test("POST /api/search embeds the image and returns selected Vectorize metadata", async () => {
  let queriedValues: number[] | undefined;
  let queriedOptions: Record<string, unknown> | undefined;
  const env = createEnvironment(async (values, options) => {
    queriedValues = values;
    queriedOptions = options;
    return {
      matches: [
        {
          id: "bag-01",
          score: 0.987654,
          metadata: {
            name: "Canvas Bag",
            category: "bag",
            image: "/images/product-bag-01.png",
            ignored: "not returned",
          },
        },
      ],
    };
  });
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
    results: [
      {
        id: "bag-01",
        score: 0.987654,
        name: "Canvas Bag",
        category: "bag",
        image: "/images/product-bag-01.png",
      },
    ],
  });
  assert.deepEqual(queriedValues, Array(768).fill(0.25));
  assert.deepEqual(queriedOptions, { topK: 12, returnMetadata: "all" });
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
