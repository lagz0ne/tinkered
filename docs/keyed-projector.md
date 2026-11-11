# A projector for keyed data

A board with a `load` reads its parts from a store.
The store is the truth. The server keeps no member.
So the server must learn when the store changes.
A projector tells it.

Decisions: ADR 0137 and ADR 0138.

## What a projector is

A projector follows the store's notices. It is the
outbox pattern: a write adds a notice in the same
transaction. The projector reads each notice in
order. For each one, it calls `invalidate`.

```ts
for (const n of notices) {
  await run(board.invalidate, {
    input: { tasks: { project: n.project, id: n.id } },
  });
}
```

The server then sends a signal to each reader whose
part holds that member. The reader asks again.

The signal carries the trace of the `invalidate`
call. The reader's ask links to it. So a write
that calls `invalidate` is one chain, from the
writer to each reader.

## The load

The load is an op. It gives the members of a part.

```ts
const loadTasks = operation({
  input: z.object({ project: z.string() }),
  depends: { db },
  run: ({ db }, { input }) =>
    db.tasks(input.project),
});

board({ serve: true, load: { tasks: loadTasks } });
```

- Its input says which fields a part must have.
- An ask with fewer fields is refused before the
  guard.
- It can give more than the part. Only the part's
  members go to the reader.
- It runs in a session of its own, closed when it
  returns. A transaction it opens ends with it.

## The rules

1. One notice: one `invalidate` for its key.
2. Notices of one pass make one signal per reader.
   A pass ends at the next microtask.
3. The store cut its log past the projector's place:
   every part in use is dirty. Send an empty part.

   ```ts
   await run(board.invalidate, {
     input: { tasks: {} },
   });
   ```

4. The retry of a failed pass stays in the app.
5. A store with no notices: the op calls
   `invalidate` after its commit. Two cases of ADR
   0137 are open again there: an op that fails after
   the commit, and a second process that writes.

## A set on the cell

A set on a board with a load keeps nothing. It marks
its member dirty, as `invalidate` does. A delete on
the cell does nothing: call `invalidate`.
