import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  classifyColor,
  derivePrice,
  deriveSizes,
  type Category,
} from "../scripts/enrich-products.ts";

const priceRanges: Record<Category, readonly [number, number]> = {
  bag: [3_000, 30_000],
  shoes: [4_000, 20_000],
  chair: [8_000, 60_000],
  mug: [800, 4_000],
  watch: [5_000, 80_000],
  lamp: [2_000, 25_000],
};

test("price and size derivation is deterministic and stays within category ranges", () => {
  const sizeSets = new Set<string>();

  for (const [category, [minimum, maximum]] of Object.entries(priceRanges) as [
    Category,
    readonly [number, number],
  ][]) {
    const id = `${category}-01`;
    const price = derivePrice(id, category);
    const sizes = deriveSizes(id);

    assert.equal(price, derivePrice(id, category));
    assert.equal(price % 100, 0);
    assert.ok(price >= minimum && price <= maximum);
    assert.ok(sizes.length > 0);
    assert.ok(sizes.every((size) => ["S", "M", "L"].includes(size)));
    sizeSets.add(sizes.join("/"));
  }

  assert.ok(sizeSets.size >= 2);
});

test("color classification maps representative RGB values to the nearest named color", () => {
  assert.equal(classifyColor({ r: 20, g: 20, b: 20 }), "black");
  assert.equal(classifyColor({ r: 238, g: 242, b: 239 }), "white");
  assert.equal(classifyColor({ r: 178, g: 42, b: 38 }), "red");
});
