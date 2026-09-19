import { useEffect, useRef, useState } from "react";
import { useRun } from "@tinker/react";
import { postComment } from "./api.ts";
import { assignees } from "../shared/issues.ts";
import { parseDraftCapability, parseDraftEvent, type Draft } from "../shared/draft.ts";
import { fail, isError } from "../errors.ts";

type View = "quiet" | "running" | "ready" | "cancelled" | "failed";

function readFailedMessage(error: unknown): string {
  if (isError(error, "BadDraftInput")) return "That draft update was unreadable. Try again.";
  if (isError(error, "DraftFailed")) return "The draft helper failed. Try again.";
  if (isError(error, "IssueNotFound")) return "That issue is gone.";
  return "The draft helper failed. Try again.";
}

function readLine(line: string): Draft.Event | null {
  const text = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
  if (text.length === 0 || text.startsWith(":")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw fail("BadDraftInput", { reason: "draft update is unreadable" });
  }
  return parseDraftEvent(raw);
}

type Pump = {
  tail: string;
  readonly apply: (event: Draft.Event) => void;
};

function pumpLines(pump: Pump, chunk: string): Draft.Outcome | undefined {
  const lines = (pump.tail + chunk).split("\n");
  pump.tail = lines.pop() ?? "";
  let outcome: Draft.Outcome | undefined;
  for (const line of lines) {
    const event = readLine(line);
    if (event === null) continue;
    if (event.kind === "terminal") outcome = event.status;
    else pump.apply(event);
  }
  return outcome;
}

