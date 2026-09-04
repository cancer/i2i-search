import type { Material, Sdf } from "./raymarch.ts";

/**
 * カタログに載せる機械部品の形状と寸法バリエーション。
 * 同一カテゴリ内は「寸法だけが違う同型部品」になるよう、形状は共通の SDF で表す。
 */
export type Category = "bearing" | "gear" | "bolt" | "nut" | "spring" | "bushing";

export interface Variant {
  /** 型番風の識別名 */
  model: string;
  /** 主要寸法。商品説明の材料になるので mm で持つ */
  dimensions: string;
  material: MaterialName;
  sdf: Sdf;
  /** 接地面の高さ */
  groundY: number;
}

export type MaterialName = "steel" | "brass" | "black-oxide" | "zinc";

export const MATERIALS: Record<MaterialName, Material> = {
  steel: { albedo: [0.62, 0.63, 0.65], specular: 0.55 },
  brass: { albedo: [0.68, 0.55, 0.28], specular: 0.5 },
  "black-oxide": { albedo: [0.16, 0.16, 0.17], specular: 0.42 },
  zinc: { albedo: [0.70, 0.72, 0.75], specular: 0.38 },
};

/** 表面処理ごとの見た目の色。画像から抽出せず、レンダリング時の材質を正とする */
export const MATERIAL_COLORS: Record<MaterialName, "gray" | "brown" | "black" | "white"> = {
  steel: "gray",
  brass: "brown",
  "black-oxide": "black",
  zinc: "white",
};

const materialCycle: readonly MaterialName[] = ["steel", "zinc", "black-oxide", "brass"];

function pickMaterial(index: number): MaterialName {
  return materialCycle[index % materialCycle.length];
}

// --- SDF プリミティブ ------------------------------------------------

function sdSphere(x: number, y: number, z: number, radius: number): number {
  return Math.hypot(x, y, z) - radius;
}

/** Y 軸を中心軸とする円柱 */
function sdCylinder(x: number, y: number, z: number, radius: number, halfHeight: number): number {
  const radial = Math.hypot(x, z) - radius;
  const axial = Math.abs(y) - halfHeight;
  return Math.min(Math.max(radial, axial), 0) + Math.hypot(Math.max(radial, 0), Math.max(axial, 0));
}

function sdTorus(x: number, y: number, z: number, ringRadius: number, tubeRadius: number): number {
  return Math.hypot(Math.hypot(x, z) - ringRadius, y) - tubeRadius;
}

function sdBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): number {
  const qx = Math.abs(x) - hx;
  const qy = Math.abs(y) - hy;
  const qz = Math.abs(z) - hz;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
}

/** Y 軸を中心軸とする六角柱（対辺距離 = across * 2） */
function sdHexPrism(x: number, y: number, z: number, across: number, halfHeight: number): number {
  const kx = -Math.sqrt(3) / 2;
  const ky = 0.5;
  const kz = 1 / Math.sqrt(3);
  let px = Math.abs(x);
  let pz = Math.abs(z);
  const fold = 2 * Math.min(0, kx * px + ky * pz);
  px -= fold * kx;
  pz -= fold * ky;
  const clamped = Math.min(Math.max(px, -kz * across), kz * across);
  const radial = Math.hypot(px - clamped, pz - across) * Math.sign(pz - across);
  const axial = Math.abs(y) - halfHeight;
  return Math.min(Math.max(radial, axial), 0) + Math.hypot(Math.max(radial, 0), Math.max(axial, 0));
}

/** 中心軸まわりに n 個の同一形状を並べるための座標折り返し */
function foldAngular(x: number, z: number, count: number): readonly [number, number] {
  const sector = (2 * Math.PI) / count;
  const angle = Math.atan2(z, x);
  const folded = angle - sector * Math.round(angle / sector);
  const radius = Math.hypot(x, z);
  return [radius * Math.cos(folded), radius * Math.sin(folded)];
}

/** ねじ山。半径をらせん状に増減させて近似する */
function threadOffset(x: number, y: number, z: number, pitch: number, depth: number): number {
  return depth * Math.sin((y / pitch) * 2 * Math.PI + Math.atan2(z, x));
}

