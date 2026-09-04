import sharp from "sharp";

/**
 * 部品の形状を符号付き距離関数（SDF）として受け取り、無地背景のスタジオ撮影風に
 * レンダリングする。カタログ写真と同じ「単体・無地背景・同一構図」を得るのが目的。
 */
export type Sdf = (x: number, y: number, z: number) => number;

export interface Material {
  /** 拡散反射色（0-1） */
  albedo: readonly [number, number, number];
  /** 鏡面反射の強さ（0-1）。金属ほど大きい */
  specular: number;
}

export interface RenderOptions {
  /** 出力の一辺（px） */
  size: number;
  /** 1 px あたりのサンプル数の平方根。2 なら 4 サンプル */
  supersample: number;
  /** 接地面の高さ。部品の底面に合わせる */
  groundY: number;
}

const MAX_STEPS = 160;
const MAX_DISTANCE = 8;
const SURFACE_EPSILON = 0.0012;
const NORMAL_EPSILON = 0.0015;

const CAMERA = {
  eye: [0, 1.5, 3.5] as const,
  fov: 0.5,
} as const;

const KEY_LIGHT = normalize(-0.45, 0.82, 0.36);
const FILL_LIGHT = normalize(0.6, 0.35, 0.5);

function normalize(x: number, y: number, z: number): readonly [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 部品表面までの距離を辿り、交差点までの距離を返す。交差しなければ undefined */
function marchPart(
  sdf: Sdf,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
): number | undefined {
  let travelled = 0.4;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const distance = sdf(
      originX + dirX * travelled,
      originY + dirY * travelled,
      originZ + dirZ * travelled,
    );
    if (distance < SURFACE_EPSILON) {
      return travelled;
    }
    travelled += distance * 0.9;
    if (travelled > MAX_DISTANCE) {
      return undefined;
    }
  }
  return undefined;
}

/** 光源方向への遮蔽率（0 = 完全に影, 1 = 影なし）。半影を出すため最小距離で減衰させる */
function softShadow(sdf: Sdf, x: number, y: number, z: number): number {
  const [lightX, lightY, lightZ] = KEY_LIGHT;
  let travelled = 0.02;
  let shadow = 1;
  for (let step = 0; step < 48; step += 1) {
    const distance = sdf(
      x + lightX * travelled,
      y + lightY * travelled,
      z + lightZ * travelled,
    );
    if (distance < SURFACE_EPSILON) {
      return 0;
    }
    shadow = Math.min(shadow, (distance * 12) / travelled);
    travelled += Math.max(distance, 0.01);
    if (travelled > 4) {
      break;
    }
  }
  return clamp01(shadow);
}

function shadePart(
  sdf: Sdf,
  material: Material,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
): readonly [number, number, number] {
  const e = NORMAL_EPSILON;
  const normal = normalize(
    sdf(x + e, y, z) - sdf(x - e, y, z),
    sdf(x, y + e, z) - sdf(x, y - e, z),
    sdf(x, y, z + e) - sdf(x, y, z - e),
  );

  const key = Math.max(0, normal[0] * KEY_LIGHT[0] + normal[1] * KEY_LIGHT[1] + normal[2] * KEY_LIGHT[2]);
  const fill = Math.max(0, normal[0] * FILL_LIGHT[0] + normal[1] * FILL_LIGHT[1] + normal[2] * FILL_LIGHT[2]);
  const sky = 0.5 + 0.5 * normal[1];
  const shadow = softShadow(sdf, x + normal[0] * 0.01, y + normal[1] * 0.01, z + normal[2] * 0.01);

  const half = normalize(KEY_LIGHT[0] - dirX, KEY_LIGHT[1] - dirY, KEY_LIGHT[2] - dirZ);
  const specular = material.specular
    * Math.pow(Math.max(0, normal[0] * half[0] + normal[1] * half[1] + normal[2] * half[2]), 48)
    * (0.25 + 0.75 * shadow);
  const rim = 0.25 * Math.pow(1 - Math.max(0, -(normal[0] * dirX + normal[1] * dirY + normal[2] * dirZ)), 4);

  const light = 0.30 + 0.72 * key * (0.3 + 0.7 * shadow) + 0.26 * fill + 0.22 * sky;
  return [
    clamp01(material.albedo[0] * light + specular + rim),
    clamp01(material.albedo[1] * light + specular + rim),
    clamp01(material.albedo[2] * light + specular + rim),
  ];
}

/** 背景と接地面。上から下へ淡いグラデーションを敷き、接地影だけを落とす */
function shadeBackground(
  sdf: Sdf,
  groundY: number,
  originY: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  screenY: number,
): readonly [number, number, number] {
  const gradient = 1 - 0.075 * clamp01(0.5 - screenY * 0.5);
  if (dirY >= 0) {
    return [gradient, gradient, gradient * 0.999];
  }

  const travelled = (groundY - originY) / dirY;
  const x = CAMERA.eye[0] + dirX * travelled;
  const z = CAMERA.eye[2] + dirZ * travelled;
  const shadow = 0.35 + 0.65 * softShadow(sdf, x, groundY + 0.004, z);
  const shade = gradient * (0.55 + 0.45 * shadow);
  return [shade, shade, shade * 0.997];
}

export async function renderPart(
  sdf: Sdf,
  material: Material,
  options: RenderOptions,
): Promise<Buffer> {
  const { size, supersample, groundY } = options;
  const samples = size * supersample;
  const accumulator = new Float64Array(size * size * 3);

  const [eyeX, eyeY, eyeZ] = CAMERA.eye;
  const forward = normalize(-eyeX, -eyeY, -eyeZ);
  const right = normalize(-forward[2], 0, forward[0]);
  const up = normalize(
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  );

  for (let sampleY = 0; sampleY < samples; sampleY += 1) {
    const screenY = 1 - ((sampleY + 0.5) / samples) * 2;
    for (let sampleX = 0; sampleX < samples; sampleX += 1) {
      const screenX = ((sampleX + 0.5) / samples) * 2 - 1;
      const [dirX, dirY, dirZ] = normalize(
        forward[0] + screenX * CAMERA.fov * right[0] + screenY * CAMERA.fov * up[0],
        forward[1] + screenX * CAMERA.fov * right[1] + screenY * CAMERA.fov * up[1],
        forward[2] + screenX * CAMERA.fov * right[2] + screenY * CAMERA.fov * up[2],
      );

      const hit = marchPart(sdf, eyeX, eyeY, eyeZ, dirX, dirY, dirZ);
      const color = hit === undefined
        ? shadeBackground(sdf, groundY, eyeY, dirX, dirY, dirZ, screenY)
        : shadePart(
          sdf,
          material,
          eyeX + dirX * hit,
          eyeY + dirY * hit,
          eyeZ + dirZ * hit,
          dirX,
          dirY,
          dirZ,
        );

      const pixel = (((sampleY / supersample) | 0) * size + ((sampleX / supersample) | 0)) * 3;
      accumulator[pixel] += color[0];
      accumulator[pixel + 1] += color[1];
      accumulator[pixel + 2] += color[2];
    }
  }

  const perPixel = supersample * supersample;
  const pixels = Buffer.allocUnsafe(size * size * 3);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = Math.round(clamp01(accumulator[index] / perPixel) * 255);
  }

  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}
