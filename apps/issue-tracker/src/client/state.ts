import { data } from "@tinker/core";
import { raise, type Errors } from "../errors.ts";
import type { Issues } from "../shared/issues.ts";

/** The create form's draft: cleared on a successful save. */
export type NewIssue = { readonly title: string; readonly description: string };

/** Which issues the list shows. */
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

/** The wire as the tab sees it. `live` flips when the wire drops; `pending`/`failed` track the
 * reconnect operation; `closedBadly` records a reconnect whose old scope closed uncleanly. */
export type Connection = {
  readonly live: boolean;
  readonly pending: boolean;
  readonly failed: boolean;
  readonly closedBadly: boolean;
};

/** The create form's draft: cleared on a successful save. */
export const newIssue = data<NewIssue>({
  label: "newIssue",
  initial: { title: "", description: "" },
});

/** Which issues the list shows. */
export const filter = data<Filter>({ label: "filter", initial: "all" });

/** The selected issue id, or null when nothing is selected. */
export const selectedId = data<string | null>({ label: "selectedId", initial: null });

/** The edit form's draft, or null when no issue is selected. */
export const editDraft = data<EditDraft | null>({ label: "editDraft", initial: null });

/** The edit form's notice, or null when there is nothing to say. */
export const editNotice = data<string | null>({ label: "editNotice", initial: null });

/** The comment form's draft text. */
export const commentDraft = data<string>({ label: "commentDraft", initial: "" });

/** The comment form's author. */
export const commentAuthor = data<string>({ label: "commentAuthor", initial: "Ada" });

/** The comment form's notice, or null when there is nothing to say. */
export const commentNotice = data<string | null>({ label: "commentNotice", initial: null });

/** The selected issue's saved detail, or null when none has loaded yet. */
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

/** The wire as the tab sees it. */
export const connection = data<Connection>({
  label: "connection",
  initial: { live: true, pending: false, failed: false, closedBadly: false },
});

/** One in-flight draft run. */
export const draftRun = data<DraftRun>({
  label: "draftRun",
  initial: { view: "quiet", text: "", draft: "", notice: null },
});

/** The draft prompt the prompt field types into. */
export const draftPrompt = data<string>({ label: "draftPrompt", initial: "" });

/** The author a draft post names; the ready view's select writes it. */
export const draftAuthor = data<string>({ label: "draftAuthor", initial: "Ada" });

/** Whether the draft helper answers: checked once at boot, retried by hand. */
export const draftCapability = data<"loading" | "off" | "on" | "failed">({
  label: "draftCapability",
  initial: "loading",
});

/** Seed one edit draft from its saved issue: a fresh draft with no conflict. */
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

/** Read one row's mark, or null when the row is not listed. */
export function markOf(saved: readonly Issues.Issue[], id: string): RowMark | null {
  const current = saved.find((issue) => issue.id === id) ?? null;
  if (current === null) return null;
  return { revision: current.revision, updatedAt: current.updatedAt };
}

/** True when two marks name the same saved row state. */
export function sameMark(a: RowMark, b: RowMark | null): boolean {
  if (b === null) return false;
  return a.revision === b.revision && a.updatedAt === b.updatedAt;
}

/** One field guard: the door for one patch field. */
type Field<V> = (value: unknown) => value is V;

/** True when a patch key names a guarded field. */
function isField<T>(
  key: string,
  fields: { [K in keyof T]-?: Field<T[K]> },
): key is keyof T & string {
  return key in fields;
}

/** Check one present patch field; absent stays absent, a failing guard raises the named error. */
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
  if (typeof raw !== "object" || raw === null) raise(error, { reason: "patch is unreadable" });
  const patch: Partial<T> = {};
  const seen = raw as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!isField(key, fields)) continue;
    setField(patch, key, fields[key], seen[key], error);
  }
  return patch;
}

/** A string field, or nothing. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** A status field, or nothing. */
export function isStatus(value: unknown): value is Issues.Status {
  return value === "open" || value === "in_progress" || value === "done";
}

/** An assignee field: a name or cleared, or nothing. */
export function isAssignee(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
