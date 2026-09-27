import type { Stream } from "@tinker/hono";
import { source, type Sync } from "@tinker/sync";
import { raise } from "../errors.ts";
import { issueList } from "../shared/issues.ts";

/** The rows the source publishes: each shared cell under its key. */
const published: Sync.Row[] = [[issueList, "issues"]];

/** The source extension, one identity per process: `createApp` installs this
 * same object and the `/sync` row's op declares it in `depends`. */
export const src = source({ cells: published });

/** The keys a tab may ask for: the published rows' keys. */
const keys = new Set(published.map(([, key]) => key));

/** The SSE side of ADR 0048's userland transport: `send` writes one frame
 * down the stream (a throw from `emit` closes the wire — the client went
 * away), `deliver` fans the register read off the URL to the `onMessage` listeners,
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

/** Read the keys a tab's stream URL asks for (`/sync?keys=issues`) as the register sync
 * answers. No key, or a key the source does not publish, raises `BadRegister`. */
export function readRegister(raw: unknown): Sync.Message {
  if (!Array.isArray(raw) || raw.length === 0) raise("BadRegister", { reason: "no keys" });
  const asked = raw.filter((key): key is string => typeof key === "string" && keys.has(key));
  if (asked.length !== raw.length) raise("BadRegister", { reason: "unknown key" });
  return { type: "register", keys: asked };
}
