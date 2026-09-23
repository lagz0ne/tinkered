# Team poll

Build a local team poll using only core and React from Tinker.
Start from the blank project. Follow GUIDELINES.md.
No network, storage, login, dates, or later tasks are needed.
People vote on polls; each voter holds at most one vote per poll.

## Public API

Export exactly these names from src/index.ts.
Use the public core types supplied in node_modules.
Operation.Handle has output first, input second.
Every operation works through createScope, scope.run, and scope.resolve.
Input-free calls use scope.run(handle, {}).
The browser entry mounts PollApp at the root element in index.html.

- Poll is { id: string; question: string;
  choices: readonly string[]; limit: number; closed: boolean }.
- Vote is { id: string; pollId: string; voter: string; choice: string }.
- polls is Data.Cell<readonly Poll[]>.
- votes is Data.Cell<readonly Vote[]>.
- createPoll is Operation.Handle<Poll,
  { question: string; choices: string; limit: string }>.
- setLimit is Operation.Handle<Poll, { pollId: string; limit: string }>.
- closePoll is Operation.Handle<Poll, { pollId: string }>.
- castVote is Operation.Handle<Vote,
  { pollId: string; voter: string; choice: string }>.
- withdrawVote is Operation.Handle<void, { voteId: string }>.
- undoPoll is Operation.Handle<void, void>.
- PollApp is a React view function with no props.
- isError and the Errors types come from ./errors.ts.

Keep all other names out of the public entry.
Each scope starts with no polls and no votes.
Each PollApp owns a fresh scope.
Two apps share no records, form text, selections, filter, or notice.

## Errors

Use one registry in errors.ts, with these kinds and payloads:

- BlankQuestion: { question: unknown }.
- BadChoices: { choices: unknown }.
- BadLimit: { limit: unknown }.
- BlankVoter: { voter: unknown }.
- NotFound: { id: string }.
- UnknownChoice: { pollId: string; choice: string }.
- PollClosed: { id: string }.
- PollFull: { id: string }.
- NoVotes: { id: string }.
- BelowVotes: { id: string; votes: number }.
- EmptyUndo: {}.

Errors from the app are these managed kinds, not a wrapper error.
If several rules fail, any matching error is allowed.
An unknown poll or vote id reports NotFound with that id.
Payload types are exact; an id that is not text can name no record.

## Text input

Question: trim it. Empty or non-text input reports BlankQuestion,
keeping the original input value.

Choices arrive as one text, comma separated. Split on commas and
trim each part. Valid text gives 2 to 6 parts, each nonempty,
with no two parts equal. Anything else, or non-text input,
reports BadChoices with the original input value.

Limit arrives as text, as typed. Trim it. Valid text is a whole
number from 1 to 50 in plain digits. Anything else reports BadLimit
with the original input value: blank text, signs, decimals, letters,
spaces inside, or non-text. Never replace bad text with a default.

Voter: trim it. Empty or non-text input reports BlankVoter,
keeping the original input value. Voter names match exactly
after trimming.

## Polls

createPoll appends an open poll in creation order with a nonempty,
scope-unique opaque id, the trimmed question, the parsed choices in
typed order, and the parsed limit. Return the saved poll.
Duplicate questions are allowed; ids distinguish polls.
Never reuse any id issued in that scope, including after undo.

setLimit changes only that poll's limit.
Bad limit text reports BadLimit first.
Setting the limit the poll already has passes with no change or undo
step, even when the poll is closed, and returns the saved poll.
Otherwise a closed poll reports PollClosed, and a limit below the
poll's vote count reports BelowVotes with its id and that count.

closePoll marks a poll closed.
Closing an already closed poll passes with no change or undo step,
and returns the saved poll.
Otherwise a poll with no votes reports NoVotes.

## Votes

A choice must be one of the poll's choices, matched exactly after
trimming; otherwise report UnknownChoice with the poll id and the
trimmed choice.

Casting the same choice a voter already holds on that poll passes with
no change or undo step, and returns that existing vote. This holds
even when the poll is closed or full.

Otherwise:

- a closed poll reports PollClosed;
- a voter who holds a vote on that poll with another choice gets
  that vote's choice changed in place, keeping its id and position;
- a new voter on a poll whose vote count equals its limit
  reports PollFull.

A passing new vote appends a vote in creation order with a new opaque
id. Return the saved or changed vote.
withdrawVote removes that vote. An unknown vote id reports NotFound.
A vote on a closed poll reports PollClosed.

Every failed action leaves polls, votes, and undo history unchanged.
Do not partly update a record before finding a failed rule.

## Undo

Each passing create, changed limit, close, new or changed vote,
and withdraw adds one undo step.
Passing actions that change no record add none.
Typing, choosing a filter, and choosing a poll or choice add none.
Failed actions add none.
undoPoll restores the exact polls and votes before the last passing
change, in their order. Undo adds no new step. There is no redo.
Empty history reports EmptyUndo with {}.
Undo leaves typed form text, selections, and filters alone.

## Screen

The new-poll form has labeled text inputs Question, Choices, and
Limit, and a button Create poll. All start empty.
Success clears all three; failure keeps their text.
Send the typed text as it is; the operations decide.

Show a table named Polls with Question, Votes, Leader, and Status
columns, in saved poll order.
Votes is the poll's vote count.
Leader is the choice with the most votes; a tie goes to the earlier
choice in the poll's choice order; None when there are no votes.
Status is Closed when closed, Full when open with a vote count equal
to its limit, and Open otherwise.
Each poll that is not closed has a button named Close <question>.
Keep it enabled so a blocked close shows the managed error.

The vote form has a labeled select Poll, a labeled text input Voter,
a labeled select Choice, and a button Vote.
Poll lists every saved poll in creation order, showing its question
and using its id as the option value; its empty option has the text
Choose poll. Choice lists the chosen poll's choices in order; its
empty option has the text Choose choice.
Both selects start empty. Choosing a different poll resets Choice
to empty. Keep the poll, voter text, and choice after success,
failure, and undo. When undo removes the chosen poll, keep its id
selected as an option labeled Removed poll, with no choices, until
the user chooses another poll; a vote then reports NotFound.

Show a table named Votes with Poll, Voter, and Choice columns,
in saved vote order. Poll shows the poll's question.
Each row has a button named Withdraw <voter> from <question>.

Filter buttons All, Open, and Closed filter only the poll rows.
All shows every poll. Open shows every poll that is not closed,
including Full polls. Closed shows only closed polls.
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
