---
name: react
description: >
  Use when you write or change a React page or
  component in a Tinker app: read a cell, run
  an operation from a button, show a pending or
  failed call, or mount the app. Also when a
  check prints tinker/react-state or
  tinker/one-wire.
metadata:
  purpose: >
    How React reads cells and runs operations
    through @tinkered/react, with no state and no
    effect of its own.
  type: framework
  framework: react
  library: '@tinkered/react'
  library_version: '0.21.0'
requires:
  - '@tinkered/core#core'
sources:
  - 'lagz0ne/tinkered:packages/react/src/index.ts'
---

# Tinker React

Read the `@tinkered/core` skill `core` first. This
skill adds the React side only.

React is a thin host. It reads cells and runs
operations. State lives in a cell. An effect lives
in a resource.

## Setup

```tsx
import { createScope, data, operation } from "@tinkered/core";
import {
  ScopeProvider,
  useData,
  useRun,
} from "@tinkered/react";
import { createRoot } from "react-dom/client";

const count = data({ label: "count", initial: 0 });

const add = operation({
  label: "count.add",
  depends: { count: count.controller },
  run: ({ count }) => count.update((n) => n + 1),
});

function Counter() {
  const value = useData(count);
  const { run, isPending, error } = useRun(add);
  return (
    <button disabled={isPending} onClick={() => run()}>
      {error ? "failed" : value}
    </button>
  );
}

const scope = createScope();
createRoot(document.body).render(
  <ScopeProvider scope={scope}>
    <Counter />
  </ScopeProvider>,
);
```

- `useData(cell)` renders again when that cell
  changes.
- `useRun(op)` gives `run`, `runAsync`, `status`,
  `data` and `error`. It has the shape of a React
  Query mutation.
- With capsules, pass the scope that
  `createScope({ capsules })` returns. The
  provider waits for its start.

## Core patterns

### Read a part of a cell

```tsx
import { data } from "@tinkered/core";
import { useData } from "@tinkered/react";

const user = data({
  label: "user",
  initial: { name: "Ann", visits: 0 },
});

function Name() {
  const name = useData(user, (u) => u.name);
  return <b>{name}</b>;
}
```

The component renders again only when `name`
changes.

### Read a keyed part

```tsx no-check
const list = useData(
  sea.board.waves.where({ room }),
);
const one = useData(
  sea.board.waves.of({ room, id }),
);
```

### A computed value with a stable reference

Use a Core `derived`, not `useMemo`. Pass its
config at each render. Every reader of the same
config gets the same value.

```tsx no-check
const view = useData(
  prView({ viewer: me.email, mode }),
);
```

### State for one subtree

`SessionProvider` opens a session for its
children. A write inside it stays inside it, and
ends when the subtree unmounts.

```tsx
import { data } from "@tinkered/core";
import {
  SessionProvider,
  useController,
  useData,
} from "@tinkered/react";

const draft = data({ label: "form.draft", initial: "" });

function Field() {
  const text = useData(draft);
  const cell = useController(draft);
  return (
    <input
      value={text}
      onChange={(e) => cell.set(e.target.value)}
    />
  );
}

function Form() {
  return (
    <SessionProvider>
      <Field />
    </SessionProvider>
  );
}
```

## Common mistakes

### HIGH: `useState` or `useReducer` [tinker/react-state]

Wrong:

```tsx no-check
const [open, setOpen] = useState(false);
```

Right: a `data` cell, read with `useData`. For
state that must end with a subtree, put the
subtree in a `SessionProvider`.

### HIGH: `useEffect` [tinker/react-state]

Wrong:

```tsx no-check
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, []);
```

Right: a `resource` holds the timer and its
cleanup. An operation or a capsule `start` hook
depends on it.

### HIGH: `fetch` in a component [tinker/one-wire]

The page talks to the server by rpc and remote
data only. Read the `@tinkered/core` skill
`core/rpc`.

### MEDIUM: a new object as the selected value

```tsx no-check
useData(user, (u) => ({ name: u.name }));
```

A new object on each read renders on each change.
Select a plain value, or pass `isEqual` as the
third argument.

## Completion

- The app's frontend check prints no
  `tinker/react-state` and no `tinker/one-wire`.
- A browser test clicks the control and reads
  the new text.
