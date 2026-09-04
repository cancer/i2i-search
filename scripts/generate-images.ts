import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { MATERIALS, MATERIAL_COLORS, CATEGORIES, variantsOf, type Category } from "./render/parts.ts";
import { renderPart } from "./render/raymarch.ts";

/**
 * 商品画像を自前のレンダリングで生成する。カタログ写真と同じ「部品 1 点・無地背景・
 * 同一構図」に揃えることで、同一カテゴリ内は寸法差だけが違う似た見た目になる。
 */

interface Product {
  id: string;
  name: string;
  category: Category;
  image: string;
  color: string;
  spec: string;
}

const IMAGE_SIZE = 512;
const SUPERSAMPLE = 2;

const categoryNames: Record<Category, string> = {
  bearing: "Bearing",
  gear: "Gear",
  bolt: "Bolt",
  nut: "Nut",
  spring: "Spring",
  bushing: "Bushing",
};

async function generateImages(): Promise<void> {
  const projectRoot = process.cwd();
  const imagesDirectory = path.join(projectRoot, "public", "images");
  await mkdir(imagesDirectory, { recursive: true });

  const products: Product[] = [];
  for (const category of CATEGORIES) {
    const variants = variantsOf(category);
    for (const [index, variant] of variants.entries()) {
      const id = `${category}-${String(index + 1).padStart(2, "0")}`;
      const image = await renderPart(variant.sdf, MATERIALS[variant.material], {
        size: IMAGE_SIZE,
        supersample: SUPERSAMPLE,
        groundY: variant.groundY,
      });
      await writeFile(path.join(imagesDirectory, `product-${id}.png`), image);

      products.push({
        id,
        name: `${categoryNames[category]} ${variant.model}`,
        category,
        image: `/images/product-${id}.png`,
        color: MATERIAL_COLORS[variant.material],
        spec: `${variant.dimensions} / ${variant.material}`,
      });
    }
    console.log(`${category}: ${variants.length} 点をレンダリングしました。`);
  }

  await writeFile(
    path.join(projectRoot, "public", "products.json"),
    `${JSON.stringify(products, null, 2)}\n`,
    "utf8",
  );
  console.log(`Rendered ${products.length} product images.`);
}

await generateImages();
