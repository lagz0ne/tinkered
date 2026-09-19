import { data } from "@tinker/core";
import { synced } from "@tinker/sync";
import { raise } from "../errors.ts";

export declare namespace Issues {
  /** Where an issue sits: Open, In progress, or Done. */
  export type Status = "open" | "in_progress" | "done";
  /** One saved issue. Revision guards edits; comments append without it. */
  export type Issue = {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly status: Status;
    readonly assignee: string | null;
    readonly revision: number;
    readonly createdAt: number;
    readonly updatedAt: number;
  };
  /** One saved comment. Appended independently of edit revisions. */
  export type Comment = {
    readonly id: string;
    readonly issueId: string;
    readonly author: string;
    readonly text: string;
    readonly createdAt: number;
  };
  /** One saved history entry: creation, a successful change, or a comment. */
  export type Activity = {
    readonly id: string;
    readonly issueId: string;
    readonly kind: "created" | "edited" | "commented";
    readonly summary: string;
    readonly createdAt: number;
  };
  /** The full detail view: the issue plus its discussion and history. */
  export type Detail = {
    readonly issue: Issue;
    readonly comments: readonly Comment[];
    readonly activity: readonly Activity[];
  };
  /** Raw input a person types into the create form. */
  export type CreateInput = {
    readonly title: string;
    readonly description: string;
  };
  /** Raw edit input: the id, the revision originally opened, and the fields to change. */
  export type EditInput = {
    readonly id: string;
    readonly baseRevision: number;
    readonly title?: string;
    readonly description?: string;
    readonly status?: Status;
    readonly assignee?: string | null;
  };
  /** Raw comment input: the issue, a demo author, and the text. */
  export type CommentInput = {
    readonly issueId: string;
    readonly author: string;
    readonly text: string;
  };
}

/** The demo identities. Example names, not authentication. */
export const assignees: readonly string[] = ["Ada", "Lin", "Sam"];

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

/** Read a required id field, failing with the entry's label. */
function readId(raw: Record<string, unknown>, label: string): string {
  const value = raw.id;
  if (typeof value !== "string" || value.length === 0) raise("BadIssue", { label });
  return value;
}

function readStatus(raw: unknown): Issues.Status {
  if (raw === undefined) return "open";
  if (raw === "open" || raw === "in_progress" || raw === "done") return raw;
  raise("BadIssue", { label: "issues" });
}

function readAssignee(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && assignees.includes(raw)) return raw;
  raise("BadIssue", { label: "issues" });
}

function readCount(raw: unknown): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  raise("BadIssue", { label: "issues" });
}

function readTime(raw: unknown, label: string): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  raise("BadIssue", { label });
}

/** Parse one saved issue at the process edge. Rows saved by slice t01 carry
 * only id/title/description and load with open defaults. */
export function parseIssue(raw: unknown): Issues.Issue {
  if (!isRecord(raw)) raise("BadIssue", { label: "issues" });
  if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
    raise("BadIssue", { label: "issues" });
  }
  if (typeof raw.description !== "string") raise("BadIssue", { label: "issues" });
  return {
    id: readId(raw, "issues"),
    title: raw.title,
    description: raw.description,
    status: readStatus(raw.status),
    assignee: readAssignee(raw.assignee),
    revision: raw.revision === undefined ? 0 : readCount(raw.revision),
    createdAt: raw.createdAt === undefined ? 0 : readTime(raw.createdAt, "issues"),
    updatedAt: raw.updatedAt === undefined ? 0 : readTime(raw.updatedAt, "issues"),
  };
}

/** Parse the shared issue list snapshot. */
export function parseIssueList(raw: unknown): readonly Issues.Issue[] {
  if (!Array.isArray(raw)) raise("BadIssueList", { label: "issues" });
  return raw.map(parseIssue);
}

/** Parse one issue id from a path reader at the door. */
export function parseIssueId(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    raise("BadEditInput", { reason: "issue is required" });
  }
  return raw;
}

/** Parse one saved comment at the process edge. */
export function parseComment(raw: unknown): Issues.Comment {
  if (!isRecord(raw)) raise("BadIssue", { label: "comments" });
  return {
    id: readId(raw, "comments"),
    issueId: readIssueId(raw),
    author: readAuthor(raw),
    text: readCommentText(raw),
    createdAt: readTime(raw.createdAt, "comments"),
  };
}

function readIssueId(raw: Record<string, unknown>): string {
  if (typeof raw.issueId !== "string" || raw.issueId.length === 0) {
    raise("BadIssue", { label: "comments" });
  }
  return raw.issueId;
}

function readAuthor(raw: Record<string, unknown>): string {
  if (typeof raw.author !== "string" || raw.author.length === 0) {
    raise("BadIssue", { label: "comments" });
  }
  return raw.author;
}

function readCommentText(raw: Record<string, unknown>): string {
  if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
    raise("BadIssue", { label: "comments" });
  }
  return raw.text;
}

