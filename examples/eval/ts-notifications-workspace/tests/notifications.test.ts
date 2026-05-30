import { sendNotification } from "../src/notifications/service";

test("sends an email notification", () => {
  const result = sendNotification("a@b.com", " hi ");
  expect(result.delivered).toBe(true);
  expect(result.body).toBe("hi");
});
