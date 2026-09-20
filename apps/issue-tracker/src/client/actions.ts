import { operation } from "@tinker/core";
import { isError as isHttpError } from "@tinker/http";
import { parseIssue, type Issues } from "../shared/issues.ts";
import { isError, raise } from "../errors.ts";
import { getDetail, patchIssue, postComment, postIssue } from "./api.ts";
import { wire } from "./connection.ts";
import {
  commentAuthor,
  commentDraft,
  commentNotice,
  connection,
  detail,
  detailNotice,
  editDraft,
  editNotice,
  filter,
  newIssue,
  selectedId,
  type Filter,
} from "./state.ts";

/** Admit one typed string at the door: the single-string actions' shape. */
function readString(raw: unknown, action: string): string {
  if (typeof raw !== "string") raise("BadDraftInput", { reason: `${action} needs a string` });
  return raw;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

/** One patch over the edit draft: only the fields the caller set. */
export type EditPatch = {
  readonly title?: string;
  readonly description?: string;
  readonly status?: Issues.Status;
  readonly assignee?: string | null;
};

/** Admit one optional text field: absent stays absent, present must be a string. */
function readOptionalText(raw: unknown, field: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") raise("BadEditInput", { reason: `${field} is unreadable` });
  return raw;
}

/** Admit one optional status field: absent stays absent, present must be known. */
function readOptionalStatus(raw: unknown): Issues.Status | undefined {
  if (raw === undefined) return undefined;
  if (raw === "open" || raw === "in_progress" || raw === "done") return raw;
  raise("BadEditInput", { reason: "status is unknown" });
}

/** Admit one optional assignee field: absent stays absent, present is a name or cleared. */
function readOptionalAssignee(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw === "string") return raw;
  raise("BadEditInput", { reason: "assignee is unreadable" });
}

/** Admit a partial issue-draft patch: only the known fields pass, only the set ones apply. */
function readPatch(raw: unknown): EditPatch {
  if (!isRecord(raw)) raise("BadEditInput", { reason: "edit is unreadable" });
  const patch: { -readonly [K in keyof EditPatch]?: EditPatch[K] } = {};
  const title = readOptionalText(raw.title, "title");
  if (title !== undefined) patch.title = title;
  const description = readOptionalText(raw.description, "description");
  if (description !== undefined) patch.description = description;
  const status = readOptionalStatus(raw.status);
  if (status !== undefined) patch.status = status;
  const assignee = readOptionalAssignee(raw.assignee);
  if (assignee !== undefined) patch.assignee = assignee;
  return patch;
}

/** Admit a partial create-form patch: title and description. */
function readNewIssuePatch(raw: unknown): {
  readonly title?: string;
  readonly description?: string;
} {
  if (!isRecord(raw)) raise("BadCreateInput", { reason: "issue is unreadable" });
  const patch: { title?: string; description?: string } = {};
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string") raise("BadCreateInput", { reason: "title is unreadable" });
    patch.title = raw.title;
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string")
      raise("BadCreateInput", { reason: "description is unreadable" });
    patch.description = raw.description;
  }
  return patch;
}

/** Admit a partial comment-draft patch: text and author. */
function readCommentPatch(raw: unknown): { readonly text?: string; readonly author?: string } {
  if (!isRecord(raw)) raise("BadCommentInput", { reason: "comment is unreadable" });
  const patch: { text?: string; author?: string } = {};
  if (raw.text !== undefined) {
    if (typeof raw.text !== "string") raise("BadCommentInput", { reason: "text is unreadable" });
    patch.text = raw.text;
  }
  if (raw.author !== undefined) {
    if (typeof raw.author !== "string")
      raise("BadCommentInput", { reason: "author is unreadable" });
    patch.author = raw.author;
  }
  return patch;
}

