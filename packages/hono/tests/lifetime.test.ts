import { createScope, extension, operation, resource, tag } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { hono, route, stream } from "../src/index.ts";

const record = tag<(event: string) => void>({ label: "record" });
const owner = tag({ label: "owner", default: "request" });
const held = resource({
  label: "held",
  target: "session",
  depends: { record, owner },
  factory: ({ record, owner }, ctx) => {
    ctx.defer((end) => record(`${owner} ${end.status}`));
    return owner;
  },
});
const read = operation({
  label: "read",
  depends: { held, record },
  run: ({ held, record }) => {
    record(`read ${held}`);
    return held;
  },
});
const fail = operation({
  label: "fail",
  depends: { held },
  run: ({ held }) => {
    throw new Error(held);
  },
});
const sessionEnd = extension({
  label: "sessionEnd",
  hooks: {
    session: async (event) => {
      const append = event.resolve(record);
      const end = await event.next();
      append(`session ${end.status}`);
      return end;
    },
  },
});

test("an already-aborted request answers 499 and closes cancelled without running its route", async () => {
  const events: string[] = [];
  const web = hono([route.get("/", read)]).extension;
  const scope = createScope({
    extensions: [web, sessionEnd],
    tags: [record((event) => events.push(event))],
  });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request(
      new Request("http://local/", {
        signal: AbortSignal.abort(new Error("client stopped")),
      }),
    );
    expect(response.status).toBe(499);
    expect(events).toEqual(["session cancelled"]);
  } finally {
    await scope.close();
  }
});

test("a synchronous stream body failure releases the body and request resources", async () => {
  const events: string[] = [];
  const web = hono([
    route.get("/", read, {
      respond: (_value, c) => stream(c, fail, { tags: [owner("body")] }),
    }),
  ]).extension;
  const scope = createScope({
    extensions: [web],
    tags: [record((event) => events.push(event))],
  });
  try {
    await scope.ready;
    await scope.resolve(web).request("/");
    expect([...events]).toEqual(["read request", "body failed", "request failed"]);
  } finally {
    await scope.close();
  }
});
