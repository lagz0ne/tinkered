# Round 2 — edit a booking

Round 1 still applies in full.
This round adds editing with a draft.
A draft is unsaved text that you can keep or drop.

## Terms used here

- **Draft** means the unsaved edited values.
- **Save** means the draft passes checks and replaces the booking.
- **Discard** means the draft is dropped, the booking stays.

## Reads and writes

In addition to the round 1 calls, tests call:

```ts
const draft = scope.run(openEdit, {
  input: { id: saved.id },
});
scope.run(saveEdit, {
  input: { id: saved.id, title: "New name", room: "Cedar", start: 540, end: 600 },
});
scope.run(discardEdit, { input: { id: saved.id } });
```

`openEdit` returns a copy of the saved booking.
Editing that copy never changes the saved list.

## Rules with a small example

Open "Standup" for edit.
Retype the title as "Planning", then discard.
The list still shows "Standup".
Open it again, retype as "Planning", then save.
The list now shows "Planning".
A booking that clashes with "Planning" could still
have been saved while the draft was open:
the draft blocks nothing until save.

The full rules:

- `openEdit` takes `{ id: string }`.
  An unknown id reports `NotFound`.
- `openEdit` returns a copy: writing to the result
  never changes the saved booking.
- `saveEdit` takes
  `{ id, title, room, start, end }`.
  It checks the same title, room, and time rules as booking.
- Clash checks skip the booking being edited:
  keeping its own slot always passes.
- A failed save keeps the saved booking as it was.
- A failed save keeps the draft open for another try.
- `discardEdit` takes `{ id: string }`.
  An unknown id reports `NotFound`.
- Canceling the drafted booking closes its draft too.
- Save or discard for a closed or missing draft
  reports `NotFound` with that id.
- A discard leaves the saved booking unchanged.
- Unsaved text never changes the list.
- Only one draft is open at a time:
  opening a second id closes the first, unsaved text lost.

## The screen, in addition to round 1

- Each row gains an `Edit <title>` button.
- The open draft shows inputs named
  `Edit title`, `Edit room`,
  `Edit start time`, `Edit end time`.
- Draft buttons are named `Save` and `Discard`.
- `Save` keeps the draft open on failure
  and shows the error in the same `role="alert"` block.
- `Save` clears the draft and shows the new row
  when the save passes.
- `Discard` closes the draft and leaves the row unchanged.

## New exports in `src/index.ts`

```ts
export type EditInput = {
  readonly id: string;
  readonly title: string;
  readonly room: string;
  readonly start: number;
  readonly end: number;
};
export const editDraft: Data.Cell<Booking | undefined>;
export const openEdit: Operation.Handle<Booking, { id: string }>;
export const saveEdit: Operation.Handle<Booking, EditInput>;
export const discardEdit: Operation.Handle<void, { id: string }>;
```

Notes on the shape above:

- `editDraft` is empty when no edit is open.
- `saveEdit` returns the saved booking.
- `openEdit` and `discardEdit` of an unknown id
  report `NotFound` with that id.

## No new error kinds

Round 1 errors cover this round.
A clash on save reports `Clash`.
A save of an id that is gone reports `NotFound`.

## Do not

- Do not change round 1 names, labels, or error kinds.
- Do not write the draft into the saved list
  before a passing save.
- Do not block other bookings while a draft is open.
