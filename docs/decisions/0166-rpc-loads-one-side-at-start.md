# 0166 rpc loads one side at start

Date: 2026-11-21. Status: dropped after the
build (Duke, 2026-11-21 11:12 UTC: "Drop the
split"). It was accepted on 2026-11-20 16:42 UTC
(option a: "lazy module at start"). See "Result".
ADR 0130 stays as it is: rpc is one chunk.

## What the user said

- 2026-11-20: the rpc and remoteData chunk is
  engine, not interface. Cut the overlap from
  first principles. Clean old dead code on the
  way.
- 2026-11-20 16:42: picked "lazy module at
  start" for the side split. No API change.

## Context

One rpc definition serves or sends. Its config
says which:

- rpc: `implement` or `remote`;
- remoteData: `serve` or `read`.

The config is a value at start. No bundler can
see it. So each side ships the other side's code:

- a page ships `answer`, `stream`, the watchers
  and the dirty pass;
- a server ships the asks, the park and the
  back-off.

Fable measured it on 0.31.16 by stub builds
(`fable-rebuild.md`, step 4):

- a page would drop 1,949 B gzip;
- a server would drop 2,473 B gzip.

0.33.0 sizes, gzip:

- no rpc: 23,257 B (cap 23,272 B);
- with rpc: 33,787 B (cap 35,232 B).

## Precedent

- **Tinker's lazy module** (glossary, ADR 0107):
  a resource whose factory imports one module
  path. It is built once, cached and spanned.
- **Code splitting on `import()`**: Rollup,
  Rolldown and Vite put a dynamic import in a
  file of its own. A page fetches it only when
  the code runs. `React.lazy` and route chunks
  work so.
- **Export conditions** (`react-server`,
  `browser`): the bundler picks a file by the
  side. Option b used it. It was not picked: a
  page could then no longer serve, and in-page
  server tests break (ADR 0160 decision 2).
- **Separate packages** (`@trpc/client`,
  `@trpc/server`): an import names the side.
  Option c. It was not picked: new API.

Where ours is simpler: the config already says
the side. So no marker file, no condition and no
new name.

## Decision

1. **One module per side.** rpc's code splits in
   three:
   - shared: the definitions, ops, tags, fault
     brand, config check, lifecycle hooks,
     protocol, wire shapes and `transport`;
   - client side: rpc `remote` and remoteData
     `read`;
   - server side: rpc `implement` (with `answer`
     and `stream`) and remoteData `serve`.
2. **Loaded at start, by the config.** A
   capsule's start hook imports its side's
   module, as a lazy module does: a scope
   resource whose factory imports the path.
   - The module cache loads it once per process.
   - A root with both sides loads both.
   - No run, call or write waits on an import
     after start.
3. **A failed import fails start.** It is the
   resource's own failure, as for any lazy
   module. Core adds no retry. A page that cannot
   fetch the file fails as a route chunk does.
4. **No API change.** No new export, option or
   condition. A page that implements a key (the
   site's sea page, an in-page server test)
   loads the server side, and works as today.
5. **The size gate counts per side.** It follows
   static and dynamic imports from the entry:
   - core alone: cap 23,272 B, as today;
   - core, shared and client side: cap 35,232 B;
   - core, shared and server side: cap 35,232 B;
   - it prints the total of all files too;
   - the cap numbers do not move here. A lower cap
     goes to Duke with exact bytes after the build.
6. **A page-bundle check.** A Vite build of a
   small page that uses `remote` and `read`:
   - the server side is a file of its own;
   - no static import from the page's entry
     reaches it;
   - the check prints the gzip bytes the page
     loads at start.
7. **The wire keys keep their names.** The new
   modules' names start with `rpc-`, so the
   field rename keeps their keys (ADR 0130).

```ts
// a page: loads the client side at start
api({ remote: ws.client });
board({ read: ws.client });

// a server: loads the server side at start
api({ implement: { "todo.add": add } });
board({ serve: true });
```

## Amends

ADR 0130 says rpc code is in "its own chunk".
It is now three: one shared chunk and one per
side. An app that uses no rpc still drops all
three.

## Consequences

- A page's first start fetches one more file.
  Later starts in the same page do not.
- Start of a root with rpc already awaits; it
  now also awaits one import.
- Bun bundles a dynamic import into a server
  build, so a server binary keeps one file.
- A test of a side runs that side's import.
- Statechart specs `rpc-call`, `rpc-stream` and
  `remote-part` model the same steps. Their
  checks run again on the moved code.

## Result

The split was built and every gate passed, on
box branches `core/rpc-split` (B, both sides
lazy) and `core/rpc-split-c` (C, only the server
side lazy). A real page gained little, so Duke
dropped it. Nothing landed in the code.

Bytes a page loads at start, gzip:

- **main:** ws page 34,616 B; Hedl 259,044 B;
  one file.
- **B:** ws page 34,232 B (-384); Hedl
  258,592 B (-452); one more file, fetched
  after the start code runs.
- **C:** ws page 33,575 B (-1,041); Hedl
  257,967 B (-1,077); one file. A server set
  grows by 1,069 B.

Why B saved so little:

- Fable's stub build counted about 1.9 KB per
  side, in one file.
- Each extra file loses about 450 to 550 B of
  gzip context.
- Vite already joins Core and the rpc chunk into
  one page file.

Other facts from the build:

- Start cost: "no difference we can see", once
  each side is imported once per process. With
  an `import()` per root, B was 4.2% slower.
- Bun puts every dynamic import in its one
  server file. So a Bun server gains nothing.
- Report: `/home/paseo/plans/rpc-split/report.md`
  on the box.
