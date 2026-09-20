import { useData, useRun } from "@tinker/react";
import { assignees } from "../shared/issues.ts";
import {
  cancelDraft,
  checkCapability,
  discardDraft,
  postDraft,
  beginDraft,
  setDraftAuthor,
  typePrompt,
} from "./actions.ts";
import { draftAuthor, draftCapability, draftPrompt, draftRun } from "./state.ts";

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

type BodyProps = {
  readonly view: "quiet" | "running" | "ready" | "cancelled" | "failed";
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

/** The triage draft: reads the capability and run cells, runs one operation per control, and
 * nothing else. The drafter resource owns the in-flight stream; selection changes discard. */
export default function DraftView() {
  const capability = useData(draftCapability);
  const run = useData(draftRun);
  const prompt = useData(draftPrompt);
  const author = useData(draftAuthor);
  const check = useRun(checkCapability);
  const begin = useRun(beginDraft);
  const stop = useRun(cancelDraft);
  const clear = useRun(discardDraft);
  const post = useRun(postDraft);
  const type = useRun(typePrompt);
  const name = useRun(setDraftAuthor);
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
        <button type="button" onClick={() => check.run()}>
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
  const shown = run.draft.length > 0 ? run.draft : run.text;
  return (
    <section aria-label="triage draft">
      <h3>Triage draft</h3>
      <DraftBody
        view={run.view}
        text={run.text}
        shown={shown}
        author={author}
        setAuthor={(next) => name.run({ input: next })}
        start={() => begin.run()}
        cancel={() => stop.run()}
        post={() => post.run()}
        posting={post.isPending}
        discard={() => clear.run()}
        prompt={prompt}
        setPrompt={(next) => type.run({ input: next })}
      />
      {run.notice !== null ? <p role="alert">{run.notice}</p> : null}
    </section>
  );
}
