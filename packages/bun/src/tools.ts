import type { Observe, transport } from "@tinkered/core";

/** What a run hook's event gives the protocol. */
type Event = {
  readonly run: transport.Hook["run"];
  readonly log: Observe.Logger;
  readonly call?: { readonly signal?: AbortSignal };
};

/**
 * A run hook's tools, as the protocol's `Hook`. Core makes an event's logger on the first read
 * of `log`, and the protocol reads it only to log a fault: a call with no fault makes none.
 * `signal` is the call's own by default; a watch passes its own session's (ADR 0133 d1).
 */
export class Tools implements transport.Hook {
  readonly run: transport.Hook["run"];
  readonly signal: AbortSignal | undefined;
  private event: Event;
  constructor(event: Event, signal = event.call?.signal) {
    this.run = event.run;
    this.signal = signal;
    this.event = event;
  }
  get log(): Observe.Logger {
    return this.event.log;
  }
}
