import { capsule, data, operation, resource, tag, type Operation } from "@tinkered/core";

import { letter, type Letter } from "@/mail/letter";

/** One letter in line, and how many sends of it failed. */
type Item = { letter: Letter; tries: number };

/** The slot: the backend the outbox feeds. */
const inner = tag<Operation.Handle<void, Letter>>({ label: "outbox.inner" });

/** The time between two sends. */
const everyMs = tag<number>({ label: "outbox.everyMs" });

/** Sends of one letter before it goes to `dead`. */
const tries = tag<number>({ label: "outbox.tries", default: 3 });

/** The letters in line, first in first out. */
const line = data<Item[]>({ label: "outbox.line", initial: [] });

/** The letters that failed `tries` times: a dead letter channel. */
const dead = data<Item[]>({ label: "outbox.dead", initial: [] });

/** Puts the letter in line and answers at once, so the caller never waits for the provider. */
const enqueue = operation({
  label: "outbox.enqueue",
  input: letter,
  depends: { line: line.controller },
  run: ({ line }, { input }) => {
    line.update((list) => [...list, { letter: input, tries: 0 }]);
  },
});

/** Sends the first letter in line. A failed send goes to the back, or to `dead` at `tries`. */
const sendOne = operation({
  label: "outbox.sendOne",
  depends: { inner: inner.controller, tries, line: line.controller, dead: dead.controller },
  run: async ({ inner, tries, line, dead }) => {
    const [first, ...rest] = line.get();
    if (!first) return { kind: "idle" as const };
    line.set(rest);

    const result = await inner.settle({ input: first.letter });
    if (result.status === "success") return { kind: "sent" as const };

    const item = { letter: first.letter, tries: first.tries + 1 };
    if (item.tries < tries) line.update((list) => [...list, item]);
    else dead.update((list) => [...list, item]);
    return { kind: "failed" as const };
  },
});

/** Fires when the scope begins to close, graceful or not: the pump stops taking a new tick. */
const stopping = resource({
  label: "outbox.stopping",
  factory: (_deps, { closing }) => closing,
});

/** Sends each letter still in line, until the line is empty. */
const drain = operation({
  label: "outbox.drain",
  depends: { sendOne: sendOne.controller },
  run: async ({ sendOne }) => {
    let sent = 0;
    for (;;) {
      const one = await sendOne.run();
      if (one.kind === "idle") return { kind: "drained" as const, sent };
      if (one.kind === "sent") sent += 1;
    }
  },
});

/**
 * One send per `everyMs`, until the scope begins to close. On a graceful close the work signal
 * stays live, so the pump sends what is left. A forced close aborts it and the line is dropped.
 */
const pump = operation({
  label: "outbox.pump",
  depends: { everyMs, stopping, sendOne: sendOne.controller, drain: drain.controller },
  run: async ({ everyMs, stopping, sendOne, drain }, { clock, signal }) => {
    for (;;) {
      const slept = await clock.sleep(everyMs, stopping).then(
        () => true,
        () => false,
      );
      if (!slept) break;
      await sendOne.run();
    }
    if (!signal.aborted) await drain.run();
  },
});

/**
 * A queue in front of a backend: `outbox({ inner: smtp.deliver, everyMs: 100 })`, where `smtp = smtpMail(...)`.
 * Its start hook runs the pump. A graceful close sends what is left before the scope ends.
 */
export const outbox = capsule({
  label: "outbox",
  config: { inner: inner.required, everyMs: everyMs.required, tries },
  exports: { enqueue, line, dead },
  hooks: {
    async start({ next, run }) {
      await next();
      void run(pump, {}, { role: "handler", explain: "Sends one letter per tick" });
    },
  },
});
