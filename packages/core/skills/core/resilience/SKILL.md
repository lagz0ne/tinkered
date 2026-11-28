---
name: resilience
description: >
  Use when a call to a third party needs a
  throttle or rate limit, a retry with backoff,
  a circuit breaker, or a bulkhead. Also when
  start fails with DuplicateCapsule for a
  second wrapper.
metadata:
  purpose: >
    Release It! and resilience4j patterns as a
    backend capsule or a wrapper capsule in an
    op slot, each with its graph line.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.34.21'
requires:
  - core
  - capsule
sources:
  - 'lagz0ne/tinkered:packages/core/src/main.ts'
---

# Resilience

A known pattern needs no new part. It is a
capsule that uses some of these four:

- **op slot:** a config key whose tag holds an
  operation. The cmd fills it with another
  capsule's op.
- **list slot:** `tag.all` of op slots. The cmd
  writes the list and its order.
- **hooks:** `start` begins a loop or a
  listener, `run` wraps each run, `close` stops.
- **cell:** the state the pattern keeps.

- Throttle, rate limit: "Setup", "Throttle"
- Retry, backoff: "Retry"
- Circuit breaker: "Breaker"
- Bulkhead, max calls in flight: "Bulkhead"
- A queue in front of a provider: the
  [messaging](../messaging/SKILL.md) skill.

## Setup

The app capsule declares an op slot (see the
capsule skill). A backend capsule fills it. The
backend has a slot of its own for its pace, and
a throttler capsule fills that one.

```ts
import {
  capsule,
  createScope,
  data,
  operation,
  tag,
  type Operation,
} from "@tinkered/core";
import { z } from "zod";

const letter = z.object({ to: z.string() });

type Letter = z.infer<typeof letter>;

// src/mail/index.ts: the app capsule
const backend = tag<Operation.Handle<void, Letter>>({
  label: "mail.backend",
});

const send = operation({
  label: "mail.send",
  input: letter,
  depends: { backend },
  run: ({ backend }, { input }) =>
    backend.run({ input }),
});

export const mail = capsule({
  label: "mail",
  config: { backend: backend.required },
  exports: { send },
});

// src/throttle/throttler.server.ts
const gapMs = tag<number>({ label: "throttler.gapMs" });

const turn = data<number>({
  label: "throttler.turn",
  initial: 0,
});

const runner = operation({
  label: "throttler.runner",
  depends: { gapMs, turn: turn.controller },
  run: async ({ gapMs, turn }, ctx) => {
    const now = ctx.clock.currentTimeMillis();
    const at = Math.max(now, turn.get());
    turn.set(at + gapMs);

    await ctx.clock.sleep(at - now, ctx.signal);
  },
});

export const throttler = capsule({
  label: "throttler",
  config: { gapMs: gapMs.required },
  exports: { runner },
});

// src/mail/smtp.server.ts: the backend
const throttle = tag<
  Operation.Handle<Promise<void>, void>
>({ label: "mail.smtp.throttle" });

const sent = data<Letter[]>({
  label: "mail.smtp.sent",
  initial: [],
});

const deliver = operation({
  label: "mail.smtp.deliver",
  input: letter,
  depends: { throttle, sent: sent.controller },
  run: async ({ throttle, sent }, { input }) => {
    await throttle.run();
    sent.update((list) => [...list, input]);
  },
});

export const smtpMail = capsule({
  label: "mail.smtp",
  config: { throttle: throttle.required },
  exports: { deliver, sent },
});

// cmds/server.ts
const app = createScope({
  capsules: [
    throttler({ gapMs: 100 }),
    smtpMail({ throttle: throttler.runner }),
    mail({ backend: smtpMail.deliver }),
  ],
});

const live = await app.ready;

await live.run(mail.send, {
  input: { to: "ana@x.io" },
});

await live.close();
```

- A feature calls `mail.send`. It never sees the
  backend or its pace.
- The runner takes no input and gives no answer,
  so one throttler fits any backend.
- Each call books the next free turn in a cell
  before it sleeps, so calls go in the order
  they came.
- Time comes from `ctx.clock`. A test passes
  `makeTestClock()` and calls `advance`.
- The graph shows each step:

```text
mail.send exits{value}
  calls{slot:mail.backend}
mail.smtp.deliver exits{value}
  writes{mail.smtp.sent.update}
  calls{slot:mail.smtp.throttle}
throttler.runner exits{value}
  reads{throttler.turn.get}
  writes{throttler.turn.set}
```

## Core patterns

### Throttle (rate limiter)

The setup is the throttle: the backend waits for
the throttler's turn, then calls its provider.

- To refuse in place of a wait, the runner
  answers a kind: `{ kind: "limited", inMs }`.
  The backend's slot type then names that kind.
- A second provider with its own limit needs a
  second throttler (see Common mistakes).

### Retry (backoff)

`settle` the slot. After a failure, sleep
`baseMs * 2^n` on the scope clock, and call
again. The last call throws as the provider did.

