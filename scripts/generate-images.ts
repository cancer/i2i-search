import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

type Category = "bag" | "shoes" | "chair" | "mug" | "watch" | "lamp";
type Pattern = "solid" | "stripes" | "dots" | "checks";

interface Variant {
  primary: string;
  secondary: string;
  accent: string;
  pattern: Pattern;
  scale: number;
  rotation: number;
}

const categories: Category[] = ["bag", "shoes", "chair", "mug", "watch", "lamp"];

const variants: Variant[] = [
  { primary: "#d97757", secondary: "#f6c6a8", accent: "#713f32", pattern: "solid", scale: 0.94, rotation: -4 },
  { primary: "#335c67", secondary: "#8ec5c9", accent: "#19383e", pattern: "stripes", scale: 1.04, rotation: 3 },
  { primary: "#e7b84b", secondary: "#fff1b8", accent: "#72551a", pattern: "dots", scale: 0.98, rotation: -2 },
  { primary: "#805b9b", secondary: "#d9b9e9", accent: "#432d57", pattern: "checks", scale: 1.08, rotation: 5 },
  { primary: "#4d8061", secondary: "#b9d7ae", accent: "#2c4e3a", pattern: "stripes", scale: 0.9, rotation: 2 },
  { primary: "#d65a75", secondary: "#ffc1ca", accent: "#6f293b", pattern: "dots", scale: 1.02, rotation: -5 },
  { primary: "#4f6d9a", secondary: "#b8c9e8", accent: "#283c61", pattern: "checks", scale: 1.06, rotation: 1 },
  { primary: "#bd8451", secondary: "#efd0a4", accent: "#674127", pattern: "solid", scale: 0.96, rotation: -1 },
];

const categoryNames: Record<Category, string> = {
  bag: "Bag",
  shoes: "Shoes",
  chair: "Chair",
  mug: "Mug",
  watch: "Watch",
  lamp: "Lamp",
};

function patternDefinition(id: string, variant: Variant): string {
  const { primary, secondary } = variant;
  switch (variant.pattern) {
    case "stripes":
      return `<pattern id="${id}" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><rect width="36" height="36" fill="${primary}"/><rect width="12" height="36" fill="${secondary}" opacity="0.72"/></pattern>`;
    case "dots":
      return `<pattern id="${id}" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="${primary}"/><circle cx="8" cy="8" r="5" fill="${secondary}" opacity="0.8"/><circle cx="24" cy="24" r="5" fill="${secondary}" opacity="0.8"/></pattern>`;
    case "checks":
      return `<pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="${primary}"/><rect width="20" height="20" fill="${secondary}" opacity="0.65"/><rect x="20" y="20" width="20" height="20" fill="${secondary}" opacity="0.65"/></pattern>`;
    case "solid":
      return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${primary}"/></pattern>`;
  }
}

