import { useEffect, useState } from "react";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { isError as isHttpError } from "@tinker/http";
import { getDetail, patchIssue, postComment, postIssue } from "./api.ts";
import DraftView from "./DraftView.tsx";
import type { TabSync } from "./sync.ts";
import { assignees, issueList, parseIssue, type Issues } from "../shared/issues.ts";
import { isError } from "../errors.ts";

type Filter = "all" | Issues.Status;

type Conflict = {
  readonly message: string;
  readonly current: Issues.Issue;
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function IssueForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const create = useRun(postIssue);
  const failed = create.isError;
  const message = failed ? readSubmitMessage(create.error) : null;
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (title.trim().length === 0) return;
    try {
      await create.runAsync({ input: { title, description } });
      setTitle("");
      setDescription("");
    } catch {
      return;
    }
  }
  return (
    <form onSubmit={submit} aria-label="create issue">
      <label htmlFor="create-title">
        Title
        <input
          id="create-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
        />
      </label>
      <label htmlFor="create-description">
        Description
        <textarea
          id="create-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <button type="submit" disabled={create.isPending || title.trim().length === 0}>
        {create.isPending ? "Saving…" : "Create issue"}
      </button>
      {failed ? <p role="alert">{message}</p> : null}
    </form>
  );
}

function readSubmitMessage(error: unknown): string {
  if (isError(error, "BadCreateInput")) return error.payload.reason;
  if (isHttpError(error, "ResponseFailed")) return readHttpMessage(error.payload.response.status);
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Could not save the issue.";
}

function readHttpMessage(status: number): string {
  if (status === 404) return "That issue is gone. Reload the list.";
  if (status === 409) return "Someone else saved first. Reload and try again.";
  return "Could not save. Try again.";
}

function statusName(status: Issues.Status): string {
  if (status === "open") return "Open";
  if (status === "in_progress") return "In progress";
  return "Done";
}

function assigneeName(issue: Issues.Issue): string {
  return issue.assignee ?? "Unassigned";
}

function matches(issue: Issues.Issue, filter: Filter): boolean {
  if (filter === "all") return true;
  return issue.status === filter;
}

