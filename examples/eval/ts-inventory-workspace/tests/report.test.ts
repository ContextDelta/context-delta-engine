import { monthlyValuationReport } from "../src/inventory/report";

test("sums valuation rows", () => {
  expect(monthlyValuationReport([{ sku: "a", value: 5 }])).toBe(5);
});