/** Type one create-form field at the door. */
export const typeNewIssue = operation({
  label: "typeNewIssue",
  input: readNewIssuePatch,
  depends: { draft: newIssue.controller },
  run: ({ draft }, { input }) => {
    draft.update((prev) => ({ ...prev, ...input }));
  },
});

/** Save the create form, then clear it. The failure message stays in the run's error. */
export const submitNewIssue = operation({
  label: "submitNewIssue",
  depends: { post: postIssue, draft: newIssue.controller },
  run: async ({ post, draft }) => {
    const saved = await post.run({ input: draft.get() });
    draft.set({ title: "", description: "" });
    return saved;
  },
});

/** Show only one status in the list. */
export const setFilter = operation({
  label: "setFilter",
  input: (raw): Filter => {
    if (raw === "all" || raw === "open" || raw === "in_progress" || raw === "done") return raw;
    raise("BadEditInput", { reason: "filter is unknown" });
  },
  depends: { shown: filter.controller },
  run: ({ shown }, { input }) => {
    shown.set(input);
  },
});

/** Select one issue, or nothing. Clears the detail and its drafts when deselected. */
export const selectIssue = operation({
  label: "selectIssue",
  input: (raw): string | null => {
    if (raw === null || raw === undefined) return null;
    return readString(raw, "selectIssue");
  },
  depends: {
    selected: selectedId.controller,
    shown: detail.controller,
    draft: editDraft.controller,
    notice: editNotice.controller,
    detailNote: detailNotice.controller,
    comment: commentDraft.controller,
    commentNote: commentNotice.controller,
  },
  run: ({ selected, shown, draft, notice, detailNote, comment, commentNote }, { input }) => {
    selected.set(input);
    if (input === null) {
      shown.set(null);
      draft.set(null);
      notice.set(null);
      detailNote.set(null);
      comment.set("");
      commentNote.set(null);
    }
  },
});

/** Load one saved detail and seed the edit draft when the draft is for another issue or empty.
 * A load that lands after the selection moved writes nothing: the newer load owns the cells. */
export const loadDetail = operation({
  label: "loadDetail",
  input: (raw) => readString(raw, "loadDetail"),
  depends: {
    fetch: getDetail,
    selected: selectedId.controller,
    shown: detail.controller,
    note: detailNotice.controller,
    draft: editDraft.controller,
  },
  run: async ({ fetch, selected, shown, note, draft }, { input: id }) => {
    const found = await fetch.run({ input: id });
    if (selected.get() !== id) return found;
    shown.set(found);
    note.set(null);
    const current = draft.get();
    if (current === null || current.id !== id) {
      draft.set({
        id,
        title: found.issue.title,
        description: found.issue.description,
        status: found.issue.status,
        assignee: found.issue.assignee,
        baseRevision: found.issue.revision,
        conflict: null,
      });
    }
    return found;
  },
});

/** Type into the edit draft. */
export const typeEdit = operation({
  label: "typeEdit",
  input: readPatch,
  depends: { draft: editDraft.controller },
  run: ({ draft }, { input }) => {
    draft.update((prev) => (prev === null ? prev : { ...prev, ...input }));
  },
});

/** Save the edit draft. On success the base revision advances and the detail reloads; on a
 * stale revision the current saved issue is kept as the conflict. */
export const saveEdit = operation({
  label: "saveEdit",
  depends: {
    save: patchIssue,
    draft: editDraft.controller,
    notice: editNotice.controller,
    detailNote: detailNotice.controller,
    reloadDetail: loadDetail,
  },
  run: async ({ save, draft, notice, detailNote, reloadDetail }) => {
    const current = draft.get();
    if (current === null) raise("BadEditInput", { reason: "nothing is selected" });
    notice.set(null);
    try {
      const updated = await save.run({
        input: {
          id: current.id,
          baseRevision: current.baseRevision,
          title: current.title,
          description: current.description,
          status: current.status,
          assignee: current.assignee,
        },
      });
      draft.update((prev) =>
        prev === null ? prev : { ...prev, baseRevision: updated.revision, conflict: null },
      );
      try {
        await reloadDetail.run({ input: current.id });
      } catch (error: unknown) {
        detailNote.set(readDetailError(error));
      }
      return updated;
    } catch (error: unknown) {
      const found = readEditError(error);
      notice.set(found.message);
      const currentSaved = found.current ?? (await readStoredConflict(error));
      if (currentSaved !== null) {
        draft.update((prev) => (prev === null ? prev : { ...prev, conflict: currentSaved }));
      }
      throw error;
    }
  },
});

