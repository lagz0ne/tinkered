import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { castVote, closePoll, createPoll, undoPoll, voteCount, withdrawVote } from "./model.ts";
import type { Poll, Vote } from "./model.ts";
import { errorKind } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The new-poll form text, exactly as typed. */
export type PollDraft = { question: string; choices: string; limit: string };

/** The vote form: the chosen poll id, the voter text as typed, and the chosen choice. */
export type VoteDraft = { pollId: string; voter: string; choice: string };

/** Which poll rows the Polls table shows. Filtering never deletes. */
export type PollFilter = "All" | "Open" | "Closed";

/** How one poll reads on screen. */
export type PollStatus = "Open" | "Full" | "Closed";

/** One Polls table row. */
export type PollRow = {
  id: string;
  question: string;
  votes: number;
  leader: string;
  status: PollStatus;
};

/** One Votes table row. */
export type VoteRow = { id: string; question: string; voter: string; choice: string };

/** One Poll select option. */
export type PollOption = { id: string; label: string };

const emptyPoll: PollDraft = { question: "", choices: "", limit: "" };

export const pollDraft: Data.Cell<PollDraft> = data({ label: "pollDraft", initial: emptyPoll });

export const voteDraft: Data.Cell<VoteDraft> = data({
  label: "voteDraft",
  initial: { pollId: "", voter: "", choice: "" },
});

export const pollFilter: Data.Cell<PollFilter> = data({ label: "pollFilter", initial: "All" });

export const notice: Data.Cell<Name | undefined> = data({ label: "notice", initial: undefined });

const statusOf = (poll: Poll, count: number): PollStatus => {
  if (poll.closed) return "Closed";
  return count >= poll.limit ? "Full" : "Open";
};

/** The choice with the most votes; a tie goes to the earlier choice; None with no votes. */
const leaderOf = (poll: Poll, cast: readonly Vote[]): string => {
  const tally = poll.choices.map((choice) => ({
    choice,
    count: cast.filter((vote) => vote.pollId === poll.id && vote.choice === choice).length,
  }));
  const best = tally.reduce((top, each) => (each.count > top.count ? each : top), {
    choice: "None",
    count: 0,
  });
  return best.choice;
};

const shownBy = (filter: PollFilter, status: PollStatus): boolean => {
  if (filter === "All") return true;
  return filter === "Closed" ? status === "Closed" : status !== "Closed";
};

/** Polls table rows for one filter, in saved poll order. */
export const pollRows = (
  saved: readonly Poll[],
  cast: readonly Vote[],
  filter: PollFilter,
): readonly PollRow[] =>
  saved
    .map((poll) => {
      const count = voteCount(cast, poll.id);
      return {
        id: poll.id,
        question: poll.question,
        votes: count,
        leader: leaderOf(poll, cast),
        status: statusOf(poll, count),
      };
    })
    .filter((row) => shownBy(filter, row.status));

/** Votes table rows in saved vote order. */
export const voteRows = (saved: readonly Poll[], cast: readonly Vote[]): readonly VoteRow[] =>
  cast.flatMap((vote) =>
    saved
      .filter((poll) => poll.id === vote.pollId)
      .map((poll) => ({
        id: vote.id,
        question: poll.question,
        voter: vote.voter,
        choice: vote.choice,
      })),
  );

/** Poll select options; a chosen poll that undo removed stays as Removed poll. */
export const pollOptions = (saved: readonly Poll[], chosenId: string): readonly PollOption[] => {
  const options = saved.map((poll) => ({ id: poll.id, label: poll.question }));
  const removed = chosenId !== "" && !saved.some((poll) => poll.id === chosenId);
  return removed ? [...options, { id: chosenId, label: "Removed poll" }] : options;
};

/** The chosen poll's choices in order; none for no poll or a removed one. */
export const choiceOptions = (saved: readonly Poll[], chosenId: string): readonly string[] =>
  saved.filter((poll) => poll.id === chosenId).flatMap((poll) => poll.choices);

