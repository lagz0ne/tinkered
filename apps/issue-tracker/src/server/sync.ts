import { operation, resource, type Resource } from "@tinker/core";
import type { Stream } from "@tinker/hono";
import type { Sync } from "@tinker/sync";
import { raise } from "../errors.ts";

export declare namespace Viewers {
  /** One connected tab's inbox: open it once per stream, deliver posts into it. */
  export type Inbox = {
    /** Register a tab's deliver under its client id; the returned closer drops it. */
    open(id: string, deliver: (message: Sync.Message) => void): () => void;
    /** Hand one posted message to the tab's deliver; false when the tab is gone. */
    deliver(id: string, message: Sync.Message): boolean;
  };
}

/** The POST inbox registry the sync streams share: a scope resource, so the
 * composition root owns it and `defer` clears it on close. */
export const viewers: Resource.Handle<Viewers.Inbox> = resource({
  label: "viewers",
  factory: (_deps, { defer }) => {
    const inboxes = new Map<string, (message: Sync.Message) => void>();
    defer(() => {
      inboxes.clear();
    });
    return {
      open: (id, deliver) => {
        inboxes.set(id, deliver);
        return () => {
          if (inboxes.get(id) === deliver) inboxes.delete(id);
        };
      },
      deliver: (id, message) => {
        const found = inboxes.get(id);
        if (found === undefined) return false;
        found(message);
        return true;
      },
    };
  },
});

/** The SSE side of ADR 0048's userland transport: `send` writes one frame
 * down the stream (a throw from `emit` closes the wire — the client went
 * away), `deliver` fans a posted message to the `onMessage` listeners,
 * `onClose` listeners run once on `close`, and a `signal` abort closes. */
export function sseTransport(
  emit: Stream.Emit,
  signal: AbortSignal,
): Sync.Transport & { readonly deliver: (message: Sync.Message) => void } {
  let open = true;
  const arrivals = new Set<(message: Sync.Message) => void>();
  const partings = new Set<() => void>();
  const transport: Sync.Transport = {
    send: (message) => {
      if (open === false) return;
      try {
        emit(frame(message));
      } catch {
        closeWire();
      }
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
      closeWire();
    },
  };
  function closeWire(): void {
    if (open === false) return;
    open = false;
    for (const part of Array.from(partings)) part();
  }
  signal.addEventListener("abort", () => closeWire(), { once: true });
  return {
    ...transport,
    deliver: (message) => {
      for (const arrival of Array.from(arrivals)) arrival(message);
    },
  };
}

function frame(message: Sync.Message): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/** Read a posted register message: the keys the viewer shows. Anything else
 * is refused. */
export function parseRegister(raw: unknown): Sync.Message {
  if (typeof raw !== "object" || raw === null) raise("BadRegister", { reason: "unreadable" });
  if (!("type" in raw) || raw.type !== "register") raise("BadRegister", { reason: "unreadable" });
  if (!("keys" in raw) || Array.isArray(raw.keys) === false)
    raise("BadRegister", { reason: "unreadable" });
  const keys = raw.keys.filter((key): key is string => typeof key === "string");
  if (keys.length !== raw.keys.length) raise("BadRegister", { reason: "unreadable" });
  return { type: "register", keys };
}

/** Read one register POST: the client id plus its posted message. */
function parsePosted(raw: unknown): { readonly id: string; readonly message: Sync.Message } {
  if (typeof raw !== "object" || raw === null) raise("BadRegister", { reason: "unreadable" });
  if (!("id" in raw) || typeof raw.id !== "string") raise("BadRegister", { reason: "unreadable" });
  if (!("message" in raw)) raise("BadRegister", { reason: "unreadable" });
  return { id: raw.id, message: parseRegister(raw.message) };
}

/** Hand one posted message to its tab's inbox; a gone tab answers 410. */
export const registerViewer = operation({
  label: "registerViewer",
  input: parsePosted,
  depends: { viewers },
  run: ({ viewers }, ctx) => {
    if (viewers.deliver(ctx.input.id, ctx.input.message) === false)
      raise("ViewerGone", { id: ctx.input.id });
  },
});
