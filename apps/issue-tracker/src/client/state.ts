import { data } from "@tinker/core";
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

/** The wire as the tab sees it. */
export const connection = data<Connection>({
  label: "connection",
  initial: { live: true, pending: false, failed: false, closedBadly: false },
});
