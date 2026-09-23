/**
 * Teacher-only team poll. Built from the frozen task and the public
 * core declarations only; never copied into a worker image or context.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation, Scope } from "@tinker/core";
import { fail } from "./errors.ts";

/** One poll with its choices in typed order. */
export type Poll = {
  id: string;
  question: string;
  choices: readonly string[];
  limit: number;
  closed: boolean;
};

/** One voter's vote on one poll. */
export type Vote = { id: string; pollId: string; voter: string; choice: string };

type Ballot = { polls: readonly Poll[]; votes: readonly Vote[] };

/** Saved polls in creation order. */
export const polls: Data.Cell<readonly Poll[]> = data({ label: "polls", initial: [] });

/** Saved votes in creation order. */
export const votes: Data.Cell<readonly Vote[]> = data({ label: "votes", initial: [] });

const history: Data.Cell<readonly Ballot[]> = data({ label: "history", initial: [] });

const issued: Data.Cell<number> = data({ label: "issued", initial: 0 });

const MIN_CHOICES = 2;
const MAX_CHOICES = 6;
const MAX_LIMIT = 50;
const PLAIN_DIGITS = /^[0-9]+$/;

type Cells = {
  polls: Scope.DataController<readonly Poll[]>;
  votes: Scope.DataController<readonly Vote[]>;
  history: Scope.DataController<readonly Ballot[]>;
  issued: Scope.DataController<number>;
};

const ballotCells = {
  polls: polls.controller,
  votes: votes.controller,
  history: history.controller,
  issued: issued.controller,
};

const saveStep = (cells: Cells): void => {
  const step = { polls: cells.polls.get(), votes: cells.votes.get() };
  cells.history.update((steps) => [...steps, step]);
};

const nextId = (cells: Cells, prefix: string): string => {
  const next = cells.issued.get() + 1;
  cells.issued.set(next);
  return `${prefix}-${next}`;
};

function readQuestion(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw fail("BlankQuestion", { question: raw });
  return raw.trim();
}

function readChoices(raw: unknown): readonly string[] {
  if (typeof raw !== "string") throw fail("BadChoices", { choices: raw });
  const parts = raw.split(",").map((part) => part.trim());
  const sized = parts.length >= MIN_CHOICES && parts.length <= MAX_CHOICES;
  const distinct = new Set(parts).size === parts.length;
  if (!sized || parts.includes("") || !distinct) throw fail("BadChoices", { choices: raw });
  return parts;
}

function readLimit(raw: unknown): number {
  if (typeof raw !== "string" || !PLAIN_DIGITS.test(raw.trim()))
    throw fail("BadLimit", { limit: raw });
  const limit = Number(raw.trim());
  if (limit < 1 || limit > MAX_LIMIT) throw fail("BadLimit", { limit: raw });
  return limit;
}

function readVoter(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw fail("BlankVoter", { voter: raw });
  return raw.trim();
}

/** A caller value as text for an error payload; a value that is not text names no record. */
const textOf = (raw: unknown): string => (typeof raw === "string" ? raw : String(raw));

function readChoice(poll: Poll, raw: unknown): string {
  if (typeof raw !== "string")
    throw fail("UnknownChoice", { pollId: poll.id, choice: textOf(raw) });
  const choice = raw.trim();
  if (!poll.choices.includes(choice)) throw fail("UnknownChoice", { pollId: poll.id, choice });
  return choice;
}

const findPoll = (rows: readonly Poll[], id: unknown): Poll => {
  const poll = rows.find((row) => row.id === id);
  if (poll === undefined) throw fail("NotFound", { id: textOf(id) });
  return poll;
};

const replacePoll = (rows: readonly Poll[], changed: Poll): readonly Poll[] =>
  rows.map((row) => (row.id === changed.id ? changed : row));

/** How many votes one poll holds. */
export const voteCount = (rows: readonly Vote[], pollId: string): number =>
  rows.filter((vote) => vote.pollId === pollId).length;

/** Create an open poll from the typed question, choices, and limit. */
export const createPoll: Operation.Handle<
  Poll,
  { question: string; choices: string; limit: string }
