import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { connection, counter, src, sub, web, wire } from "./index.ts";

test("the memory guest receives the source snapshot before it is ready", async () => {
  const stop = new AbortController();
  const origin = createScope({ signal: stop.signal, extensions: [src] });
  try {
    await origin.ready;
    origin.controller(counter).set(1);
    const guest = createScope({
      signal: stop.signal,
      extensions: [sub],
      tags: wire(origin.resolve(connection)),
    });
    try {
      await guest.ready;
      expect(guest.resolve(counter)).toBe(1);
    } finally {
      stop.abort();
      await guest.closed;
    }
  } finally {
    stop.abort();
    await origin.closed;
  }
});

test("fresh roots reuse the graph without keeping the last counter value", async () => {
  for (const value of [2, 7]) {
    const stop = new AbortController();
    const origin = createScope({ signal: stop.signal, extensions: [src] });
    try {
      await origin.ready;
      expect(origin.resolve(counter)).toBe(0);
      origin.controller(counter).set(value);
      const guest = createScope({
        signal: stop.signal,
        extensions: [sub],
        tags: wire(origin.resolve(connection)),
      });
      try {
        await guest.ready;
        expect(guest.resolve(counter)).toBe(value);
      } finally {
        stop.abort();
        await guest.closed;
      }
    } finally {
      stop.abort();
      await origin.closed;
    }
  }
});

test("the Hono stream registers a key, reads its SSE snapshot, and cancels", async () => {
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal, extensions: [web, src] });
  try {
    await root.ready;
    const app = root.resolve(web);
    const response = await app.request("/sync?client=test");
    if (response.body === null) expect.unreachable("The response must have a stream.");
    const reader = response.body.getReader();
    try {
      const posted = await app.request("/sync?client=test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "register", keys: ["counter"] }),
      });
      expect(posted.status).toBe(200);
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value).trim()).toBe(
        'data: {"type":"snapshot","key":"counter","version":0,"value":0}',
      );
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  } finally {
    stop.abort();
    await root.closed;
  }
});
