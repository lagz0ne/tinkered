import { createScope, data, extension, operation, type Observe } from "@tinker/core";
import { hono, route } from "@tinker/hono";
import { expect, test } from "vite-plus/test";
import { publishAfterCommit } from "../src/index.ts";

const list = data({ label: "list", initial: "" });
const read = operation({ label: "read", depends: { list }, run: ({ list }) => list });
const save = operation({ label: "save", run: () => "saved" });

test("local publishing runs after later starts and before the first request", async () => {
  let saved = "old";
  const publish = operation({
    label: "publish",
    depends: { list: list.controller },
    run: ({ list }) => list.set(saved),
  });
  const later = extension({
    label: "later",
    start: () => {
      saved = "ready";
    },
  });
  const web = hono([route.get("/", read)]).extension;
  const scope = createScope({ extensions: [web, publishAfterCommit(publish), later] });
  try {
    await scope.ready;
    expect(await (await scope.resolve(web).request("/")).json()).toBe("ready");
  } finally {
    await scope.close();
  }
});

test("a failed boot publish rejects ready with its cause", async () => {
  const failure = new Error("read failed");
  const publish = operation({
    label: "publish",
    run: () => {
      throw failure;
    },
  });
  const scope = createScope({ extensions: [publishAfterCommit(publish)] });
  try {
    await expect(scope.ready).rejects.toBe(failure);
  } finally {
    await scope.close();
  }
});

test("a failed publish after commit keeps the answer and the next commit retries", async () => {
  const lines: Observe.Log[] = [];
  let fail = false;
  let reads = 0;
  const publish = operation({
    label: "publish",
    run: () => {
      reads++;
      if (fail) throw new Error("read failed");
    },
  });
  const web = hono([route.post("/", save)]).extension;
  const scope = createScope({
    extensions: [web, publishAfterCommit(publish)],
    observe: { log: (line) => lines.push(line) },
  });
  try {
    await scope.ready;
    fail = true;
    expect(await (await scope.resolve(web).request("/", { method: "POST" })).json()).toBe("saved");
    expect(lines.filter((line) => line.message === "publish failed")).toMatchObject([
      { attributes: { error: "read failed" } },
    ]);
    fail = false;
    await scope.resolve(web).request("/", { method: "POST" });
    expect(reads).toBe(3);
  } finally {
    await scope.close();
  }
});

test("a manual session does not publish after boot", async () => {
  let reads = 0;
  const publish = operation({
    label: "publish",
    run: () => {
      reads++;
    },
  });
  const scope = createScope({ extensions: [publishAfterCommit(publish)] });
  try {
    await scope.ready;
    await scope.session((session) => session.run(save));
    expect(reads).toBe(1);
  } finally {
    await scope.close();
  }
});
