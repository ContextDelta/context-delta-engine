import test from "node:test";
import assert from "node:assert/strict";
import { createOrder } from "../../src/orders/service.js";

test("creates an order with a positive total", () => {
  assert.equal(createOrder({ customerId: "c1", total: 42 }).total, 42);
});
