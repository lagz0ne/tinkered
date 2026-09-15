# Decisions

One file per decision. Newest has the highest number. A decision changes only
by a new decision that names the old one.

| id                                                          | decision                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| [0001](0001-typescript-only.md)                             | The coding convention covers TypeScript only                     |
| [0002](0002-tsdoc-only.md)                                  | Comments are TSDoc on exports only                               |
| [0003](0003-behavior-tests-only.md)                         | Tests prove behavior at the public seam; no unit tests, no mocks |
| [0004](0004-error-registry.md)                              | Each package throws only from one error registry                 |
| [0005](0005-plain-private.md)                               | Class internals use `private`, never `#private`                  |
| [0006](0006-trust-the-types.md)                             | Validate at the process edge once; trust types inside            |
| [0007](0007-own-style-census.md)                            | Style is enforced by our own grep census, not a copied one       |
| [0008](0008-type-and-namespace.md)                          | `type` over `interface`; one namespace per concept               |
| [0030](0030-react-is-a-thin-adapter-not-a-store.md)         | `@tinker/react` is a thin adapter over core, not a store         |
| [0031](0031-session-lifetime-binds-to-react-subtree.md)     | A session's lifetime binds to a React subtree's mount            |
| [0032](0032-resources-suspend-operations-are-imperative.md) | Resources suspend; operations are imperative                     |
| [0033](0033-react-tests-run-in-vitest-browser-mode.md)      | React tests run in vitest browser mode                           |
