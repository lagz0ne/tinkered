import { data, resource, tag } from "@tinker/core";
import { createSseClient, type Sse } from "@tinker/sync/sse";
import { connection } from "./state.ts";

export declare namespace Wire {
  /** The app's public source shape stays compatible with its openSource tag. */
  type Source = Sse.Source;
}

/** How the wire opens one server-sent stream: the browser's `EventSource`, rebound in a test. */
export const openSource = tag<(url: string) => Wire.Source>({
  label: "openSource",
  default: (url) => new EventSource(url),
});

/** The reconnect intent: a count the `reconnect` operation bumps. The wire opens a fresh stream
 * on each bump; nothing calls the wire (ADR 0070). */
export const retry = data<number>({ label: "wire.retry", initial: 0 });

/** The app maps the wire's states to the screen's connection cell. */
const HEALTH = {
  connecting: { live: false, pending: true, failed: false },
  live: { live: true, pending: false, failed: false },
  failed: { live: false, pending: false, failed: true },
};

/** The tab owns one transport. Its URL registers the visible keys on every fresh GET;
 * the retry cell asks for a new stream without replacing sync's transport (ADR 0070). */
export const wire = resource({
  label: "wire",
  depends: { open: openSource, health: connection.controller, intent: retry.controller },
  factory: ({ open, health, intent }, { defer }) => {
    const transport = createSseClient({
      open: (keys) => {
        const query = new URLSearchParams(keys.map((key) => ["keys", key]));
        return open(`/sync?${query}`);
      },
      onState: (state) => health.set(HEALTH[state]),
      onRetry: (reconnect) => intent.watch(reconnect),
    });
    defer(() => transport.close());
    return transport;
  },
});
