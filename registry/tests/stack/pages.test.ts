import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { useData } from "@tinker/react";
import { createScope, data, extension, operation, resource, type Scope } from "@tinker/core";
import { hono, route } from "../../src/hono/index.ts";
import { expect, test } from "vite-plus/test";
import { pages } from "../../src/stack/pages.ts";

const title = data({ label: "title", initial: "Published title" });
const read = operation({ label: "readPage", depends: { title }, run: ({ title }) => title });
function Title() {
  return createElement("h1", {}, useData(title));
}

test("pages render the request's cells and keep the renderer's status and headers", async () => {
  const page = pages({
    component: Title,
    read,
    async render(request, value, content) {
      return new Response(await renderToReadableStream(content), {
        status: 202,
        headers: {
          "content-type": "text/html",
          "x-page": `${new URL(request.url).pathname}:${value}`,
        },
      });
    },
  });
  const web = hono([], { mount: page.mount }).extension;
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    scope.controller(title).set("Saved title");
    const response = await scope.resolve(web).request("/list");
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("x-page")).toBe("/list:Saved title");
    expect(await response.text()).toBe("<h1>Saved title</h1>");
  } finally {
    await scope.close();
  }
});

test("API and built assets keep their routes before the catch-all page", async () => {
  const page = pages({ component: Title, read, render: async () => new Response("page") });
  const api = operation({ label: "api", run: () => "api" });
  const web = hono([route.get("/api", api)], {
    mount(app) {
      page.mount(app);
      app.get("/assets/client.js", (c) => c.text("asset"));
    },
  }).extension;
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    const app = scope.resolve(web);
    expect(await (await app.request("/api")).json()).toBe("api");
    expect(await (await app.request("/assets/client.js")).text()).toBe("asset");
    expect(await (await app.request("/other")).text()).toBe("page");
  } finally {
    await scope.close();
  }
});

test("a page holds its session and waits for commit before its final chunk ends", async () => {
  const finish = Promise.withResolvers<void>();
  const commit = Promise.withResolvers<void>();
  const committing = Promise.withResolvers<void>();
  const ends: Scope.End[] = [];
  const saved = resource({
    label: "saved",
    target: "session",
    factory(_deps, ctx) {
      ctx.defer(async (end) => {
        ends.push(end);
        committing.resolve();
        await commit.promise;
      });
      return "written";
    },
  });
  const save = operation({ label: "save", depends: { saved }, run: ({ saved }) => saved });
  const page = pages({
    component: Title,
    read: save,
    async render(_request, value) {
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode(value));
            await finish.promise;
            controller.close();
          },
        }),
      );
    },
  });
  const web = hono([], { mount: page.mount }).extension;
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("written");
    expect(ends).toEqual([]);
    finish.resolve();
    await committing.promise;
    let ended = false;
    const last = reader.read().then((chunk) => {
      ended = chunk.done;
    });
    await Promise.resolve();
    expect(ended).toBe(false);
    commit.resolve();
    await last;
    expect(ends).toEqual([{ status: "success" }]);
    expect(ended).toBe(true);
  } finally {
    finish.resolve();
    commit.resolve();
    await scope.close();
  }
});

test.each(["reader", "request"])(
  "a page abort through %s cancels the renderer and its session",
  async (kind) => {
    const outcomes: string[] = [];
    const stopped = Promise.withResolvers<void>();
    const page = pages({
      component: Title,
      read,
      async render() {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
            },
            cancel() {
              stopped.resolve();
            },
          }),
        );
      },
    });
    const web = hono([], { mount: page.mount }).extension;
    const watch = extension({
      label: "watch",
      hooks: {
        async session(event) {
          const end = await event.next();
          outcomes.push(end.status);
          return end;
        },
      },
    });
    const scope = createScope({ extensions: [web, page.extension, watch] });
    const stop = new AbortController();
    try {
      await scope.ready;
      const response = await scope.resolve(web).request("/", { signal: stop.signal });
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
      if (kind === "reader") await reader.cancel();
      else stop.abort();
      await stopped.promise;
      await expect.poll(() => outcomes).toEqual(["cancelled", "cancelled"]);
    } finally {
      stop.abort();
      await scope.close();
    }
  },
);

