import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

type Category = "bag" | "shoes" | "chair" | "mug" | "watch" | "lamp";

interface Credit {
  title: string;
  author: string;
  license: string;
  source: string;
}

interface Product {
  id: string;
  name: string;
  category: Category;
  image: string;
  credit: Credit;
}

interface CommonsMetadataValue {
  value?: unknown;
}

interface CommonsImageInfo {
  url?: unknown;
  thumburl?: unknown;
  mime?: unknown;
  descriptionurl?: unknown;
  extmetadata?: Record<string, CommonsMetadataValue>;
}

interface CommonsPage {
  pageid?: unknown;
  index?: unknown;
  title?: unknown;
  imageinfo?: CommonsImageInfo[];
}

interface CommonsCandidate {
  key: string;
  imageUrl: string;
  credit: Credit;
}

interface PreparedProduct {
  product: Product;
  image: Buffer;
}

const categories: Category[] = ["bag", "shoes", "chair", "mug", "watch", "lamp"];

const searchTerms: Record<Category, string[]> = {
  bag: ["handbag photograph", "leather handbag", "shoulder bag"],
  shoes: ["sneaker product", "sneakers shoes", "footwear"],
  chair: ["chair product photograph", "chair furniture", "armchair"],
  mug: ["ceramic mug photograph", "coffee mug product", "drinking mug"],
  watch: ["wristwatch product", "wrist watch", "watch"],
  lamp: ["desk lamp product", "table lamp", "lamp"],
};

const categoryNames: Record<Category, string> = {
  bag: "Bag",
  shoes: "Shoes",
  chair: "Chair",
  mug: "Mug",
  watch: "Watch",
  lamp: "Lamp",
};

const commonsApiUrl = "https://commons.wikimedia.org/w/api.php";
const userAgent = "i2i-search-demo/1.0 (https://github.com/cancer/i2i-search)";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }
  return getString(value);
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z\d]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return namedEntities[entity.toLowerCase()] ?? match;
  });
}

function cleanHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function metadataText(
  metadata: Record<string, CommonsMetadataValue> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key]?.value;
  const text = getString(value);
  if (!text) {
    return undefined;
  }
  const cleaned = cleanHtml(text);
  return cleaned || undefined;
}

