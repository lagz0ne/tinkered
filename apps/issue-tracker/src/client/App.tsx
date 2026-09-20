import type { Scope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { assignees, issueList, type Issues } from "../shared/issues.ts";
import {
  reconnect,
  reload,
  reloadTheirs,
  saveEdit,
  selectIssue,
  setFilter,
  submitComment,
  submitNewIssue,
  typeNewIssue,
  typeComment,
  typeEdit,
  assigneeName,
  matches,
  readSubmitMessage,
  readStatusOption,
  statusName,
} from "./actions.ts";
import type { Filter } from "./state.ts";
import DraftView from "./DraftView.tsx";
import {
  commentAuthor,
  commentDraft,
  commentNotice,
  connection,
  detail,
  detailNotice,
  editDraft,
  editNotice,
  filter,
  newIssue,
  selectedId,
} from "./state.ts";

/** The create form: the draft lives in a cell, the save is an operation, and the failure
 * message reads off the run's error — the draft survives a failed save. The submit reads
 * nothing from the render: the cell already holds every keystroke (written synchronously in
 * `onChange`), so even a click that beats the re-render saves the fresh draft. The disabled
 * button is the empty guard; a blank title is refused at the operation's door. */
function IssueForm() {
  const draft = useData(newIssue);
  const create = useRun(submitNewIssue);
  const message = create.isError ? readSubmitMessage(create.error) : null;
  const type = useRun(typeNewIssue);
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    create.run();
  }
  return (
    <form onSubmit={submit} aria-label="create issue">
      <label htmlFor="create-title">
        Title
        <input
          id="create-title"
          value={draft.title}
          onChange={(event) => type.run({ input: { title: event.target.value } })}
          required
          maxLength={200}
        />
      </label>
      <label htmlFor="create-description">
        Description
        <textarea
          id="create-description"
          value={draft.description}
          onChange={(event) => type.run({ input: { description: event.target.value } })}
        />
      </label>
      <button type="submit" disabled={create.isPending || draft.title.trim().length === 0}>
        {create.isPending ? "Saving…" : "Create issue"}
      </button>
      {create.isError ? <p role="alert">{message}</p> : null}
    </form>
  );
}

