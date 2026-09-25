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
import { Field, NamedTable, Notice } from "./layout.tsx";

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
      <Field
        name="Question"
        control={
          <input
            value={draft.question}
            onChange={(event) => question.run({ input: { value: event.target.value } })}
          />
        }
      />
      <Field
        name="Choices"
        control={
          <input
            value={draft.choices}
            onChange={(event) => choices.run({ input: { value: event.target.value } })}
          />
        }
      />
      <Field
        name="Limit"
        control={
          <input
            value={draft.limit}
            onChange={(event) => limit.run({ input: { value: event.target.value } })}
          />
        }
      />
      <button type="submit">Create poll</button>
    </form>
  );
}

/** The Close button of one Polls row. */
function CloseButton(props: { readonly row: PollRow }): ReactElement {
  const { row } = props;
  const close = useRun(submitClose);
  return (
    <button type="button" onClick={() => close.run({ input: { pollId: row.id } })}>
      Close {row.question}
    </button>
  );
}

/** The filter buttons and the Polls table; a poll that is not closed has its Close button. */
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
      <NamedTable
        name="Polls"
        headers={["Question", "Votes", "Leader", "Status"]}
        rows={pollRows(saved, cast, filter).map((row) => ({
          key: row.id,
          cells: [row.question, row.votes, row.leader, row.status],
          actions: row.status === "Closed" ? undefined : <CloseButton row={row} />,
        }))}
      />
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
      <Field
        name="Poll"
        control={
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
        }
      />
      <Field
        name="Voter"
        control={
          <input
            value={draft.voter}
            onChange={(event) => voter.run({ input: { value: event.target.value } })}
          />
        }
      />
      <Field
        name="Choice"
        control={
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
        }
      />
      <button type="submit">Vote</button>
    </form>
  );
}

/** The Withdraw button of one Votes row. */
function WithdrawButton(props: { readonly row: VoteRow }): ReactElement {
  const { row } = props;
  const withdraw = useRun(submitWithdraw);
  return (
    <button type="button" onClick={() => withdraw.run({ input: { voteId: row.id } })}>
      Withdraw {row.voter} from {row.question}
    </button>
  );
}

/** The Votes table in saved vote order, each row with its Withdraw button. */
function VoteTable(): ReactElement {
  const saved = useData(polls);
  const cast = useData(votes);
  return (
    <NamedTable
      name="Votes"
      headers={["Poll", "Voter", "Choice"]}
      rows={voteRows(saved, cast).map((row) => ({
        key: row.id,
        cells: [row.question, row.voter, row.choice],
        actions: <WithdrawButton row={row} />,
      }))}
    />
  );
}

/** The shared notice and the Undo button. */
function NoticeBar(): ReactElement {
  const shown = useData(notice);
  const undo = useRun(submitUndo);
  return (
    <>
      <Notice text={shown} />
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
        <NoticeBar />
        <PollTable />
        <VoteForm />
        <VoteTable />
      </main>
    </ScopeProvider>
  );
}
