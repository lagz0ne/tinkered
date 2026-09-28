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
import { raise } from "../errors.ts";
import { activityRows, commentRows, issueRows, store } from "./store.ts";

/** Load one saved issue inside the caller's transaction. A missing id raises
 * IssueNotFound here, so the failure's origin names this step. */
export const loadSaved = operation({
  label: "loadSaved",
  input: parseIssueId,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => {
    const rows = await tx.select().from(issueRows).where(eq(issueRows.id, ctx.input));
    const found = rows.at(0);
    if (found === undefined) raise("IssueNotFound", { id: ctx.input });
    return parseIssue({ ...found });
  },
});

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

/** Write an edited issue's fields over its saved row, in the caller's transaction. */
export const writeIssue = operation({
  label: "writeIssue",
  input: parseIssue,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => {
    const updated = ctx.input;
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
  },
});

/** Append one activity row in the caller's transaction. The caller draws the id
 * from `ctx.random`, so a seeded scope replays the same ids in the same order. */
export const recordActivity = operation({
  label: "recordActivity",
  input: parseActivity,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => {
    await tx.insert(activityRows).values(ctx.input);
  },
});

/** Save one issue row inside the caller's short transaction session. */
export const createIssue = operation({
  label: "createIssue",
  input: parseCreateInput,
  depends: { tx: store.tx, record: recordActivity },
  run: async ({ tx, record }, ctx) => {
    const now = ctx.clock.currentTimeMillis();
    const issue: Issues.Issue = {
      id: ctx.random.uuid(),
      title: ctx.input.title,
      description: ctx.input.description,
      status: "open",
      assignee: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(issueRows).values(issue);
    await record.run({
      input: {
        id: ctx.random.uuid(),
        issueId: issue.id,
        kind: "created",
        summary: "created",
        createdAt: now,
      },
    });
    return issue;
  },
});

/** Save an edit guarded by the revision originally opened. A stale base
 * revision raises IssueConflict carrying the current saved issue; nothing is
 * written and no activity is recorded. */
export const editIssue = operation({
  label: "editIssue",
  input: parseEditInput,
  depends: { load: loadSaved, write: writeIssue, record: recordActivity },
  run: async ({ load, write, record }, ctx) => {
    const saved = await load.run({ input: ctx.input.id });
    checkFresh(saved, ctx.input.baseRevision);
    const updated = applyEdit(saved, ctx.input, ctx.clock.currentTimeMillis());
    await write.run({ input: updated });
    const names = editNames(ctx.input);
    await record.run({
      input: {
        id: ctx.random.uuid(),
        issueId: updated.id,
        kind: "edited",
        summary: names.length > 0 ? `edited ${names.join(", ")}` : "edited",
        createdAt: updated.updatedAt,
      },
    });
    return updated;
  },
});

/** Append one comment. Comments need no edit revision; the issue's updated
 * time moves so watchers reload, but its revision does not. */
export const addComment = operation({
  label: "addComment",
  input: parseCommentInput,
  depends: { tx: store.tx, load: loadSaved, record: recordActivity },
  run: async ({ tx, load, record }, ctx) => {
    await load.run({ input: ctx.input.issueId });
    const now = ctx.clock.currentTimeMillis();
    const comment: Issues.Comment = {
      id: ctx.random.uuid(),
      issueId: ctx.input.issueId,
      author: ctx.input.author,
      text: ctx.input.text,
      createdAt: now,
    };
    await tx.insert(commentRows).values(comment);
    await tx.update(issueRows).set({ updatedAt: now }).where(eq(issueRows.id, ctx.input.issueId));
    await record.run({
      input: {
        id: ctx.random.uuid(),
        issueId: ctx.input.issueId,
        kind: "commented",
        summary: `${ctx.input.author} commented`,
        createdAt: now,
      },
    });
    return comment;
  },
});

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

/** Read every saved row, oldest first: the one select both the root list read
 * and the publish-after-commit share. Used at boot to restore the shared truth. */
export const listIssues = operation({
  label: "listIssues",
  depends: { db: store.db },
  run: async ({ db }): Promise<readonly Issues.Issue[]> => {
    const rows = await db.select().from(issueRows).orderBy(asc(issueRows.createdAt));
    return rows.map((row) => parseIssue({ ...row }));
  },
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
  depends: { all: listIssues, list: issueList.controller },
  run: async ({ all, list }) => {
    const fresh = await all.run();
    if (JSON.stringify(list.get()) !== JSON.stringify(fresh)) list.set(fresh);
  },
});

/** The shared cell the published list lives in. Re-exported for the bridge. */
export { issueList };
