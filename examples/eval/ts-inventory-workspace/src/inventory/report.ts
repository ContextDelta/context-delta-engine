export function monthlyValuationReport(rows: { sku: string; value: number }[]) {
  return rows.reduce((total, row) => total + row.value, 0);
}
