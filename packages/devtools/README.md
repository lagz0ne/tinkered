# @tinkered/devtools

Devtools keeps a record of what a scope did.
A tool reads the record as one plain object.

It is a plain capsule.
You add it to a scope's `capsules`.
The scope lists it under the label `tinker.devtools`.
There is no global hook.

```ts
const dt = devtools();
const scope = createScope({ capsules: [dt] });
dt.snapshot();
```

## One devtools per scope

Each call to `devtools()` makes a new capsule with its own state.
So give each scope its own call.

## Options

- `limit`: the size of the span ring and the session list.
  The default is 1000.
- `values`: keep the last value of each write.
  The default is off.
  With it off, a write shows only its label and count.

## The snapshot

`dt.snapshot()` gives a fresh copy each call.
Changing the copy changes nothing that devtools keeps.

- `scope`: the scope's state, and its status once closed.
  Before the scope starts, the state is `starting`.
- `sessions`: each session, by id, in the order it opened.
  Its `runs` are the spans opened in it.
- `runs`: the spans opened outside any session.
- `resources`: the resource spans, in any session.
- `writes`: the count of writes to each cell label.
- `exits`: the count of each exit, keyed `label<tab>exit`.

Each span keeps its attributes and its events.
A span that did not fail has no `error` key.

The snapshot is plain JSON.
A JSON round trip gives the same object.

The span ring keeps the newest `limit` spans.
The exit counts keep every run, even after a span leaves the ring.

## Sessions

- The session list keeps at most `limit` sessions.
- It drops the oldest closed session first.
- With no closed session, it drops the oldest open one.
- A span of a dropped session leaves the snapshot.
- A session is `open` while it runs.
  Then it is `closed`, with its status.
- A session whose function throws ends `failed`.

## Exits

- An operation that answers a `kind` counts as `label<tab>kind`.
- A refusal counts as `label<tab>refused`.
- A plain value counts as `label<tab>value`.
- A failed run counts no exit.

## Failures

- A resource whose factory throws leaves a `failed` span in `resources`.
- A failed operation keeps its error as text, such as `Error: boom`.
- A thrown value that is not an `Error` is kept as its JSON, such as `"nope"`.
- If JSON cannot write it, such as a BigInt, it is kept as its type, such as `bigint`.

## Writes

- A write still lands in the cell.
- Devtools counts it by the cell label.

## Listeners

`dt.moves(listener)` calls `listener` once for each new record.
A record is a span, a session that opens or closes, a scope state change, or a write.
It returns a function. Call it to stop the listener.

A listener that throws does not stop the run.
Its error is rethrown in a microtask, so the host sees it.

## Not in it yet

- The CLI command `tinker state`.
- An IndexedDB span log.
- A React panel.
