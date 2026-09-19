import { useEffect, useState } from "react";
import type { Scope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { postIssue } from "./api.ts";
import type { TabSync } from "./sync.ts";
import { issueList } from "../shared/issues.ts";
import { isError } from "../errors.ts";

/** The create form: local draft state only; saving sends a command. */
function IssueForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const create = useRun(postIssue);
  const failed = create.isError;
  const message = failed ? readMessage(create.error) : null;
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
      <label>
        Title
        <input
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
        />
      </label>
      <label>
        Description
        <textarea
          name="description"
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

/** Read the human sentence off any thrown value. */
function readMessage(error: unknown): string {
  if (isError(error, "BadCreateInput")) return error.payload.reason;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Could not save the issue.";
}

/** The saved list: what sync published, nothing else. */
function IssueList() {
  const issues = useData(issueList);
  if (issues.length === 0) return <p>No issues yet. Create the first one.</p>;
  return (
    <ul aria-label="issues">
      {issues.map((issue) => (
        <li key={issue.id}>
          <strong>{issue.title}</strong>
          <p>{issue.description}</p>
        </li>
      ))}
    </ul>
  );
}

/** The app shell: the command scope owns the api baseUrl. */
export function App(props: { connected: TabSync.Connected }) {
  const [live, setLive] = useState(true);
  return (
    <ScopeProvider scope={props.connected.scope}>
      <main>
        <h1>Issues</h1>
        <LiveState connected={props.connected} live={live} setLive={setLive} />
        <IssueForm />
        <IssueList />
      </main>
    </ScopeProvider>
  );
}

/** The live wire state: a dropped sync stays visible; reload retries. */
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

export type { Scope };
