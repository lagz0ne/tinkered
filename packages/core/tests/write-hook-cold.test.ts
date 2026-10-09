import { expect, test } from "vite-plus/test";
import { createScope, data, extension, isError } from "../src/index";

test("a closed scope refuses a write before a stopping hook runs", async () => {
  const count = data({ label: "count", initial: 0 });
  let writes = 0;
  const stop = extension({
    label: "stop",
    hooks: {
      write: () => {
        writes++;
      },
    },
  });
  const root = createScope({ extensions: [stop] });
  await root.ready;
  const controller = root.controller(count);
  expect((await root.close({ graceful: true })).status).toBe("success");
  try {
    controller.set(1);
    expect.unreachable("a closed scope must refuse a write");
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
    expect(error.payload.reason).toBe("scope is closed");
  }
  expect(writes).toBe(0);
});