```ts
import {
  capsule,
  operation,
  tag,
  type Operation,
} from "@tinkered/core";
import { z } from "zod";

const pair = z.object({ base: z.string() });

type Pair = z.infer<typeof pair>;

const inner = tag<
  Operation.Handle<Promise<number>, Pair>
>({ label: "retry.inner" });

const tries = tag<number>({
  label: "retry.tries",
  default: 3,
});

const baseMs = tag<number>({
  label: "retry.baseMs",
  default: 100,
});

const fetch = operation({
  label: "retry.fetch",
  input: pair,
  depends: { inner: inner.controller, tries, baseMs },
  run: async ({ inner, tries, baseMs }, ctx) => {
    for (let n = 1; n < tries; n++) {
      const result = await inner.settle({
        input: ctx.input,
      });
      if (result.status === "success") {
        return result.value;
      }

      const wait = baseMs * 2 ** (n - 1);
      await ctx.clock.sleep(wait, ctx.signal);
    }
    return inner.run({ input: ctx.input });
  },
});

export const retry = capsule({
  label: "retry",
  config: { inner: inner.required, tries, baseMs },
  exports: { fetch },
});
```

- An async provider fills
  `Operation.Handle<Promise<T>, I>`. A sync one
  fills `Operation.Handle<T, I>`.
- Retry only a call that is safe to repeat: a
  read, or a write the provider takes once per
  key.

### Breaker (circuit breaker)

A state cell: `closed` with a count of failures
in a row, or `open` with the time it opened.
Open answers `down` and does not call. After
`coolMs`, one call tests the provider.

```ts
import {
  capsule,
  data,
  operation,
  tag,
  type Operation,
} from "@tinkered/core";
import { z } from "zod";

const pair = z.object({ base: z.string() });

type Pair = z.infer<typeof pair>;

const inner = tag<
  Operation.Handle<Promise<number>, Pair>
>({ label: "breaker.inner" });

const failures = tag<number>({
  label: "breaker.failures",
  default: 3,
});

const coolMs = tag<number>({
  label: "breaker.coolMs",
  default: 30_000,
});

type State =
  | { kind: "closed"; failed: number }
  | { kind: "open"; at: number };

const state = data<State>({
  label: "breaker.state",
  initial: { kind: "closed", failed: 0 },
});

const quote = operation({
  label: "breaker.quote",
  input: pair,
  depends: {
    inner: inner.controller,
    failures,
    coolMs,
    state: state.controller,
  },
  run: async (deps, ctx) => {
    const { inner, failures, coolMs, state } = deps;
    const now = ctx.clock.currentTimeMillis();
    const was = state.get();
    if (was.kind === "open" && now < was.at + coolMs) {
      return { kind: "down" as const };
    }

    const result = await inner.settle({
      input: ctx.input,
    });
    if (result.status === "success") {
      state.set({ kind: "closed", failed: 0 });
      return {
        kind: "rate" as const,
        value: result.value,
      };
    }

    const failed =
      was.kind === "closed" ? was.failed + 1 : failures;
    state.set(
      failed < failures
        ? { kind: "closed", failed }
        : { kind: "open", at: now },
    );
    return { kind: "down" as const };
  },
});

export const breaker = capsule({
  label: "breaker",
  config: { inner: inner.required, failures, coolMs },
  exports: { quote, state },
});
```

- Join it with retry in the cmd:
  `breaker({ inner: retry.fetch })`, then
  `retry({ inner: provider.fetch })`.
- A test reaches each exit: `rate`, and `down`
  both when the call fails and while it is open.

### Bulkhead

A count cell of calls in flight. Past `most`,
the call answers `full`. A slow provider cannot
take every worker.

```ts
import {
  capsule,
  data,
  operation,
  tag,
  type Operation,
} from "@tinkered/core";
import { z } from "zod";

const pair = z.object({ base: z.string() });

type Pair = z.infer<typeof pair>;

const inner = tag<
  Operation.Handle<Promise<number>, Pair>
>({ label: "bulkhead.inner" });

const most = tag<number>({
  label: "bulkhead.most",
  default: 4,
});

const busy = data<number>({
  label: "bulkhead.busy",
  initial: 0,
});

const quote = operation({
  label: "bulkhead.quote",
  input: pair,
  depends: { inner, most, busy: busy.controller },
  run: async ({ inner, most, busy }, { input }) => {
    if (busy.get() >= most) {
      return { kind: "full" as const };
    }

    busy.update((n) => n + 1);
    try {
      const value = await inner.run({ input });
      return { kind: "rate" as const, value };
    } finally {
      busy.update((n) => n - 1);
    }
  },
});

export const bulkhead = capsule({
  label: "bulkhead",
  config: { inner: inner.required, most },
  exports: { quote, busy },
});
```

## Common mistakes

### MEDIUM: one capsule installed twice

A capsule installs once in a scope. A second
`throttler(...)` or `retry(...)` raises
`DuplicateCapsule`.

Right: one throttler per scope today. A second
provider with its own limit waits on a Core
decision (two installs of one capsule).

## Completion

- Each pattern's state is a cell that a test
  reads.
- Time comes from `ctx.clock`; tests use
  `makeTestClock()`.
- The graph shows `calls{slot:…}` for each
  slot.
- `tinker check` prints OK.
