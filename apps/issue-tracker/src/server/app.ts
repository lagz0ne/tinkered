import { Hono } from "hono";
import { operation } from "@tinker/core";
import { handle, stream, tinker, type HonoScope } from "@tinker/hono";
import type { Sync } from "@tinker/sync";
import { issueList, parseCommentInput, parseCreateInput, parseEditInput, parseIssueId } from "../shared/issues.ts";
import { parseDraftInput } from "../shared/draft.ts";
import { isError } from "../errors.ts";
import { runDraft, type RunDraft } from "./draft.ts";
import type { Booted } from "./bridge.ts";

function frame(message: Sync.Message): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

function readPosted(raw: unknown): Sync.Message | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!("type" in raw) || raw.type !== "register") return undefined;
  if (!("keys" in raw) || Array.isArray(raw.keys) === false) return undefined;
  const keys = raw.keys.filter((key): key is string => typeof key === "string");
  if (keys.length !== raw.keys.length) return undefined;
  return { type: "register", keys };
}

function onError(error: unknown, c: Parameters<HonoScope.OnError>[1]) {
  if (isError(error, "IssueNotFound")) return c.text("issue not found", 404);
  if (isError(error, "IssueConflict")) {
    return c.json(
      {
        message: "someone else saved first — reload and try again",
        id: error.payload.id,
        currentRevision: error.payload.currentRevision,
        current: error.payload.current,
      },
      409,
    );
  }
  if (isError(error, "BadCreateInput") || isError(error, "BadEditInput")) {
    return c.text(error.payload.reason, 400);
  }
  if (isError(error, "BadCommentInput")) return c.text(error.payload.reason, 400);
  if (isError(error, "BadDraftInput")) return c.text(error.payload.reason, 400);
  if (isError(error, "DraftFailed")) return c.text(error.payload.reason, 502);
  if (isError(error, "IssueNotFound")) return c.text("issue not found", 404);
  return undefined;
}

/** Build the Hono app on the owning root scope. Route operations close over the
 * root: saves run in their own short child session and publish only after the
 * database commit resolves; reads answer the published root cell or the
 * database. A rejected save writes nothing and publishes nothing. */
export function buildApp(booted: Booted.Composed): Hono {
  const { scope, src, save } = booted;
  const saveIssue = operation({
    label: "saveIssue",
    input: parseCreateInput,
    run: (_deps, ctx) => save.create(ctx.input),
  });
  const editSaved = operation({
    label: "editSaved",
    input: parseEditInput,
    run: (_deps, ctx) => save.edit(ctx.input),
  });
  const commentSaved = operation({
    label: "commentSaved",
    input: parseCommentInput,
    run: (_deps, ctx) => save.comment(ctx.input),
  });
  const readIssues = operation({
    label: "readIssues",
    run: () => scope.resolve(issueList),
  });
  const readOne = operation({
    label: "readOne",
    input: parseIssueId,
    run: (_deps, ctx) => booted.detail(ctx.input),
  });
  const readCapability = operation({
    label: "readCapability",
    run: () => ({ enabled: booted.draft.enabled }),
  });
  const posts = new Map<string, (message: Sync.Message) => void>();
  const app = new Hono();
  app.use(tinker(scope, { onError }));
  app.post("/api/issues", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      raw = undefined;
    }
    return handle(saveIssue, {
      input: () => raw,
      respond: (issue, res) => res.json(issue, 201),
    })(c);
  });
  app.patch("/api/issues/:id", async (c) => {
    const id = c.req.param("id");
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      raw = undefined;
    }
    return handle(editSaved, {
      input: () => (typeof raw === "object" && raw !== null ? { ...raw, id } : { id }),
      respond: (issue, res) => res.json(issue, 200),
    })(c);
  });
  app.post("/api/issues/:id/comments", async (c) => {
    const issueId = c.req.param("id");
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      raw = undefined;
    }
    return handle(commentSaved, {
      input: () => (typeof raw === "object" && raw !== null ? { ...raw, issueId } : { issueId }),
      respond: (comment, res) => res.json(comment, 201),
    })(c);
  });
  app.get("/api/issues/:id", (c) =>
    handle(readOne, {
      input: () => c.req.param("id"),
      respond: (detail, res) => res.json(detail, 200),
    })(c),
  );
  app.get(
    "/api/issues",
    handle(readIssues, {
      respond: (issues, c) => c.json(issues),
    }),
  );
  app.get("/api/draft", (c) =>
    handle(readCapability, {
      respond: (capability, res) => res.json(capability, 200),
    })(c),
  );
  app.post("/api/issues/:id/draft", (c) => {
    const id = c.req.param("id");
    return draftStream(booted, c, id);
  });
  app.get("/sync", (c) => {
    const id = c.req.query("client") ?? "guest";
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    return stream(c, (emit, ctx) => {
      let open = true;
      const arrivals = new Set<(message: Sync.Message) => void>();
      const partings = new Set<() => void>();
      const queue: Sync.Message[] = [];
      const transport: Sync.Transport = {
        send: (message) => {
          if (open === false) return;
          queue.push(message);
        },
        onMessage: (listener) => {
          arrivals.add(listener);
          return () => {
            arrivals.delete(listener);
          };
        },
        onClose: (listener) => {
          partings.add(listener);
          return () => {
            partings.delete(listener);
          };
        },
        close: () => {
          if (open === false) return;
          open = false;
          queue.length = 0;
          posts.delete(id);
          for (const part of Array.from(partings)) part();
        },
      };
      const fail = (): void => {
        transport.close();
      };
      posts.set(id, (message) => {
        for (const arrival of Array.from(arrivals)) arrival(message);
      });
      ctx.signal.addEventListener("abort", () => transport.close(), { once: true });
      const flush = async (): Promise<void> => {
        while (open && queue.length > 0) {
          const next = queue.shift();
          if (next === undefined) return;
          try {
            await emit(frame(next));
          } catch {
            fail();
            return;
          }
        }
      };
      const pump = async (): Promise<void> => {
        try {
          await emit(": ready\n\n");
        } catch {
          fail();
          return;
        }
        await scope.resolve(src).connect(owned(transport, flush, fail));
      };
      return pump().then(
        () => {
          posts.delete(id);
          transport.close();
        },
        () => {
          posts.delete(id);
          transport.close();
        },
      );
    });
  });
  app.post("/sync", async (c) => {
    const id = c.req.query("client") ?? "guest";
    const send = posts.get(id);
    if (send === undefined) return c.text("gone", 410);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.text("bad", 400);
    }
    const message = readPosted(raw);
    if (message === undefined) return c.text("bad", 400);
    send(message);
    return c.text("ok");
  });
  return app;
}

