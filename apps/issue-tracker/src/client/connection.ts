import {
  data,
  extension,
  operation,
  resource,
  tag,
  type Operation,
  type Scope,
} from "@tinker/core";
import { HttpRequest, send } from "@tinker/http";
import type { Sync } from "@tinker/sync";
import { fail } from "../errors.ts";
import { connection } from "./state.ts";

export declare namespace Wire {
  /** One server-sent stream as the wire uses it: the browser's `EventSource` fits it, and a test
   * binds a fake that behaves alike. */
  type Source = {
    onopen: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    close(): void;
  };
  /** The stream resource's value: the tab's one stream at a time, and the POSTs behind it. */
  type Stream = {
    /** POST one message behind the current stream's open, in send order. A refused or failed
     * POST drops the wire; a POST after the wire closed is skipped. */
    post(message: Sync.Message): Promise<void>;
    /** Close the current stream and open the next: resolves on its open, rejects with
     * `SyncDropped` when it errors first. After the wire closed it opens nothing. */
    reopen(): Promise<void>;
  };
  /** One sync message POSTed for one tab: the client id pairs it with the tab's stream. */
  type Post = { readonly id: string; readonly message: Sync.Message };
  /** The transport sync needs, plus the extension whose `start` hands it the scope. */
  type Link = {
    readonly transport: Sync.Transport;
    readonly extension: Scope.Extension<void>;
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

/** Admit one wire frame: a snapshot for a key at a version. Anything else is refused. */
function readMessage(raw: unknown): Sync.Message {
  if (!isRecord(raw)) throw fail("SyncDropped", { reason: "bad snapshot" });
  if (raw.type !== "snapshot") throw fail("SyncDropped", { reason: "bad snapshot" });
  if (typeof raw.key !== "string") throw fail("SyncDropped", { reason: "bad snapshot" });
  if (typeof raw.version !== "number") throw fail("SyncDropped", { reason: "bad snapshot" });
  return { type: "snapshot", key: raw.key, version: raw.version, value: raw.value };
}

/** Admit one server-sent frame: a JSON string carrying a snapshot message. */
function readData(event: MessageEvent): Sync.Message {
  if (typeof event.data !== "string") throw fail("SyncDropped", { reason: "bad snapshot" });
  let raw: unknown;
  try {
    raw = JSON.parse(event.data);
  } catch {
    throw fail("SyncDropped", { reason: "bad snapshot" });
  }
  return readMessage(raw);
}

/** How the wire opens one server-sent stream: the browser's `EventSource`, rebound in a test. */
export const openSource = tag<(url: string) => Wire.Source>({
  label: "openSource",
  default: (url) => new EventSource(url),
});

/** The last frame the stream admitted: sync's `onMessage` listeners watch it. */
const inbox = data<Sync.Message | null>({ label: "inbox", initial: null });

/** True once the wire closed for good (the first stream failed, or sync closed the transport):
 * sync's `onClose` listeners watch it, so they fire once. */
const wireClosed = data<boolean>({ label: "wireClosed", initial: false });

/** The last register sync sent: a reconnect replays it on the fresh stream. */
export const lastRegister = data<Sync.Message | null>({ label: "lastRegister", initial: null });

/** POST one sync message for one tab through HTTP; the server hands it to the tab's stream. */
export const postSync = operation({
  label: "issues.postSync",
  depends: { send },
  run: async ({ send: sendIt }, ctx: Operation.Ctx<Wire.Post>) => {
    await sendIt.run({
      input: HttpRequest.post(`/sync?client=${ctx.input.id}`, {
        body: HttpRequest.bodyJson(ctx.input.message),
      }),
    });
  },
});

/** The tab's stream: one `Wire.Source` at a time under one client id from `ctx.random`. The
 * first stream opens at the first resolve; its open writes the connection live, and an error
 * before that open fails the boot (the connection failed, the wire closed, so sync rejects
 * `ready`). A later error or a malformed frame drops the connection and closes that stream; sync
 * stays attached. `reopen` swaps in the next stream for `reconnect`. POSTs queue in order behind
 * the current stream's open. `defer` closes the stream; `ctx.signal` aborts in-flight POSTs. */
export const stream = resource({
  label: "stream",
  depends: {
    open: openSource,
    post: postSync,
    link: connection.controller,
    frames: inbox.controller,
    closed: wireClosed.controller,
  },
  factory: ({ open, post, link, frames, closed }, { defer, signal, random }): Wire.Stream => {
    const id = random.uuid();
    let current: Wire.Source | null = null;
    let gate: Promise<void> = Promise.resolve();
    let queue: Promise<void> = Promise.resolve();

    const shut = (): void => {
      current?.close();
      current = null;
    };
    const drop = (): void => {
      shut();
      link.update((prev) => ({ ...prev, live: false }));
    };
    const receive = (source: Wire.Source, event: MessageEvent): void => {
      if (source !== current) return;
      let message: Sync.Message;
      try {
        message = readData(event);
      } catch {
        drop();
        return;
      }
      frames.set(message);
    };
    const openNext = (): Promise<void> => {
      shut();
      const source = open(`/sync?client=${id}`);
      current = source;
      gate = new Promise<void>((resolve, reject) => {
        source.onerror = () => {
          if (source !== current) return;
          shut();
          reject(fail("SyncDropped", { reason: "stream failed" }));
        };
        source.onopen = () => {
          if (source !== current) return;
          source.onerror = () => {
            if (source === current) drop();
          };
          link.update((prev) => ({ ...prev, live: true }));
          resolve();
        };
        source.onmessage = (event) => receive(source, event);
      });
      return gate;
    };
    const deliver = async (message: Sync.Message): Promise<void> => {
      if (closed.get() || signal.aborted) return;
      try {
        await post.run({ input: { id, message } });
      } catch {
        if (signal.aborted === false) drop();
      }
    };

    const stopClosed = closed.watch((isClosed) => {
      if (isClosed) shut();
    });
    defer(stopClosed);
    defer(shut);
    openNext().then(undefined, () => {
      link.update((prev) => ({ ...prev, live: false, failed: true }));
      closed.set(true);
    });
    return {
      post: (message) => {
        const opened = gate;
        queue = queue
          .then(() => opened)
          .then(
            () => deliver(message),
            () => undefined,
          );
        return queue;
      },
      reopen: () => (closed.get() ? Promise.resolve() : openNext()),
    };
  },
});

/** Send one sync message up the wire: a register is kept as the last register, then every
 * message POSTs behind the stream's open. */
export const sendSync = operation({
  label: "sendSync",
  depends: { line: stream, last: lastRegister.controller },
  run: ({ line, last }, ctx: Operation.Ctx<Sync.Message>) => {
    if (ctx.input.type === "register") last.set(ctx.input);
    return line.post(ctx.input);
  },
});

/** Close the wire for good: sync's `onClose` listeners fire once and the stream closes. */
export const closeWire = operation({
  label: "closeWire",
  depends: { closed: wireClosed.controller },
  run: ({ closed }) => {
    closed.set(true);
  },
});

/** A transport with no scope yet: it sends nothing and hears nothing. */
const unstarted: Sync.Transport = {
  send: () => undefined,
  onMessage: () => () => undefined,
  onClose: () => () => undefined,
  close: () => undefined,
};

/** Build the tab's wire for sync: a thin `Sync.Transport` over the wire units, plus the extension
 * whose `start` hands it the scope. Install the extension before `subscribe(link.transport, …)`:
 * sync's `start` registers through the transport. Nothing opens until sync's first send resolves
 * the stream. `send` runs `sendSync`, `onMessage` watches the admitted frames, `onClose` watches
 * the closed flag (so it fires once), `close` runs `closeWire`. */
export function createWire(): Wire.Link {
  let scoped = unstarted;
  return {
    transport: {
      send: (message) => scoped.send(message),
      onMessage: (listener) => scoped.onMessage(listener),
      onClose: (listener) => scoped.onClose(listener),
      close: () => scoped.close(),
    },
    extension: extension({
      label: "wire",
      start: (scope, { signal }, next) => {
        scoped = scopedTransport(scope, signal);
        return next();
      },
    }),
  };
}

/** The transport over one scope's wire units. `close` after the scope closed (a failed boot
 * closes it at once) has nothing left to close: the wire closed first. */
function scopedTransport(scope: Scope.Handle, signal: AbortSignal): Sync.Transport {
  return {
    send: (message) => {
      scope.run(sendSync, { input: message }).then(undefined, () => undefined);
    },
    onMessage: (listener) =>
      scope.controller(inbox).watch((message) => {
        if (message !== null) listener(message);
      }),
    onClose: (listener) =>
      scope.controller(wireClosed).watch((isClosed) => {
        if (isClosed) listener();
      }),
    close: () => {
      if (signal.aborted === false) scope.run(closeWire);
    },
  };
}
