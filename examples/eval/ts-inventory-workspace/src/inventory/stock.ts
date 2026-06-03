import { reorderThreshold } from "./reorder";

export function flagLowStock(items: { sku: string; stock: number; minimum: number }[]) {
  return items.filter((item) => reorderThreshold(item.stock, item.minimum)).map((item) => item.sku);
}