async function readPostedDraft(issueId: string, prompt: string, stopper: AbortController) {
  const res = await fetch(`/api/issues/${issueId}/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: stopper.signal,
  });
  if (!res.ok) {
    if (res.status === 404) throw fail("IssueNotFound", { id: issueId });
    throw fail("DraftFailed", { reason: "the draft helper failed" });
  }
  if (res.body === null) throw fail("DraftFailed", { reason: "the draft helper failed" });
  return res.body.getReader();
}

async function runStream(
  issueId: string,
  prompt: string,
  stopper: AbortController,
  apply: (event: Draft.Event) => void,
): Promise<Draft.Outcome> {
  const reader = await readPostedDraft(issueId, prompt, stopper);
  const decoder = new TextDecoder();
  let outcome: Draft.Outcome = "failed";
  const pump: Pump = { tail: "", apply };
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const finished = pumpLines(pump, decoder.decode(next.value, { stream: true }));
      if (finished !== undefined) outcome = finished;
    }
    const closing = readLine(pump.tail);
    if (closing !== null && closing.kind === "terminal") return closing.status;
    return outcome;
  } finally {
    reader.releaseLock();
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

type ReadyProps = {
  readonly shown: string;
  readonly author: string;
  readonly setAuthor: (author: string) => void;
  readonly post: () => void;
  readonly posting: boolean;
  readonly discard: () => void;
};

function ReadyView(props: ReadyProps) {
  return (
    <>
      <p>{props.shown}</p>
      <label htmlFor="draft-author">
        Author
        <select
          id="draft-author"
          value={props.author}
          onChange={(event) => props.setAuthor(event.target.value)}
        >
          {assignees.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={props.post} disabled={props.posting}>
        {props.posting ? "Posting…" : "Post draft"}
      </button>
      <button type="button" onClick={props.discard} disabled={props.posting}>
        Discard draft
      </button>
    </>
  );
}

type RetryProps = {
  readonly start: () => void;
  readonly discard: () => void;
};

function RetryView(props: RetryProps) {
  return (
    <>
      <button type="button" onClick={props.start}>
        Draft a summary
      </button>
      <button type="button" onClick={props.discard}>
        Discard draft
      </button>
    </>
  );
}

async function readCapability(signal: AbortSignal): Promise<"off" | "on" | "failed"> {
  try {
    const res = await fetch("/api/draft", { signal });
    if (!res.ok) return "failed";
    const found = parseDraftCapability(await res.json());
    return found.enabled ? "on" : "off";
  } catch {
    return "failed";
  }
}

function DraftView(props: { issueId: string; reload: () => void }) {
  const [capability, setCapability] = useState<"loading" | "off" | "on" | "failed">("loading");
  const [check, setCheck] = useState(0);
  const [view, setView] = useState<View>("quiet");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [prompt, setPrompt] = useState("");
  const [author, setAuthor] = useState<string>("Ada");
  const [notice, setNotice] = useState<string | null>(null);
  const runId = useRef(0);
  const flight = useRef<AbortController | null>(null);
  const comment = useRun(postComment);
  useEffect(() => {
    const stopper = new AbortController();
    let alive = true;
    setCapability("loading");
    readCapability(stopper.signal)
      .then((found) => {
        if (alive) setCapability(found);
      })
      .catch(() => {
        if (alive) setCapability("failed");
      });
    return () => {
      alive = false;
      stopper.abort();
    };
  }, [check]);
  function retryCapability(): void {
    setCheck((now) => now + 1);
  }
  useEffect(
    () => () => {
      runId.current += 1;
      flight.current?.abort();
      flight.current = null;
    },
    [props.issueId],
  );
  async function start(): Promise<void> {
    const id = runId.current + 1;
    runId.current = id;
    flight.current?.abort();
    const stopper = new AbortController();
    flight.current = stopper;
    setView("running");
    setText("");
    setDraft("");
    setNotice(null);
    const outcome = await startRun(id, stopper);
    if (runId.current !== id) return;
    if (flight.current === stopper) flight.current = null;
    if (outcome === undefined) return;
    setView(readView(outcome));
    if (outcome === "failed") setNotice("The draft helper failed. Try again.");
  }
  function readView(outcome: Draft.Outcome): View {
    if (outcome === "done") return "ready";
    if (outcome === "cancelled") return "cancelled";
    return "failed";
  }
  async function startRun(
    id: number,
    stopper: AbortController,
  ): Promise<Draft.Outcome | undefined> {
    try {
      return await runStream(props.issueId, prompt, stopper, (event) => {
        if (runId.current !== id) return;
        if (event.kind === "text") setText((seen) => seen + event.text);
        else if (event.kind === "done") setDraft(event.draft);
      });
    } catch (error: unknown) {
      if (runId.current !== id) return undefined;
      stopper.abort();
      if (isAbort(error)) {
        setView("cancelled");
        return undefined;
      }
      setView("failed");
      setNotice(readFailedMessage(error));
      return undefined;
    }
  }
  function cancel(): void {
    flight.current?.abort();
  }
  function discard(): void {
    runId.current += 1;
    flight.current?.abort();
    flight.current = null;
    setView("quiet");
    setText("");
    setDraft("");
    setNotice(null);
  }
  async function post(): Promise<void> {
    setNotice(null);
    try {
      await comment.runAsync({ input: { issueId: props.issueId, author, text: draft } });
      discard();
      props.reload();
    } catch {
      setNotice("Could not post the draft. It is kept — try again.");
    }
  }
  if (capability === "loading") {
    return (
      <section aria-label="triage draft">
        <h3>Triage draft</h3>
        <p aria-live="polite">Checking the draft helper…</p>
      </section>
    );
  }
  if (capability === "failed") {
    return (
      <section aria-label="triage draft">
        <h3>Triage draft</h3>
        <p role="alert">Could not check the draft helper. Your work is kept.</p>
        <button type="button" onClick={retryCapability}>
          Retry
        </button>
      </section>
    );
  }
  if (capability === "off") {
    return (
      <section aria-label="triage draft">
        <h3>Triage draft</h3>
        <p>The draft helper is off. No account is needed for ordinary use.</p>
      </section>
    );
  }
  const shown = draft.length > 0 ? draft : text;
  return (
    <section aria-label="triage draft">
      <h3>Triage draft</h3>
      <DraftBody
        view={view}
        text={text}
        shown={shown}
        author={author}
        setAuthor={setAuthor}
        start={start}
        cancel={cancel}
        post={post}
        posting={comment.isPending}
        discard={discard}
        prompt={prompt}
        setPrompt={setPrompt}
      />
      {notice !== null ? <p role="alert">{notice}</p> : null}
    </section>
  );
}

type BodyProps = {
  readonly view: View;
  readonly text: string;
  readonly shown: string;
  readonly author: string;
  readonly setAuthor: (author: string) => void;
  readonly start: () => void;
  readonly cancel: () => void;
  readonly post: () => void;
  readonly posting: boolean;
  readonly discard: () => void;
  readonly prompt: string;
  readonly setPrompt: (prompt: string) => void;
};

function DraftBody(props: BodyProps) {
  if (props.view === "quiet") {
    return (
      <>
        <label htmlFor="draft-prompt">
          What should the helper look at?
          <input
            id="draft-prompt"
            value={props.prompt}
            onChange={(event) => props.setPrompt(event.target.value)}
            placeholder="Short summary or next steps"
          />
        </label>
        <button type="button" onClick={props.start}>
          Draft a summary
        </button>
      </>
    );
  }
  if (props.view === "running") {
    return (
      <>
        <p aria-live="polite">{props.text.length > 0 ? props.text : "Drafting…"}</p>
        <button type="button" onClick={props.cancel}>
          Cancel draft
        </button>
      </>
    );
  }
  if (props.view === "ready") {
    return (
      <ReadyView
        shown={props.shown}
        author={props.author}
        setAuthor={props.setAuthor}
        post={props.post}
        posting={props.posting}
        discard={props.discard}
      />
    );
  }
  if (props.view === "cancelled") {
    return (
      <>
        <p>Cancelled.</p>
        {props.text.length > 0 ? <p>{props.text}</p> : null}
        <RetryView start={props.start} discard={props.discard} />
      </>
    );
  }
  return <RetryView start={props.start} discard={props.discard} />;
}

export default DraftView;