const kindOf = (error: unknown): Name => {
  const kind = errorKind(error);
  if (kind === undefined) throw error;
  return kind;
};

/** Type into the Question input. Clears any earlier notice. */
export const typeQuestion: Operation.Handle<void, { value: string }> = operation({
  label: "typeQuestion",
  depends: { draft: pollDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, question: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Choices input. Clears any earlier notice. */
export const typeChoices: Operation.Handle<void, { value: string }> = operation({
  label: "typeChoices",
  depends: { draft: pollDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, choices: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Limit input. Clears any earlier notice. */
export const typeLimit: Operation.Handle<void, { value: string }> = operation({
  label: "typeLimit",
  depends: { draft: pollDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, limit: input.value }));
    shown.set(undefined);
  },
});

/** Choose a poll in the vote form; a different poll resets Choice. Clears any earlier notice. */
export const choosePoll: Operation.Handle<void, { pollId: string }> = operation({
  label: "choosePoll",
  depends: { draft: voteDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((vote) =>
      vote.pollId === input.pollId ? vote : { ...vote, pollId: input.pollId, choice: "" },
    );
    shown.set(undefined);
  },
});

/** Type into the Voter input. Clears any earlier notice. */
export const typeVoter: Operation.Handle<void, { value: string }> = operation({
  label: "typeVoter",
  depends: { draft: voteDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((vote) => ({ ...vote, voter: input.value }));
    shown.set(undefined);
  },
});

/** Choose a choice in the vote form. Clears any earlier notice. */
export const chooseChoice: Operation.Handle<void, { choice: string }> = operation({
  label: "chooseChoice",
  depends: { draft: voteDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((vote) => ({ ...vote, choice: input.choice }));
    shown.set(undefined);
  },
});

/** Show All, Open, or Closed poll rows. Clears any earlier notice. */
export const chooseFilter: Operation.Handle<void, PollFilter> = operation({
  label: "chooseFilter",
  depends: { filter: pollFilter.controller, shown: notice.controller },
  run: ({ filter, shown }, { input }) => {
    filter.set(input);
    shown.set(undefined);
  },
});

/** Create the typed poll. Success clears all three inputs; failure keeps them and shows the kind. */
export const submitPoll: Operation.Handle<void, void> = operation({
  label: "submitPoll",
  depends: { draft: pollDraft.controller, shown: notice.controller, create: createPoll.controller },
  run: ({ draft, shown, create }) => {
    try {
      create.run({ input: draft.get() });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.set(emptyPoll);
    shown.set(undefined);
  },
});

/** Vote with the chosen poll, voter, and choice. The vote form keeps them either way. */
export const submitVote: Operation.Handle<void, void> = operation({
  label: "submitVote",
  depends: { draft: voteDraft.controller, shown: notice.controller, cast: castVote.controller },
  run: ({ draft, shown, cast }) => {
    try {
      cast.run({ input: draft.get() });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Close one poll from its row button. */
export const submitClose: Operation.Handle<void, { pollId: string }> = operation({
  label: "submitClose",
  depends: { shown: notice.controller, close: closePoll.controller },
  run: ({ shown, close }, { input }) => {
    try {
      close.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Withdraw one vote from its row button. */
export const submitWithdraw: Operation.Handle<void, { voteId: string }> = operation({
  label: "submitWithdraw",
  depends: { shown: notice.controller, withdraw: withdrawVote.controller },
  run: ({ shown, withdraw }, { input }) => {
    try {
      withdraw.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Undo the last passing change. Form text, selections, and the filter stay. */
export const submitUndo: Operation.Handle<void, void> = operation({
  label: "submitUndo",
  depends: { shown: notice.controller, undo: undoPoll.controller },
  run: ({ shown, undo }) => {
    try {
      undo.run({});
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});
