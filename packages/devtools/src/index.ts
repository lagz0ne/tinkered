import { capsule } from "@tinkered/core";
import type { Observe, Scope } from "@tinkered/core";

/** What devtools keeps and what a tool reads from it. */
export declare namespace Devtools {
  /**
   * `limit` sizes the span ring and the session list (default 1000). `values` keeps the last
   * value of each write (default off: the snapshot then holds no value).
   */
  type Options = { readonly limit?: number; readonly values?: boolean };

  /** How a scope or a session ended: Core's own close status. */
  type Status = Scope.Result["status"];

  /** One session the capsule saw open. `runs` holds the spans opened in it. */
  type Session = {
    id: number;
    state: "open" | "closed";
    status?: Status;
    runs: Observe.Span[];
  };

  /** The writes to one cell label. `value` is in it only when `values` is on. */
  type Write = { label: string; count: number; value?: unknown };

  /**
   * The state a tool reads. Each call gives fresh objects, so a caller cannot change what devtools
   * keeps.
   */
  type Snapshot = {
    scope: { state: "starting" | "ready" | "closing" | "closed"; status?: Status };
    sessions: Session[];
    /** The spans opened outside any session, except resource spans. */
    runs: Observe.Span[];
    /** Every resource span, in any session. */
    resources: Observe.Span[];
    writes: Write[];
    /** Keys are `label\texit`. The count lives outside the ring, so it keeps every exit. */
    exits: Record<string, number>;
  };
}

type SessionLine = { state: "open" | "closed"; status?: Devtools.Status };

/**
 * A capsule that keeps what Core tells it. Its state lives in each call, so give each scope its
 * own `devtools()`. A `moves` listener that throws does not stop the others or the app: the error
 * is rethrown in a microtask, as a DOM event listener's error is reported.
 */
export function devtools(options?: Devtools.Options) {
  const limit = options?.limit ?? 1000;
  const values = options?.values ?? false;
  const spans: Observe.Span[] = [];
  const sessions = new Map<number, SessionLine>();
  const writes = new Map<string, { count: number; value?: unknown }>();
  const exits = new Map<string, number>();
  const listeners = new Set<() => void>();
  let scope: Devtools.Snapshot["scope"] = { state: "starting" };

  /** Tell each listener of a new record. A listener removed during the loop is skipped; one added
   * during the loop is also told. */
  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  function keepSpan(span: Observe.Span): void {
    spans.push(span);
    if (spans.length > limit) spans.shift();

    if (span.kind === "operation" && span.status === "ok") {
      const exit = span.attributes["tinker.exit"];
      const key = `${span.name}\t${typeof exit === "string" ? exit : "value"}`;
      exits.set(key, (exits.get(key) ?? 0) + 1);
    }
    notify();
  }

  function setScope(state: Devtools.Snapshot["scope"]["state"], status?: Devtools.Status): void {
    scope = status === undefined ? { state } : { state, status };
    notify();
  }

  function openSession(id: number): void {
    sessions.set(id, { state: "open" });
    if (sessions.size > limit) dropOldestSession();
    notify();
  }

  /** Drop the oldest closed session. If none is closed, drop the oldest open one, so the list
   * stays at `limit`. */
  function dropOldestSession(): void {
    const [oldest] = sessions.keys();
    for (const [id, line] of sessions) {
      if (line.state === "closed") {
        sessions.delete(id);
        return;
      }
    }
    sessions.delete(oldest);
  }

  /** A session the list dropped while it was open has no line left, so its close is skipped. */
  function closeSession(id: number, status: Devtools.Status): void {
    const line = sessions.get(id);
    if (line === undefined) return;

    line.state = "closed";
    line.status = status;
    notify();
  }

  function countWrite(label: string, value: unknown): void {
    const seen = writes.get(label);
    const count = (seen?.count ?? 0) + 1;
    writes.set(label, values ? { count, value } : { count });
    notify();
  }

  function snapshot(): Devtools.Snapshot {
    /** Keyed by `unknown`, so a span's `session.id` reads as is: no session has a key that is
     * not a number, so a span with one is dropped, as is a span of a dropped session. */
    const byId = new Map<unknown, Devtools.Session>();
    const list: Devtools.Session[] = [];
    for (const [id, line] of sessions) {
      const session: Devtools.Session = {
        id,
        state: line.state,
        ...(line.status === undefined ? {} : { status: line.status }),
        runs: [],
      };
      list.push(session);
      byId.set(id, session);
    }

    const runs: Observe.Span[] = [];
    const resources: Observe.Span[] = [];
    for (const span of spans) {
      const copy = copySpan(span);
      if (span.kind === "resource") {
        resources.push(copy);
        continue;
      }

      const id = span.attributes["session.id"];
      if (id === undefined) runs.push(copy);
      else byId.get(id)?.runs.push(copy);
    }

    return {
      scope: { ...scope },
      sessions: list,
      runs,
      resources,
      writes: [...writes].map(([label, write]) =>
        values ? { label, count: write.count, value: write.value } : { label, count: write.count },
      ),
      exits: Object.fromEntries(exits),
    };
  }

  function moves(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return capsule({
    label: "tinker.devtools",
    exports: { snapshot, moves },
    hooks: {
      start: async ({ tap, next }) => {
        setScope("starting");
        tap({ export: keepSpan });
        await next();
        setScope("ready");
      },
      close: async ({ next }) => {
        setScope("closing");
        const result = await next();
        setScope("closed", result.status);
        return result;
      },
      session: async ({ handle, next }) => {
        const id = handle.id;
        if (id === undefined) return next();

        openSession(id);
        const result = await next();
        closeSession(id, result.status);
        return result;
      },
      write: ({ cell, value, next }) => {
        next();
        countWrite(cell.label, value);
      },
    },
  });
}

/**
 * A copy of a span, built field by field: Core's span is a class whose ids are getters and whose
 * private fields must not leak. Attributes and events are copied one level down. `error` becomes
 * text: an `Error` turns into `{}` in JSON, so a copy holds `String(error)`.
 */
function copySpan(span: Observe.Span): Observe.Span {
  return {
    id: span.id,
    parentId: span.parentId,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    sampled: span.sampled,
    name: span.name,
    kind: span.kind,
    start: span.start,
    end: span.end,
    status: span.status,
    ...(span.error === undefined ? {} : { error: textOf(span.error) }),
    attributes: { ...span.attributes },
    events: span.events.map((event) => ({
      name: event.name,
      time: event.time,
      attributes: { ...event.attributes },
    })),
  };
}

/** A failure as text: an `Error` as `name: message`; anything else as its JSON, or its type. */
function textOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error) ?? typeof error;
  } catch {
    return typeof error;
  }
}
