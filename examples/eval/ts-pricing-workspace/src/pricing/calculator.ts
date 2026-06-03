import { capDiscount } from "./rules";

// Applies a promotional discount, capped by the pricing rules.
export function applyDiscount(price: number, requestedPercent: number): number {
  const percent = capDiscount(requestedPercent);
  return price - (price * percent) / 100;
}