/** Copy the conflicting current saved issue into the edit draft. */
export const reloadTheirs = operation({
  label: "reloadTheirs",
  depends: {
    draft: editDraft.controller,
    notice: editNotice.controller,
    reloadDetail: loadDetail,
  },
  run: async ({ draft, notice, reloadDetail }) => {
    const current = draft.get();
    if (current?.conflict === null || current?.conflict === undefined) return;
    const theirs = current.conflict;
    draft.set({
      id: theirs.id,
      title: theirs.title,
      description: theirs.description,
      status: theirs.status,
      assignee: theirs.assignee,
      baseRevision: theirs.revision,
      conflict: null,
    });
    notice.set(null);
    await reloadDetail.run({ input: theirs.id });
  },
});

/** Type into the comment draft. */
export const typeComment = operation({
  label: "typeComment",
  input: readCommentPatch,
  depends: { text: commentDraft.controller, author: commentAuthor.controller },
  run: ({ text, author }, { input }) => {
    if (input.text !== undefined) text.set(input.text);
    if (input.author !== undefined) author.set(input.author);
  },
});

/** Post the comment draft, clear it, and reload the detail. */
export const submitComment = operation({
  label: "submitComment",
  depends: {
    post: postComment,
    text: commentDraft.controller,
    author: commentAuthor.controller,
    notice: commentNotice.controller,
    detailNote: detailNotice.controller,
    reloadDetail: loadDetail,
    selected: selectedId.controller,
  },
  run: async ({ post, text, author, notice, detailNote, reloadDetail, selected }) => {
    const id = selected.get();
    if (id === null) raise("BadCommentInput", { reason: "nothing is selected" });
    notice.set(null);
    try {
      const saved = await post.run({
        input: { issueId: id, author: author.get(), text: text.get() },
      });
      text.set("");
      try {
        await reloadDetail.run({ input: id });
      } catch (error: unknown) {
        detailNote.set(readDetailError(error));
      }
      return saved;
    } catch (error: unknown) {
      notice.set(readCommentError(error));
      throw error;
    }
  },
});

/** Reload the selected issue's detail. A failed reload keeps the last detail and notes why. */
export const reload = operation({
  label: "reload",
  depends: {
    selected: selectedId.controller,
    reloadDetail: loadDetail,
    note: detailNotice.controller,
  },
  run: async ({ selected, reloadDetail, note }) => {
    const id = selected.get();
    if (id === null) return;
    try {
      await reloadDetail.run({ input: id });
    } catch (error: unknown) {
      note.set(readDetailError(error));
    }
  },
});

/** Reconnect the tab wire: open a fresh stream and replay the register. */
export const reconnect = operation({
  label: "reconnect",
  depends: { line: wire.required, link: connection.controller },
  run: async ({ line, link }) => {
    link.update((prev) => ({ ...prev, pending: true, failed: false }));
    try {
      await line.reconnect();
    } catch {
      link.update((prev) => ({ ...prev, pending: false, failed: true }));
      return;
    }
    link.update((prev) => ({ ...prev, pending: false, failed: false }));
  },
});

/** Read the create failure as the plain message the form shows. */
export function readSubmitMessage(error: unknown): string {
  if (isError(error, "BadCreateInput")) return error.payload.reason;
  const offline = readOfflineMessage(error);
  if (offline !== null) return offline;
  if (isHttpError(error, "ResponseFailed")) return readHttpMessage(error.payload.response.status);
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Could not save the issue.";
}

