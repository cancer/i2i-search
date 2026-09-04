import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  derivePrice,
  deriveSizes,
  type Category,
} from "../scripts/enrich-products.ts";

const priceRanges: Record<Category, readonly [number, number]> = {
  bearing: [800, 20_000],
  gear: [1_500, 40_000],
  bolt: [100, 3_000],
  nut: [100, 1_500],
  spring: [200, 5_000],
  bushing: [500, 12_000],
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
