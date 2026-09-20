import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { operation } from "@tinker/core";
import {
  issueList,
  parseActivity,
  parseComment,
  parseCommentInput,
  parseCreateInput,
  parseEditInput,
  parseIssue,
  parseIssueId,
  type Issues,
} from "../shared/issues.ts";
import type { DrizzleStore } from "@tinker/drizzle";
import { raise } from "../errors.ts";
import { activityRows, commentRows, issueRows, store, type Store } from "./store.ts";

type Tx = DrizzleStore.Tx<Awaited<Store.Database>>;
type Db = Awaited<Store.Database>;

/** Read every saved row, oldest first: the one select both the root list read
 * and the publish-after-commit share. */
async function selectAllIssues(db: Db): Promise<readonly Issues.Issue[]> {
  const rows = await db.select().from(issueRows).orderBy(asc(issueRows.createdAt));
  return rows.map((row) => parseIssue({ ...row }));
}

async function loadSaved(tx: Tx, id: string): Promise<Issues.Issue> {
  const rows = await tx.select().from(issueRows).where(eq(issueRows.id, id));
  const found = rows.at(0);
  if (found === undefined) raise("IssueNotFound", { id });
  return parseIssue({ ...found });
}

function checkFresh(saved: Issues.Issue, baseRevision: number): void {
  if (saved.revision !== baseRevision) {
    raise("IssueConflict", { id: saved.id, currentRevision: saved.revision, current: saved });
  }
}

function applyEdit(saved: Issues.Issue, input: Issues.EditInput, now: number): Issues.Issue {
  return {
    ...saved,
    title: input.title ?? saved.title,
    description: input.description ?? saved.description,
    status: input.status ?? saved.status,
    assignee: input.assignee === undefined ? saved.assignee : input.assignee,
    revision: saved.revision + 1,
    updatedAt: now,
  };
}

function editNames(input: Issues.EditInput): string[] {
  const names: string[] = [];
  if (input.title !== undefined) names.push("title");
  if (input.description !== undefined) names.push("description");
  if (input.status !== undefined) names.push("status");
  if (input.assignee !== undefined) names.push("assignee");
  return names;
}

async function writeIssue(tx: Tx, updated: Issues.Issue): Promise<void> {
  await tx
    .update(issueRows)
    .set({
      title: updated.title,
      description: updated.description,
      status: updated.status,
      assignee: updated.assignee,
      revision: updated.revision,
      updatedAt: updated.updatedAt,
    })
    .where(eq(issueRows.id, updated.id));
}

async function recordActivity(
  tx: Tx,
  issueId: string,
  kind: Issues.Activity["kind"],
  summary: string,
  now: number,
): Promise<void> {
  await tx.insert(activityRows).values({
    id: randomUUID(),
    issueId,
    kind,
    summary,
    createdAt: now,
  });
}

/** Save one issue row inside the caller's short transaction session. */
export const createIssue = operation({
  label: "createIssue",
  input: parseCreateInput,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => {
    const now = ctx.clock.currentTimeMillis();
    const issue: Issues.Issue = {
      id: randomUUID(),
      title: ctx.input.title,
      description: ctx.input.description,
      status: "open",
      assignee: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(issueRows).values(issue);
    await recordActivity(tx, issue.id, "created", "created", now);
    return issue;
  },
});

/** Save an edit guarded by the revision originally opened. A stale base
 * revision raises IssueConflict carrying the current saved issue; nothing is
 * written and no activity is recorded. */
export const editIssue = operation({
  label: "editIssue",
  input: parseEditInput,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => {
    const saved = await loadSaved(tx, ctx.input.id);
    checkFresh(saved, ctx.input.baseRevision);
    const updated = applyEdit(saved, ctx.input, ctx.clock.currentTimeMillis());
    await writeIssue(tx, updated);
    const names = editNames(ctx.input);
    await recordActivity(
      tx,
      updated.id,
      "edited",
      names.length > 0 ? `edited ${names.join(", ")}` : "edited",
      updated.updatedAt,
    );
    return updated;
  },
});

/** Append one comment. Comments need no edit revision; the issue's updated
 * time moves so watchers reload, but its revision does not. */
export const addComment = operation({
  label: "addComment",
  input: parseCommentInput,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => {
    await loadSaved(tx, ctx.input.issueId);
    const now = ctx.clock.currentTimeMillis();
    const comment: Issues.Comment = {
      id: randomUUID(),
      issueId: ctx.input.issueId,
      author: ctx.input.author,
      text: ctx.input.text,
      createdAt: now,
    };
    await tx.insert(commentRows).values(comment);
    await tx.update(issueRows).set({ updatedAt: now }).where(eq(issueRows.id, ctx.input.issueId));
    await recordActivity(tx, ctx.input.issueId, "commented", `${ctx.input.author} commented`, now);
    return comment;
  },
});

/** Read one issue with its comments and activity, oldest first. */
export const readDetail = operation({
  label: "readDetail",
  input: parseIssueId,
  depends: { db: store.db },
  run: async ({ db }, ctx) => {
    const rows = await db.select().from(issueRows).where(eq(issueRows.id, ctx.input));
    const found = rows.at(0);
    if (found === undefined) raise("IssueNotFound", { id: ctx.input });
    const comments = await db
      .select()
      .from(commentRows)
      .where(eq(commentRows.issueId, ctx.input))
      .orderBy(asc(commentRows.createdAt), asc(commentRows.id));
    const activity = await db
      .select()
      .from(activityRows)
      .where(eq(activityRows.issueId, ctx.input))
      .orderBy(asc(activityRows.createdAt), asc(activityRows.id));
    const detail: Issues.Detail = {
      issue: parseIssue({ ...found }),
      comments: comments.map((row) => parseComment({ ...row })),
      activity: activity.map((row) => parseActivity({ ...row })),
    };
    return detail;
  },
});

/** Read every saved row. Used at boot to restore the shared truth. */
export const listIssues = operation({
  label: "listIssues",
  depends: { db: store.db },
  run: ({ db }) => selectAllIssues(db),
});

/** Read the published list: what a request answers without touching the table. */
export const readIssues = operation({
  label: "readIssues",
  depends: { issues: issueList },
  run: ({ issues }) => issues,
});

/** Publish the committed rows to the shared cell. Runs at the root only — after
 * `scope.ready` at boot and after a request session committed — so the sync
 * source fans the committed truth out to every viewer. Skips the write when the
 * saved rows serialize equal to the published ones, so a rejected request that
 * changed nothing keeps the cell identity (and sends no snapshot). */
export const publishIssues = operation({
  label: "publishIssues",
  depends: { db: store.db, list: issueList.controller },
  run: async ({ db, list }) => {
    const fresh = await selectAllIssues(db);
    if (JSON.stringify(list.get()) !== JSON.stringify(fresh)) list.set(fresh);
  },
});

/** The shared cell the published list lives in. Re-exported for the bridge. */
export { issueList };
