# Round 4 — undo the last change

Rounds 1 to 3 still apply in full.
This round adds one undo step for booking changes.

## Terms used here

- **Change** means one passing booking write:
  a book, cancel, edit save, series book,
  one cancel, or series cancel.
- **Undo** means the last change is reversed.
- **Redo** is out of scope: there is none.

## Reads and writes

In addition to the earlier calls, tests call:

```ts
scope.run(bookBooking, {
  input: { title: "Standup", room: "Cedar", date: "2026-10-01", start: 540, end: 600 },
});
scope.run(undoChange, {});
const list = scope.resolve(bookings);
```

After the undo above, the list no longer
holds "Standup".

## Rules with a small example

Book "A" in Cedar 09:00, then book "B" in Cedar 10:00.
Undo removes "B"; "A" stays.
Undo again removes "A"; the list is empty.
Undo a third time: nothing happens,
and it reports `EmptyUndo`.
Edit "A" to "A2", then undo: "A" is back.
Book a 3-week series, then undo:
all three days go away in one step.

The full rules:

- `undoChange` takes no input.
- Undo reverses the last passing booking change.
- A series book or series cancel is one step:
  undo removes or restores every occurrence at once.
- Undo restores booking data only.
  It never touches form text, drafts, or filters.
- Failed actions add no undo step.
- Filter and draft moves add no undo step.
- An undo with no step left reports `EmptyUndo`.
  It carries no payload: `{}`.
- An undo of an undo is allowed:
  each undo pops one step, so two undos reverse two changes.
- Undo restores the exact prior booking state
  and pops its history entry.
  It adds no new history entry.
- The no-overlap rule holds in every round,
  undo included: a restored snapshot was valid
  when saved, so restoring it creates no overlap.

## The screen, in addition to rounds 1 to 3

- A button named `Undo`.
- After an undo, the list and row buttons match
  the restored bookings.
- Form text, drafts, and filters stay as they were.
- An empty undo shows `EmptyUndo`
  in the same `role="alert"` block.

## New export in `src/index.ts`

```ts
export const undoChange: Operation.Handle<void, void>;
```

This is the only input-free operation in the app.
Call it as `scope.run(undoChange, {})`.

## New error in `src/errors.ts`

- `EmptyUndo` carries `{}`.

Earlier errors stay as they are.

## Do not

- Do not change earlier names, labels, or error kinds.
- Do not add redo.
- Do not push form, draft, or filter moves onto undo.
- Do not fail an undo with `Clash`.