const filterOptions: readonly { readonly value: Filter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

/** The status filter: reads one cell, runs one operation. */
function IssueFilters() {
  const shown = useData(filter);
  const choose = useRun(setFilter);
  return (
    <div role="group" aria-label="filter issues">
      {filterOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={shown === option.value}
          onClick={() => choose.run({ input: option.value })}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const sameIssues = (a: readonly Issues.Issue[], b: readonly Issues.Issue[]): boolean => a === b;

/** The saved list, filtered: subscribes to the whole list cell (the rows it renders) and the
 * filter cell, so a keystroke in a form never touches it. */
function IssueList() {
  const shown = useData(filter);
  const selected = useData(selectedId);
  const issues = useData(
    issueList,
    (list) => list.filter((issue) => matches(issue, shown)),
    sameIssues,
  );
  const choose = useRun(selectIssue);
  const all = useData(issueList);
  if (all.length === 0) return <p>No issues yet. Create the first one.</p>;
  if (issues.length === 0) return <p>No issues with this status.</p>;
  return (
    <ul aria-label="issues">
      {issues.map((issue) => (
        <li key={issue.id}>
          <button
            type="button"
            aria-current={selected === issue.id}
            onClick={() => choose.run({ input: selected === issue.id ? null : issue.id })}
          >
            <strong>{issue.title}</strong> · {statusName(issue.status)} · {assigneeName(issue)} ·
            rev {issue.revision}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The edit form: the draft lives in a cell (seeded by the load), the save is an operation, and
 * the notice reads off the run's error through the notice cell — a stale save keeps the draft. */
function EditForm() {
  const draft = useData(editDraft);
  const notice = useData(editNotice);
  const save = useRun(saveEdit);
  const type = useRun(typeEdit);
  const theirs = useRun(reloadTheirs);
  if (draft === null) return null;
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    save.run();
  }
  return (
    <form onSubmit={submit} aria-label="edit issue">
      <label htmlFor="edit-title">
        Title
        <input
          id="edit-title"
          value={draft.title}
          onChange={(event) => type.run({ input: { title: event.target.value } })}
          required
          maxLength={200}
        />
      </label>
      <label htmlFor="edit-description">
        Description
        <textarea
          id="edit-description"
          value={draft.description}
          onChange={(event) => type.run({ input: { description: event.target.value } })}
        />
      </label>
      <label htmlFor="edit-status">
        Status
        <select
          id="edit-status"
          value={draft.status}
          onChange={(event) => {
            const next = readStatusOption(event.target.value);
            if (next !== undefined) type.run({ input: { status: next } });
          }}
        >
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </label>
      <label htmlFor="edit-assignee">
        Assignee
        <select
          id="edit-assignee"
          value={draft.assignee ?? ""}
          onChange={(event) =>
            type.run({ input: { assignee: event.target.value === "" ? null : event.target.value } })
          }
        >
          <option value="">Unassigned</option>
          {assignees.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : `Save (rev ${draft.baseRevision})`}
      </button>
      {notice !== null ? <p role="alert">{notice}</p> : null}
      {draft.conflict !== null ? (
        <button type="button" onClick={() => theirs.run()}>
          Reload their change
        </button>
      ) : null}
    </form>
  );
}

/** The comment form: the draft text and author live in cells; the notice reads off the run.
 * Like the create form, the submit reads nothing from the render — the cells already hold
 * every keystroke, so a click that beats the re-render still posts the fresh draft. */
function CommentForm(props: { readonly issueId: string }) {
  const text = useData(commentDraft);
  const author = useData(commentAuthor);
  const notice = useData(commentNotice);
  const comment = useRun(submitComment);
  const type = useRun(typeComment);
  function submit(event: React.FormEvent): void {
    event.preventDefault();
    comment.run();
  }
  return (
    <form onSubmit={submit} aria-label="add comment" data-issue={props.issueId}>
      <label htmlFor="comment-author">
        Author
        <select
          id="comment-author"
          value={author}
          onChange={(event) => type.run({ input: { author: event.target.value } })}
        >
          {assignees.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="comment-text">
        Comment
        <textarea
          id="comment-text"
          value={text}
          onChange={(event) => type.run({ input: { text: event.target.value } })}
        />
      </label>
      <button type="submit" disabled={comment.isPending || text.trim().length === 0}>
        {comment.isPending ? "Posting…" : "Add comment"}
      </button>
      {notice !== null ? <p role="alert">{notice}</p> : null}
    </form>
  );
}

/** The selected issue: reads the detail cell the load filled and the detail notice; the reload
 * button reruns the load. The draft view keeps its own props contract. */
function DetailView() {
  const selected = useData(selectedId);
  if (selected === null) return <p>Select an issue to edit it.</p>;
  return <SelectedDetail selected={selected} />;
}

/** The selected issue's detail: the last saved detail plus its notice. */
function SelectedDetail(props: { readonly selected: string }) {
  const shown = useData(detail);
  const notice = useData(detailNotice);
  const again = useRun(reload);
  const current = shown !== null && shown.issue.id === props.selected ? shown : null;
  if (current === null) return <DetailPending notice={notice} />;
  return (
    <>
      {notice !== null ? <p role="alert">{notice}</p> : null}
      <section aria-label="issue detail">
        <h2>{current.issue.title}</h2>
        <p>
          {statusName(current.issue.status)} · {assigneeName(current.issue)} · rev{" "}
          {current.issue.revision}
        </p>
        <p>Saved {new Date(current.issue.updatedAt).toLocaleString()}</p>
        <p>{current.issue.description}</p>
        <EditForm />
        <h3>Comments</h3>
        {current.comments.length === 0 ? (
          <p>No comments yet.</p>
        ) : (
          <ul aria-label="comments">
            {current.comments.map((comment) => (
              <li key={comment.id}>
                <strong>{comment.author}</strong> · {new Date(comment.createdAt).toLocaleString()}
                <p>{comment.text}</p>
              </li>
            ))}
          </ul>
        )}
        <CommentForm issueId={current.issue.id} />
        <DraftView issueId={current.issue.id} reload={() => again.run()} />
        <h3>Activity</h3>
        <ul aria-label="activity">
          {current.activity.map((entry) => (
            <li key={entry.id}>
              {entry.summary} · {new Date(entry.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** The detail before it loads: the notice when the last load failed, else the wait. */
function DetailPending(props: { readonly notice: string | null }) {
  if (props.notice === null) return <p>Loading detail…</p>;
  return (
    <>
      <p role="alert">{props.notice}</p>
      <p>Loading detail…</p>
    </>
  );
}

/** The wire as the tab sees it: reads the connection cell, runs the reconnect operation. */
function LiveState() {
  const link = useData(connection);
  const again = useRun(reconnect);
  return (
    <>
      {link.live ? null : <p role="alert">Live updates stopped. Your drafts are kept.</p>}
      {link.live ? null : (
        <button type="button" onClick={() => again.run()} disabled={link.pending}>
          Reconnect
        </button>
      )}
      {link.pending ? <p aria-live="polite">Reconnecting…</p> : null}
      {link.failed ? <p role="alert">Still no connection. Try again.</p> : null}
      {link.closedBadly ? <p role="alert">The old connection did not close cleanly.</p> : null}
    </>
  );
}

/** The reload button: reruns the load for the selected issue. */
function ReloadButton() {
  const again = useRun(reload);
  return (
    <button type="button" onClick={() => again.run()}>
      Reload
    </button>
  );
}

/** The app shell: the scope comes from the provider at the root; every child reads cells and
 * runs operations, nothing else. */
export function App() {
  return (
    <main>
      <h1>Issues</h1>
      <LiveState />
      <IssueForm />
      <IssueFilters />
      <IssueList />
      <DetailView />
      <ReloadButton />
    </main>
  );
}

/** The app with its scope: the composition root owns both; the shell only reads and runs. */
export function ScopedApp(props: { readonly scope: Scope.Handle }) {
  return (
    <ScopeProvider scope={props.scope}>
      <App />
    </ScopeProvider>
  );
}
