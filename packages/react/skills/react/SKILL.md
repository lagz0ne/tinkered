---
name: react
description: >
  Use when you write or change a React page or
  component in a Tinker app: read a cell, run
  an operation from a button, show a pending or
  failed call, or mount the app. Also when a
  check prints tinker/kind, tinker/react-state,
  tinker/one-wire or tinker/link.
metadata:
  purpose: >
    How React reads cells and runs operations
    through @tinkered/react, with no state and no
    effect of its own.
  type: framework
  framework: react
  library: '@tinkered/react'
  library_version: '0.32.3'
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

A list reads once with `where` and passes each
member to its item. Core keeps a member's
reference until that member changes, so a
`memo` item draws again only for its own change.

```tsx no-check
{list.map((wave) => (
  <Wave key={wave.id} wave={wave} />
))}
```

Read `of(key)` when a component has the key and
no list above it.

### A computed value with a stable reference

Use a Core `resource` with a `config`, not
`useMemo`. Pass its
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

### Show each kind of an answer

A call can answer a union by `kind`. The page
reads it in a `switch` with a case for each kind,
and no `default`. A new kind in the contract then
fails the check at this `switch`.

```tsx no-check
function Moved({ out }: { out?: MoveAnswer }) {
  switch (out?.kind) {
    case undefined:
    case "moved":
      return null;
    case "stale":
      return <small role="status">Changed.</small>;
    case "gone":
      return <small role="status">Gone.</small>;
  }
}
```

Read a field only in the case of a kind that has
it. `out.version` in case `gone` fails the type
check.

## Common mistakes

### HIGH: a kind with no case [tinker/kind]

Wrong:

```tsx no-check
if (out?.kind === "stale") return <Stale />;
return null;
```

Right: a `switch` on `kind`, with a case for
each kind the check names. Do not add `default:`.
Do not cast.

### HIGH: `useState` or `useReducer` [tinker/react-state]

Wrong:

```tsx no-check
const [open, setOpen] = useState(false);
```

Right: a `data` cell, read with `useData`. For
state that must end with a subtree, put the
subtree in a `SessionProvider`.

### HIGH: `useEffect` or `useLayoutEffect` [tinker/react-state]

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

### HIGH: a plain `<a href>` to a page of the app [tinker/link]

Wrong:

```tsx no-check
<a href={`/issues/${team}/${id}`}>{title}</a>
```

A click loads the whole page again. The scope
and every cell start over.

Right: a page link is the router's `Link`.
A server path, such as `/auth/login`: add `rel="external"`.
The `Link` takes the route's path and params:

```tsx no-check
<Link to="/issues/$team/$id" params={{ team, id }}>
  {title}
</Link>
```

### MEDIUM: a new object as the selected value

```tsx no-check
useData(user, (u) => ({ name: u.name }));
```

A new object on each read renders on each change.
Select a plain value, or pass `isEqual` as the
third argument.

## Completion

- `tinker check` prints `tinker check: OK`.
- A browser test clicks the control and reads
  the new text.
