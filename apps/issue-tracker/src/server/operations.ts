import { randomUUID } from "node:crypto";
import { operation } from "@tinker/core";
import { issueList, parseCreateInput, parseIssue, type Issues } from "../shared/issues.ts";
import { issueRows, store } from "./store.ts";

/** Save one issue row inside the caller's short transaction session. */
export const createIssue = operation({
  label: "createIssue",
  input: parseCreateInput,
  depends: { tx: store.tx },
  run: async ({ tx }, ctx) => {
    const issue: Issues.Issue = {
      id: randomUUID(),
      title: ctx.input.title,
      description: ctx.input.description,
      status: "open",
    };
    await tx.insert(issueRows).values(issue);
    return issue;
  },
});

/** Read every saved row. Used at boot to restore the shared truth. */
export const listIssues = operation({
  label: "listIssues",
  depends: { db: store.db },
  run: async ({ db }) => {
    const rows = await db.select().from(issueRows);
    return rows.map(parseIssue);
  },
});

/** The shared cell the published list lives in. Re-exported for the bridge. */
export { issueList };
