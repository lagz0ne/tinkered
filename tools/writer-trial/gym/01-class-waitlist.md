# Class waitlist

Build a local gym class sign-up using only core and React from Tinker.
Start from the blank project. Follow GUIDELINES.md.
No network, storage, login, dates, prices, or later tasks are needed.
Staff add classes; members join a class, or wait when it is full.

## Public API

Export exactly these names from src/index.ts.
Use the public core types supplied in node_modules.
Operation.Handle has output first, input second.
Every operation works through createScope, scope.run, and scope.resolve.
Input-free calls use scope.run(handle, {}).
The browser entry mounts GymApp at the root element in index.html.

- GymClass is { id: string; name: string; capacity: number }.
- Signup is { classId: string; member: string;
  status: "booked" | "waiting" }.
- classes is Data.Cell<readonly GymClass[]>.
- signups is Data.Cell<readonly Signup[]>.
- addClass is Operation.Handle<GymClass,
  { name: string; capacity: string }>.
- setCapacity is Operation.Handle<GymClass,
  { classId: string; capacity: string }>.
- joinClass is Operation.Handle<Signup,
  { classId: string; member: string }>.
- leaveClass is Operation.Handle<Signup,
  { classId: string; member: string }>.
- undoGym is Operation.Handle<void, void>.
- GymApp is a React view function with no props.
- isError and the Errors types come from ./errors.ts.

Keep all other names out of the public entry.
Each scope starts with no classes and no signups.
Each GymApp owns a fresh scope.
Two apps share no records, form text, filter, or notice.

## Errors

Use one registry in errors.ts, with these kinds and payloads:

- BadName: { name: unknown }.
- DuplicateName: { name: string }.
- BadCapacity: { capacity: unknown }.
- BlankMember: { member: unknown }.
- NotFound: { id: string }.
- NotJoined: { classId: string; member: string }.
- CapacityTooLow: { classId: string; booked: number }.
- EmptyUndo: {}.

Errors from the app are these managed kinds, not a wrapper error.
If several rules fail, any matching error is allowed.
An unknown class id reports NotFound with that id.
Payload types are exact; an id that is not text can name no class.

## Text input

Name: trim it. Empty or non-text input reports BadName, keeping the
original input value. Another class with the same trimmed name
reports DuplicateName with the trimmed name.

Capacity arrives as text, as typed. Trim it. Valid text is a plain
whole number from 1 to 20 with no leading zero. Anything else reports
BadCapacity with the original input value: blank text, signs,
decimals, letters, spaces inside, 0, 21, or non-text. Never replace
bad text with a default.

Member: trim it. Empty or non-text input reports BlankMember, keeping
the original input value. Members match exactly after trimming.

## Classes

addClass adds a class at the end, with the trimmed name and the
capacity as a number. Its id is K followed by the class count after
adding it, such as K3 for the third class.

setCapacity changes a class's capacity. A capacity below the class's
booked count reports CapacityTooLow with the class id and that count.
A larger capacity books waiting members of that class, first come
first served, until the class is full or no one waits.
Setting the same capacity passes with no change or undo step, and
returns the saved class.

## Signups

joinClass adds the trimmed member to the class, at the end of
signups: booked while the class has a free place, waiting when it is
full. A member already in that class, booked or waiting, passes with
no change or undo step, and returns the saved signup. One member may
join several classes.

leaveClass removes the member's signup and returns it as it was.
When a booked member leaves, the class's first waiting member, in
signup order, becomes booked; its place in signups does not move.
A member not in that class reports NotJoined with the class id and
the trimmed member.

Every failed action leaves classes, signups, and undo history
unchanged. Do not partly update a record before finding a failed rule.

## Undo

Each passing add, set, join, and leave that changes a record adds one
undo step; a leave that books a waiting member is one step.
Passing actions that change no record add none.
Typing and choosing a filter add none. Failed actions add none.
undoGym restores the exact classes and signups before the last
passing change. Undo adds no new step. There is no redo.
Empty history reports EmptyUndo with {}.
Undo leaves typed form text, the chosen class, and the filter alone.

## Screen

The class form has labeled text inputs Name and Capacity, and a
button Add class. Both start empty. After a passing Add class, both
clear; failure keeps both.

The member form has a labeled select Class, listing every class name
in saved order, a labeled text input Member, and buttons Join and
Set capacity. Class starts on the first class once one exists. When the chosen
class is gone, Class shows the first class, or nothing when there is
none; with no class, Join and Set capacity send an empty class id.
Member starts empty. Join sends the chosen class and the typed
member; after a passing Join, Member clears. Set capacity sends the
chosen class and the Capacity text from the class form; after a
passing Set capacity, Capacity clears. Failure keeps all text.
Send the typed text as it is; the operations decide.

Show a table named Classes with Class, Capacity, Booked, and Waiting
columns, one row per class in saved order. Booked and Waiting show
how many signups of that class have that status.

Show a table named Signups with Class, Member, and Status columns,
one row per signup in saved order. Class shows the class name.
Status shows Booked, or Waiting followed by the member's place in
that class's queue, such as Waiting 2.
Each row has a button named Remove <member> from <class name>, which
runs leaveClass for that signup.

Filter buttons All, Booked, and Waiting filter only the signup rows.
All starts selected. Filtering never deletes records.
Changes update the shown rows without another click.

Undo is always available, including when history is empty.
Use one shared role=alert block showing the managed error kind.
An empty or absent alert is allowed when there is no error.
Every passing action clears an earlier error notice, including typing,
choosing a class, filtering, and a passing action that changes no
record.

Test public operations and real browser behavior.
Run check, all tests, and build. Ask Jev about changed source and tests.
Fix every finding under gate.blocking before you report done.
Report real commands and results, plus any issue still open.
