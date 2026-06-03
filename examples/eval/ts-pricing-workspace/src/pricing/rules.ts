export const MAX_DISCOUNT_PERCENT = 50;

export function capDiscount(percent: number): number {
  return Math.min(percent, MAX_DISCOUNT_PERCENT);
}
