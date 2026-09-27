import { data, extension, operation, resource, tag, type Operation } from "@tinker/core";
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
     * POST drops the wire; a POST behind a failed stream or after the wire closed is skipped. */
    post(message: Sync.Message): Promise<void>;
    /** Close the current stream and open the next: resolves on its open, rejects with
     * `SyncDropped` when it errors first. After the wire closed it opens nothing. */
    reopen(): Promise<void>;
  };
  /** One sync message POSTed for one tab: the client id pairs it with the tab's stream. */
  type Post = { readonly id: string; readonly message: Sync.Message };
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

/** The last frame the stream admitted: the bridge hands each one to sync. */
const inbox = data<Sync.Message | null>({ label: "inbox", initial: null });

/** True once the wire closed for good (the first stream failed, or sync closed its end): the
 * bridge closes sync's end of the pair, once. */
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
 * stays attached. `reopen` swaps in the next stream for `reconnect`. Each POST waits for the open
 * of the stream it was sent behind, so POSTs go out in send order; one sent behind a stream that
 * failed is skipped (the register replays on reconnect). `defer` closes the stream; `ctx.signal`
 * aborts in-flight POSTs. */
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
      post: (message) =>
        gate.then(
          () => deliver(message),
          () => undefined,
        ),
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

/** Close the wire for good: the stream closes and the bridge closes sync's end of the pair. */
export const closeWire = operation({
  label: "closeWire",
  depends: { closed: wireClosed.controller },
  run: ({ closed }) => {
    closed.set(true);
  },
});

/** The near end of the `memoryPair` whose far end sync holds, bound once at the composition
 * root (ADR 0048: the transport is userland's). */
export const wirePeer = tag<Sync.Transport>({ label: "wirePeer" });

/** Link sync's pair to the wire units: a message sync sends runs `sendSync`; an admitted frame
 * goes to sync; the wire closing closes the pair (sync's `onClose` fires once); sync closing the
 * pair runs `closeWire`. Every link starts here and `defer` stops it. After the scope closed (a
 * failed boot closes it at once) a pair close has nothing left to close. */
const bridge = resource({
  label: "bridge",
  depends: {
    peer: wirePeer,
    sendIt: sendSync,
    closeIt: closeWire,
    frames: inbox.controller,
    closed: wireClosed.controller,
  },
  factory: ({ peer, sendIt, closeIt, frames, closed }, { defer, signal }) => {
    const stopSends = peer.onMessage((message) => {
      sendIt.run({ input: message }).then(undefined, () => undefined);
    });
    const stopFrames = frames.watch((message) => {
      if (message !== null) peer.send(message);
    });
    const stopClosed = closed.watch((isClosed) => {
      if (isClosed) peer.close();
    });
    const stopParted = peer.onClose(() => {
      if (signal.aborted === false) closeIt.run();
    });
    defer(stopSends);
    defer(stopFrames);
    defer(stopClosed);
    defer(stopParted);
    return { linked: true };
  },
});

/** Link the bound peer before sync starts. Install it before `subscribe`: sync's `start`
 * registers through its end of the pair. Nothing opens until that register resolves the
 * stream. */
export const wire = extension({
  label: "wire",
  start: (scope, _ctx, next) => {
    scope.resolve(bridge);
    return next();
  },
});
