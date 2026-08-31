export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

export class GeminiEmbeddingError extends Error {
  readonly status: number;

  constructor(status: number, summary: string) {
    super(`Gemini embedding request failed with HTTP ${status}: ${summary}`);
    this.name = "GeminiEmbeddingError";
    this.status = status;
  }
}

function toBase64(bytes: Uint8Array): string {
  const chunkSize = 32_768;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function summarizeErrorBody(body: string, apiKey: string): string {
  const redacted = apiKey ? body.split(apiKey).join("[redacted]") : body;
  const summary = redacted.replace(/\s+/g, " ").trim();
  return summary.slice(0, 200) || "no response body";
}

async function readErrorBody(response: Response): Promise<string> {
  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (bytesRead < 4_096) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const remaining = 4_096 - bytesRead;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      bytesRead += chunk.length;
      if (chunk.length < value.length) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();
}

function hasEmbeddingValues(
  payload: unknown,
): payload is { embeddings: Array<{ values: unknown }> } {
  if (!payload || typeof payload !== "object" || !("embeddings" in payload)) {
    return false;
  }

  const embeddings = payload.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length === 0) {
    return false;
  }

  const firstEmbedding = embeddings[0];
  return typeof firstEmbedding === "object"
    && firstEmbedding !== null
    && "values" in firstEmbedding;
}

export async function embedImage(
  bytes: Uint8Array,
  mimeType: "image/png" | "image/jpeg",
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<number[]> {
  const response = await fetchFn(EMBEDDING_ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      content: {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: toBase64(bytes),
            },
          },
        ],
      },
      embedContentConfig: {
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    }),
  });

  if (!response.ok) {
    let body = "";
    try {
      body = await readErrorBody(response);
    } catch {
      body = "";
    }
    throw new GeminiEmbeddingError(response.status, summarizeErrorBody(body, apiKey));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Gemini embedding response was not valid JSON");
  }

  if (!hasEmbeddingValues(payload) || !Array.isArray(payload.embeddings[0].values)) {
    throw new Error("Gemini embedding response did not contain embedding values");
  }

  const values = payload.embeddings[0].values;
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `埋め込みの次元不一致: 期待値 ${EMBEDDING_DIMENSIONS}、実際 ${values.length}`,
    );
  }

  if (!values.every(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  )) {
    throw new Error("Gemini embedding response contained invalid values");
  }

  return values;
}
