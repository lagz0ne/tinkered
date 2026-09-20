import type { Context } from "hono";
import { operation, tag, type Scope } from "@tinker/core";
import { stream } from "@tinker/hono";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";
import { fail, isError } from "../errors.ts";
import { parseDraftInput, type Draft } from "../shared/draft.ts";
import { getRemote, listRemote } from "../tools/issues.ts";
import { readDetail } from "./operations.ts";

/** Draft helper config: off unless the root binds it on. Read by
 * `readCapability` and by the draft route; slice 3 replaces the rest. */
export const draftHelper = tag<{
  readonly enabled: boolean;
  readonly baseUrl: string | undefined;
}>({ label: "draftHelper", default: { enabled: false, baseUrl: undefined } });

/** Read whether the draft helper is on: what the client shows or hides. */
export const readCapability = operation({
  label: "readCapability",
  depends: { draft: draftHelper },
  run: ({ draft }) => ({ enabled: draft.enabled }),
});

const denyUnexpected = operation({
  label: "denyUnexpected",
  input: claudeCode.approval,
  run: (): ClaudeCode.Decision => ({ behavior: "deny", message: "only issue reads are allowed" }),
});

export const triage = harness({
  label: "triage",
  adapter: claudeCode,
  approve: denyUnexpected,
  tools: [listRemote, getRemote],
});

export const draftGuardrails = claudeCode.options({
  tools: [],
  allowedTools: ["mcp__triage__list", "mcp__triage__get"],
  settingSources: [],
  strictMcpConfig: true,
});

function readPrompt(input: { readonly id: string; readonly prompt: string }): string {
  const ask = input.prompt.trim().length > 0 ? input.prompt : "summarize it and suggest next steps";
  return `Read issue ${input.id} with the get tool, then ${ask}. Reply with a short summary or next steps as plain text.`;
}

export const draftTurn = triage.turn({
  label: "draft",
  input: parseDraftInput,
  request: (input) => ({ prompt: readPrompt(input) }),
  response: (result) => {
    if (result.subtype === "success") return result.result;
    throw fail("DraftFailed", { reason: "the draft run did not finish" });
  },
});

export declare namespace RunDraft {
  /** What the run hands its caller, after the session closes. */
  export type Done = {
    readonly status: Draft.Outcome;
    readonly draft: string;
  };
}

function readClosed(end: Scope.Result): Draft.Outcome {
  if (end.teardownErrors !== undefined && end.teardownErrors.length > 0) return "failed";
  if (end.status !== "success") return end.status === "cancelled" ? "cancelled" : "failed";
  return "done";
}

