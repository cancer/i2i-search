import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { embedImage, GeminiEmbeddingError } from "../src/embed.ts";

export const MAX_EMBED_ATTEMPTS = 5;
export const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 8_000;

interface Product {
  id: string;
  name: string;
  category: string;
  image: string;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function embedWithRetry(bytes: Uint8Array, apiKey: string): Promise<number[]> {
  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt += 1) {
    try {
      return await embedImage(bytes, "image/png", apiKey);
    } catch (error) {
      const isRateLimit = error instanceof GeminiEmbeddingError && error.status === 429;
      if (!isRateLimit || attempt === MAX_EMBED_ATTEMPTS) {
        throw error;
      }

      const delay = Math.min(
        RETRY_MAX_DELAY_MS,
        RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
      );
      await wait(delay);
    }
  }

  throw new Error("Embedding attempts exhausted");
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY=... npm run ingest");
  process.exit(1);
}

const projectRoot = process.cwd();
const productsPath = path.join(projectRoot, "public", "products.json");
const imagesDirectory = path.join(projectRoot, "public", "images");
const outputDirectory = path.join(projectRoot, "data");
const outputPath = path.join(outputDirectory, "vectors.ndjson");
const products = JSON.parse(await readFile(productsPath, "utf8")) as Product[];
const lines: string[] = [];

for (const product of products) {
  const imageBytes = new Uint8Array(
    await readFile(path.join(imagesDirectory, `product-${product.id}.png`)),
  );
  const values = await embedWithRetry(imageBytes, apiKey);
  lines.push(JSON.stringify({
    id: product.id,
    values,
    metadata: {
      name: product.name,
      category: product.category,
      image: product.image,
    },
  }));
  console.log(`Embedded ${product.id}`);
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${lines.length} vectors to ${path.relative(projectRoot, outputPath)}.`);
