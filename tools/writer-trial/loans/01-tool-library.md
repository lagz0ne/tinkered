# Tool library

Build a local tool library using only core and React from Tinker.
Start from the blank project. Follow GUIDELINES.md.
No network, storage, login, dates, or later tasks are needed.
Members borrow tools; each tool has a number of copies.

## Public API

Export exactly these names from src/index.ts.
Use the public core types supplied in node_modules.
Operation.Handle has output first, input second.
Every operation works through createScope, scope.run, and scope.resolve.
Input-free calls use scope.run(handle, {}).
The browser entry mounts LibraryApp at the root element in index.html.

- Tool is { id: string; name: string; copies: number;
  retired: boolean }.
- Loan is { id: string; toolId: string; member: string }.
- tools is Data.Cell<readonly Tool[]>.
- loans is Data.Cell<readonly Loan[]>.
- addTool is Operation.Handle<Tool, { name: string; copies: string }>.
- setCopies is Operation.Handle<Tool, { toolId: string; copies: string }>.
- retireTool is Operation.Handle<Tool, { toolId: string }>.
- lendTool is Operation.Handle<Loan, { toolId: string; member: string }>.
- returnLoan is Operation.Handle<void, { loanId: string }>.
- undoLibrary is Operation.Handle<void, void>.
- LibraryApp is a React view function with no props.
- isError and the Errors types come from ./errors.ts.

Keep all other names out of the public entry.
Each scope starts with no tools and no loans.
Each LibraryApp owns a fresh scope.
Two apps share no records, form text, selections, filter, or notice.

## Errors

Use one registry in errors.ts, with these kinds and payloads:

- BlankName: { name: unknown }.
- BadCopies: { copies: unknown }.
- BlankMember: { member: unknown }.
- NotFound: { id: string }.
- Retired: { id: string }.
- NoCopyLeft: { id: string }.
- MemberLimit: { member: string }.
- OnLoan: { id: string; loanIds: readonly string[] }.
- BelowLoans: { id: string; onLoan: number }.
- EmptyUndo: {}.

Errors from the app are these managed kinds, not a wrapper error.
If several rules fail, any matching error is allowed.
An unknown tool or loan id reports NotFound with that id.

## Copies text

Copies arrive as text, as typed.
Trim it. Valid text is a whole number from 1 to 20 in plain digits.
Anything else reports BadCopies with the original input value:
blank text, signs, decimals, letters, spaces inside, or non-text.
Never replace bad copies text with a default.

## Add and change tools

Trim the name. Empty or non-text input reports BlankName,
keeping the original input value.
Duplicate names are allowed; ids distinguish tools.
Create a tool that is not retired, with the parsed copies.
Append it in creation order with a nonempty, scope-unique opaque id.
Return the saved tool. Its name is the trimmed text.
Never reuse any id issued in that scope, including after undo.

setCopies changes only that tool's copies.
A retired tool reports Retired with its id.
Copies below the number of its open loans report BelowLoans
with its id and that loan count.
Setting the value the tool already has passes with no change
or undo step, even when the tool is retired, and returns the saved tool.
Bad copies text still reports BadCopies first.

retireTool marks a tool retired.
Retiring an already retired tool passes with no change or undo step,
even while it has open loans, and returns the saved tool.
Otherwise a tool with open loans reports OnLoan with its id and
those loan ids in saved loan order.
Retired tools stay in the list and are never lent again.

## Lend and return

Trim the member name. Empty or non-text input reports BlankMember,
keeping the original input value.
Member names match exactly after trimming.

Lending a tool the same member already holds passes with no change
or undo step, and returns that member's existing loan for it.
This holds even when no copy is left, the tool is retired,
or the member is at the limit.

Otherwise:

- a retired tool reports Retired with its id;
- a tool whose open loans equal its copies reports NoCopyLeft;
- a member who already holds 3 loans reports MemberLimit
  with the trimmed member name.

A passing lend appends a loan in creation order with a new opaque id
and returns it.
returnLoan removes that loan. An unknown loan id reports NotFound.
Tools and loans never change order except by these rules.

Every failed action leaves tools, loans, and undo history unchanged.
Do not partly update a record before finding a failed rule.

## Undo

Each passing add, changed copies, retire, lend, or return adds one
undo step. Passing actions that change no record add none.
Typing, choosing a filter, and choosing a tool add none.
Failed actions add none.
undoLibrary restores the exact tools and loans before the last
passing change, in their order. Undo adds no new step. No redo.
Empty history reports EmptyUndo with {}.
Undo leaves typed form text, selections, and filters alone.

## Screen

The new-tool form has labeled text inputs Name and Copies,
and a button Add tool. Both start empty.
Success clears both inputs; failure keeps their text.
Send the typed copies text as it is; the operation decides.

Show a table named Tools with Name, Copies, Out, and Status columns.
Rows stay in saved tool list order.
Out is the number of open loans. Status is Retired, Out when no copy
is left, and Available otherwise.
Each row that is not retired has a button named Retire <name>.
Keep it enabled so a blocked retire shows the managed error.

The lend form has a labeled select Tool, a labeled text input Member,
and a button Lend. The select lists every saved tool in creation
order, showing its name and using its id as the option value.
It starts empty; an empty option has the text Choose tool.
Keep the selected id and the member text after success and failure.

Show a table named Loans with Tool and Member columns, in saved loan
order. Each row has a button named Return <tool name> from <member>.

All, Available, and Retired buttons filter only the tool rows.
All starts selected. Filtering never deletes records.
Changes update the shown rows without another click.

Undo is always available, including when history is empty.
Use one shared role=alert block showing the managed error kind.
An empty or absent alert is allowed when there is no error.
Every passing action clears an earlier error notice, including typing,
selecting, filtering, and a passing action that changes no record.

Test public operations and real browser behavior.
Run check, all tests, and build. Ask Jev about changed source and tests.
Fix every finding under gate.blocking before you report done.
Report real commands and results, plus any issue still open.
