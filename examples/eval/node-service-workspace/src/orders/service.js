import { validateOrder } from "./validator.js";

export function createOrder(input) {
  const order = validateOrder(input);
  return {
    id: `order-${order.customerId}`,
    total: order.total
  };
}
