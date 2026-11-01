import { operation, tag } from "@tinker/core";

/** The tab's stop signal: the router entry binds the one that closes its app root. */
export const tabStop = tag<AbortSignal>({ label: "sync.tabStop" });

/** Reads {@link tabStop} for a capsule hook, which reaches tags only through a unit. */
export const readTabStop = operation({
  label: "sync.readTabStop",
  depends: { tabStop },
  run: ({ tabStop }) => tabStop,
});

/** The browser entry passes `window`; the server passes nothing. */
export const pageEvents = tag<EventTarget | undefined>({
  label: "sync.pageEvents",
  default: undefined,
});
