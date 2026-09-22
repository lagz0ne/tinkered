# Round 3 — dates and a weekly series

Rounds 1 and 2 still apply in full,
with the changes named below.
This round adds a calendar date and a weekly repeat.

## Terms used here

- **Date** means a calendar day, `YYYY-MM-DD`.
- **Series** means bookings that repeat weekly.
  A series id ties its bookings together.
- **Occurrence** means one booking in a series.

## Dates replace the fixed day

- Every booking gains a `date` field.
- The fixed day 2026-10-01 is now the default date
  in the form, not the only date.
- Old round 1 calls without a `date` still work:
  they book 2026-10-01.
- Old tests still run using their original date.
- New calls pass `date` beside the old fields.
- Reject a date that is not a real `YYYY-MM-DD` day
  with `BadDate`, carrying `{ date: unknown }`.
- Clash checks compare one room on one date only.
  The same slot on two dates never clashes.
- The list sorts by date, then start time,
  then creation order.

## Reads and writes

Booking input now accepts an added date:

```ts
const saved = scope.run(bookBooking, {
  input: { title: "Standup", room: "Cedar", date: "2026-10-02", start: 540, end: 600 },
});
const one = scope.run(cancelBooking, {
  input: { id: saved.id },
});
```

Series booking and series cancel:

```ts
const made = scope.run(bookSeries, {
  input: { title: "Standup", room: "Cedar", date: "2026-10-06", start: 540, end: 600, weeks: 3 },
});
scope.run(cancelSeries, {
  input: { seriesId: made[0].seriesId },
});
```

## Series rules with a small example

Book "Standup" in Cedar at 09:00,
starting 2026-10-06, for 3 weeks.
That books 10-06, 10-13, and 10-20.
If 10-13 is taken, nothing is booked:
the whole series fails and reports `Clash`.
Cancel one 10-13 booking by its id:
only that day frees up.
Cancel the series by its series id:
all three days free up.

The full rules:

- `weeks` is an integer from 1 to 12.
  Anything else reports `BadCount`,
  carrying `{ weeks: unknown }`.
- A series books `weeks` dates, 7 days apart,
  starting from `date`.
- Title, room, date, and time rules match one booking.
- Check every date first.
  If any date fails, book none and report that error.
- All bookings in one series share one `seriesId`.
  One-off bookings have no `seriesId`.
- `cancelSeries` takes `{ seriesId: string }`.
  An unknown id reports `NotFound` with that id.
- Canceling one id removes one occurrence
  and leaves the rest of its series.
- Canceling a series id removes every occurrence.
- A failed series booking leaves saved bookings unchanged.
- Rounds 1 and 2 keep working for one date.

## The screen, in addition to rounds 1 and 2

- Booking and edit forms gain a `Date` input.
  It starts at `2026-10-01`.
- The booking form gains a `Weeks` input, starting at `1`.
- A series form button is named `Book series`.
- A series row shows its date beside title, room, time.
- Each series row keeps its own `Cancel <title>` button.
- Each series row gains a `Cancel series` button.
- Errors keep using the same `role="alert"` block.

## New and changed exports in `src/index.ts`

`Booking` and inputs gain added fields.
Old input shapes stay valid: `date` is added,
`weeks` is added only on the series input.

```ts
export type Booking = {
  readonly id: string;
  readonly title: string;
  readonly room: Room;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly seriesId?: string;
};
export type BookInput = {
  readonly title: string;
  readonly room: string;
  readonly date?: string;
  readonly start: number;
  readonly end: number;
};
export type SeriesInput = {
  readonly title: string;
  readonly room: string;
  readonly date: string;
  readonly start: number;
  readonly end: number;
  readonly weeks: number;
};
export const bookSeries: Operation.Handle<readonly Booking[], SeriesInput>;
export const cancelSeries: Operation.Handle<void, { seriesId: string }>;
```

`EditInput` gains an added optional `date` field too
(defaults to 2026-10-01, like `BookInput`),
and clash checks skip only the booking edited.

## New errors in `src/errors.ts`

- `BadDate` carries `{ date: unknown }`.
- `BadCount` carries `{ weeks: unknown }`.

Round 1 and 2 errors stay as they are.

## Do not

- Do not change earlier names, labels, or error kinds.
- Do not book some dates when one date fails.
- Do not drop the 2026-10-01 default.
