# Seat map

Build a local cinema seat map using only core and React from Tinker.
Start from the blank project. Follow GUIDELINES.md.
No network, storage, login, dates, prices, or later tasks are needed.
Customers hold seats, buy what they hold, or release a held seat.

## Public API

Export exactly these names from src/index.ts.
Use the public core types supplied in node_modules.
Operation.Handle has output first, input second.
Every operation works through createScope, scope.run, and scope.resolve.
Input-free calls use scope.run(handle, {}).
The browser entry mounts SeatApp at the root element in index.html.

- Seat is { id: string; row: string; number: number;
  state: "free" | "held" | "sold"; customer: string | null }.
- seats is Data.Cell<readonly Seat[]>.
- ROWS is the readonly list "A", "B", "C", "D", "E".
- holdSeat is Operation.Handle<Seat,
  { row: string; number: string; customer: string }>.
- buySeats is Operation.Handle<readonly Seat[], { customer: string }>.
- releaseSeat is Operation.Handle<Seat, { seatId: string }>.
- undoSeats is Operation.Handle<void, void>.
- SeatApp is a React view function with no props.
- isError and the Errors types come from ./errors.ts.

Keep all other names out of the public entry.
Each scope starts with 40 free seats with no customer: rows A to E,
numbers 1 to 8, in row order then number order. A seat's id is its
row followed by its number, such as "C5".
Each SeatApp owns a fresh scope.
Two apps share no records, form text, filter, or notice.

## Errors

Use one registry in errors.ts, with these kinds and payloads:

- BadRow: { row: unknown }.
- BadNumber: { number: unknown }.
- BlankCustomer: { customer: unknown }.
- NotFound: { id: string }.
- SeatTaken: { id: string; customer: string }.
- SeatSold: { id: string }.
- SeatLimit: { customer: string }.
- NothingHeld: { customer: string }.
- EmptyUndo: {}.

Errors from the app are these managed kinds, not a wrapper error.
If several rules fail, any matching error is allowed.
An unknown seat id reports NotFound with that id.
Payload types are exact; an id that is not text can name no seat.

## Text input

Row: trim it. It must be exactly one of A, B, C, D, or E after
trimming. Anything else, including lower case, blank, or non-text
input, reports BadRow with the original input value.

Number arrives as text, as typed. Trim it. Valid text is one plain
digit from 1 to 8. Anything else reports BadNumber with the original
input value: blank text, signs, decimals, letters, spaces inside, or
non-text. Never replace bad text with a default.

Customer: trim it. Empty or non-text input reports BlankCustomer,
keeping the original input value. Customers match exactly after
trimming.

## Seats

holdSeat holds the seat at that row and number for the customer.
Holding a seat the same customer already holds passes with no change
or undo step, even when that customer is at the limit, and returns
the saved seat. Otherwise a seat held by another customer reports
SeatTaken with the seat id and that other customer, a sold seat
reports SeatSold, and a customer who already holds or bought 4 seats
reports SeatLimit with the trimmed customer.
A passing hold sets state to held and customer to the trimmed name.

buySeats sells every seat the customer holds, in seat order: state
becomes sold, customer stays. It returns those seats as sold. A
customer who holds no seat reports NothingHeld with the trimmed
customer.

releaseSeat frees a held seat: state becomes free and customer null.
Releasing a seat that is already free passes with no change or undo
step, and returns the saved seat. A sold seat reports SeatSold.

Every failed action leaves seats and undo history unchanged.
Do not partly update a record before finding a failed rule.

## Undo

Each passing hold, buy, and release that changes a seat adds one
undo step; one buy is one step however many seats it sells.
Passing actions that change no record add none.
Typing and choosing a filter add none. Failed actions add none.
undoSeats restores the exact seats before the last passing change.
Undo adds no new step. There is no redo.
Empty history reports EmptyUndo with {}.
Undo leaves typed form text and the filter alone.

## Screen

The seat form has labeled text inputs Row, Number, and Customer, and
buttons Hold and Buy. All start empty.
Hold sends the typed row, number, and customer; Buy sends the typed
customer. After a passing Hold, Row and Number clear and Customer
stays; after a passing Buy, all three stay. Failure keeps all three.
Send the typed text as it is; the operations decide.

Show a table named Seats with Seat, State, and Customer columns, one
row per seat in saved order. Seat shows the id. State shows Free,
Held, or Sold. Customer shows the name, or None.
Each held row has a button named Release <id>.
Free and sold rows have no button.

Filter buttons All, Free, Held, and Sold filter only the seat rows.
All shows every seat; each other shows only seats in that state.
All starts selected. Filtering never deletes records.
Changes update the shown rows without another click.

Undo is always available, including when history is empty.
Use one shared role=alert block showing the managed error kind.
An empty or absent alert is allowed when there is no error.
Every passing action clears an earlier error notice, including typing,
filtering, and a passing action that changes no record.

Test public operations and real browser behavior.
Run check, all tests, and build. Ask Jev about changed source and tests.
Fix every finding under gate.blocking before you report done.
Report real commands and results, plus any issue still open.
