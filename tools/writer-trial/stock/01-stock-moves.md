# Stock moves

Build a small local stock desk using only core and React from Tinker.
Start from the blank project. Follow GUIDELINES.md.
No network, storage, login, dates, or later tasks are needed.

## Public API

Export these names from src/index.ts.
Use the public core types supplied in node_modules.
Operation.Handle has output first, input second.
Every operation works through createScope, scope.run, and scope.resolve.
Input-free calls use scope.run(handle, {}).
The browser entry mounts StockApp at the root element in index.html.

- Item is the string union Cable or Stand.
- Place is the string union East or West.
- items is readonly Item[], in Cable, Stand order.
- places is readonly Place[], in East, West order.
- Stock is { item: Item; place: Place; quantity: number }.
- Move is { id: string; item: Item; from: Place;
  to: Place; quantity: number }.
- MoveInput is { item: string; from: string;
  to: string; quantity: number }.
- EditMoveInput is MoveInput plus { id: string }.
- stock is Data.Cell<readonly Stock[]>.
- moves is Data.Cell<readonly Move[]>.
- editDraft is Data.Cell<Move | undefined>.
- moveStock is Operation.Handle<Move, MoveInput>.
- openMoveEdit is Operation.Handle<Move, { id: string }>.
- saveMoveEdit is Operation.Handle<Move, EditMoveInput>.
- discardMoveEdit is Operation.Handle<void, { id: string }>.
- undoMove is Operation.Handle<void, void>.
- StockApp is a React view function with no props.
- isError and the Errors types come from ./errors.ts.

Keep all other names out of the public entry.
Each scope starts with no moves and no open draft.
Its stock has four rows, always in this order:

- Cable, East, quantity 8.
- Cable, West, quantity 2.
- Stand, East, quantity 3.
- Stand, West, quantity 1.

Each StockApp owns a fresh scope.
Two apps on one page share no stock, moves, drafts, notices, or form text.

## Errors

Use one registry in errors.ts, with these kinds and payloads:

- UnknownItem: { item: unknown }.
- UnknownPlace: { place: unknown }.
- SamePlace: { place: string }.
- BadQuantity: { quantity: unknown }.
- ShortStock: { item: Item; place: Place;
  available: number; requested: number }.
- NotFound: { id: string }.
- EmptyUndo: {}.

Invalid values keep their original value in the error payload.
Do not trim or change item or place names.
A quantity must be a positive safe integer.
Strings, zero, fractions, NaN, and infinity are invalid API quantities.
If several fields are invalid, either matching field error is allowed.
Errors from the app are these managed kinds, not a wrapper error.

## Move stock

A move needs a known item and two known, different places.
If from and to match, report SamePlace with that place.
The source must have enough stock; otherwise report ShortStock.
A passing move subtracts from the source and adds to the target.
It appends one Move with a nonempty, scope-unique opaque id.
No other stock row changes. Stock never becomes negative.
Moves stay in creation order, even after an edit.
The return value equals the saved move.
A failed move changes no stock, moves, draft, or undo history.

## Edit a saved move

openMoveEdit copies the named saved move into editDraft and returns it.
Unknown ids report NotFound. Opening adds no undo step.
Opening a second move drops the first draft and its unsaved screen text.
Changes typed into the editor do not change saved moves or stock.

saveMoveEdit requires a draft open for the given id and that saved id to exist.
Otherwise report NotFound with that id.
It replaces that move while keeping its id and place in the list.
Its fields follow the same item, place, and quantity rules as a new move.

To replace it, first try to reverse the old move against current stock,
then try the replacement against that restored stock.
Check both steps before writing anything.
The reversal needs the old target to hold at least the old quantity.
If it does not, report ShortStock for the old target and old quantity.
This reversal rule applies even when some fields are unchanged.
The replacement may use a different item or direction.
If either step fails, leave stock, moves, draft, and undo history unchanged.
Keep the editor open with its typed values.
On success, save both stock and the replaced move, then close the draft.
Return the replaced move. The whole save adds one undo step.

For example, move 3 Cables from East to West, then edit that move to 5.
Cable stock becomes East 3 and West 7; there is still one move.

For a reversal failure, move 3 Cables East to West,
then move 4 Cables West to East.
West now has 1. Saving an edit of the first move reports
ShortStock { item: Cable, place: West, available: 1, requested: 3 }.
Nothing is changed by that failed save.

These are behavior examples only. No implementation is supplied.

Discard closes the draft without changing stock, moves, or undo history.
Discard for a closed or different draft reports NotFound with that id.

## Undo

Each passing move or edit save adds exactly one undo step.
Opening, typing, filtering, discarding, and failed actions add none.
undoMove restores the exact stock and move list before the last passing change.
It adds no new step. There is no redo.
Empty history reports EmptyUndo with {}.
Undo leaves draft state, typed form text, and filters alone.
If undo removes a drafted move, a later save reports NotFound.
New moves after undo must not reuse any id already issued in that scope.

## Screen

Use real labeled text inputs so invalid values can be tested.
The new-move form has Item, From, To, Quantity, and Move stock.
Initial text is Cable, East, West, and 1.
Parse number text at the input boundary.
A cleared or unreadable Quantity reports BadQuantity with that text.
After a passing move, keep form values. After failure, also keep them.

Show stock in a table named Stock with Item, Place, Quantity columns.
Show moves in a table named Moves with Item, From, To, Quantity columns.
Each move row has one Edit move button.
Rows appear in saved-list order and show the saved values.

The single editor has Edit item, Edit from, Edit to, Edit quantity,
Save move, and Discard move.
Opening seeds these inputs from the clicked row.
Switching rows must replace all input text.

The All, Cable, and Stand buttons filter only the move rows.
Filtering must not delete moves or change stock.
Undo is always available, including when history is empty.
There is one shared role=alert block showing the managed error kind.
A passing action clears an earlier error notice.

Test the public operations and the real browser behavior.
Run check, all tests, and build. Ask Jev about changed source and tests.
Report real commands and results, plus any issue still open.
