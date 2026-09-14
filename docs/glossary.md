# Glossary

| term                 | meaning                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| public seam          | The one surface tests may touch: the package entry `src/index.ts`.                                                                                                              |
| behavior test        | A test that names one public cause and checks one decisive public outcome through the seam.                                                                                     |
| fixture              | Setup at the top of a test file, built with the public API, shared by that file's tests.                                                                                        |
| error registry       | `src/errors.ts` in a package: every error name and its payload type, the only place code throws from.                                                                           |
| `isError(e, "Name")` | Guard that narrows an unknown error to one registry entry; on mismatch the caller rethrows.                                                                                     |
| `isX`                | A type discriminator. Checks the smallest stable shape needed to narrow; not a runtime safety wall.                                                                             |
| `readX`              | The reader that does any real admission once and captures the facts later code needs.                                                                                           |
| process edge         | Where data enters from outside: network, fs, env, argv, user input. Validated once there.                                                                                       |
| layer word           | A name part that says where code sits, not what it is: `Runtime`, `Manager`, `Handler`, `Wrapper`, `Base`. Banned.                                                              |
| handle               | An object a caller holds to use a thing. Its config sits on it as plain fields.                                                                                                 |
| owner                | Who may mutate and release a value at a handoff: borrow, transfer, or retain.                                                                                                   |
| census               | `style-census.sh`: grep counts of forbidden (S*, T*) and watched (W*) patterns.                                                                                                 |
| strict               | Census mode where any S* or T* hit fails. Ends with `Style census: OK` or `FAIL`.                                                                                               |
| TSDoc                | A `/** */` comment on an exported interface or function. The only allowed comment.                                                                                              |
| YAGNI                | Build only what current behavior needs; no options or hooks for a future caller.                                                                                                |
| concept namespace    | `export declare namespace X { ... }` holding every type of one concept; `X.Handle` is what `createX()` returns.                                                                 |
| unit / span          | One tracked piece of work; opened when an operation or resource resolves. Units nest by explicit parent into a tree.                                                            |
| exporter             | An extension (`onStart`/`onEnd`) that consumes spans; its failures are isolated and never fail application work.                                                                |
| behavior-neutral     | Observation never changes results or value identity; the core wraps no user value. Deep client tracing lives in adapters.                                                       |
| data                 | The only reactive value: a cell. Read/watch/set. No separate derive/compute unit.                                                                                               |
| dependency mode      | How a dep is taken: **read** (bare `data` → the value) or **write** (`data.controller` → get/set/watch handle).                                                                 |
| derivation           | A pattern, not a unit: an operation/resource writes a `data` cell (write-mode dep) that others watch; or a consumer watches sources and combines them.                          |
| operation (command)  | A function with typed `input`; runs on each `resolve(input)`; may have effects; not reactive, not memoized by deps.                                                             |
| session              | A child scope layer; an owned lifetime boundary closed structurally (children first, then teardown).                                                                            |
| target               | A resource's `target: "scope" \| "session"` — one shared instance for the whole scope, or one per session. Deps bind at the owner.                                              |
| release              | Reset a node and cascade to its downstream dependents so they rebuild; mainly a frontend affordance (server uses `close`).                                                      |
| preset               | A test-only replacement of a node's realization; only downstream consumers see it. Never a production seed.                                                                     |
| onClose              | Userland teardown hook registered from outside on a scope/session handle, run alongside resource-internal cleanup.                                                              |
| outcome              | Success is declared outside-in (boundary owner signals when its work finishes); failure bubbles inside-out (a thrown error). `onOutcome` notifies resources to commit/rollback. |
| owner-context        | A node resolves deps and registers cleanup at its owning layer and bubbles up from there; a scope resource needing a session-only required tag is a normal `MissingTag`.        |
