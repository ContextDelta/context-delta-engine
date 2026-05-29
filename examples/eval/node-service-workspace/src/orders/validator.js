export function validateOrder(input) {
  if (!input?.customerId) {
    throw new Error("customerId is required");
  }

  return {
    customerId: input.customerId,
    total: Number(input.total ?? 0)
  };
}