/** Read the save failure as the notice plus the conflicting current issue, if one arrived. */
export function readEditError(error: unknown): {
  readonly message: string;
  readonly current: Issues.Issue | null;
} {
  if (isError(error, "IssueConflict")) {
    return {
      message: "Someone else saved first. Your draft is kept — reload their change, then save.",
      current: error.payload.current,
    };
  }
  if (isError(error, "BadEditInput")) return { message: error.payload.reason, current: null };
  const offline = readOfflineMessage(error);
  if (offline !== null) return { message: offline, current: null };
  if (isHttpError(error, "ResponseFailed")) {
    if (error.payload.response.status === 409) {
      return { message: "Someone else saved first. Reload and try again.", current: null };
    }
    return { message: readHttpMessage(error.payload.response.status), current: null };
  }
  if (error instanceof Error && error.message.length > 0) {
    return { message: error.message, current: null };
  }
  return { message: "Could not save. Try again.", current: null };
}

/** Read a 409 body as its current saved issue, or null when it carries none. */
export function readConflictBody(raw: unknown): { readonly current: Issues.Issue } | null {
  if (!isRecord(raw) || raw.current === undefined) return null;
  try {
    return { current: parseIssue(raw.current) };
  } catch {
    return null;
  }
}

/** Read the conflicting current issue stored on a 409 response, if the body carries one. */
export async function readStoredConflict(error: unknown): Promise<Issues.Issue | null> {
  if (!isHttpError(error, "ResponseFailed")) return null;
  if (error.payload.response.status !== 409) return null;
  const body = readConflictBody(await error.payload.response.json());
  return body === null ? null : body.current;
}

/** Read the comment failure as the plain message the form shows. */
export function readCommentError(error: unknown): string {
  if (isError(error, "BadCommentInput")) return error.payload.reason;
  const offline = readOfflineMessage(error);
  if (offline !== null) return offline;
  if (isHttpError(error, "ResponseFailed")) return readHttpMessage(error.payload.response.status);
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Could not post. Try again.";
}

/** Read the detail failure as the plain message shown above the last saved detail. */
export function readDetailError(error: unknown): string {
  if (isHttpError(error, "RequestFailed")) {
    return "Could not reach the server. Showing the last saved detail.";
  }
  if (isHttpError(error, "ResponseFailed")) {
    if (error.payload.response.status === 404) return "That issue is gone. Reload the list.";
    return "Could not refresh this issue. Showing the last saved detail.";
  }
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Could not load the issue.";
}

/** Name one status for the list and detail rows. */
export function statusName(status: Issues.Status): string {
  if (status === "open") return "Open";
  if (status === "in_progress") return "In progress";
  return "Done";
}

/** Name one issue's assignee for the list and detail rows. */
export function assigneeName(issue: Issues.Issue): string {
  return issue.assignee ?? "Unassigned";
}

/** True when one issue passes the list filter. */
export function matches(issue: Issues.Issue, shown: Filter): boolean {
  if (shown === "all") return true;
  return issue.status === shown;
}

/** Admit one status option from the edit select; undefined leaves the draft alone. */
export function readStatusOption(value: string): Issues.Status | undefined {
  if (value === "open" || value === "in_progress" || value === "done") return value;
  return undefined;
}

/** Read one HTTP status as the plain message the forms show. */
function readHttpMessage(status: number): string {
  if (status === 404) return "That issue is gone. Reload the list.";
  if (status === 409) return "Someone else saved first. Reload and try again.";
  return "Could not save. Try again.";
}

/** Read a dropped wire as the plain message the forms show, or null when it is not offline. */
function readOfflineMessage(error: unknown): string | null {
  if (isHttpError(error, "RequestFailed")) {
    return "Could not reach the server. Your work is kept — try again.";
  }
  return null;
}
