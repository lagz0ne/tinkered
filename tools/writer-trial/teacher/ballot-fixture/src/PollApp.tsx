import type { FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { polls, votes } from "./model.ts";
import {
  chooseChoice,
  chooseFilter,
  choosePoll,
  choiceOptions,
  notice,
  pollDraft,
  pollFilter,
  pollOptions,
  pollRows,
  submitClose,
  submitPoll,
  submitUndo,
  submitVote,
  submitWithdraw,
  typeChoices,
  typeLimit,
  typeQuestion,
  typeVoter,
  voteDraft,
  voteRows,
} from "./screen.ts";
import type { PollFilter, PollRow, VoteRow } from "./screen.ts";

const filters: readonly PollFilter[] = ["All", "Open", "Closed"];

/** The new-poll form: labeled Question, Choices, and Limit inputs and Create poll. */
function PollForm(): ReactElement {
  const draft = useData(pollDraft);
  const question = useRun(typeQuestion);
  const choices = useRun(typeChoices);
  const limit = useRun(typeLimit);
  const submit = useRun(submitPoll);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        submit.run();
      }}
    >
      <label>
        Question
        <input
          value={draft.question}
          onChange={(event) => question.run({ input: { value: event.target.value } })}
        />
      </label>
      <label>
        Choices
        <input
          value={draft.choices}
          onChange={(event) => choices.run({ input: { value: event.target.value } })}
        />
      </label>
      <label>
        Limit
        <input
          value={draft.limit}
          onChange={(event) => limit.run({ input: { value: event.target.value } })}
        />
      </label>
      <button type="submit">Create poll</button>
    </form>
  );
}

/** One Polls row; a poll that is not closed has its Close button. */
function PollLine(props: { readonly row: PollRow }): ReactElement {
  const { row } = props;
  const close = useRun(submitClose);
  return (
    <tr>
      <td>{row.question}</td>
      <td>{row.votes}</td>
      <td>{row.leader}</td>
      <td>{row.status}</td>
      <td>
        {row.status === "Closed" ? null : (
          <button type="button" onClick={() => close.run({ input: { pollId: row.id } })}>
            Close {row.question}
          </button>
        )}
      </td>
    </tr>
  );
}

/** The filter buttons and the Polls table. */
function PollTable(): ReactElement {
  const saved = useData(polls);
  const cast = useData(votes);
  const filter = useData(pollFilter);
  const choose = useRun(chooseFilter);
  return (
    <>
      <div>
        {filters.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={each === filter}
            onClick={() => choose.run({ input: each })}
          >
            {each}
          </button>
        ))}
      </div>
      <table aria-label="Polls">
        <thead>
          <tr>
            <th>Question</th>
            <th>Votes</th>
            <th>Leader</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pollRows(saved, cast, filter).map((row) => (
            <PollLine key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </>
  );
}

/** The vote form: labeled Poll select, Voter input, Choice select, and Vote. */
function VoteForm(): ReactElement {
  const saved = useData(polls);
  const draft = useData(voteDraft);
  const pick = useRun(choosePoll);
  const voter = useRun(typeVoter);
  const choose = useRun(chooseChoice);
  const vote = useRun(submitVote);
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        vote.run();
      }}
    >
      <label>
        Poll
        <select
          value={draft.pollId}
          onChange={(event) => pick.run({ input: { pollId: event.target.value } })}
        >
          <option value="">Choose poll</option>
          {pollOptions(saved, draft.pollId).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Voter
        <input
          value={draft.voter}
          onChange={(event) => voter.run({ input: { value: event.target.value } })}
        />
      </label>
      <label>
        Choice
        <select
          value={draft.choice}
          onChange={(event) => choose.run({ input: { choice: event.target.value } })}
        >
          <option value="">Choose choice</option>
          {choiceOptions(saved, draft.pollId).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Vote</button>
    </form>
  );
}

/** One Votes row with its Withdraw button. */
function VoteLine(props: { readonly row: VoteRow }): ReactElement {
  const { row } = props;
  const withdraw = useRun(submitWithdraw);
  return (
    <tr>
      <td>{row.question}</td>
      <td>{row.voter}</td>
      <td>{row.choice}</td>
      <td>
        <button type="button" onClick={() => withdraw.run({ input: { voteId: row.id } })}>
          Withdraw {row.voter} from {row.question}
        </button>
      </td>
    </tr>
  );
}

/** The Votes table in saved vote order. */
function VoteTable(): ReactElement {
  const saved = useData(polls);
  const cast = useData(votes);
  return (
    <table aria-label="Votes">
      <thead>
        <tr>
          <th>Poll</th>
          <th>Voter</th>
          <th>Choice</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {voteRows(saved, cast).map((row) => (
          <VoteLine key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

/** The shared notice and the Undo button. */
function Notice(): ReactElement {
  const shown = useData(notice);
  const undo = useRun(submitUndo);
  return (
    <>
      <div role="alert">{shown}</div>
      <button type="button" onClick={() => undo.run()}>
        Undo
      </button>
    </>
  );
}

/** One PollApp owns a fresh scope. Two apps share nothing. */
export function PollApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <main>
        <PollForm />
        <Notice />
        <PollTable />
        <VoteForm />
        <VoteTable />
      </main>
    </ScopeProvider>
  );
}
