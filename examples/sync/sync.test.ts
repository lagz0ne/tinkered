import { expect, test } from "vite-plus/test";
import { honoTour, tour } from "./index.ts";

test("the memory demo reads the source snapshot in the guest", async () => {
  expect(await tour()).toBe("counter:1");
});

test("a closed tour leaves the graph usable for a fresh value", async () => {
  await tour(2);
  expect(await tour(7)).toBe("counter:7");
});

test("the Hono demo registers a key and reads its SSE snapshot", async () => {
  expect(await honoTour()).toBe('data: {"type":"snapshot","key":"counter","version":0,"value":0}');
});
