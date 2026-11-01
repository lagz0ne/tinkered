import { capsule, operation, resource, tag } from "@tinker/core";
export const tabStop = tag<AbortSignal>({ label: "sync.tabStop" });
/** A hook reads the tab's stop through this run: a hook reads no tag itself (ADR 0120). */
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
/** Listens while the factory runs; `bind` only names what to close. */
export const tabLifetime = resource({
  label: "router.tabLifetime",
  depends: { target: pageEvents },
  factory: ({ target }, ctx) => {
    let close: (() => Promise<void>) | undefined;
    const leave = (event: Event) => {
      if (!("persisted" in event) || !event.persisted) return close?.();
    };
    target?.addEventListener("pagehide", leave);
    ctx.defer(() => target?.removeEventListener("pagehide", leave));
    return {
      bind: (next: () => Promise<void>) => {
        close = next;
      },
    };
  },
});
/** The entry signal stops active work before Core's graceful root shutdown waits for it. */
export const accountOwner = capsule({
  label: "sync.accountOwner",
  hooks: {
    async start(event) {
      await event.next();
      const signal = await event.run(
        readTabStop,
        {},
        {
          role: "setup",
          explain: "Reads the tab's stop signal",
        },
      );
      let stop = new AbortController();
      let version = 0;
      const cancel = () => stop.abort();
      signal.addEventListener("abort", cancel, { once: true });
      event.defer(() => {
        signal.removeEventListener("abort", cancel);
        stop.abort();
      });
      return {
        capture: () => ({ version, signal: stop.signal }),
        reset: () => {
          stop.abort();
          stop = new AbortController();
          version += 1;
          if (signal.aborted) stop.abort();
        },
      };
    },
  },
});
