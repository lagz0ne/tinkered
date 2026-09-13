# Glossary

| term                 | meaning                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| public seam          | The one surface tests may touch: the package entry `src/index.ts`.                                                 |
| behavior test        | A test that names one public cause and checks one decisive public outcome through the seam.                        |
| fixture              | Setup at the top of a test file, built with the public API, shared by that file's tests.                           |
| error registry       | `src/errors.ts` in a package: every error name and its payload type, the only place code throws from.              |
| `isError(e, "Name")` | Guard that narrows an unknown error to one registry entry; on mismatch the caller rethrows.                        |
| `isX`                | A type discriminator. Checks the smallest stable shape needed to narrow; not a runtime safety wall.                |
| `readX`              | The reader that does any real admission once and captures the facts later code needs.                              |
| process edge         | Where data enters from outside: network, fs, env, argv, user input. Validated once there.                          |
| layer word           | A name part that says where code sits, not what it is: `Runtime`, `Manager`, `Handler`, `Wrapper`, `Base`. Banned. |
| handle               | An object a caller holds to use a thing. Its config sits on it as plain fields.                                    |
| owner                | Who may mutate and release a value at a handoff: borrow, transfer, or retain.                                      |
| census               | `style-census.sh`: grep counts of forbidden (S*, T*) and watched (W*) patterns.                                    |
| strict               | Census mode where any S* or T* hit fails. Ends with `Style census: OK` or `FAIL`.                                  |
| TSDoc                | A `/** */` comment on an exported interface or function. The only allowed comment.                                 |
| YAGNI                | Build only what current behavior needs; no options or hooks for a future caller.                                   |
| concept namespace    | `export declare namespace X { ... }` holding every type of one concept; `X.Handle` is what `createX()` returns.    |
