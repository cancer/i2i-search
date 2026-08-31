export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;
export const DESCRIPTION_MODEL = "gemini-3.7-flash";
export const DESCRIPTION_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${DESCRIPTION_MODEL}:generateContent`;

type ImageMimeType = "image/png" | "image/jpeg";
type FetchFunction = typeof fetch;
type InlineImagePart = {
  inline_data: {
    mime_type: ImageMimeType;
    data: string;
  };
};
type TextPart = { text: string };
type EmbeddingPart = InlineImagePart | TextPart;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getEmbeddingValues(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return undefined;
  }

  const embedding = payload.embedding;
  if (isRecord(embedding) && "values" in embedding) {
    return embedding.values;
  }

  const embeddings = payload.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length === 0) {
    return undefined;
  }

  const firstEmbedding = embeddings[0];
  return isRecord(firstEmbedding) && "values" in firstEmbedding
    ? firstEmbedding.values
    : undefined;
}

function imagePart(bytes: Uint8Array, mimeType: ImageMimeType): InlineImagePart {
  return {
    inline_data: {
      mime_type: mimeType,
      data: toBase64(bytes),
    },
  };
}

async function embeddingRequest(
  parts: EmbeddingPart[],
  apiKey: string,
  fetchFn: FetchFunction,
): Promise<number[]> {
  const response = await fetchFn(EMBEDDING_ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      content: { parts },
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

  const values = getEmbeddingValues(payload);
  if (!Array.isArray(values)) {
    throw new Error("Gemini embedding response did not contain embedding values");
  }

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

function descriptionText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    return "";
  }

  const candidate = payload.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    return "";
  }

  return candidate.content.parts
    .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
}

export async function describeProduct(
  bytes: Uint8Array,
  mimeType: ImageMimeType,
  productName: string,
  category: string,
  apiKey: string,
  fetchFn: FetchFunction = fetch,
): Promise<string> {
  const response = await fetchFn(DESCRIPTION_ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          imagePart(bytes, mimeType),
          {
            text: `あなたはECサイトのコピーライターです。この商品（商品名: ${productName} / カテゴリ: ${category}）の商品説明文を日本語で書いてください。2〜3文、80〜150字。商品の特徴・素材感・使いどころ・魅力を購入者向けに述べる。写真そのものへの言及（「写真には」「写っている」「画像は」等）は禁止。説明文のみを出力。`,
          },
        ],
      }],
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
    throw new Error("Gemini description response was not valid JSON");
  }

  const description = descriptionText(payload);
  if (description === "") {
    throw new Error("Gemini description response did not contain a product description");
  }

  return description;
}

export async function embedImage(
  bytes: Uint8Array,
  mimeType: ImageMimeType,
  apiKey: string,
  fetchFnOrText?: FetchFunction | string,
  textOrFetchFn?: string | FetchFunction,
): Promise<number[]> {
  const fetchFn = typeof fetchFnOrText === "function"
    ? fetchFnOrText
    : typeof textOrFetchFn === "function"
      ? textOrFetchFn
      : fetch;
  const text = typeof fetchFnOrText === "string"
    ? fetchFnOrText
    : typeof textOrFetchFn === "string"
      ? textOrFetchFn
      : undefined;
  const parts: EmbeddingPart[] = [imagePart(bytes, mimeType)];
  if (text !== undefined) {
    parts.push({ text });
  }

  return embeddingRequest(parts, apiKey, fetchFn);
}

export async function embedProduct(
  bytes: Uint8Array,
  mimeType: ImageMimeType,
  text: string,
  apiKey: string,
  fetchFn: FetchFunction = fetch,
): Promise<number[]> {
  return embedImage(bytes, mimeType, apiKey, fetchFn, text);
}

export async function embedText(
  text: string,
  apiKey: string,
  fetchFn: FetchFunction = fetch,
): Promise<number[]> {
  return embeddingRequest([{ text }], apiKey, fetchFn);
}
