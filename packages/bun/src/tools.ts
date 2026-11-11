import type { Observe, transport } from "@tinker/core";

/** What a run hook's event gives the protocol. */
type Event = {
  readonly run: transport.Hook["run"];
  readonly log: Observe.Logger;
  readonly call?: { readonly signal?: AbortSignal };
};

/**
 * A run hook's tools, as the protocol's `Hook`. Core makes an event's logger on the first read
 * of `log`, and the protocol reads it only to log a fault: a call with no fault makes none.
 */
export class Tools implements transport.Hook {
  readonly run: transport.Hook["run"];
  readonly signal: AbortSignal | undefined;
  private event: Event;
  constructor(event: Event) {
    this.run = event.run;
    this.signal = event.call?.signal;
    this.event = event;
  }
  get log(): Observe.Logger {
    return this.event.log;
  }
}
