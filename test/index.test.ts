import { strict as assert } from "node:assert";
import { test } from "node:test";

import worker from "../src/index.ts";

type WorkerEnvironment = Parameters<typeof worker.fetch>[1];

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
