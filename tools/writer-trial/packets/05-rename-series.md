# Fresh task — rename a series

Keep all four earlier rounds and the learning rules working.
Add a way to rename every remaining booking in one series.
You decide the code structure. No worked solution is supplied.

## Core behavior

Add renameSeries to src/index.ts.
Its handle type is:

```ts
Operation.Handle<readonly Booking[], { seriesId: string; title: string }>;
```

- Trim the new title. Reject a blank title with BlankTitle,
  carrying the original title text.
- An unknown series reports NotFound, with id set to seriesId.
- Rename all remaining occurrences of that series, and only those.
- Keep their ids, series ids, dates, rooms, times, and order.
- Return the renamed bookings in their saved list order.
- A failed action changes no booking and adds no undo step.
- A passing rename adds exactly one undo step for the whole series.
- Undo restores the exact list from before the rename.
- Leave an open booking draft alone, even when it belongs to the series.
- Scopes remain separate.

## Screen behavior

Each series row gains a button with the accessible name
Rename series <booking title>.

Clicking it opens one series-title editor:

- An input named Series title, starting with the clicked row's title.
- A button named Save series title.
- A button named Discard series title.

Saving runs the new operation.
Success closes the editor and shows the renamed rows.
Failure keeps the editor and its text; show the error kind
in the same alert area used for other actions.
Discard closes the editor and changes no booking or undo history.
Opening another series drops the first unsaved title.
Form text, chosen series, and notices live in core cells.
Views read state and run actions with useRun.

Add tests for the new behavior and keep earlier tests passing.
