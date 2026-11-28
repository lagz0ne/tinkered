---
name: messaging
description: >
  Use when work must not hold the caller: a
  queue, an outbox, a drain, a dead letter.
  Also for a list of listeners, a wire tap or
  audit of calls, or a loop that runs in the
  background of a scope.
metadata:
  purpose: >
    Enterprise integration patterns as capsules:
    a line cell and a start-hook pump, a list
    slot of listeners, a run hook.
  type: sub-skill
  library: '@tinkered/core'
  library_version: '0.34.21'
requires:
  - core
  - capsule
sources:
  - 'lagz0ne/tinkered:packages/core/src/main.ts'
---

# Messaging

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

- Queue, outbox, drain, dead letter: "Queue"
- Listeners, observer, pub-sub: "Listeners"
- Wire tap, audit of calls: "Wire tap"
- A foreign callback (a port, a process hook):
  the [capsule](../capsule/SKILL.md) skill.

## Core patterns

### Queue (message channel, dead letter)

The caller must not wait for the provider. The
op puts the item in a line cell and answers. The
capsule's `start` hook starts a pump that sends
one item per tick.

```ts
import {
  capsule,
  data,
  operation,
  tag,
  type Operation,
} from "@tinkered/core";
import { z } from "zod";

const letter = z.object({ to: z.string() });

type Letter = z.infer<typeof letter>;

type Item = { letter: Letter; tries: number };

const inner = tag<Operation.Handle<void, Letter>>({
  label: "outbox.inner",
});

const everyMs = tag<number>({ label: "outbox.everyMs" });

const tries = tag<number>({
  label: "outbox.tries",
  default: 3,
});

const line = data<Item[]>({
  label: "outbox.line",
  initial: [],
});

const dead = data<Item[]>({
  label: "outbox.dead",
  initial: [],
});

const deliver = operation({
  label: "outbox.deliver",
  input: letter,
  depends: { line: line.controller },
  run: ({ line }, { input }) => {
    line.update((list) => [
      ...list,
      { letter: input, tries: 0 },
    ]);
  },
});

const sendOne = operation({
  label: "outbox.sendOne",
  depends: {
    inner: inner.controller,
    tries,
    line: line.controller,
    dead: dead.controller,
  },
  run: async ({ inner, tries, line, dead }) => {
    const [first, ...rest] = line.get();
    if (!first) return { kind: "idle" as const };
    line.set(rest);

    const result = await inner.settle({
      input: first.letter,
    });
    if (result.status === "success") {
      return { kind: "sent" as const };
    }

    const item = { ...first, tries: first.tries + 1 };
    if (item.tries < tries) {
      line.update((list) => [...list, item]);
    } else {
      dead.update((list) => [...list, item]);
    }
    return { kind: "failed" as const };
  },
});

const pump = operation({
  label: "outbox.pump",
  depends: { everyMs, sendOne: sendOne.controller },
  run: async ({ everyMs, sendOne }, ctx) => {
    for (;;) {
      const slept = await ctx.clock
        .sleep(everyMs, ctx.signal)
        .then(
          () => true,
          () => false,
        );
      if (!slept) return;

      await sendOne.run();
    }
  },
});

export const outbox = capsule({
  label: "outbox",
  config: {
    inner: inner.required,
    everyMs: everyMs.required,
    tries,
  },
  exports: { deliver, line, dead },
  hooks: {
    async start({ next, run }) {
      await next();
      void run(
        pump,
        {},
        { role: "handler", explain: "One send per tick" },
      );
    },
  },
});
```

- `settle` gives the failure as a value, so one
  bad item never stops the pump.
- The pump's own `ctx.signal` aborts at the
  scope's close. The sleep then fails, and the
  loop returns.
- `dead` keeps what failed `tries` times. Read it
  on an admin page, or alert on it.
- Items in a cell end with the process. To keep
  them past a restart, the line is a table, and
  the claim is `FOR UPDATE SKIP LOCKED`.

### Listeners (observer, pub-sub)

The capsule declares a list slot. It runs each
listener in the cmd's order.

```ts
import {
  capsule,
  data,
  operation,
  tag,
  type Operation,
} from "@tinkered/core";
import { z } from "zod";

const member = z.object({ email: z.string() });

type Member = z.infer<typeof member>;

const listener = tag<
  Operation.Handle<unknown, Member>
>({ label: "signup.on" });

const members = data<Member[]>({
  label: "signup.members",
  initial: [],
});

const join = operation({
  label: "signup.join",
  input: member,
  depends: {
    on: listener.all,
    members: members.controller,
  },
  run: async ({ on, members }, { input }) => {
    members.update((list) => [...list, input]);

    for (const each of on) await each.run({ input });
    return { kind: "joined" as const };
  },
});

export const signup = capsule({
  label: "signup",
  config: { on: listener.all },
  exports: { join, members },
});

// cmds/server.ts:
// signup({ on: [stats.count, welcome.greet] })
```

- A listener is an op of another capsule. Its
  own `depends` reach its own cells.
- A listener that must not hold the caller goes
  through a queue: put `outbox.deliver` in the
  list.

### Wire tap (interceptor)

A `run` hook sees every run in the scope.
`event.is(op)` says yes for one op, and types
its input. The hook calls `next()` and changes
nothing.

```ts
import {
  capsule,
  data,
  operation,
} from "@tinkered/core";
import { z } from "zod";

const send = operation({
  label: "mail.send",
  input: z.object({ subject: z.string() }),
  run: () => undefined,
});

const seen = data<string[]>({
  label: "tap.seen",
  initial: [],
});

const kept = {
  role: "state",
  explain: "Each subject the tap saw",
} as const;

export const tap = capsule({
  label: "tap",
  exports: { seen },
  hooks: {
    run(event) {
      if (event.is(send)) {
        const subject = event.input.subject;
        event
          .load(seen, kept)
          .update((list) => [...list, subject]);
      }
      return event.next();
    },
  },
});
```

- Install the tap first in `capsules`: the first
  hook is the outermost.

## Common mistakes

### HIGH: a background loop in a resource

A scope `resource` that starts work with
`void every.run().catch(() => undefined)` hides
each failure. If the loop throws, it stops for
good, and no test sees it.

Wrong:

```ts no-check
export const flusher = resource({
  label: "ops.flusher",
  target: "scope",
  depends: { every: flushEvery.controller },
  factory: async ({ every }, ctx) => {
    void every
      .run({ signal: ctx.closing })
      .catch(() => undefined);
  },
});
```

Right: start the loop in the capsule's `start`
hook, as in "Queue". Each round `settle`s its
work, so one failure is a value, and the loop
goes on.

### HIGH: a background run with a signal

`run(pump, { signal: closing }, meta)` owns the
call in a child session (ADR 0090). The pump's
writes land in that child, so the root's cells
never change.

Wrong:

```ts no-check
void run(pump, { signal: closing }, meta);
```

Right: `void run(pump, {}, meta)`. The pump's own
`ctx.signal` aborts at the scope's close. A run
that must keep its signal depends on
`cell.atScope.controller` to write the root
(ADR 0126).

## Completion

- Each pattern's state is a cell that a test
  reads.
- Time comes from `ctx.clock`; tests use
  `makeTestClock()`.
- The graph shows `calls{slot:…}` for each
  slot.
- `tinker check` prints OK.
