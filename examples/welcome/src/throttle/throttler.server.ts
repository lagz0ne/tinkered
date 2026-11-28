import { capsule, data, operation, tag } from "@tinkered/core";

/** At most one turn per `gapMs`. */
const gapMs = tag<number>({ label: "throttler.gapMs" });

/** The first time the next turn may start. */
const turn = data<number>({ label: "throttler.turn", initial: 0 });

/** Waits for the next free turn. A caller books it first, so turns go in the order asked. */
const runner = operation({
  label: "throttler.runner",
  depends: { gapMs, turn: turn.controller },
  run: async ({ gapMs, turn }, { clock, signal }) => {
    const now = clock.currentTimeMillis();
    const at = Math.max(now, turn.get());
    turn.set(at + gapMs);

    await clock.sleep(at - now, signal);
  },
});

/** A pace for one provider: `smtpMail({ throttle: pace.runner })`, where `pace = throttler(...)`. */
export const throttler = capsule({
  label: "throttler",
  config: { gapMs: gapMs.required },
  exports: { runner },
});
