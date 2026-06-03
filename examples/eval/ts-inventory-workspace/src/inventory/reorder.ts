export function reorderThreshold(stock: number, minimum: number): boolean {
  // Flags an item as low-stock when it falls at or below its reorder minimum.
  return stock <= minimum;
}
