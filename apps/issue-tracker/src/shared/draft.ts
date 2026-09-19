export declare namespace Draft {
  /** Where a draft sits: quiet, mid-run, ready to post, or stopped. */
  export type Status = "idle" | "running" | "done" | "cancelled" | "failed";
  /** The run's terminal outcome, reported after the session closes. */
  export type Outcome = "done" | "cancelled" | "failed";
  /** One streamed event a draft view shows: text the model wrote, a status
   * line, or the finished draft. */
  export type Event =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "status"; readonly status: string }
    | { readonly kind: "done"; readonly draft: string };
}

import { raise } from "../errors.ts";

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
