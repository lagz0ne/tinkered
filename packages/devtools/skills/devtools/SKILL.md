---
name: devtools
description: >
  Use when you want to see what a Tinker scope
  did: its spans, sessions, exits or writes. Also
  when a tool reads a scope's state, or listens
  for each new record.
metadata:
  purpose: >
    How to add devtools to a scope, read its
    snapshot, and listen for new records.
  type: sub-skill
  library: '@tinkered/devtools'
  library_version: '0.34.1'
requires:
  - '@tinkered/core#core'
sources:
  - 'lagz0ne/tinkered:packages/devtools/src/index.ts'
---

# Devtools

Devtools is a plain capsule. It keeps what a scope
did, and gives it back as one plain object.

Read the `@tinkered/core` skill `core` first. This
skill adds devtools only.

## Setup

```ts
import { createScope, operation } from "@tinkered/core";
import { devtools } from "@tinkered/devtools";

const dt = devtools();
const scope = await createScope({ capsules: [dt] }).ready;

const hello = operation({
  label: "hello",
  run: () => "hi",
});

scope.run(hello);
export const { runs, exits } = dt.snapshot();
await scope.close({ graceful: true });
```

- Add the capsule to `capsules`. There is no
  global hook.
- `dt.snapshot()` gives the state now.
- `exits` counts `hello\tvalue` once.

## One devtools per scope

Each call to `devtools()` makes a new capsule with
its own state. Give each scope its own call.

```ts no-check
import { createScope } from "@tinkered/core";
import { devtools } from "@tinkered/devtools";

const shared = devtools();
const a = createScope({ capsules: [shared] });
const b = createScope({ capsules: [shared] });
```

Two scopes that share one capsule share its state.
So use `devtools()` once for each scope.

## Options

```ts
import { devtools } from "@tinkered/devtools";

export const dt = devtools({ limit: 500, values: true });
```

- `limit` sizes the span ring and the session list.
  The default is 1000.
- `values: true` keeps the last value of each
  write. The default is off.

## The snapshot

```ts
import { createScope, operation } from "@tinkered/core";
import { devtools } from "@tinkered/devtools";

const dt = devtools();
const scope = await createScope({ capsules: [dt] }).ready;

const ping = operation({
  label: "ping",
  run: () => "pong",
});

await scope.session(async (inner) => {
  inner.run(ping);
});

export const state = dt.snapshot();
await scope.close({ graceful: true });
```

- `scope`: the state, and the status once closed.
- `sessions`: each session by id, in open order.
  Its `runs` hold the spans opened in it.
- `runs`: the spans opened outside any session.
- `resources`: the resource spans, in any session.
- `writes`: the count for each cell label.
- `exits`: the count for each `label\texit` key.

Each call gives fresh objects. A change to the
copy changes nothing devtools keeps.

## Listeners

```ts
import { createScope, operation } from "@tinkered/core";
import { devtools } from "@tinkered/devtools";

const dt = devtools();
export let latest = dt.snapshot();
const stop = dt.moves(() => {
  latest = dt.snapshot();
});

const scope = await createScope({ capsules: [dt] }).ready;
const ping = operation({
  label: "ping",
  run: () => "pong",
});
scope.run(ping);
stop();
await scope.close({ graceful: true });
```

- `dt.moves(listener)` calls `listener` once for
  each new record: a span, a session that opens
  or closes, a scope state change, or a write.
- It returns a function. Call it to stop the
  listener.
- A listener that throws does not stop the run.
  Its error is rethrown in a microtask.

## Completion

- `dt.snapshot().scope.state` is `closed` after
  the scope closes.
- Each op you ran shows in `runs`, or in a
  session's `runs` when it ran in one.
