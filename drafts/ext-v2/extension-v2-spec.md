# Spec: the extension is the library's door

Status: draft for Duke's approval.
ADR: 0120 v2 (`adr-0120-v2-draft.md`).
Base: tinkered main a336d60 (0120 v1 built);
tinker-app main d7f9b00; hedl main 3cc37eb.
Proof: `extension-proto/` (tsc clean, node run).

Words:

- **library**: one folder in
  `tinker/components/`.
- **extension**: what `extension()` returns.
- **handle**: an extension not yet called.
- **binding**: what a call returns; what a
  scope installs.
- **unit**: an operation or a resource.
- **record**: what the scope knows about each
  installed extension, at any moment.

## 1. Types

```ts
export declare namespace Extension {
  type Handle<C extends Config, E, T = void> =
    Scope.Extension<T> & E & {
      readonly config: C;
      (values: Values<C>): Binding<T>;
    };
  type Binding<T = void> = Scope.Extension<T>;
  type Values<C> = Scope.ConfigValues<C>;
  type Exports = Record<string,
    Operation.Handle<any, any>
    | Resource.Handle<any>
    | Data.Cell<any>>;
  type Reserved =
    "label" | "config" | "hooks" | "exports";
}
```

- v1 `Scope.Configurable` is renamed
  `Extension.Handle`.
- v1 rules stay: config entries (tag,
  `.required`, `.optional`, `.all`),
  `ConfigValues`, the `unfilled` marker.
- An extension with no config is still a
  handle. It is called with no argument:
  `health()`.

```ts
export function extension<
  const C extends Scope.Config = {},
  const E extends Extension.Exports = {},
  T = void,
>(def: {
  readonly label: string;
  readonly config?: C;
  readonly exports?: E;
  readonly hooks?: Hooks<C, T>;
}): Extension.Handle<C, E, T>;
```

```ts
export function tag<T>(def: {
  label: string;
  default?: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
  secret?: true;          // new
}): Tag.Handle<T>;
```

## 2. Hook events

Every hook event loses these fields:

- `resolve`, `controller`, `run`, `settle`;
- `scope` (on `start` and `close`).

Every hook event gains these fields:

