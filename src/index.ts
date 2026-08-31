import { embedImage } from "./embed.ts";

type WorkerEnv = Env & { GEMINI_API_KEY: string };

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

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname !== "/api/search") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return errorResponse("POST is required", 405, { allow: "POST" });
    }

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

    try {
      const values = await embedImage(
        new Uint8Array(await image.arrayBuffer()),
        image.type,
        env.GEMINI_API_KEY,
      );
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
          };
        }),
      });
    } catch {
      return errorResponse("search failed", 502);
    }
  },
};