// --- 部品ごとの SDF --------------------------------------------------

function ballBearing(outer: number, bore: number, width: number, balls: number): Sdf {
  const middle = (outer + bore) / 2;
  const ball = (outer - bore) * 0.3;
  return (x, y, z) => {
    const groove = sdTorus(x, y, z, middle, ball * 1.04);
    const outerRing = Math.max(
      Math.max(sdCylinder(x, y, z, outer, width), -sdCylinder(x, y, z, middle + ball * 0.86, width + 1)),
      -groove,
    );
    const innerRing = Math.max(
      Math.max(sdCylinder(x, y, z, middle - ball * 0.86, width), -sdCylinder(x, y, z, bore, width + 1)),
      -groove,
    );
    const [fx, fz] = foldAngular(x, z, balls);
    return Math.min(Math.min(outerRing, innerRing), sdSphere(fx - middle, y, fz, ball));
  };
}

function spurGear(outer: number, teeth: number, width: number, bore: number): Sdf {
  const root = outer * 0.86;
  const toothHeight = outer - root;
  return (x, y, z) => {
    const body = sdCylinder(x, y, z, root, width);
    const [fx, fz] = foldAngular(x, z, teeth);
    const tooth = sdBox(fx - (root + toothHeight * 0.5), y, fz, toothHeight * 0.55, width, outer * 0.075);
    const hub = sdCylinder(x, y, z, bore * 1.7, width * 1.25);
    return Math.max(Math.min(Math.min(body, tooth), hub), -sdCylinder(x, y, z, bore, width * 2));
  };
}

function hexBolt(across: number, shank: number, length: number, pitch: number): Sdf {
  const headHalf = across * 0.42;
  return (x, y, z) => {
    const head = sdHexPrism(x, y - (length - headHalf), z, across, headHalf);
    const radial = Math.hypot(x, z) - (shank + threadOffset(x, y, z, pitch, shank * 0.075));
    const axial = Math.abs(y) - (length - headHalf * 2);
    const shaft = Math.min(Math.max(radial, axial), 0) + Math.hypot(Math.max(radial, 0), Math.max(axial, 0));
    return Math.min(head, shaft);
  };
}

function hexNut(across: number, bore: number, height: number, pitch: number): Sdf {
  return (x, y, z) => {
    const body = sdHexPrism(x, y, z, across, height);
    const radial = (bore + threadOffset(x, y, z, pitch, bore * 0.09)) - Math.hypot(x, z);
    return Math.max(body, radial);
  };
}

function coilSpring(coilRadius: number, wire: number, pitch: number, coils: number): Sdf {
  const halfHeight = (pitch * coils) / 2;
  return (x, y, z) => {
    const angle = Math.atan2(z, x);
    const offset = y - (pitch * angle) / (2 * Math.PI);
    const wrapped = offset - pitch * Math.round(offset / pitch);
    const helix = Math.hypot(Math.hypot(x, z) - coilRadius, wrapped) - wire;
    return Math.max(helix, Math.abs(y) - halfHeight);
  };
}

function bushing(outer: number, bore: number, height: number, flange: number): Sdf {
  return (x, y, z) => {
    const body = sdCylinder(x, y, z, outer, height);
    const collar = sdCylinder(x, y - height + flange, z, outer * 1.22, flange);
    return Math.max(Math.min(body, collar), -sdCylinder(x, y, z, bore, height * 2));
  };
}

// --- カタログ定義 ----------------------------------------------------

interface CatalogEntry {
  outer: number;
  bore: number;
  width: number;
  detail: number;
  /** 表示用の実寸（mm） */
  millimeters: readonly number[];
}

