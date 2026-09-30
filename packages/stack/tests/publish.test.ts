import { createScope, data, extension, operation, resource, tag, type Observe } from "@tinker/core";
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
    hooks: {
      start: () => {
        saved = "ready";
      },
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

test("a reused publisher refreshes the root that committed, not the last root or request", async () => {
  const storage = tag<{ value: string }>({ label: "storage" });
  const committed = resource({
    label: "committed",
    target: "scope",
    depends: { storage },
    factory: ({ storage }) => storage,
  });
  const publish = operation({
    label: "publish",
    depends: { storage, list: list.controller },
    run: ({ storage, list }) => list.set(storage.value),
  });
  const save = operation({
    label: "save",
    depends: { committed, list: list.controller },
    run: ({ committed, list }) => {
      committed.value += " saved";
      list.set("request draft");
      return "saved";
    },
  });
  const publisher = publishAfterCommit(publish);
  const web = hono([route.post("/", save)], {
    tags: () => storage({ value: "request" }),
  }).extension;
  const a = createScope({
    tags: [storage({ value: "A" })],
    extensions: [web, publisher],
  });
  const b = createScope({
    tags: [storage({ value: "B" })],
    extensions: [publisher],
  });
  try {
    await a.ready;
    await b.ready;
    await a.resolve(web).request("/", { method: "POST" });
    expect([a.resolve(list), b.resolve(list)]).toEqual(["A saved", "B"]);
  } finally {
    await a.close();
    await b.close();
  }
});
