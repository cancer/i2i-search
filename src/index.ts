import {
  GeminiEmbeddingError,
  describeProduct,
  embedImage,
  embedProduct,
  embedText,
} from "./embed.ts";

type WorkerEnv = Env & { GEMINI_API_KEY: string; INGEST_TOKEN: string };

interface Product {
  id: string;
  name: string;
  category: string;
  image: string;
  price: number;
  sizes: string[];
  color: string;
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function errorResponse(message: string, status: number, headers?: HeadersInit): Response {
  return jsonResponse({ error: message }, status, headers);
}

function parseQueryNumber(
  searchParams: URLSearchParams,
  name: string,
  defaultValue: number,
): number | undefined {
  const value = searchParams.get(name);
  if (value === null) {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getImageMimeType(response: Response): "image/png" | "image/jpeg" {
  return response.headers.get("content-type")?.split(";", 1)[0].trim() === "image/jpeg"
    ? "image/jpeg"
    : "image/png";
}

function getUpstreamStatus(error: unknown): number | undefined {
  return error instanceof GeminiEmbeddingError ? error.status : undefined;
}

async function ingest(request: Request, env: WorkerEnv): Promise<Response> {
  if (!env.INGEST_TOKEN || request.headers.get("x-ingest-token") !== env.INGEST_TOKEN) {
    return errorResponse("unauthorized", 401);
  }

  const url = new URL(request.url);
  const offset = parseQueryNumber(url.searchParams, "offset", 0);
  const requestedLimit = parseQueryNumber(url.searchParams, "limit", 10);
  if (offset === undefined || requestedLimit === undefined) {
    return errorResponse("offset and limit must be numbers", 400);
  }

  const limit = Math.min(requestedLimit, 10);

  try {
    const productsResponse = await env.ASSETS.fetch(new URL("/products.json", request.url));
    if (!productsResponse.ok) {
      throw new Error("products fetch failed");
    }

    const products = await productsResponse.json() as Product[];
    if (!Array.isArray(products)) {
      throw new Error("products response was not an array");
    }

    const vectors: Array<{
      id: string;
      values: number[];
      metadata: {
        name: string;
        category: string;
        image: string;
        description: string;
        price: number;
        sizes: string[];
        color: string;
      };
    }> = [];

    for (const product of products.slice(offset, offset + limit)) {
      const imageResponse = await env.ASSETS.fetch(new URL(product.image, request.url));
      if (!imageResponse.ok) {
        throw new Error("image fetch failed");
      }

      const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
      const mimeType = getImageMimeType(imageResponse);
      const description = await describeProduct(
        imageBytes,
        mimeType,
        product.name,
        product.category,
        env.GEMINI_API_KEY,
      );
      const values = await embedProduct(
        imageBytes,
        mimeType,
        description,
        env.GEMINI_API_KEY,
      );
      vectors.push({
        id: product.id,
        values,
        metadata: {
          name: product.name,
          category: product.category,
          image: product.image,
          description,
          price: product.price,
          sizes: product.sizes,
          color: product.color,
        },
      });
    }

    if (vectors.length > 0) {
      await env.VECTORIZE.upsert(vectors);
    }

    return jsonResponse({
      processed: vectors.length,
      total: products.length,
      ids: vectors.map((vector) => vector.id),
    });
  } catch (error) {
    const upstreamStatus = getUpstreamStatus(error);
    return errorResponse(
      upstreamStatus === undefined ? "ingest failed" : `ingest failed (upstream ${upstreamStatus})`,
      502,
    );
  }
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

async function queryVectorize(values: number[], env: WorkerEnv): Promise<Response> {
  const matches = await env.VECTORIZE.query(values, {
    topK: 12,
    returnMetadata: "all",
  });

  return jsonResponse({
    results: matches.matches.map((match) => {
      const metadata = match.metadata;
      return {
        id: match.id,
        score: match.score,
        name: typeof metadata?.name === "string" ? metadata.name : "",
        category: typeof metadata?.category === "string" ? metadata.category : "",
        image: typeof metadata?.image === "string" ? metadata.image : "",
        description: typeof metadata?.description === "string" ? metadata.description : undefined,
        price: optionalFiniteNumber(metadata?.price),
        sizes: optionalStringArray(metadata?.sizes),
        color: typeof metadata?.color === "string" ? metadata.color : undefined,
      };
    }),
  });
}

async function parseTextQuery(request: Request): Promise<string | Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("JSON body is required", 400);
  }

  const query = isRecord(payload) && typeof payload.q === "string" ? payload.q.trim() : "";
  if (query.length < 1 || query.length > 200) {
    return errorResponse("q must be 1 to 200 characters", 400);
  }

  return query;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/api/ingest") {
      if (request.method !== "POST") {
        return errorResponse("POST is required", 405, { allow: "POST" });
      }

      return ingest(request, env);
    }

    if (pathname !== "/api/search") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return errorResponse("POST is required", 405, { allow: "POST" });
    }

    try {
      const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      let values: number[];
      if (contentType === "application/json") {
        const query = await parseTextQuery(request);
        if (query instanceof Response) {
          return query;
        }
        values = await embedText(query, env.GEMINI_API_KEY);
      } else {
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return errorResponse("multipart form data is required", 400);
        }

        const image = formData.get("image");
        if (!(image instanceof File)) {
          return errorResponse("image is required", 400);
        }

        if (image.type !== "image/png" && image.type !== "image/jpeg") {
          return errorResponse("image must be a PNG or JPEG file", 400);
        }

        if (image.size > 8 * 1024 * 1024) {
          return errorResponse("image is too large", 413);
        }

        values = await embedImage(
          new Uint8Array(await image.arrayBuffer()),
          image.type,
          env.GEMINI_API_KEY,
        );
      }

      return queryVectorize(values, env);
    } catch {
      return errorResponse("search failed", 502);
    }
  },
};
