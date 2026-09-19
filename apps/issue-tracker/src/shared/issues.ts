import { data } from "@tinker/core";
import { synced } from "@tinker/sync";
import { raise } from "../errors.ts";

export declare namespace Issues {
  /** One saved issue. Open is the only status in slice t01. */
  export type Issue = {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly status: "open";
  };
  /** Raw input a person types into the create form. */
  export type CreateInput = {
    readonly title: string;
    readonly description: string;
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

/** Parse one saved issue at the process edge. */
export function parseIssue(raw: unknown): Issues.Issue {
  if (!isRecord(raw)) raise("BadIssue", { label: "issues" });
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    raise("BadIssue", { label: "issues" });
  }
  if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
    raise("BadIssue", { label: "issues" });
  }
  if (typeof raw.description !== "string") raise("BadIssue", { label: "issues" });
  return { id: raw.id, title: raw.title, description: raw.description, status: "open" };
}

/** Parse the shared issue list snapshot. */
export function parseIssueList(raw: unknown): readonly Issues.Issue[] {
  if (!Array.isArray(raw)) raise("BadIssueList", { label: "issues" });
  return raw.map(parseIssue);
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

/** The shared truth: every saved issue. Synced so two tabs see the same list. */
export const issueList = data({
  label: "issues",
  initial: [] as readonly Issues.Issue[],
  parse: parseIssueList,
  meta: [synced({ key: "issues" })],
});