const CATALOG: Record<Category, readonly CatalogEntry[]> = {
  bearing: [
    { outer: 0.95, bore: 0.42, width: 0.30, detail: 8, millimeters: [47, 20, 14] },
    { outer: 0.95, bore: 0.50, width: 0.26, detail: 9, millimeters: [47, 25, 12] },
    { outer: 1.00, bore: 0.46, width: 0.34, detail: 9, millimeters: [52, 22, 16] },
    { outer: 1.00, bore: 0.58, width: 0.24, detail: 11, millimeters: [52, 30, 12] },
    { outer: 0.90, bore: 0.38, width: 0.32, detail: 8, millimeters: [42, 17, 15] },
    { outer: 1.02, bore: 0.54, width: 0.30, detail: 10, millimeters: [55, 28, 14] },
    { outer: 0.92, bore: 0.48, width: 0.22, detail: 10, millimeters: [44, 24, 10] },
    { outer: 0.98, bore: 0.44, width: 0.36, detail: 9, millimeters: [50, 21, 18] },
  ],
  gear: [
    { outer: 0.95, bore: 0.24, width: 0.18, detail: 18, millimeters: [48, 12, 9] },
    { outer: 0.98, bore: 0.26, width: 0.16, detail: 24, millimeters: [50, 13, 8] },
    { outer: 1.00, bore: 0.22, width: 0.22, detail: 30, millimeters: [52, 11, 11] },
    { outer: 0.92, bore: 0.28, width: 0.20, detail: 16, millimeters: [46, 14, 10] },
    { outer: 0.96, bore: 0.20, width: 0.24, detail: 20, millimeters: [49, 10, 12] },
    { outer: 1.00, bore: 0.30, width: 0.14, detail: 36, millimeters: [52, 15, 7] },
    { outer: 0.90, bore: 0.24, width: 0.26, detail: 14, millimeters: [45, 12, 13] },
    { outer: 0.98, bore: 0.26, width: 0.20, detail: 27, millimeters: [50, 13, 10] },
  ],
  bolt: [
    { outer: 0.40, bore: 0.17, width: 1.05, detail: 0.075, millimeters: [16, 8, 45] },
    { outer: 0.44, bore: 0.20, width: 1.10, detail: 0.085, millimeters: [18, 10, 50] },
    { outer: 0.36, bore: 0.15, width: 0.95, detail: 0.065, millimeters: [14, 7, 40] },
    { outer: 0.48, bore: 0.22, width: 1.15, detail: 0.095, millimeters: [21, 12, 55] },
    { outer: 0.40, bore: 0.17, width: 0.85, detail: 0.075, millimeters: [16, 8, 35] },
    { outer: 0.44, bore: 0.20, width: 1.00, detail: 0.070, millimeters: [18, 10, 45] },
    { outer: 0.52, bore: 0.25, width: 1.18, detail: 0.100, millimeters: [24, 14, 60] },
    { outer: 0.36, bore: 0.15, width: 1.10, detail: 0.055, millimeters: [14, 7, 50] },
  ],
  nut: [
    { outer: 0.78, bore: 0.34, width: 0.30, detail: 0.15, millimeters: [16, 8, 6.5] },
    { outer: 0.86, bore: 0.40, width: 0.34, detail: 0.17, millimeters: [18, 10, 8 ] },
    { outer: 0.70, bore: 0.30, width: 0.26, detail: 0.13, millimeters: [14, 7, 5.5] },
    { outer: 0.94, bore: 0.44, width: 0.38, detail: 0.19, millimeters: [21, 12, 10] },
    { outer: 0.78, bore: 0.34, width: 0.44, detail: 0.15, millimeters: [16, 8, 10] },
    { outer: 0.86, bore: 0.40, width: 0.24, detail: 0.17, millimeters: [18, 10, 5] },
    { outer: 1.00, bore: 0.50, width: 0.40, detail: 0.21, millimeters: [24, 14, 11] },
    { outer: 0.70, bore: 0.30, width: 0.36, detail: 0.13, millimeters: [14, 7, 8] },
  ],
  spring: [
    { outer: 0.44, bore: 0.075, width: 0.30, detail: 5, millimeters: [22, 3.5, 38] },
    { outer: 0.50, bore: 0.085, width: 0.26, detail: 6, millimeters: [25, 4, 40] },
    { outer: 0.38, bore: 0.065, width: 0.34, detail: 4, millimeters: [19, 3, 34] },
    { outer: 0.44, bore: 0.070, width: 0.22, detail: 7, millimeters: [22, 3.5, 32] },
    { outer: 0.56, bore: 0.095, width: 0.32, detail: 5, millimeters: [28, 4.5, 40] },
    { outer: 0.38, bore: 0.055, width: 0.24, detail: 6, millimeters: [19, 2.8, 30] },
    { outer: 0.50, bore: 0.080, width: 0.38, detail: 4, millimeters: [25, 4, 38] },
    { outer: 0.46, bore: 0.075, width: 0.28, detail: 6, millimeters: [23, 3.5, 36] },
  ],
  bushing: [
    { outer: 0.62, bore: 0.36, width: 0.46, detail: 0.10, millimeters: [30, 18, 24] },
    { outer: 0.68, bore: 0.42, width: 0.40, detail: 0.11, millimeters: [34, 21, 20] },
    { outer: 0.56, bore: 0.32, width: 0.52, detail: 0.09, millimeters: [28, 16, 26] },
    { outer: 0.74, bore: 0.46, width: 0.44, detail: 0.12, millimeters: [36, 23, 22] },
    { outer: 0.62, bore: 0.30, width: 0.58, detail: 0.10, millimeters: [30, 15, 29] },
    { outer: 0.68, bore: 0.38, width: 0.34, detail: 0.13, millimeters: [34, 19, 17] },
    { outer: 0.56, bore: 0.36, width: 0.62, detail: 0.08, millimeters: [28, 18, 31] },
    { outer: 0.74, bore: 0.50, width: 0.36, detail: 0.11, millimeters: [36, 25, 18] },
  ],
};

