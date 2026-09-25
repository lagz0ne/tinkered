# Round 1 — book and cancel

You build a room-booking screen.
It uses only `@tinker/core` and `@tinker/react`.
Core owns the rules. React reads state and runs actions.
No server. No database. No other state library.

## The day and the rooms

- The day is fixed: 2026-10-01, UTC.
- Rooms are fixed: Cedar and Maple.
- Each room has its own bookings.
- The list starts empty.
- A reload starts fresh.

## Terms used here

- **Slot** means one room plus a start and end time.
- **Clash** means two bookings in one room whose times overlap.

## What a booking holds

A booking holds five fields:

- `id`: a string, unique in its scope.
  Callers treat it as opaque.
- `title`: trimmed text, never blank.
- `room`: `Cedar` or `Maple`.
- `start`: minutes since midnight, an integer from 0 to 1439.
- `end`: minutes since midnight, an integer from 0 to 1439.

## Reads and writes

Tests call your code through a scope:

```ts
const scope = createScope();
const saved = scope.run(bookBooking, {
  input: { title: "Standup", room: "Cedar", start: 540, end: 600 },
});
const list = scope.resolve(bookings);
scope.run(cancelBooking, { input: { id: saved.id } });
```

`scope.resolve` reads a cell.
`scope.run` runs an operation.
Use those names, as the core docs show.

## Rules with a small example

Book "Standup" in Cedar, 09:00 to 10:00.
That is `start: 540`, `end: 600`.
Booking it again in Cedar fails: the slot is taken.
Booking it in Maple at the same time works:
rooms do not share slots.
Booking Cedar 10:00 to 11:00 works:
one booking may start when another ends.

The full rules:

- Trim the title. Reject a blank title.
- Reject an unknown room.
- Reject a time outside 0 to 1439, or not an integer.
- Reject an end at or before the start.
- Reject any overlap in one room.
- Allow overlap across rooms.
- Allow back-to-back times.
- List bookings by start time, then by creation order.
- Cancel takes a booking id.
  A second cancel of one id reports not found.
- A failed action leaves saved bookings unchanged.
- Two calls for one empty slot create exactly one booking.
  The second call fails.

## The screen

- Inputs with the names
  `Title`, `Room`, `Start time`, `End time`.
- Time inputs accept 24-hour `HH:MM`, such as `09:00`.
- A button named `Book`.
- One row per booking, showing its title, room, and time.
- One `Cancel` button per row,
  named `Cancel <title>` for screen readers.
- Filter buttons named `All`, `Cedar`, `Maple`.
  Filtering hides rows without deleting them.
- Errors show beside the form in a `role="alert"` block.
  The block shows the error kind, such as `Clash`.
- Keep the form values after a failed booking.
- After success, clear the title and show the saved row.
- A cancel removes its row and frees its slot.
- Each mounted app owns its scope, so two roots share nothing.

## Exact exports in `src/index.ts`

```ts
export type Room = "Cedar" | "Maple";
export const rooms: readonly Room[];
export type Booking = {
  readonly id: string;
  readonly title: string;
  readonly room: Room;
  readonly start: number;
  readonly end: number;
};
export type BookInput = {
  readonly title: string;
  readonly room: string;
  readonly start: number;
  readonly end: number;
};
export const bookings: Data.Cell<readonly Booking[]>;
export const bookBooking: Operation.Handle<Booking, BookInput>;
export const cancelBooking: Operation.Handle<void, { id: string }>;
export function BookingApp(): ReactElement;
export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
```

Notes on the shape above:

- `BookInput.room` is a plain string:
  the operation rejects unknown rooms itself.
- `cancelBooking` returns nothing.
- `BookingApp` creates its own scope and needs no props.
- `Data`, `Operation`, and `ReactElement` come from
  `@tinker/core` and `react`.

## Errors in `src/errors.ts`

One registry, as the coding rules demand.
Callers narrow with `isError(error, "Kind")`.

- `BlankTitle` carries `{ title: string }`.
- `UnknownRoom` carries `{ room: string }`.
- `BadTime` carries `{ value: unknown }`.
- `EmptySlot` carries `{ start: number; end: number }`.
- `Clash` carries `{ room: string; start: number; end: number }`.
- `NotFound` carries `{ id: string }`.

## Do not

- Do not add another Tinker package or state library.
- Do not change these names, labels, or error kinds.
- Do not prescribe internals beyond this packet:
  no private function or component names are fixed here.
- Do not store bookings outside core cells.
