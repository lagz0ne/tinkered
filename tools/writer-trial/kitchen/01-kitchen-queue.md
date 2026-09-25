# Kitchen queue

Build a local kitchen ticket queue using only core and React from Tinker.
Start from the blank project. Follow GUIDELINES.md.
No network, storage, login, dates, or later tasks are needed.
Tables order dishes; tickets wait, cook on a small stove, then serve.

## Public API

Export exactly these names from src/index.ts.
Use the public core types supplied in node_modules.
Operation.Handle has output first, input second.
Every operation works through createScope, scope.run, and scope.resolve.
Input-free calls use scope.run(handle, {}).
The browser entry mounts KitchenApp at the root element in index.html.

- Ticket is { id: string; table: number; dish: string; qty: number;
  state: "waiting" | "cooking" | "served" }.
- tickets is Data.Cell<readonly Ticket[]>.
- stove is Data.Cell<number>. It starts at 3.
- MENU is the readonly list "Soup", "Salad", "Pasta", "Steak", "Cake",
  in that order.
- addTicket is Operation.Handle<Ticket,
  { table: string; dish: string; qty: string }>.
- startCooking is Operation.Handle<Ticket, { ticketId: string }>.
- serveTicket has the same handle type as startCooking.
- cancelTicket is Operation.Handle<void, { ticketId: string }>.
- setStove is Operation.Handle<number, { size: string }>.
- undoKitchen is Operation.Handle<void, void>.
- KitchenApp is a React view function with no props.
- isError and the Errors types come from ./errors.ts.

Keep all other names out of the public entry.
Each scope starts with no tickets and a stove of 3.
Each KitchenApp owns a fresh scope.
Two apps share no records, form text, selections, filter, or notice.

## Errors

Use one registry in errors.ts, with these kinds and payloads:

- BadTable: { table: unknown }.
- UnknownDish: { dish: unknown }.
- BadQty: { qty: unknown }.
- BadSize: { size: unknown }.
- NotFound: { id: string }.
- TooMany: { id: string; qty: number }.
- StoveFull: { size: number }.
- NotCooking: { id: string }.
- AlreadyServed: { id: string }.
- CannotCancel: { id: string }.
- BelowCooking: { size: number; cooking: number }.
- EmptyUndo: {}.

Errors from the app are these managed kinds, not a wrapper error.
If several rules fail, any matching error is allowed.
An unknown ticket id reports NotFound with that id.
Payload types are exact; an id that is not text can name no record.

## Text input

Table, qty, and size arrive as text, as typed. Trim each.
Valid text is plain digits for a whole number in range:
table 1 to 40, qty 1 to 9, size 1 to 5.
Anything else reports BadTable, BadQty, or BadSize with the original
input value: blank text, signs, decimals, letters, spaces inside,
or non-text. Never replace bad text with a default.

Dish: trim it. It must equal one MENU name exactly after trimming.
Anything else, including blank or non-text input, reports UnknownDish
with the original input value.

## Tickets

addTicket merges into a waiting ticket for the same table and dish,
if one exists: that ticket's qty grows by the new qty, keeping its id
and position. A merged qty above 9 reports TooMany with that ticket's
id and the total it would have. Otherwise addTicket appends a waiting
ticket in creation order with a nonempty, scope-unique opaque id.
Cooking and served tickets never merge. Return the saved ticket.
Never reuse any id issued in that scope, including after undo.

startCooking moves a waiting ticket to cooking.
Starting a ticket that is already cooking passes with no change or
undo step, even when the stove is full, and returns the saved ticket.
Otherwise a served ticket reports AlreadyServed, and a waiting ticket
reports StoveFull with the stove size when the number of cooking
tickets equals the stove size.

serveTicket moves a cooking ticket to served.
Serving a ticket that is already served passes with no change or undo
step, and returns the saved ticket. A waiting ticket reports NotCooking.

cancelTicket removes a waiting ticket. A cooking or served ticket
reports CannotCancel.

setStove changes the stove size. Bad size text reports BadSize first.
Setting the size the stove already has passes with no change or undo
step, and returns that size. A size below the number of cooking
tickets reports BelowCooking with that size and the cooking count.
Return the saved size.

Every failed action leaves tickets, stove, and undo history unchanged.
Do not partly update a record before finding a failed rule.

## Undo

Each passing add or merge, start, serve, cancel, and changed stove
size adds one undo step. Passing actions that change no record add
none. Typing, choosing a dish, and choosing a filter add none.
Failed actions add none.
undoKitchen restores the exact tickets, in order, and the stove size
before the last passing change. Undo adds no new step. No redo.
Empty history reports EmptyUndo with {}.
Undo leaves typed form text, the chosen dish, and the filter alone.

## Screen

The new-ticket form has a labeled text input Table, a labeled select
Dish, a labeled text input Qty, and a button Add ticket.
Dish lists the MENU names in order, each name as its own option
value; its empty option has the text Choose dish and value empty string. All start empty.
Success clears Table and Qty and keeps Dish; failure keeps all three.
Send the typed text as it is; the operations decide.

The stove form has a labeled text input Stove size and a button
Set stove. It starts empty. Success clears it; failure keeps its text.
Show the text Stove: <size> with the saved stove size.

Show a table named Tickets with Table, Dish, Qty, and State columns,
in saved ticket order. State shows Waiting, Cooking, or Served.
Each waiting row has buttons named Cook <dish> for table <table> and
Cancel <dish> for table <table>. Each cooking row has a button named
Serve <dish> for table <table>. Served rows have no button.
Keep buttons enabled so a blocked action shows the managed error.

Filter buttons All, Waiting, Cooking, and Served filter only the
ticket rows. All shows every ticket; each other shows only tickets in
that state. All starts selected. Filtering never deletes records.
Changes update the shown rows and stove text without another click.

Undo is always available, including when history is empty.
Use one shared role=alert block showing the managed error kind.
An empty or absent alert is allowed when there is no error.
Every passing action clears an earlier error notice, including typing,
choosing a dish, filtering, and a passing action that changes no record.

Test public operations and real browser behavior.
Run check, all tests, and build. Ask Jev about changed source and tests.
Fix every finding under gate.blocking before you report done.
Report real commands and results, plus any issue still open.
