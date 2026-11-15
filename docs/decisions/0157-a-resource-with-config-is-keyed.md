# 0157 A resource with config is keyed

Date: 2026-11-15. Status: accepted (Duke, 13:37 to
14:24 UTC).
Changes: ADR 0150 (the name `derived`), ADR 0152
(when a write in a compute is refused).

## What the user said

- 11:45: "the golden code should be all
  observable, almost 100% ... those should be on
  span".
- 13:37: picked "A. derived makes a span".
- 13:38: "Is derived more like a resource or an
  operation?"
- 13:39: "Can derived (and should) it have
  lifecycle? I think yes".
- 13:40: "surely resource can be turned to dervied
  just by having config".
- 14:24: picked "A. Not while a reader computes".

## Context

A `derived` had a `factory`, kept its value, and
gave it to each reader. A resource does the same.
Three things set them apart:

- its key was its config;
- it built again when a source changed;
- it had no end, and made no span.

The apps showed a third form. In Hedl, 37 of 78
resources watch a cell by hand:

```ts
factory: ({ cam, density }, { defer }) => {
  defer(cam.watch(() => density.run()));
},
```

The watcher runs on no span. 27 of them write a
cell, which a `derived` compute refused.

No app resource reads a cell's value at its build
(0 of 86). So "builds again when a source
changes" breaks no app code.

## Precedent

- Solid: `createMemo` with `onCleanup`. The
  cleanup runs before each new run and at the
  end.
- Solid, Vue, MobX: a memo is pure; an effect
  may write. Vue stops a chain of writes at 100.
- TanStack Query: the arguments of a read are
  its key.

## Decision

1. `derived` goes. A `resource` with a `config`
   is the same unit: keyed by its config values.

   ```ts
   const open = resource({
     label: "tasks.open",
     config: { project: project.required },
     depends: (c) => ({
       rows: tasks.where({ project: c.project }),
     }),
     factory: ({ rows }, { config, defer }) =>
       rows.get().length,
   });
   ```

2. The call with values is the read, as before:
   `useData(open({ project }))`.
3. `config: {}` gives one key. The resource still
   follows its sources.
4. Each build is a span of kind `resource`, with
   the label. A read with no change makes none.
5. The factory gets `{ config, defer }`. An end
   runs before the next build, when the last
   reader leaves, and when the scope closes. Ends
   run last first, as a resource's do.
6. An operation or a resource may name the read
   in `depends`. It gets a reader.
7. A build that a reader starts must not write a
   cell: `WriteInRead`, once `WriteInDerived`.
   A build that a source's change sets off may
   write. The round limit of ADR 0152 ends a
   loop with `UpdateDepth`.
8. The read's type is `Data.Built<T>`. The unit's
   type is `Resource.Keyed<C, T>`.

## Not in this step

- One engine. A resource with no `config` keeps
  its own path: `target`, an async build,
  `release`. The keyed path is sync.
- `useResource` for a keyed resource. A page
  reads it with `useData`.
- The parent of a build's span. It is a root.

## Consequences

- An app moves each `derived({ ... })` to
  `resource({ config, ... })`. The factory's
  second argument is `{ config }`, not the
  config. Hedl and acountee have 5 each.
- An app that reads `WriteInDerived` reads
  `WriteInRead`. Its payload names `resource`.
- A resource that watches a cell by hand can
  move its cell into `depends`. Its run is then
  a span.
- Core grows by 99 bytes. The cap goes up by
  128 bytes.
- `tinker/plain` no longer knows the name
  `derived`.
