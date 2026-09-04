import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type Category = "bearing" | "gear" | "bolt" | "nut" | "spring" | "bushing";
export type Size = "S" | "M" | "L";

export const PRICE_RANGES: Record<Category, readonly [number, number]> = {
  bearing: [800, 20_000],
  gear: [1_500, 40_000],
  bolt: [100, 3_000],
  nut: [100, 1_500],
  spring: [200, 5_000],
  bushing: [500, 12_000],
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && categories.includes(value as Category);
}

function isProductRecord(value: unknown): value is ProductRecord {
  return isRecord(value) && typeof value.id === "string" && isCategory(value.category);
}

export async function enrichProducts(): Promise<void> {
  const projectRoot = process.cwd();
  const productsPath = path.join(projectRoot, "public", "products.json");
  const rawProducts: unknown = JSON.parse(await readFile(productsPath, "utf8"));
  if (!Array.isArray(rawProducts) || !rawProducts.every(isProductRecord)) {
    throw new Error("商品一覧の形式が正しくありません。");
  }

  const enrichedProducts: ProductRecord[] = rawProducts.map((product) => ({
    ...product,
    price: derivePrice(product.id, product.category),
    sizes: deriveSizes(product.id),
  }));

  await writeFile(productsPath, `${JSON.stringify(enrichedProducts, null, 2)}\n`, "utf8");
  console.log(`Enriched ${enrichedProducts.length} products with price and sizes.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await enrichProducts();
}
