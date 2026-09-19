import { createScope, type Scope } from "@tinker/core";
import { subscribe, sync, type Sync } from "@tinker/sync";
import { api } from "./api.ts";
import { issueList } from "../shared/issues.ts";
import { fail, isError } from "../errors.ts";

export declare namespace TabSync {
  /** One connected tab: its scope plus a watch for a dropped live wire. */
  export type Connected = {
    readonly scope: Scope.Handle;
    readonly onDrop: (listener: () => void) => () => void;
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

/** Admit one wire message at the boundary. Anything else is a SyncDropped. */
function readMessage(raw: unknown): Sync.Message {
  if (!isRecord(raw)) throw fail("SyncDropped", { reason: "bad snapshot" });
  if (raw.type !== "snapshot") throw fail("SyncDropped", { reason: "bad snapshot" });
  if (typeof raw.key !== "string") throw fail("SyncDropped", { reason: "bad snapshot" });
  if (typeof raw.version !== "number") throw fail("SyncDropped", { reason: "bad snapshot" });
  return { type: "snapshot", key: raw.key, version: raw.version, value: raw.value };
}

function readData(event: MessageEvent): Sync.Message {
  let raw: unknown;
  try {
    raw = JSON.parse(event.data as string);
  } catch {
    throw fail("SyncDropped", { reason: "bad snapshot" });
  }
  return readMessage(raw);
}

/** Wait for the stream to open. A failed stream rejects: the tab shows the
 * failure instead of pretending an unsent draft was saved. */
function opened(stream: EventSource): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.onopen = () => resolve();
    stream.onerror = () => reject(fail("SyncDropped", { reason: "sync stream failed" }));
  });
}

/** Connect one browser tab: the GET opens the server wire first, then the
 * subscribe registers over POST — the register cannot race the stream.
 * The tab scope also carries the HTTP base, so commands reach this server.
 * One owned close path notifies listeners exactly once; a drop after ready
 * is visible through onDrop. Reload retries; reconnect stays t05. */
export async function connectTab(baseUrl: string): Promise<TabSync.Connected> {
  const id = Math.random().toString(36).slice(2);
  const stream = new EventSource(`${baseUrl}/sync?client=${id}`);
  try {
    await opened(stream);
  } catch (error) {
    stream.close();
    throw error;
  }
  const dropped = new Set<() => void>();
  let closed = false;
  const fire = (): void => {
    for (const listener of Array.from(dropped)) listener();
  };
  const closeOnce = (): void => {
    if (closed) return;
    closed = true;
    stream.close();
    fire();
  };
  const post = async (message: Sync.Message): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/sync?client=${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
    } catch {
      closeOnce();
      return;
    }
    if (!res.ok) closeOnce();
  };
  const transport: Sync.Transport = {
    send: (message) => {
      if (closed) return;
      post(message).then(settleSend, settleSend);
    },
    onMessage: (listener) => {
      stream.onmessage = (event) => {
        try {
          listener(readData(event));
        } catch (error) {
          if (isError(error, "SyncDropped")) closeOnce();
          else throw error;
        }
      };
      return () => {
        stream.onmessage = null;
      };
    },
    onClose: (listener) => {
      dropped.add(listener);
      return () => {
        dropped.delete(listener);
      };
    },
    close: () => closeOnce(),
  };
  const scope = createScope({
    tags: [sync(issueList), api.config({ baseUrl })],
    extensions: [subscribe(transport)],
  });
  try {
    await scope.ready;
  } catch (error) {
    closeOnce();
    throw error;
  }
  stream.onerror = () => closeOnce();
  return {
    scope,
    onDrop: (listener) => {
      if (closed) {
        listener();
        return () => undefined;
      }
      dropped.add(listener);
      return () => {
        dropped.delete(listener);
      };
    },
  };
}

function settleSend(): void {}