function getCommonsPages(payload: unknown): CommonsPage[] {
  if (!isRecord(payload) || !isRecord(payload.query) || !isRecord(payload.query.pages)) {
    throw new Error("Commons API の検索結果の形式が正しくありません。");
  }

  return Object.values(payload.query.pages)
    .filter((page): page is CommonsPage => isRecord(page))
    .sort((left, right) => {
      const leftIndex = typeof left.index === "number" ? left.index : Number.MAX_SAFE_INTEGER;
      const rightIndex = typeof right.index === "number" ? right.index : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
}

function createSearchUrl(searchTerm: string): string {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${searchTerm} filetype:bitmap`,
    gsrlimit: "50",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "1024",
    format: "json",
    origin: "*",
  });
  return `${commonsApiUrl}?${params}`;
}

async function searchCommons(searchTerm: string): Promise<CommonsPage[]> {
  const response = await fetch(createSearchUrl(searchTerm), {
    headers: { "user-agent": userAgent },
  });
  if (!response.ok) {
    throw new Error(`Commons API の検索に失敗しました: HTTP ${response.status}`);
  }
  return getCommonsPages(await response.json());
}

function createCandidate(page: CommonsPage): CommonsCandidate | undefined {
  const imageInfo = page.imageinfo?.[0];
  if (!imageInfo) {
    return undefined;
  }

  const mime = getString(imageInfo.mime);
  if (mime !== "image/jpeg" && mime !== "image/png") {
    return undefined;
  }

  const license = metadataText(imageInfo.extmetadata, "LicenseShortName");
  if (!license) {
    return undefined;
  }

  const imageUrl = getString(imageInfo.thumburl) ?? getString(imageInfo.url);
  const source = getString(imageInfo.descriptionurl);
  if (!imageUrl || !source) {
    return undefined;
  }

  const pageTitle = getString(page.title)?.replace(/^File:/i, "") ?? "Untitled image";
  const title = metadataText(imageInfo.extmetadata, "ObjectName") ?? cleanHtml(pageTitle);
  const author = metadataText(imageInfo.extmetadata, "Artist") ?? "Unknown author";
  const pageId = getIdentifier(page.pageid) ?? source;

  return {
    key: pageId,
    imageUrl,
    credit: { title, author, license, source },
  };
}

async function retryOnce<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("処理に失敗しました。");
}

async function downloadAndConvert(candidate: CommonsCandidate): Promise<Buffer> {
  const response = await fetch(candidate.imageUrl, {
    headers: { "user-agent": userAgent },
  });
  if (!response.ok) {
    throw new Error(`画像のダウンロードに失敗しました: HTTP ${response.status}`);
  }

  return sharp(Buffer.from(await response.arrayBuffer()))
    .resize({ width: 512, height: 512, fit: "cover" })
    .png()
    .toBuffer();
}

async function prepareCategory(category: Category): Promise<PreparedProduct[]> {
  const selected: PreparedProduct[] = [];
  const seenCandidates = new Set<string>();
  const usedTerms: string[] = [];
  let skippedCandidates = 0;

  for (const searchTerm of searchTerms[category]) {
    if (selected.length >= 8) {
      break;
    }
    usedTerms.push(searchTerm);

    let pages: CommonsPage[];
    try {
      pages = await retryOnce(() => searchCommons(searchTerm));
    } catch (error) {
      console.warn(`${category}: 検索語「${searchTerm}」をスキップしました (${String(error)}).`);
      continue;
    }

    for (const page of pages) {
      if (selected.length >= 8) {
        break;
      }

      const candidate = createCandidate(page);
      const candidateKey = candidate?.key ?? getIdentifier(page.pageid) ?? getString(page.title);
      if (!candidateKey || seenCandidates.has(candidateKey)) {
        skippedCandidates += 1;
        continue;
      }
      seenCandidates.add(candidateKey);

      if (!candidate) {
        skippedCandidates += 1;
        continue;
      }

      try {
        const image = await retryOnce(() => downloadAndConvert(candidate));
        const index = selected.length + 1;
        const id = `${category}-${String(index).padStart(2, "0")}`;
        selected.push({
          image,
          product: {
            id,
            name: `${categoryNames[category]} ${String(index).padStart(2, "0")}`,
            category,
            image: `/images/product-${id}.png`,
            credit: candidate.credit,
          },
        });
      } catch (error) {
        skippedCandidates += 1;
        console.warn(`${category}: 候補をスキップしました (${candidate.imageUrl}, ${String(error)}).`);
      }
    }
  }

  console.log(
    `${category}: 採用 ${selected.length}/8, 検索語 ${usedTerms.join(" / ")}, スキップ ${skippedCandidates}`,
  );

  if (selected.length < 8) {
    throw new Error(`${category} の画像を 8 枚確保できませんでした。`);
  }
  return selected;
}

async function generateImages(): Promise<void> {
  const preparedProducts: PreparedProduct[] = [];
  for (const category of categories) {
    preparedProducts.push(...await prepareCategory(category));
  }

  const projectRoot = process.cwd();
  const imagesDirectory = path.join(projectRoot, "public", "images");
  const productsPath = path.join(projectRoot, "public", "products.json");
  await mkdir(imagesDirectory, { recursive: true });

  for (const { product, image } of preparedProducts) {
    await writeFile(path.join(imagesDirectory, `product-${product.id}.png`), image);
  }
  await writeFile(
    productsPath,
    `${JSON.stringify(preparedProducts.map(({ product }) => product), null, 2)}\n`,
    "utf8",
  );

  console.log(`Generated ${preparedProducts.length} product images from Wikimedia Commons.`);
}

await generateImages();
