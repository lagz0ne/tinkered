import { data } from "@tinker/core";
import { raise, type Errors } from "../errors.ts";
import type { Issues } from "../shared/issues.ts";

/** The create form's draft: cleared on a successful save. */
export type NewIssue = { readonly title: string; readonly description: string };

export type Filter = "all" | Issues.Status;

/** The edit form's draft. `baseRevision` is the revision the draft opened against; it advances
 * only after the tab's own save or an explicit reload of their change. `conflict` holds the
 * current saved issue after a stale save, so the draft is kept while the notice points at it. */
export type EditDraft = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: Issues.Status;
  readonly assignee: string | null;
  readonly baseRevision: number;
  readonly conflict: Issues.Issue | null;
};

/** The wire as the tab sees it. `live` holds while the stream is open; `pending` holds while a
 * stream connects or the browser reconnects it; `failed` marks a stream the browser gave up on
 * (the server answered an HTTP error) or a malformed frame, which waits for Reconnect. Before the
 * first frame a failure fails the boot instead, and the dead page shows. */
export type Connection = {
  readonly live: boolean;
  readonly pending: boolean;
  readonly failed: boolean;
};

/** The create form's draft: cleared on a successful save. */
export const newIssue = data<NewIssue>({
  label: "newIssue",
  initial: { title: "", description: "" },
});

export const filter = data<Filter>({ label: "filter", initial: "all" });

export const selectedId = data<string | null>({ label: "selectedId", initial: null });

/** The edit form's draft, or null when no issue is selected. */
export const editDraft = data<EditDraft | null>({ label: "editDraft", initial: null });

export const editNotice = data<string | null>({ label: "editNotice", initial: null });

export const commentDraft = data<string>({ label: "commentDraft", initial: "" });

export const commentAuthor = data<string>({ label: "commentAuthor", initial: "Ada" });

export const commentNotice = data<string | null>({ label: "commentNotice", initial: null });

/** The last loaded detail, or null. A new select keeps the old issue's detail until its load
 * lands, so a reader checks `issue.id` against `selectedId`. */
export const detail = data<Issues.Detail | null>({ label: "detail", initial: null });

/** The detail notice, or null when the detail is fresh. */
export const detailNotice = data<string | null>({ label: "detailNotice", initial: null });

/** One in-flight draft run: what the view shows. `notice` is the failure line, or null when
 * there is nothing to say. The drafter resource owns the lifecycle; a failed post also writes
 * its notice, never while a run is in flight. */
export type DraftRun = {
  readonly view: "quiet" | "running" | "ready" | "cancelled" | "failed";
  readonly text: string;
  readonly draft: string;
  readonly notice: string | null;
};

export const connection = data<Connection>({
  label: "connection",
  initial: { live: true, pending: false, failed: false },
});

export const draftRun = data<DraftRun>({
  label: "draftRun",
  initial: { view: "quiet", text: "", draft: "", notice: null },
});

export const draftPrompt = data<string>({ label: "draftPrompt", initial: "" });

/** The author a draft post names; the ready view's select writes it. */
export const draftAuthor = data<string>({ label: "draftAuthor", initial: "Ada" });

/** Whether the draft helper answers: checked once at boot, retried by hand. */
export const draftCapability = data<"loading" | "off" | "on" | "failed">({
  label: "draftCapability",
  initial: "loading",
});

export function draftOf(issue: Issues.Issue): EditDraft {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    assignee: issue.assignee,
    baseRevision: issue.revision,
    conflict: null,
  };
}

/** One saved row's mark: what a newer snapshot changes when the row moves. */
export type RowMark = { readonly revision: number; readonly updatedAt: number };

export function markOf(saved: readonly Issues.Issue[], id: string): RowMark | null {
  const current = saved.find((issue) => issue.id === id) ?? null;
  if (current === null) return null;
  return { revision: current.revision, updatedAt: current.updatedAt };
}

export function sameMark(a: RowMark, b: RowMark | null): boolean {
  if (b === null) return false;
  return a.revision === b.revision && a.updatedAt === b.updatedAt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type Field<V> = (value: unknown) => value is V;

function isField<T>(
  key: string,
  fields: { [K in keyof T]-?: Field<T[K]> },
): key is keyof T & string {
  return key in fields;
}

function setField<T, K extends keyof T & string>(
  patch: Partial<T>,
  key: K,
  guard: Field<T[K]>,
  value: unknown,
  error: Errors.Name,
): void {
  if (value === undefined) return;
  if (!guard(value)) raise(error, { reason: `${key} is unreadable` });
  patch[key] = value;
}

/** Admit a partial patch: for each key present on `raw` the guard must pass or the named error
 * raises; absent keys stay absent. */
export function readPatch<T>(
  raw: unknown,
  fields: { [K in keyof T]-?: Field<T[K]> },
  error: Errors.Name,
): Partial<T> {
  if (!isRecord(raw)) raise(error, { reason: "patch is unreadable" });
  const patch: Partial<T> = {};
  for (const key of Object.keys(fields)) {
    if (!isField(key, fields)) continue;
    setField(patch, key, fields[key], raw[key], error);
  }
  return patch;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isStatus(value: unknown): value is Issues.Status {
  return value === "open" || value === "in_progress" || value === "done";
}

/** `null` is a value here, not absence: it clears the assignee. */
export function isAssignee(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