function productShape(category: Category, variant: Variant, fillId: string): string {
  const { accent, secondary, rotation, scale } = variant;
  const transform = `translate(256 270) rotate(${rotation}) scale(${scale}) translate(-256 -270)`;

  switch (category) {
    case "bag":
      return `<g transform="${transform}"><path d="M136 192h240l-18 214H154z" fill="url(#${fillId})" stroke="${accent}" stroke-width="7"/><path d="M188 198c0-74 30-108 68-108s68 34 68 108" fill="none" stroke="${accent}" stroke-width="18" stroke-linecap="round"/><path d="M171 294h170v82H171z" fill="${secondary}" opacity="0.72"/><path d="M256 294v82" stroke="${accent}" stroke-width="4" opacity="0.55"/><circle cx="256" cy="322" r="8" fill="${accent}"/></g>`;
    case "shoes":
      return `<g transform="${transform}"><path d="M120 184c24 28 54 48 94 60l70 22c22 7 38 28 38 51v20H112c-13 0-23-10-23-23v-24c0-15 9-28 23-34l28-13c16-8 21-29 17-59z" fill="${secondary}" stroke="${accent}" stroke-width="7"/><path d="M148 162c24 28 54 48 94 60l70 22c22 7 38 28 38 51v20H140c-13 0-23-10-23-23v-24c0-15 9-28 23-34l28-13c16-8 21-29 17-59z" fill="url(#${fillId})" stroke="${accent}" stroke-width="7"/><path d="M168 240c35 13 84 23 139 26" fill="none" stroke="${secondary}" stroke-width="8" opacity="0.75"/><path d="M181 260l-21-39m49 47-20-43m48 50-18-42" stroke="${accent}" stroke-width="5" stroke-linecap="round" opacity="0.65"/><path d="M143 313h204" stroke="${accent}" stroke-width="5" opacity="0.6"/></g>`;
    case "chair":
      return `<g transform="${transform}"><rect x="164" y="92" width="184" height="206" rx="34" fill="url(#${fillId})" stroke="${accent}" stroke-width="7"/><path d="M142 273h228c14 0 25 11 25 25v18H117v-18c0-14 11-25 25-25z" fill="${secondary}" stroke="${accent}" stroke-width="7"/><path d="M151 316l-20 105m230-105 20 105M185 319l-6 102m148-102 6 102" stroke="${accent}" stroke-width="12" stroke-linecap="round"/><path d="M195 135h122" stroke="${secondary}" stroke-width="9" opacity="0.72" stroke-linecap="round"/></g>`;
    case "mug":
      return `<g transform="${transform}"><path d="M143 145h202v190c0 60-40 94-101 94s-101-34-101-94z" fill="url(#${fillId})" stroke="${accent}" stroke-width="7"/><path d="M345 193h37c37 0 57 24 57 60s-20 60-57 60h-38" fill="none" stroke="${accent}" stroke-width="17"/><path d="M154 171h180" stroke="${secondary}" stroke-width="9" opacity="0.8"/><ellipse cx="244" cy="145" rx="101" ry="25" fill="${secondary}" stroke="${accent}" stroke-width="7"/><ellipse cx="244" cy="145" rx="72" ry="13" fill="${accent}" opacity="0.32"/></g>`;
    case "watch":
      return `<g transform="${transform}"><rect x="201" y="65" width="110" height="410" rx="40" fill="${secondary}" stroke="${accent}" stroke-width="7"/><rect x="186" y="150" width="140" height="240" rx="65" fill="url(#${fillId})" stroke="${accent}" stroke-width="8"/><circle cx="256" cy="270" r="82" fill="${secondary}" stroke="${accent}" stroke-width="7"/><circle cx="256" cy="270" r="70" fill="url(#${fillId})" stroke="${accent}" stroke-width="4"/><path d="M256 270v-45m0 45 35 22" stroke="${accent}" stroke-width="8" stroke-linecap="round"/><circle cx="256" cy="270" r="8" fill="${accent}"/><path d="M256 211v11m0 96v11m-59-59h11m96 0h11" stroke="${accent}" stroke-width="5" stroke-linecap="round"/></g>`;
    case "lamp":
      return `<g transform="${transform}"><path d="M150 134h212l-35 137H185z" fill="url(#${fillId})" stroke="${accent}" stroke-width="7"/><path d="M178 135h156" stroke="${secondary}" stroke-width="10" opacity="0.75"/><path d="M256 272v111" stroke="${accent}" stroke-width="12" stroke-linecap="round"/><path d="M203 401h106" stroke="${accent}" stroke-width="13" stroke-linecap="round"/><path d="M225 383h62" stroke="${secondary}" stroke-width="7" stroke-linecap="round"/></g>`;
  }
}

function productSvg(category: Category, index: number, variant: Variant): string {
  const id = `${category}-${String(index).padStart(2, "0")}`;
  const fillId = `pattern-${id}`;
  const label = `${categoryNames[category].toUpperCase()} ${String(index).padStart(2, "0")}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#e9e4da"/></linearGradient>${patternDefinition(fillId, variant)}</defs><rect width="512" height="512" rx="36" fill="url(#background)"/><circle cx="432" cy="78" r="48" fill="#ffffff" opacity="0.45"/><ellipse cx="256" cy="431" rx="155" ry="20" fill="#6c6257" opacity="0.16"/>${productShape(category, variant, fillId)}<text x="256" y="478" text-anchor="middle" fill="#423b35" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3">${label}</text></svg>`;
}

const products = categories.flatMap((category) =>
  variants.map((variant, index) => {
    const id = `${category}-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      name: `${categoryNames[category]} ${String(index + 1).padStart(2, "0")}`,
      category,
      image: `/images/product-${id}.png`,
      svg: productSvg(category, index + 1, variant),
    };
  }),
);

const projectRoot = process.cwd();
const imagesDirectory = path.join(projectRoot, "public", "images");
const productsPath = path.join(projectRoot, "public", "products.json");

await mkdir(imagesDirectory, { recursive: true });

for (const product of products) {
  await sharp(Buffer.from(product.svg)).png().toFile(path.join(imagesDirectory, `product-${product.id}.png`));
}

await writeFile(
  productsPath,
  `${JSON.stringify(products.map(({ svg: _svg, ...product }) => product), null, 2)}\n`,
  "utf8",
);

console.log(`Generated ${products.length} product images.`);