export async function runDraft(
  owner: Scope.Handle,
  input: { readonly id: string; readonly prompt: string },
  notify: (event: Draft.Event) => void,
  signal: AbortSignal,
): Promise<RunDraft.Done> {
  if (signal.aborted) return { status: "cancelled", draft: "" };
  const session = owner.createSession({ tags: [draftGuardrails] });
  let live = "";
  const unText = session.controller(triage.text).watch((next) => {
    if (next.length > live.length) notify({ kind: "text", text: next.slice(live.length) });
    live = next;
  });
  const unStatus = session.controller(triage.status).watch((next) => {
    if (next === "running") notify({ kind: "status", status: next });
  });
  let closing: Promise<Scope.Result> | undefined;
  const onAbort = (): void => {
    closing ??= session.close();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let outcome: { readonly finished: boolean; readonly draft: string };
  let thrown: unknown;
  try {
    outcome = await settleRun(session, input, signal);
  } catch (error: unknown) {
    outcome = { finished: false, draft: "" };
    thrown = error;
  } finally {
    unText();
    unStatus();
    signal.removeEventListener("abort", onAbort);
  }
  const closed = readClosed(await (closing ?? session.close({ graceful: true })));
  if (closed === "cancelled") {
    notify({ kind: "status", status: "cancelled" });
    return { status: "cancelled", draft: outcome.draft };
  }
  if (closed === "failed") {
    notify({ kind: "status", status: "failed" });
    return { status: "failed", draft: outcome.draft };
  }
  if (thrown !== undefined) throw thrown;
  const status = readOutcome(outcome, closed);
  notify({ kind: "status", status });
  if (status === "done") notify({ kind: "done", draft: outcome.draft });
  return { status, draft: outcome.draft };
}

async function settleRun(
  session: Scope.Handle,
  input: { readonly id: string; readonly prompt: string },
  signal: AbortSignal,
): Promise<{ readonly finished: boolean; readonly draft: string }> {
  try {
    const draft = await session.run(draftTurn, { input });
    return { finished: true, draft };
  } catch (error: unknown) {
    if (signal.aborted) return { finished: false, draft: "" };
    if (isError(error, "DraftFailed")) return { finished: false, draft: "" };
    throw error;
  }
}

function readOutcome(
  outcome: { readonly finished: boolean; readonly draft: string },
  closed: Draft.Outcome,
): Draft.Outcome {
  if (closed !== "done") return closed;
  if (outcome.finished) return "done";
  return "failed";
}

type DraftContext = Context;

function draftFrame(event: { readonly kind: string; readonly [key: string]: unknown }): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Answer the draft stream for one issue. Slice 3 replaces this with a tagged call;
 * until then the composition root passes its own scope straight in. */
export function draftStream(
  scope: Scope.Handle,
  draft: { readonly enabled: boolean },
  c: DraftContext,
  id: string,
): Response | Promise<Response> {
  if (draft.enabled === false) return c.text("draft helper is off", 404);
  return draftOpened(scope, c, id);
}

async function draftOpened(
  scope: Scope.Handle,
  c: DraftContext,
  id: string,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = undefined;
  }
  const input = parseDraftInput(typeof raw === "object" && raw !== null ? { ...raw, id } : { id });
  try {
    await scope.run(readDetail, { input: input.id });
  } catch (error: unknown) {
    if (isError(error, "IssueNotFound")) return c.text("that issue is gone", 404);
    throw error;
  }
  if (c.req.raw.signal.aborted) return new Response("cancelled", { status: 499 });
  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  return stream(c, async (emit, ctx) => {
    const queue: string[] = [];
    const waiter = readWaiter();
    const aborter = new AbortController();
    const onAbort = (): void => {
      aborter.abort(ctx.signal.reason);
    };
    if (ctx.signal.aborted) aborter.abort(ctx.signal.reason);
    else ctx.signal.addEventListener("abort", onAbort);
    const rawAbort = (): void => {
      aborter.abort(c.req.raw.signal.reason);
    };
    if (c.req.raw.signal.aborted) aborter.abort(c.req.raw.signal.reason);
    else c.req.raw.signal.addEventListener("abort", rawAbort);
    const finished = readRunState(scope, input, queue, waiter, aborter);
    const pump = (async (): Promise<void> => {
      for (;;) {
        while (queue.length > 0) {
          const next = queue.shift();
          if (next === undefined) break;
          try {
            await emit(next);
          } catch {
            aborter.abort();
            return;
          }
        }
        if (finished.settled) return;
        await waiter.sleep();
      }
    })();
    let done: RunDraft.Done;
    try {
      done = await finished.value;
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
      c.req.raw.signal.removeEventListener("abort", rawAbort);
      waiter.wake();
      await pump;
    }
    try {
      await emit(draftFrame({ kind: "terminal", status: done.status, draft: done.draft }));
    } catch {
      return;
    }
  });
}

type Waiter = { readonly sleep: () => Promise<void>; readonly wake: () => void };

type RunState = { settled: boolean; readonly value: Promise<RunDraft.Done> };

function readRunState(
  scope: Scope.Handle,
  input: { readonly id: string; readonly prompt: string },
  queue: string[],
  waiter: Waiter,
  aborter: AbortController,
): RunState {
  const state: RunState = {
    settled: false,
    value: runDraft(
      scope,
      input,
      (event) => {
        queue.push(draftFrame(event));
        waiter.wake();
      },
      aborter.signal,
    ).then(
      (done) => {
        state.settled = true;
        waiter.wake();
        return done;
      },
      (error: unknown) => {
        state.settled = true;
        waiter.wake();
        throw error;
      },
    ),
  };
  return state;
}

function readWaiter(): Waiter {
  let wake: () => void = () => undefined;
  const sleep = (): Promise<void> =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });
  return {
    sleep,
    wake: () => {
      const next = wake;
      wake = () => undefined;
      next();
    },
  };
}