test("a renderer failure before headers reaches Hono's error answer", async () => {
  const page = pages({
    component: Title,
    read,
    render: async () => {
      throw Object.assign(new Error("PageFailed"), { kind: "PageFailed", payload: {} });
    },
  });
  const web = hono([], { mount: page.mount }).extension;
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("internal");
  } finally {
    await scope.close();
  }
});

test("a body failure errors the page and fails its session", async () => {
  const ends: Scope.End[] = [];
  const save = resource({
    label: "save",
    target: "session",
    factory(_deps, ctx) {
      ctx.defer((end) => {
        ends.push(end);
      });
      return "saved";
    },
  });
  const page = pages({
    component: Title,
    read: operation({ label: "read", depends: { save }, run: ({ save }) => save }),
    render: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error("broken renderer");
          },
        }),
      ),
  });
  const web = hono([], { mount: page.mount }).extension;
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/");
    await expect(response.text()).rejects.toBe("broken renderer");
    await expect.poll(() => ends).toEqual([{ status: "failed", error: "broken renderer" }]);
  } finally {
    await scope.close();
  }
});

test("an empty page commits before answering with the renderer's status and headers", async () => {
  const committing = Promise.withResolvers<void>();
  const committed = Promise.withResolvers<void>();
  const saved = resource({
    label: "saved",
    target: "session",
    factory(_deps, ctx) {
      ctx.defer(async () => {
        committing.resolve();
        await committed.promise;
      });
      return "saved";
    },
  });
  const page = pages({
    component: Title,
    read: operation({ label: "save", depends: { saved }, run: ({ saved }) => saved }),
    render: async (_request, value) =>
      new Response(null, { status: 204, headers: { "x-page": value } }),
  });
  const web = hono([], { mount: page.mount }).extension;
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    let answered = false;
    const answer = Promise.resolve(scope.resolve(web).request("/")).then((response) => {
      answered = true;
      return response;
    });
    await committing.promise;
    expect(answered).toBe(false);
    committed.resolve();
    const response = await answer;
    expect(response.status).toBe(204);
    expect(response.headers.get("x-page")).toBe("saved");
    expect(await response.text()).toBe("");
  } finally {
    committed.resolve();
    await scope.close();
  }
});

test("the page extension leaves ordinary sessions free to read their cells", async () => {
  const page = pages({ component: Title, read, render: async () => new Response("page") });
  const scope = createScope({ extensions: [page.extension] });
  try {
    await scope.ready;
    expect(await scope.session((session) => session.run(read))).toBe("Published title");
  } finally {
    await scope.close();
  }
});

test("reusing a request after its page ends reads the new published value", async () => {
  const page = pages({
    component: Title,
    read,
    render: async (_request, value) => new Response(value),
  });
  const web = hono([], { mount: page.mount }).extension;
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    const request = new Request("http://localhost/list");
    const app = scope.resolve(web);
    expect(await (await app.fetch(request)).text()).toBe("Published title");
    scope.controller(title).set("New title");
    expect(await (await app.fetch(request)).text()).toBe("New title");
  } finally {
    await scope.close();
  }
});

test("the renderer can read its finished body again during request cleanup", async () => {
  const finished: boolean[] = [];
  const source = resource({
    label: "source",
    target: "session",
    factory(_deps, ctx) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("page"));
          controller.close();
        },
      });
      ctx.defer(async () => {
        const reader = body.getReader();
        try {
          finished.push((await reader.read()).done);
        } finally {
          reader.releaseLock();
        }
      });
      return body;
    },
  });
  const page = pages({
    component: Title,
    read: operation({ label: "read", depends: { source }, run: ({ source }) => source }),
    render: async (_request, source) => new Response(source),
  });
  const web = hono([], { mount: page.mount }).extension;
  const scope = createScope({ extensions: [web, page.extension] });
  try {
    await scope.ready;
    expect(await (await scope.resolve(web).request("/")).text()).toBe("page");
    expect(finished).toEqual([true]);
  } finally {
    await scope.close();
  }
});

test("a page mount without its extension passes requests to the next route", async () => {
  const page = pages({ component: Title, read, render: async () => new Response("page") });
  const web = hono([], {
    mount(app) {
      page.mount(app);
      app.get("*", (c) => c.text("fallback"));
    },
  }).extension;
  const scope = createScope({ extensions: [web] });
  try {
    await scope.ready;
    expect(await (await scope.resolve(web).request("/")).text()).toBe("fallback");
  } finally {
    await scope.close();
  }
});
