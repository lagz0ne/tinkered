# 0120 v2: the extension is the library's door

Status: proposed. Waits on Duke's approval.
Base: tinkered main a336d60 (ADR 0120 v1, built).
Thread: "Brainstorm reusable components with slots".
Proof: `tinkered/plans/extension-proto/`
(typed model + Hedl wiring, tsc clean).

## What the user said

- 02:39 "should be more like Tag (Tag and
  Tagged) ... So the config can be typed as such
  on creation?"
- 02:47 "make the graph to be more a part of
  extension so it can also show the effective
  graph ... the library knows the exact graph"
- 02:47 "As well as to observation and
  operation"
- 02:53 "we should not grant resolve too easily.
  That resolve should associate to the
  controlled, not just any"
- 02:56 "extension loads a watcher, it needs to
  'explain' so those information, meta,
  operational and observable will follow suit"
- 02:57 "It doesn't need to be declarative, make
  it dynamic, but by the end of the start, scope
  should know exactly what's going on with each
  and every extension"
- 02:58 "Actually, anytime, not only after start"
- 03:02 "the extension does the export, static,
  and other module does import those exports?"
- 03:08 "maybe we export directly from
  extension? Instead of via exports"
- 03:12 "Yes, finalize the code ... stress test
  a little bit with current use in apps"
- 03:12 "Hedl can be the first one to try"

## What v1 already has (keep)

- `extension({ label, config, hooks })`.
- Config entries: tag, `.required`,
  `.optional`, `.all`.
- A required key must be named; `undefined`
  fails start with `MissingConfig`.
- An unfilled extension is refused by
  `extensions` (the `unfilled` marker).
- `DuplicateExtension`; tests use presets.

## Changes

### 1. Names follow Tag

- `extension()` returns `Extension.Handle`.
- Calling it returns `Extension.Binding`.
- Same pair as `Tag.Handle` and `Tag.Binding`.
- Rename only: v1 `Scope.Configurable` becomes
  `Extension.Handle`; the called value becomes
  `Extension.Binding`.

### 2. Hooks read typed config

```ts
start({ config, load, next }) {
  config.smtpUrl; // URL, checked
}
```

- Core reads the bound tags once, after
  `bindConfig`, and passes them in.
- No hook calls `resolve(tag)` by hand.

### 3. No general `resolve` in a hook

- `start` gets `config`, `load`, `next`.
- It does not get `resolve`.
- The middleware hooks (`resolve`, `run`,
  `write`, `session`) keep `next` only.

### 4. `load` is the one verb

```ts
await load(migrate, {
  explain: "Brings the schema up to date",
});
load(runMailWorker, {
  explain: "Sends queued mail",
  watches: [outboxWake],
  changes: [mailOutbox],
});
```

- `load` builds a resource or runs an
  operation, and records why.
- It works at any time, not only in start.
- Its spans hang under the extension.
- No check: the explanation is the
  extension's own word.

### 5. The scope keeps a live record

```ts
scope.extensions
// [{ label, config (secrets hidden),
//    loaded: [{ unit, explain,
//      watches, changes, status }] }]
```

- Each change is an event on the observe
  hose (ADR 0119): `loaded`, `status`,
  `released`.
- A reader gets the record, then the stream
  (Kubernetes list, then watch).
- Devtools, operation and observation read it.

### 6. Exports sit flat on the extension

```ts
export const mail = extension({
  label: "mail",
  config: { smtpUrl, from },
  exports: { enqueue, send, outbox },
});

depends: { enqueue: mail.enqueue }
```

- Same object, so identity holds (ADR 0057).
- Core knows each export's library, for spans
  and the record.
- `label`, `config`, `hooks` are reserved:
  an export with one of those names is a type
  error.
- The library's index exports only its
  extension(s). Config tags and other units stay
  private.

### 7. No stutter in names

- The extension takes the library's name:
  `mail`, not `mailStart`.
- Exports drop the prefix: `enqueue`, not
  `enqueueMail`.
- Go's rule: `mail.Send`, not `mail.MailSend`.

### 8. A library may have several extensions

- One per place it runs.
- `telemetry.server`, `telemetry.browser`,
  `telemetry.worker`, `telemetry.app`.
- `sync.server`, `sync.tab`.
- Each has its own required keys, so a tab key
  on the server side is a type error.
- The `syncSide` tag goes away.

### 9. A tag can be secret

```ts
const secret = tag<string>({
  label: "auth.secret",
  secret: true,
});
```

- The record shows `[hidden]` for it.
- Found in the stress test: guessing by key
  name leaked `settings.secret`.

## Library changes (tinker-app)

- `auth`: split `authSettings` into `origin`
  and `secret` (secret: true).
- `auth`: `onUserCreated` list key; no import
  of `sync`.
- `sync` + `sync-sqlite`: one `sync`, backend
  switch in the extension, backends load by
  `import()`. `Sync.Store` is ours; no
  transaction type in it. Keep the one-commit
  write (records + events).
- Every component: index exports its
  extension(s) only; slot files go.

## Order

1. Core: changes 1 to 5, 9 (tinkered).
2. Core: change 6 (exports, reserved names).
3. Hedl first (Duke 03:12): port `cmds/` and
   its 8 components.
4. tinker-app template and the other 3 apps.
5. `sync` merge.

## Stress test (Hedl, prototype)

- `server.ts`, `router.ts` type-check.
- Server imports 5 names, was 31.
- 7 of 7 wrong calls are type errors.
- No `DATABASE_URL`: "Missing config:
  database.url".
- Not tried: real Core, TS 7, worker cmd,
  other apps.
