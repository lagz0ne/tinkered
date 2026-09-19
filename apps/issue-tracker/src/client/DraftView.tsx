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

async function runStream(
  issueId: string,
  prompt: string,
  stopper: AbortController,
  apply: (event: Draft.Event) => void,
): Promise<Draft.Outcome> {
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
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  let outcome: Draft.Outcome = "failed";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      tail += decoder.decode(next.value, { stream: true });
      const lines = tail.split("\n");
      tail = lines.pop() ?? "";
      for (const line of lines) {
        const event = readLine(line);
        if (event === null) continue;
        if (event.kind === "terminal") {
          outcome = event.status;
          continue;
        }
        apply(event);
      }
    }
    const closing = readLine(tail);
    if (closing !== null && closing.kind === "terminal") return closing.status;
    return outcome;
  } finally {
    reader.releaseLock();
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function DraftView(props: { issueId: string; reload: () => void }) {
  const [capability, setCapability] = useState<"loading" | "off" | "on">("loading");
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
    let alive = true;
    fetch("/api/draft")
      .then(async (res) => parseDraftCapability(await res.json()))
      .then((found) => {
        if (alive) setCapability(found.enabled ? "on" : "off");
      })
      .catch(() => {
        if (alive) setCapability("off");
      });
    return () => {
      alive = false;
    };
  }, []);
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
    try {
      const outcome = await runStream(props.issueId, prompt, stopper, (event) => {
        if (runId.current !== id) return;
        if (event.kind === "text") setText((seen) => seen + event.text);
        else if (event.kind === "done") setDraft(event.draft);
      });
      if (runId.current !== id) return;
      if (outcome === "done") {
        setView("ready");
      } else if (outcome === "cancelled") {
        setView("cancelled");
      } else {
        setView("failed");
        setNotice("The draft helper failed. Try again.");
      }
    } catch (error: unknown) {
      if (runId.current !== id) return;
      stopper.abort();
      if (isAbort(error)) {
        setView("cancelled");
        return;
      }
      setView("failed");
      setNotice(readFailedMessage(error));
    } finally {
      if (flight.current === stopper) flight.current = null;
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
  if (capability === "loading") return null;
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
      {view === "quiet" ? (
        <>
          <label htmlFor="draft-prompt">
            What should the helper look at?
            <input
              id="draft-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Short summary or next steps"
            />
          </label>
          <button type="button" onClick={start}>
            Draft a summary
          </button>
        </>
      ) : null}
      {view === "running" ? (
        <>
          <p aria-live="polite">{text.length > 0 ? text : "Drafting…"}</p>
          <button type="button" onClick={cancel}>
            Cancel draft
          </button>
        </>
      ) : null}
      {view === "ready" ? (
        <>
          <p>{shown}</p>
          <label htmlFor="draft-author">
            Author
            <select
              id="draft-author"
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
          <button type="button" onClick={post} disabled={comment.isPending}>
            {comment.isPending ? "Posting…" : "Post draft"}
          </button>
          <button type="button" onClick={discard} disabled={comment.isPending}>
            Discard draft
          </button>
        </>
      ) : null}
      {view === "cancelled" ? (
        <>
          <p>Cancelled.</p>
          {text.length > 0 ? <p>{text}</p> : null}
          <button type="button" onClick={start}>
            Draft a summary
          </button>
          <button type="button" onClick={discard}>
            Discard draft
          </button>
        </>
      ) : null}
      {view === "failed" ? (
        <>
          <button type="button" onClick={start}>
            Draft a summary
          </button>
          <button type="button" onClick={discard}>
            Discard draft
          </button>
        </>
      ) : null}
      {notice !== null ? <p role="alert">{notice}</p> : null}
    </section>
  );
}

export default DraftView;