const MODEL_PREFIX: Record<Category, string> = {
  bearing: "BRG",
  gear: "GEA",
  bolt: "BLT",
  nut: "NUT",
  spring: "SPR",
  bushing: "BSH",
};

function buildSdf(category: Category, entry: CatalogEntry): Sdf {
  switch (category) {
    case "bearing":
      return ballBearing(entry.outer, entry.bore, entry.width, entry.detail);
    case "gear":
      return spurGear(entry.outer, entry.detail, entry.width, entry.bore);
    case "bolt":
      return hexBolt(entry.outer, entry.bore, entry.width, entry.detail);
    case "nut":
      return hexNut(entry.outer, entry.bore, entry.width, entry.detail);
    case "spring":
      return coilSpring(entry.outer, entry.bore, entry.width, entry.detail);
    case "bushing":
      return bushing(entry.outer, entry.bore, entry.width, entry.detail);
  }
}

function describeDimensions(category: Category, entry: CatalogEntry): string {
  const [first, second, third] = entry.millimeters;
  switch (category) {
    case "bearing":
      return `外径 ${first} mm / 内径 ${second} mm / 幅 ${third} mm / 鋼球 ${entry.detail} 個`;
    case "gear":
      return `外径 ${first} mm / 軸穴 ${second} mm / 歯幅 ${third} mm / 歯数 ${entry.detail}`;
    case "bolt":
      return `二面幅 ${first} mm / ねじ径 M${second} / 長さ ${third} mm`;
    case "nut":
      return `二面幅 ${first} mm / ねじ径 M${second} / 高さ ${third} mm`;
    case "spring":
      return `コイル外径 ${first} mm / 線径 ${second} mm / 自由長 ${third} mm`;
    case "bushing":
      return `外径 ${first} mm / 内径 ${second} mm / 全長 ${third} mm`;
  }
}

/** 部品の底面。接地影を正しい高さに落とすために使う */
function groundLevel(category: Category, entry: CatalogEntry): number {
  return category === "spring" ? -(entry.width * entry.detail) / 2 : -entry.width;
}

export const CATEGORIES: readonly Category[] = Object.keys(CATALOG) as Category[];

export function variantsOf(category: Category): Variant[] {
  return CATALOG[category].map((entry, index) => ({
    model: `${MODEL_PREFIX[category]}-${entry.millimeters[0]}${String.fromCharCode(65 + index)}`,
    dimensions: describeDimensions(category, entry),
    material: pickMaterial(index),
    sdf: buildSdf(category, entry),
    groundY: groundLevel(category, entry),
  }));
}