function IssueFilters(props: { filter: Filter; setFilter: (filter: Filter) => void }) {
  const options: readonly { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "open", label: "Open" },
    { value: "in_progress", label: "In progress" },
    { value: "done", label: "Done" },
  ];
  return (
    <div role="group" aria-label="filter issues">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={props.filter === option.value}
          onClick={() => props.setFilter(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function IssueList(props: {
  filter: Filter;
  selectedId: string | null;
  select: (id: string | null) => void;
}) {
  const issues = useData(issueList);
  const shown = issues.filter((issue) => matches(issue, props.filter));
  if (issues.length === 0) return <p>No issues yet. Create the first one.</p>;
  if (shown.length === 0) return <p>No issues with this status.</p>;
  return (
    <ul aria-label="issues">
      {shown.map((issue) => (
        <li key={issue.id}>
          <button
            type="button"
            aria-current={props.selectedId === issue.id}
            onClick={() => props.select(props.selectedId === issue.id ? null : issue.id)}
          >
            <strong>{issue.title}</strong> · {statusName(issue.status)} · {assigneeName(issue)} ·
            rev {issue.revision}
          </button>
        </li>
      ))}
    </ul>
  );
}

function readStatusOption(value: string): Issues.Status | undefined {
  if (value === "open" || value === "in_progress" || value === "done") return value;
  return undefined;
}

function readEditError(error: unknown): { message: string; conflict: Conflict | null } {
  if (isError(error, "IssueConflict")) {
    return {
      message: "Someone else saved first. Your draft is kept — reload their change, then save.",
      conflict: { message: "Someone else saved first.", current: error.payload.current },
    };
  }
  if (isError(error, "BadEditInput")) return { message: error.payload.reason, conflict: null };
  if (isHttpError(error, "ResponseFailed")) {
    if (error.payload.response.status === 409) {
      return { message: "Someone else saved first. Reload and try again.", conflict: null };
    }
    return { message: readHttpMessage(error.payload.response.status), conflict: null };
  }
  if (error instanceof Error && error.message.length > 0) {
    return { message: error.message, conflict: null };
  }
  return { message: "Could not save. Try again.", conflict: null };
}

function readConflictBody(raw: unknown): { current: Issues.Issue } | null {
  if (!isRecord(raw) || raw.current === undefined) return null;
  try {
    return { current: parseIssue(raw.current) };
  } catch {
    return null;
  }
}

function EditForm(props: { saved: Issues.Issue; reload: () => void }) {
  const [title, setTitle] = useState(props.saved.title);
  const [description, setDescription] = useState(props.saved.description);
  const [status, setStatus] = useState<Issues.Status>(props.saved.status);
  const [assignee, setAssignee] = useState<string | null>(props.saved.assignee);
  const [baseRevision, setBaseRevision] = useState(props.saved.revision);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const edit = useRun(patchIssue);
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setNotice(null);
    try {
      const updated = await edit.runAsync({
        input: {
          id: props.saved.id,
          baseRevision,
          title,
          description,
          status,
          assignee,
        },
      });
      setBaseRevision(updated.revision);
      setConflict(null);
      props.reload();
    } catch (error: unknown) {
      const found = readEditError(error);
      setNotice(found.message);
      if (found.conflict !== null) setConflict(found.conflict);
      else {
        const current = await readStoredConflict(error);
        if (current !== null) setConflict({ message: found.message, current });
      }
    }
  }
  function reloadCurrent(): void {
    if (conflict === null) return;
    setTitle(conflict.current.title);
    setDescription(conflict.current.description);
    setStatus(conflict.current.status);
    setAssignee(conflict.current.assignee);
    setBaseRevision(conflict.current.revision);
    setConflict(null);
    setNotice(null);
    props.reload();
  }
  return (
    <form onSubmit={submit} aria-label="edit issue">
      <label htmlFor="edit-title">
        Title
        <input
          id="edit-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
        />
      </label>
      <label htmlFor="edit-description">
        Description
        <textarea
          id="edit-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label htmlFor="edit-status">
        Status
        <select
          id="edit-status"
          value={status}
          onChange={(event) => {
            const next = readStatusOption(event.target.value);
            if (next !== undefined) setStatus(next);
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
          value={assignee ?? ""}
          onChange={(event) => setAssignee(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">Unassigned</option>
          {assignees.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={edit.isPending}>
        {edit.isPending ? "Saving…" : `Save (rev ${baseRevision})`}
      </button>
      {notice !== null ? <p role="alert">{notice}</p> : null}
      {conflict !== null ? (
        <button type="button" onClick={reloadCurrent}>
          Reload their change
        </button>
      ) : null}
    </form>
  );
}

async function readStoredConflict(error: unknown): Promise<Issues.Issue | null> {
  if (!isHttpError(error, "ResponseFailed")) return null;
  if (error.payload.response.status !== 409) return null;
  const body = readConflictBody(await error.payload.response.json());
  return body === null ? null : body.current;
}

function CommentForm(props: { issueId: string; reload: () => void }) {
  const [author, setAuthor] = useState<string>("Ada");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const comment = useRun(postComment);
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (text.trim().length === 0) return;
    setNotice(null);
    try {
      await comment.runAsync({ input: { issueId: props.issueId, author, text } });
      setText("");
      props.reload();
    } catch (error: unknown) {
      setNotice(readCommentError(error));
    }
  }
  return (
    <form onSubmit={submit} aria-label="add comment">
      <label htmlFor="comment-author">
        Author
        <select
          id="comment-author"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
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
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button type="submit" disabled={comment.isPending || text.trim().length === 0}>
        {comment.isPending ? "Posting…" : "Add comment"}
      </button>
      {notice !== null ? <p role="alert">{notice}</p> : null}
    </form>
  );
}

function readCommentError(error: unknown): string {
  if (isError(error, "BadCommentInput")) return error.payload.reason;
  if (isHttpError(error, "ResponseFailed")) return readHttpMessage(error.payload.response.status);
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Could not post. Try again.";
}

function DetailView(props: { selectedId: string; stamp: number }) {
  const [detail, setDetail] = useState<Issues.Detail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetchDetail = useRun(getDetail).runAsync;
  const watched = useData(issueList);
  const saved = watched.find((issue) => issue.id === props.selectedId) ?? null;
  useEffect(() => {
    let alive = true;
    fetchDetail({ input: props.selectedId })
      .then((found) => {
        if (alive) {
          setDetail(found);
          setNotice(null);
        }
      })
      .catch((error: unknown) => {
        if (alive) setNotice(readDetailError(error));
      });
    return () => {
      alive = false;
    };
  }, [props.selectedId, props.stamp, tick, saved, fetchDetail]);
  function reload(): void {
    setTick((now) => now + 1);
  }
  const shown = detail !== null && detail.issue.id === props.selectedId ? detail : null;
  return (
    <>
      {notice !== null ? <p role="alert">{notice}</p> : null}
      {shown === null ? (
        <p>Loading detail…</p>
      ) : (
        <section aria-label="issue detail">
          <h2>{shown.issue.title}</h2>
          <p>
            {statusName(shown.issue.status)} · {assigneeName(shown.issue)} · rev{" "}
            {shown.issue.revision}
          </p>
          <p>{shown.issue.description}</p>
          <EditForm saved={shown.issue} reload={reload} />
          <h3>Comments</h3>
          {shown.comments.length === 0 ? (
            <p>No comments yet.</p>
          ) : (
            <ul aria-label="comments">
              {shown.comments.map((comment) => (
                <li key={comment.id}>
                  <strong>{comment.author}</strong>
                  <p>{comment.text}</p>
                </li>
              ))}
            </ul>
          )}
          <CommentForm issueId={shown.issue.id} reload={reload} />
          <DraftView issueId={shown.issue.id} reload={reload} />
          <h3>Activity</h3>
          <ul aria-label="activity">
            {shown.activity.map((entry) => (
              <li key={entry.id}>{entry.summary}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function readDetailError(error: unknown): string {
  if (isHttpError(error, "ResponseFailed")) {
    if (error.payload.response.status === 404) return "That issue is gone. Reload the list.";
    return "Could not refresh this issue. Showing the last saved detail.";
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Could not load the issue.";
}

/** The app shell: the command scope owns the api baseUrl. */
export function App(props: { connected: TabSync.Connected }) {
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);
  return (
    <ScopeProvider scope={props.connected.scope}>
      <main>
        <h1>Issues</h1>
        <LiveState connected={props.connected} live={live} setLive={setLive} />
        <IssueForm />
        <IssueFilters filter={filter} setFilter={setFilter} />
        <IssueList filter={filter} selectedId={selectedId} select={setSelectedId} />
        {selectedId !== null ? (
          <DetailView key={selectedId} selectedId={selectedId} stamp={stamp} />
        ) : (
          <p>Select an issue to edit it.</p>
        )}
        <button type="button" onClick={() => setStamp((now) => now + 1)}>
          Reload
        </button>
      </main>
    </ScopeProvider>
  );
}

function LiveState(props: {
  connected: TabSync.Connected;
  live: boolean;
  setLive: (live: boolean) => void;
}) {
  useEffect(
    () =>
      props.connected.onDrop(() => {
        props.setLive(false);
      }),
    [props.connected, props.setLive],
  );
  if (props.live) return null;
  return <p role="alert">Live updates stopped. Reload to reconnect.</p>;
}
