# Parcel locker

Build a local parcel locker desk using only core and React from Tinker.
Start from the blank project. Follow GUIDELINES.md.
No network, storage, login, dates, or later tasks are needed.
The desk receives parcels, stores them in lockers, and hands them out.

## Public API

Export exactly these names from src/index.ts.
Use the public core types supplied in node_modules.
Operation.Handle has output first, input second.
Every operation works through createScope, scope.run, and scope.resolve.
Input-free calls use scope.run(handle, {}).
The browser entry mounts LockerApp at the root element in index.html.

- Size is "S" | "M" | "L". S is smallest, L is largest.
- Parcel is { id: string; recipient: string; size: Size;
  locker: number | null; state: "held" | "stored" | "collected" }.
- parcels is Data.Cell<readonly Parcel[]>.
- LOCKERS is the readonly list of six lockers
  { number: 1..6; size: Size }: 1 and 2 are S, 3 and 4 are M,
  5 and 6 are L, in number order.
- receiveParcel is Operation.Handle<Parcel,
  { recipient: string; size: string }>.
- storeParcel is Operation.Handle<Parcel,
  { parcelId: string; locker: string }>.
- collectParcel is Operation.Handle<Parcel, { parcelId: string }>.
- returnToDesk has the same handle type as collectParcel.
- undoDesk is Operation.Handle<void, void>.
- LockerApp is a React view function with no props.
- isError and the Errors types come from ./errors.ts.

Keep all other names out of the public entry.
Each scope starts with no parcels.
Each LockerApp owns a fresh scope.
Two apps share no records, form text, selections, filter, or notice.

## Errors

Use one registry in errors.ts, with these kinds and payloads:

- BlankRecipient: { recipient: unknown }.
- BadSize: { size: unknown }.
- BadLocker: { locker: unknown }.
- NotFound: { id: string }.
- TooManyParcels: { recipient: string }.
- AlreadyStored: { id: string; locker: number }.
- Collected: { id: string }.
- LockerBusy: { locker: number }.
- TooSmall: { locker: number; size: Size }.
- NotStored: { id: string }.
- EmptyUndo: {}.

Errors from the app are these managed kinds, not a wrapper error.
If several rules fail, any matching error is allowed.
An unknown parcel id reports NotFound with that id.
Payload types are exact; an id that is not text can name no record.

## Text input

Recipient: trim it. Empty or non-text input reports BlankRecipient,
keeping the original input value. Recipients match exactly after
trimming.

Size: trim it. It must be exactly S, M, or L after trimming.
Anything else, including lower case, blank, or non-text input,
reports BadSize with the original input value.

Locker arrives as text, as typed. Trim it. Valid text is one plain
digit from 1 to 6. Anything else reports BadLocker with the original
input value: blank text, signs, decimals, letters, spaces inside,
or non-text. Never replace bad text with a default.

## Parcels

receiveParcel appends a held parcel with no locker, in creation
order, with a nonempty, scope-unique opaque id. Return it.
A recipient who already has 3 parcels that are not collected
reports TooManyParcels with the trimmed recipient.
Never reuse any id issued in that scope, including after undo.

storeParcel puts a held parcel in a locker.
Bad locker text reports BadLocker first.
Storing a parcel in the locker it is already in passes with no
change or undo step, and returns the saved parcel.
Otherwise a stored parcel reports AlreadyStored with its id and its
locker, and a collected parcel reports Collected.
A locker that holds another parcel reports LockerBusy.
A locker smaller than the parcel reports TooSmall with the locker
number and the parcel size.
A passing store sets state to stored and locker to that number.

collectParcel hands a stored parcel to its recipient: state becomes
collected and locker becomes null. Collecting a parcel that is
already collected passes with no change or undo step, and returns
the saved parcel. A held parcel reports NotStored.

returnToDesk moves a stored parcel back to held with no locker.
Returning a parcel that is already held passes with no change or undo
step, and returns the saved parcel. A collected parcel reports
Collected.

Every failed action leaves parcels and undo history unchanged.
Do not partly update a record before finding a failed rule.

## Undo

Each passing receive, store, collect, and return adds one undo step.
Passing actions that change no record add none.
Typing, choosing a parcel, and choosing a filter add none.
Failed actions add none.
undoDesk restores the exact parcels, in order, before the last
passing change. Undo adds no new step. There is no redo.
Empty history reports EmptyUndo with {}.
Undo leaves typed form text, the chosen parcel, and the filter alone.

## Screen

The receive form has labeled text inputs Recipient and Size, and a
button Receive. Both start empty.
Success clears both; failure keeps their text.

The store form has a labeled select Parcel, a labeled text input
Locker, and a button Store. Parcel lists every held parcel in creation
order, showing its recipient and size as <recipient> (<size>) and
using its id as the option value; its empty option has the text
Choose parcel and value empty string. Parcel and Locker start empty.
After a passing store, Parcel returns to empty and Locker clears;
failure keeps both. When the chosen parcel stops being held for any
other reason, including undo, keep its id chosen as an option labeled
Unavailable parcel until the user chooses another; Store then reports
the matching error for that id.
Send the typed text as it is; the operations decide.

Show a table named Parcels with Recipient, Size, Locker, and State
columns, in saved parcel order. Locker shows the number, or None
when the parcel has no locker. State shows Held, Stored, or
Collected. Each stored row has buttons named
Collect <recipient> from locker <number> and
Return <recipient> from locker <number>.
Held and collected rows have no button.

Filter buttons All, Held, Stored, and Collected filter only the
parcel rows. All shows every parcel; each other shows only parcels
in that state. All starts selected. Filtering never deletes records.
Changes update the shown rows and the Parcel options without
another click.

Undo is always available, including when history is empty.
Use one shared role=alert block showing the managed error kind.
An empty or absent alert is allowed when there is no error.
Every passing action clears an earlier error notice, including typing,
choosing a parcel, filtering, and a passing action that changes no
record.

Test public operations and real browser behavior.
Run check, all tests, and build. Ask Jev about changed source and tests.
Fix every finding under gate.blocking before you report done.
Report real commands and results, plus any issue still open.
