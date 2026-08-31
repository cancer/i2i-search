import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

export type Category = "bag" | "shoes" | "chair" | "mug" | "watch" | "lamp";
export type Size = "S" | "M" | "L";
export type Color = "black" | "white" | "gray" | "brown" | "red" | "blue" | "green" | "beige";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const PRICE_RANGES: Record<Category, readonly [number, number]> = {
  bag: [3_000, 30_000],
  shoes: [4_000, 20_000],
  chair: [8_000, 60_000],
  mug: [800, 4_000],
  watch: [5_000, 80_000],
  lamp: [2_000, 25_000],
};

export const COLORS: readonly Color[] = [
  "black",
  "white",
  "gray",
  "brown",
  "red",
  "blue",
  "green",
  "beige",
];

export const ACHROMATIC_COLORS: readonly Color[] = ["black", "white", "gray"];
export const CHROMATIC_COLORS: readonly Color[] = ["brown", "red", "blue", "green", "beige"];
export const COLOR_CHROMA_THRESHOLD = 30;

export const COLOR_REPRESENTATIVES: Record<Color, Rgb> = {
  black: { r: 20, g: 20, b: 20 },
  white: { r: 240, g: 240, b: 240 },
  gray: { r: 128, g: 128, b: 128 },
  brown: { r: 120, g: 80, b: 50 },
  red: { r: 180, g: 40, b: 40 },
  blue: { r: 50, g: 80, b: 170 },
  green: { r: 60, g: 130, b: 70 },
  beige: { r: 210, g: 190, b: 160 },
};

const categories: readonly Category[] = Object.keys(PRICE_RANGES) as Category[];
const sizeOptions: readonly (readonly Size[])[] = [
  ["S"],
  ["S", "M"],
  ["M", "L"],
  ["S", "M", "L"],
];

type ProductRecord = Record<string, unknown> & {
  id: string;
  category: Category;
};

export function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function derivePrice(id: string, category: Category): number {
  const range = PRICE_RANGES[category];
  if (!range) {
    throw new Error(`価格レンジが定義されていません: ${category}`);
  }

  const [minimum, maximum] = range;
  const steps = (maximum - minimum) / 100;
  return minimum + (hashString(id) % (steps + 1)) * 100;
}

export function deriveSizes(id: string): Size[] {
  const sizes = sizeOptions[hashString(id) % sizeOptions.length];
  return [...sizes];
}

export function classifyColor(rgb: Rgb): Color {
  const chroma = Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
  const candidateColors = chroma < COLOR_CHROMA_THRESHOLD ? ACHROMATIC_COLORS : CHROMATIC_COLORS;
  let closestColor = candidateColors[0];
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const color of candidateColors) {
    const representative = COLOR_REPRESENTATIVES[color];
    const redDistance = rgb.r - representative.r;
    const greenDistance = rgb.g - representative.g;
    const blueDistance = rgb.b - representative.b;
    const distance = redDistance ** 2 + greenDistance ** 2 + blueDistance ** 2;

    if (distance < closestDistance) {
      closestColor = color;
      closestDistance = distance;
    }
  }

  return closestColor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && categories.includes(value as Category);
}

function isProductRecord(value: unknown): value is ProductRecord {
  return isRecord(value) && typeof value.id === "string" && isCategory(value.category);
}

async function dominantCenterColor(imagePath: string): Promise<Rgb> {
  const metadata = await sharp(imagePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`画像サイズを取得できません: ${imagePath}`);
  }

  const width = Math.max(1, Math.floor(metadata.width * 0.5));
  const height = Math.max(1, Math.floor(metadata.height * 0.5));
  const left = Math.floor((metadata.width - width) / 2);
  const top = Math.floor((metadata.height - height) / 2);
  const stats = await sharp(imagePath)
    .extract({ left, top, width, height })
    .removeAlpha()
    .stats();
  return stats.dominant;
}

export async function enrichProducts(): Promise<void> {
  const projectRoot = process.cwd();
  const productsPath = path.join(projectRoot, "public", "products.json");
  const rawProducts: unknown = JSON.parse(await readFile(productsPath, "utf8"));
  if (!Array.isArray(rawProducts) || !rawProducts.every(isProductRecord)) {
    throw new Error("商品一覧の形式が正しくありません。");
  }

  const enrichedProducts: ProductRecord[] = [];
  for (const product of rawProducts) {
    const imagePath = path.join(projectRoot, "public", "images", `product-${product.id}.png`);
    const dominantColor = await dominantCenterColor(imagePath);
    enrichedProducts.push({
      ...product,
      price: derivePrice(product.id, product.category),
      sizes: deriveSizes(product.id),
      color: classifyColor(dominantColor),
    });
  }

  await writeFile(productsPath, `${JSON.stringify(enrichedProducts, null, 2)}\n`, "utf8");
  console.log(`Enriched ${enrichedProducts.length} products with price, sizes, and color.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await enrichProducts();
}
