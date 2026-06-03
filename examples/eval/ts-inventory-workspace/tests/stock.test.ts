import { flagLowStock } from "../src/inventory/stock";

test("flags low stock items below their reorder minimum", () => {
  expect(flagLowStock([{ sku: "a", stock: 1, minimum: 3 }])).toEqual(["a"]);
});
