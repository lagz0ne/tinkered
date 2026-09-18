# Decisions

One file per decision. Newest has the highest number. A decision changes only
by a new decision that names the old one.

| id                                                                     | decision                                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-typescript-only.md)                                        | The coding convention covers TypeScript only                                                                                  |
| [0002](0002-tsdoc-only.md)                                             | Comments are TSDoc on exports only                                                                                            |
| [0003](0003-behavior-tests-only.md)                                    | Tests prove behavior at the public seam; no unit tests, no mocks                                                              |
| [0004](0004-error-registry.md)                                         | Each package throws only from one error registry                                                                              |
| [0005](0005-plain-private.md)                                          | Class internals use `private`, never `#private`                                                                               |
| [0006](0006-trust-the-types.md)                                        | Validate at the process edge once; trust types inside                                                                         |
| [0007](0007-own-style-census.md)                                       | Style is enforced by our own grep census, not a copied one                                                                    |
| [0008](0008-type-and-namespace.md)                                     | `type` over `interface`; one namespace per concept                                                                            |
| [0030](0030-react-is-a-thin-adapter-not-a-store.md)                    | `@tinker/react` is a thin adapter over core, not a store                                                                      |
| [0031](0031-session-lifetime-binds-to-react-subtree.md)                | A session's lifetime binds to a React subtree's mount                                                                         |
| [0032](0032-resources-suspend-operations-are-imperative.md)            | Resources suspend; operations are imperative                                                                                  |
| [0033](0033-react-tests-run-in-vitest-browser-mode.md)                 | React tests run in vitest browser mode                                                                                        |
| [0034](0034-clock-is-an-ambient-ctx-capability.md)                     | Clock is an ambient ctx capability (Effect default-service model)                                                             |
| [0035](0035-http-client-is-a-frame-of-core-primitives.md)              | The HTTP client is a pre-wired frame of core primitives (Effect HttpClient model)                                             |
| [0036](0036-scope-verbs-resolve-reads-controller-controls-run-runs.md) | Scope verbs: `resolve` reads a snapshot, `controller` gives back control, `run` runs                                          |
| [0037](0037-inline-operation-via-scope-run.md)                         | `scope.run` also runs an inline operation, with its input passed in, not closed over                                          |
| [0038](0038-tags-on-a-call-open-a-child-session.md)                    | `tags` on a call open a child session for that run (ambient, not a shallow overlay)                                           |
| [0039](0039-hono-is-a-session-level-driver.md)                         | Hono is a session-level driver: a middleware opens the request session, routes are declarations                               |
| [0040](0040-a-server-request-is-an-inline-operation.md)                | A server request is an inline operation: spans, one log line, error mapping, streaming lifetime                               |
| [0041](0041-drizzle-transaction-is-a-session-resource.md)              | Drizzle: the client is a scope resource, the transaction a session resource whose commit is the session's success             |
| [0042](0042-cli-entrypoint-owns-the-scope-routing-is-scope-config.md)  | The CLI entrypoint owns the scope; routing is scope configuration; loading policy follows the process                         |
| [0043](0043-harness-is-a-session-thread-with-ambient-state.md)         | A harness is a session thread with ambient state; adapters keep the harness's own types                                       |
| [0044](0044-a-resource-dep-is-its-value-async-is-a-build-detail.md)    | A resource dependency is delivered as its value; async is a build detail, typed through the graph; deps build before the body |
