# 0036 Scope verbs: `resolve` reads a snapshot, `controller` gives back control, `run` runs

Date: 2026-09-17. Status: accepted. Amends the verbs used by 0010, 0020, 0022, 0032 (their
decisions stand; only the names change).

## Context

Before the first dedicated integration (ADR 0035) we aligned the public verbs, because the http
API is written in them. Today `resolve` means three things: build-and-cache a resource
(`ResourceController.resolve()`), run a command (`CommandController.resolve(call)`), and, in
prose, "deliver a dependency". `getController` is the only way to touch anything. A data
controller exposes `get()` and `read()`, which are the same function. Users say "operation";
the types say "command".

## Decision

One meaning per verb, on the scope handle and on every controller.

| verb                   | meaning                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope.resolve(x)`     | **Read the snapshot**, in the form a `depends` slot delivers (ADR 0020): data → value, resource → built instance (builds once if needed), tag → value.    |
| `scope.controller(x)`  | **Give back control**: a handle that delays and steers — data `get/set/update/watch`, resource `resolve/get`, operation `run(call)`.                      |
| `scope.run(op, call?)` | **Run an operation** now — the everyday call; `scope.controller(op).run(call)` is the long form. Same `CallArgs`/`Invocation` rules as before (ADR 0022). |

- `resolve` is never accepted for an operation (a type error). An operation is a command (ADR
  0010): it has no snapshot, is not memoized, and running it has effects. A "read" that fires a
  network call would be a lie.
- `resolve(resource)` on an unbuilt resource builds it once and caches — the same thing a
  `depends` slot does, so it is honest, and it is the one `resolve` that may do work.

Renames (mechanical, compiler-driven — change the types, fix what `vp check` lists):

| before                                           | after                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `scope.getController(x)`                         | `scope.controller(x)`                                                               |
| `CommandController.resolve(call)`                | `OperationController.run(call)`                                                     |
| `Scope.CommandController`                        | `Scope.OperationController`                                                         |
| `Operation.Command<T, I>`                        | `Operation.Handle<T, I>`                                                            |
| `DataController.read()`                          | removed — `get()` is the read                                                       |
| `ResourceController.resolve()/get()`             | unchanged: build-if-needed vs built-or-`NotResolved` are different promises         |
| React `useResolve` → `{ resolve, resolveAsync }` | `useRun` → `{ run, runAsync }` (react-query `mutate`/`mutateAsync` shape, ADR 0032) |
| React `useController(cell)`                      | unchanged (now matches `scope.controller`)                                          |

Subflows (ADR 0020/0022) are delivered as the operation controller, so a subflow is called
`deps.listRepos.run({ input })`.

## Consequences

- Pre-1.0 (0.0.0), so no compatibility shim: no aliases, no deprecation period.
- `scope.resolve`/`scope.run` are additive; `getController`, `read`, and the `Command` names are
  removed in the same change. Docs, README, examples, benches, and both test suites move together.
- Glossary rows for `operation`, `resource`, and `subflow` say the new verbs.

## Alternatives rejected

- **`execute` for operations** — it would blur with the http client's `execute(request, ctx)`
  (ADR 0035). `run` also matches the operation's own `run:` body.
- **`resolve(op)` = run it** — a read verb with effects; rejected as dishonest.
- **Keep `getController`** — the verb `controller` already says "hand me the handle".