- `config`: the extension's config, read once
  after binding. Defaults are filled. Typed as
  `Config<C>` (each key's tag value type).
- `load`: see 3.

Kept as today: `next`, `tap`, `kind`, `log`,
`signal`, `clock`, `random`, `ns`, and the
`target` / `op` / `call` / `cell` / `value`
of the middleware hooks.

```ts
type Hooks<C, T> = {
  start?(e: Start<C>): T | PromiseLike<T>;
  resolve?(e: ResolveEvent<C>): unknown;
  run?(e: RunEvent<C>): unknown;
  write?(e: WriteEvent<C>): void;
  close?(e: CloseEvent<C>): Promise<Result>;
  session?(e: SessionEvent<C>): Promise<Result>;
};
```

## 3. `load`

```ts
load<V>(unit: Resource.Handle<V>,
  why: Why): Promise<V>;
load<I, O>(unit: Operation.Handle<O, I>,
  why: Why): Operation.Controller<O, I>;
load<V>(unit: Data.Cell<V>,
  why: Why): Data.Controller<V>;

type Why = {
  readonly explain: string;
  readonly watches?: readonly Unit[];
  readonly changes?: readonly Unit[];
};
```

Rules:

1. A resource: built on the root, as
   `scope.resolve` does today. Answers its value.
2. An operation: answers its controller. The
   extension calls `run` or `settle` on it.
3. A cell: answers its controller.
4. It works in every hook, at any time while the
   root is open.
5. One unit, one record line per extension.
   A second `load` of the same unit answers the
   same value or controller and adds no line.
   It keeps the first `why`.
6. A unit held by a slot key is loaded the same
   way: `load(config.bootstrap, why)`.
7. After the root closes, `load` raises
   `Disposed`, as `resolve` does today.
8. No check that the unit is the library's own.
   The `why` is the extension's own word.
9. Spans: a `load` and everything it runs hang
   under a span named for the extension label.

## 4. The record

```ts
scope.extensions: readonly Record[];

type Record = {
  readonly label: string;
  readonly config: { [key: string]: unknown };
  readonly exports: readonly string[];
  readonly loaded: readonly Line[];
};
type Line = {
  readonly unit: string;      // unit label
  readonly explain: string;
  readonly watches: readonly string[];
  readonly changes: readonly string[];
  readonly status: Status;
  readonly error?: unknown;
};
type Status = "building" | "ready"
  | "running" | "idle" | "failed" | "released";
```

Rules:

1. One record per installed binding, in
   `extensions` order.
2. It exists before the first `start` hook
   runs, with `config` and `exports` filled.
3. `config` shows each key's value. A key whose
   tag has `secret: true` shows `"[hidden]"`,
   at any depth. A unit shows its label.
4. Status:
   - resource: `building`, then `ready` or
     `failed`; `released` when it is released;
   - operation: `idle`; `running` while a run
     from its controller is open; `failed` keeps
     the last error until the next run.
5. It is live: reading it at any time shows the
   state at that time.

## 5. Events on the observe hose

Each change in the record is one event on the
hose (ADR 0119):

```ts
{ kind: "extension.installed", label, config,
  exports }
{ kind: "extension.loaded", label, line }
{ kind: "extension.status", label, unit,
  status, error? }
```

- A tap added in `start` sees every event made
  after it, as today.
- A late reader reads `scope.extensions`, then
  taps. (Kubernetes: list, then watch.)
- With no tap, Core makes no event objects.
  The hot path pays one flag check (ADR 0119).

## 6. Exports

```ts
export const mail = extension({
  label: "mail",
  config: { smtpUrl, from },
  exports: { enqueue, send, outbox },
});
mail.enqueue === enqueue; // true
```

1. Each export is copied onto the handle and
   onto every binding. Same object: identity
   holds (ADR 0057).
2. A reserved name as an export key is a type
   error, and `extension()` raises
   `ReservedExport { label, key }`.
3. Core keeps a map unit -> extension label.
   A span of an exported unit carries
   `library: "mail"`.
4. The record lists export keys.

## 7. Library rules (convention, no Core code)

1. The index exports only the library's
   extension or extensions.
2. Names do not stutter: `mail`, `enqueue`.
3. A library that runs in more than one place
   has one extension per place, exported by
   name: `export { server, tab }`. The user
   writes `import * as sync from "..."` and
   `sync.server({...})`.
4. Config tags and other units stay private.
   Tests may import them.

## 7b. Using another library

An extension and its units may use another
library's units in 3 ways:

1. A unit's `depends`:
   `depends: { tx: database.transaction }`.
   Static, as today (mail -> database).
2. A slot key, filled by the cmd:
   `auth({ onUserCreated:
   [sync.server.createAccountStream] })`.
   The library does not import the other one.
3. `load` in a hook:
   `load(database.transaction, why)`.

Rules:

- The other library's extension must be in the
  same scope. If not, the first read of its
  private tag fails (`MissingTag`), as v1 rule 8.
- Start order is `extensions` order (ADR 0050).
  An extension whose start needs another's
  start effect (a migration) comes after it.
- The record line of a loaded foreign unit
  names that unit's own library.

## 8. Errors

- `MissingConfig { label, key }`: as v1.
- `DuplicateExtension { label }`: as v1.
- `ReservedExport { label, key }`: new.
- `Disposed`: `load` after close, as today.

## 9. What breaks

Every hook that reads `resolve`, `controller`,
`run`, `settle` or `scope` from its event.
In the tinker-app template that is 10 of 12
extensions:

- `authStartup` (x2): resolves `authSettings`
  -> becomes a config key. Hook goes away.
- `databaseSetup` (x2): resolves `databaseUrl`,
  runs `migrate` -> config key +
  `load(migrate, why).run()`.
- `mailStartup`: resolves 2 tags -> config
  keys. Hook goes away.
- `mcpRuns`: `run` hook resolves `mcpTools`
  and settles a tool -> `config.tools` +
  `load(tool.run, why).settle(...)`.
- `startRequests`: resolves `backendStop` ->
  config key.
- `syncStartup` (x2): resolves 7 slots ->
  split into `server` and `tab` extensions with
  config keys; `syncSide` goes.
- `telemetryExport`: resolves 4 tags, the
  queue, and a controller -> config keys +
  `load(queue)` + `load(flushTelemetry)`.
- `threadExport`: same as `telemetryExport`.

Not affected: `routerScope` (base, no reads).

## 10. Acceptance tests (Core)

Each is one test at the operation or scope
level. "fails" means the named error.

1. A config key with no default, left out:
   type error.
2. Same key written `undefined`: `ready`
   fails, `MissingConfig { key }`.
3. `start` reads `config.x` with the default
   filled when the key is left out.
4. A start event has no `resolve` field (type
   test and runtime `"resolve" in event` false).
5. `load(resource)` answers the built value;
   the record shows `ready`.
6. `load(op)` answers a controller; during a
   run the record shows `running`, after it
   `idle`.
7. A failing run: record shows `failed` with
   the error; the next good run clears it.
8. `load` twice: same answer, one line, first
   `why` kept.
9. `load` from a `run` hook at request time
   adds a line (works after start).
10. `load` after close: `Disposed`.
11. A `secret: true` tag nested in an object
    value shows `"[hidden]"`.
12. Exports: `mail.enqueue === enqueue`, and on
    the binding too.
13. Export named `label`: type error and
    `ReservedExport`.
14. A span of an exported unit carries its
    library label.
15. A tap added in `start` gets `installed`,
    `loaded` and `status` events in order.
16. No tap: no event object is made (count
    allocations, as ADR 0119 tests do).
17. A preset on a loaded unit wins (ADR 0015).

## 11. Hedl first (Duke 03:12)

Order inside Hedl, after Core 0120 v2 is
released:

1. `requests`, `database-sqlite`, `auth-sqlite`
   (split `origin` + `secret`), `errors`,
   `health`, `http`: one extension each.
2. `telemetry`: `server`, `browser`, `worker`,
   `app`.
3. `sync-sqlite`: `server`, `tab`.
4. `cmds/server.ts`, `router.ts`,
   `telemetry-worker.ts`: one call per library.
5. Gate: Hedl `npm run check`, live boot,
   sign-up, data parity, as for slice 2.

Then the tinker-app template, then the other
3 apps, then the `sync` merge.

## 12. Not in this spec

- Devtools UI (it reads the record).
- Graph edges from a slot tag to its unit at
  build time (v1 Open, still open).
- The `sync` / `sync-sqlite` merge details.