> = operation({
  label: "createPoll",
  depends: ballotCells,
  run: (cells, { input }) => {
    const question = readQuestion(input.question);
    const choices = readChoices(input.choices);
    const limit = readLimit(input.limit);
    const saved: Poll = { id: nextId(cells, "poll"), question, choices, limit, closed: false };
    saveStep(cells);
    cells.polls.set([...cells.polls.get(), saved]);
    return saved;
  },
});

/** Change one poll's limit; the limit it already has passes with no change. */
export const setLimit: Operation.Handle<Poll, { pollId: string; limit: string }> = operation({
  label: "setLimit",
  depends: ballotCells,
  run: (cells, { input }) => {
    const limit = readLimit(input.limit);
    const poll = findPoll(cells.polls.get(), input.pollId);
    if (poll.limit === limit) return poll;
    if (poll.closed) throw fail("PollClosed", { id: poll.id });
    const count = voteCount(cells.votes.get(), poll.id);
    if (limit < count) throw fail("BelowVotes", { id: poll.id, votes: count });
    const changed: Poll = { ...poll, limit };
    saveStep(cells);
    cells.polls.set(replacePoll(cells.polls.get(), changed));
    return changed;
  },
});

/** Close a poll with votes; a closed poll passes with no change. */
export const closePoll: Operation.Handle<Poll, { pollId: string }> = operation({
  label: "closePoll",
  depends: ballotCells,
  run: (cells, { input }) => {
    const poll = findPoll(cells.polls.get(), input.pollId);
    if (poll.closed) return poll;
    if (voteCount(cells.votes.get(), poll.id) === 0) throw fail("NoVotes", { id: poll.id });
    const changed: Poll = { ...poll, closed: true };
    saveStep(cells);
    cells.polls.set(replacePoll(cells.polls.get(), changed));
    return changed;
  },
});

/** Cast or change a vote; the choice a voter already holds passes unchanged. */
export const castVote: Operation.Handle<Vote, { pollId: string; voter: string; choice: string }> =
  operation({
    label: "castVote",
    depends: ballotCells,
    run: (cells, { input }) => {
      const voter = readVoter(input.voter);
      const poll = findPoll(cells.polls.get(), input.pollId);
      const choice = readChoice(poll, input.choice);
      const rows = cells.votes.get();
      const held = rows.find((vote) => vote.pollId === poll.id && vote.voter === voter);
      if (held !== undefined && held.choice === choice) return held;
      if (poll.closed) throw fail("PollClosed", { id: poll.id });
      if (held !== undefined) {
        const changed: Vote = { ...held, choice };
        saveStep(cells);
        cells.votes.set(rows.map((vote) => (vote.id === held.id ? changed : vote)));
        return changed;
      }
      if (voteCount(rows, poll.id) >= poll.limit) throw fail("PollFull", { id: poll.id });
      const vote: Vote = { id: nextId(cells, "vote"), pollId: poll.id, voter, choice };
      saveStep(cells);
      cells.votes.set([...rows, vote]);
      return vote;
    },
  });

/** Withdraw one vote from an open poll. */
export const withdrawVote: Operation.Handle<void, { voteId: string }> = operation({
  label: "withdrawVote",
  depends: ballotCells,
  run: (cells, { input }) => {
    const rows = cells.votes.get();
    const vote = rows.find((row) => row.id === input.voteId);
    if (vote === undefined) throw fail("NotFound", { id: textOf(input.voteId) });
    const poll = findPoll(cells.polls.get(), vote.pollId);
    if (poll.closed) throw fail("PollClosed", { id: poll.id });
    saveStep(cells);
    cells.votes.set(rows.filter((row) => row.id !== vote.id));
  },
});

/** Restore the exact polls and votes before the last passing change. */
export const undoPoll: Operation.Handle<void, void> = operation({
  label: "undoPoll",
  depends: { polls: polls.controller, votes: votes.controller, history: history.controller },
  run: (cells) => {
    const steps = cells.history.get();
    const last = steps.at(-1);
    if (last === undefined) throw fail("EmptyUndo", {});
    cells.polls.set(last.polls);
    cells.votes.set(last.votes);
    cells.history.set(steps.slice(0, -1));
  },
});