/** Parse one saved activity entry at the process edge. */
export function parseActivity(raw: unknown): Issues.Activity {
  if (!isRecord(raw)) raise("BadIssue", { label: "activity" });
  return {
    id: readId(raw, "activity"),
    issueId: readActivityIssue(raw),
    kind: readKind(raw),
    summary: readSummary(raw),
    createdAt: readTime(raw.createdAt, "activity"),
  };
}

function readActivityIssue(raw: Record<string, unknown>): string {
  if (typeof raw.issueId !== "string" || raw.issueId.length === 0) {
    raise("BadIssue", { label: "activity" });
  }
  return raw.issueId;
}

function readKind(raw: Record<string, unknown>): Issues.Activity["kind"] {
  if (raw.kind === "created" || raw.kind === "edited" || raw.kind === "commented") {
    return raw.kind;
  }
  raise("BadIssue", { label: "activity" });
}

function readSummary(raw: Record<string, unknown>): string {
  if (typeof raw.summary !== "string") raise("BadIssue", { label: "activity" });
  return raw.summary;
}

/** Parse the full detail answer: the issue plus its discussion and history. */
export function parseIssueDetail(raw: unknown): Issues.Detail {
  if (!isRecord(raw)) raise("BadIssue", { label: "detail" });
  if (!Array.isArray(raw.comments)) raise("BadIssue", { label: "detail" });
  if (!Array.isArray(raw.activity)) raise("BadIssue", { label: "detail" });
  return {
    issue: parseIssue(raw.issue),
    comments: raw.comments.map(parseComment),
    activity: raw.activity.map(parseActivity),
  };
}

/** Parse a create form at the door; blank titles are refused. */
export function parseCreateInput(raw: unknown): Issues.CreateInput {
  if (!isRecord(raw)) raise("BadCreateInput", { reason: "title is required" });
  if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
    raise("BadCreateInput", { reason: "title is required" });
  }
  if (typeof raw.description !== "string") {
    raise("BadCreateInput", { reason: "description is required" });
  }
  if (raw.title.length > 200) raise("BadCreateInput", { reason: "title is too long" });
  if (raw.description.length > 5000) {
    raise("BadCreateInput", { reason: "description is too long" });
  }
  return { title: raw.title.trim(), description: raw.description };
}

/** Parse an edit form at the door: the id, the revision originally opened,
 * and at least the shape of each changed field. */
export function parseEditInput(raw: unknown): Issues.EditInput {
  if (!isRecord(raw)) raise("BadEditInput", { reason: "issue is required" });
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    raise("BadEditInput", { reason: "issue is required" });
  }
  if (typeof raw.baseRevision !== "number" || !Number.isInteger(raw.baseRevision)) {
    raise("BadEditInput", { reason: "revision is required" });
  }
  return {
    id: raw.id,
    baseRevision: raw.baseRevision,
    title: readEditTitle(raw.title),
    description: readEditDescription(raw.description),
    status: readEditStatus(raw.status),
    assignee: readEditAssignee(raw.assignee),
  };
}

function readEditTitle(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    raise("BadEditInput", { reason: "title is required" });
  }
  if (raw.length > 200) raise("BadEditInput", { reason: "title is too long" });
  return raw.trim();
}

function readEditDescription(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") raise("BadEditInput", { reason: "description is required" });
  if (raw.length > 5000) raise("BadEditInput", { reason: "description is too long" });
  return raw;
}

function readEditStatus(raw: unknown): Issues.Status | undefined {
  if (raw === undefined) return undefined;
  if (raw === "open" || raw === "in_progress" || raw === "done") return raw;
  raise("BadEditInput", { reason: "status is unknown" });
}

function readEditAssignee(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw === "string" && assignees.includes(raw)) return raw;
  raise("BadEditInput", { reason: "assignee is unknown" });
}

/** Parse a comment form at the door: the issue, a demo author, and the text. */
export function parseCommentInput(raw: unknown): Issues.CommentInput {
  if (!isRecord(raw)) raise("BadCommentInput", { reason: "comment is required" });
  return {
    issueId: readCommentIssue(raw),
    author: readCommentAuthor(raw),
    text: readNewCommentText(raw),
  };
}

function readCommentIssue(raw: Record<string, unknown>): string {
  if (typeof raw.issueId !== "string" || raw.issueId.length === 0) {
    raise("BadCommentInput", { reason: "issue is required" });
  }
  return raw.issueId;
}

function readCommentAuthor(raw: Record<string, unknown>): string {
  if (typeof raw.author !== "string" || !assignees.includes(raw.author)) {
    raise("BadCommentInput", { reason: "author is unknown" });
  }
  return raw.author;
}

function readNewCommentText(raw: Record<string, unknown>): string {
  if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
    raise("BadCommentInput", { reason: "text is required" });
  }
  if (raw.text.length > 2000) raise("BadCommentInput", { reason: "text is too long" });
  return raw.text;
}

/** The shared truth: every saved issue. Synced so two tabs see the same list. */
export const issueList = data({
  label: "issues",
  initial: [] as readonly Issues.Issue[],
  parse: parseIssueList,
  meta: [synced({ key: "issues" })],
});
