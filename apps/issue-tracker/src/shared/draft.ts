export declare namespace Draft {
  /** Where a draft sits: quiet, mid-run, ready to post, or stopped. */
  export type Status = "idle" | "running" | "done" | "cancelled" | "failed";
  /** The run's terminal outcome, reported after the session closes. */
  export type Outcome = "done" | "cancelled" | "failed";
  /** One streamed event a draft view shows: text the model wrote, a status
   * line, the finished draft, or the joined terminal outcome. */
  export type Event =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "status"; readonly status: string }
    | { readonly kind: "done"; readonly draft: string }
    | { readonly kind: "terminal"; readonly status: Outcome; readonly draft: string };
}

import { fail, raise } from "../errors.ts";

/** Read one streamed draft frame at the browser edge: the four event
 * kinds the server emits, nothing else. */
export function parseDraftEvent(raw: unknown): Draft.Event {
  if (typeof raw !== "object" || raw === null || !("kind" in raw)) {
    raise("BadDraftInput", { reason: "draft update is unreadable" });
  }
  const found = readEventKind(raw);
  if (found !== undefined) return found;
  raise("BadDraftInput", { reason: "draft update is unreadable" });
}

function readEventKind(raw: Record<string, unknown>): Draft.Event | undefined {
  if (raw.kind === "text") return readTextEvent(raw);
  if (raw.kind === "status") return readStatusEvent(raw);
  if (raw.kind === "done") return readDoneEvent(raw);
  if (raw.kind === "terminal") return readTerminalEvent(raw);
  return undefined;
}

function readTextEvent(raw: Record<string, unknown>): Draft.Event | undefined {
  if (!("text" in raw) || typeof raw.text !== "string") return undefined;
  return { kind: "text", text: raw.text };
}

function readStatusEvent(raw: Record<string, unknown>): Draft.Event | undefined {
  if (!("status" in raw) || typeof raw.status !== "string") return undefined;
  return { kind: "status", status: raw.status };
}

function readDoneEvent(raw: Record<string, unknown>): Draft.Event | undefined {
  if (!("draft" in raw) || typeof raw.draft !== "string") return undefined;
  return { kind: "done", draft: raw.draft };
}

function readTerminalEvent(raw: Record<string, unknown>): Draft.Event | undefined {
  if (!("status" in raw) || !("draft" in raw)) return undefined;
  return {
    kind: "terminal",
    status: readOutcome(raw.status),
    draft: readTerminalDraft(raw.draft),
  };
}

function readOutcome(raw: unknown): Draft.Outcome {
  if (raw === "done" || raw === "cancelled" || raw === "failed") return raw;
  raise("BadDraftInput", { reason: "draft update is unreadable" });
}

function readTerminalDraft(raw: unknown): string {
  if (typeof raw === "string") return raw;
  raise("BadDraftInput", { reason: "draft update is unreadable" });
}

/** Read one SSE line at the browser edge: a `data:` frame becomes its event; blanks and
 * comments read null; anything else must parse as a draft event or the update is unreadable. */
export function readLine(line: string): Draft.Event | null {
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

/** The streaming pump: the unparsed tail plus the sink for live events. */
export type Pump = {
  tail: string;
  readonly apply: (event: Draft.Event) => void;
};

/** Pump SSE chunks into events: split on newlines, keep the tail, apply live frames, and answer
 * the terminal outcome when it lands. */
export function pumpLines(pump: Pump, chunk: string): Draft.Outcome | undefined {
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

/** Read the draft capability answer at the browser edge. */
export function parseDraftCapability(raw: unknown): { readonly enabled: boolean } {
  if (typeof raw !== "object" || raw === null || !("enabled" in raw)) {
    raise("BadDraftInput", { reason: "draft state is unreadable" });
  }
  if (typeof raw.enabled !== "boolean")
    raise("BadDraftInput", { reason: "draft state is unreadable" });
  return { enabled: raw.enabled };
}

/** Read a draft issue id from the object the routes send: `{ id }`. */
export function parseDraftId(raw: unknown): string {
  if (typeof raw !== "object" || raw === null)
    raise("BadDraftInput", { reason: "issue is required" });
  if (!("id" in raw) || typeof raw.id !== "string" || raw.id.length === 0) {
    raise("BadDraftInput", { reason: "issue is required" });
  }
  return raw.id;
}

/** Read a draft prompt from the object the routes send: `{ id, prompt? }`. */
export function parseDraftInput(raw: unknown): { readonly id: string; readonly prompt: string } {
  const id = parseDraftId(raw);
  if (
    typeof raw === "object" &&
    raw !== null &&
    "prompt" in raw &&
    typeof raw.prompt === "string"
  ) {
    return { id, prompt: raw.prompt };
  }
  return { id, prompt: "" };
}