type DraftContext = Parameters<Parameters<Hono["get"]>[1]>[0];

function draftFrame(event: { readonly kind: string; readonly [key: string]: unknown }): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function draftStream(booted: Booted.Composed, c: DraftContext, id: string) {
  if (booted.draft.enabled === false) return c.text("draft helper is off", 404);
  return stream(c, async (emit, ctx) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      raw = undefined;
    }
    const validated = parseDraftInput(
      typeof raw === "object" && raw !== null ? { ...raw, id } : { id },
    );
    try {
      await booted.detail(input.id);
    } catch (error: unknown) {
      if (isError(error, "IssueNotFound")) {
        await emit(draftFrame({ kind: "failed", reason: "that issue is gone" }));
        return;
      }
      throw error;
    }
    const input = validated;
    const queue: string[] = [];
    const waiter = readWaiter();
    const aborter = new AbortController();
    if (ctx.signal.aborted) aborter.abort(ctx.signal.reason);
    else ctx.signal.addEventListener("abort", () => aborter.abort(ctx.signal.reason), { once: true });
    const finished = readRunState(booted, input, queue, waiter, aborter);
    const pump = (async (): Promise<void> => {
      for (;;) {
        while (queue.length > 0) {
          const next = queue.shift();
          if (next === undefined) break;
          try {
            await emit(next);
          } catch {
            aborter.abort();
            return;
          }
        }
        if (finished.settled) return;
        await waiter.sleep();
      }
    })();
    let done: RunDraft.Done;
    try {
      done = await finished.value;
    } finally {
      waiter.wake();
      await pump;
    }
    try {
      await emit(draftFrame({ kind: "terminal", status: done.status, draft: done.draft }));
    } catch {
      return;
    }
  });
}

type Waiter = { readonly sleep: () => Promise<void>; readonly wake: () => void };

type RunState = { settled: boolean; readonly value: Promise<RunDraft.Done> };

function readRunState(
  booted: Booted.Composed,
  input: { readonly id: string; readonly prompt: string },
  queue: string[],
  waiter: Waiter,
  aborter: AbortController,
): RunState {
  const state: RunState = {
    settled: false,
    value: runDraft(
      booted.scope,
      input,
      (event) => {
        queue.push(draftFrame(event));
        waiter.wake();
      },
      aborter.signal,
    ).then(
      (done) => {
        state.settled = true;
        waiter.wake();
        return done;
      },
      (error: unknown) => {
        state.settled = true;
        waiter.wake();
        throw error;
      },
    ),
  };
  return state;
}

function readWaiter(): Waiter {
  let wake: () => void = () => undefined;
  const sleep = (): Promise<void> =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });
  return {
    sleep,
    wake: () => {
      const next = wake;
      wake = () => undefined;
      next();
    },
  };
}

function owned(
  transport: Sync.Transport,
  flush: () => Promise<void>,
  fail: () => void,
): Sync.Transport {
  let tail: Promise<void> = Promise.resolve();
  let dead = false;
  return {
    send: (message) => {
      if (dead) return;
      transport.send(message);
      tail = tail.then(flush, fail);
    },
    onMessage: (listener) => transport.onMessage(listener),
    onClose: (listener) =>
      transport.onClose(() => {
        dead = true;
        listener();
      }),
    close: () => {
      dead = true;
      transport.close();
    },
  };
}
