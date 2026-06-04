import { applyDiscount } from "../src/pricing/calculator";

test("caps promotional discount at 50 percent", () => {
  expect(applyDiscount(100, 80)).toBe(50);
});
