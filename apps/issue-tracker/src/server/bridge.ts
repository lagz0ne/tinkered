import { createScope, type Scope } from "@tinker/core";
import { source, sync, type Sync } from "@tinker/sync";
import { issueList, parseCreateInput, type Issues } from "../shared/issues.ts";
import { createIssue, listIssues } from "./operations.ts";
import { store } from "./store.ts";

export declare namespace Booted {
  /** Save one issue: the single queued saver owned by the booted authority. */
  export type Save = (input: Issues.CreateInput) => Promise<Issues.Issue>;
  /** The booted server composition: the owning root, the exact source
   * extension installed on it, and its one saver. Callers resolve this same
   * src object; a fresh source() call is a different identity. */
  export type Composed = {
    readonly scope: Scope.Handle;
    readonly src: Scope.Extension<Sync.Source>;
    readonly save: Save;
  };
}

/** Run the save: one short transaction, then publish the committed list on the
 * owning root. The input arrives typed through the operation edge, which
 * already admitted it; a rejected save publishes nothing. */
async function saveNow(scope: Scope.Handle, input: Issues.CreateInput): Promise<Issues.Issue> {
  const saved = await scope.session((s) => s.run(createIssue, { input }));
  const all = await scope.run(listIssues);
  scope.controller(issueList).set(all);
  return saved;
}

/** PGlite is single-connection: short write transactions queue here instead of
 * overlapping held-open callbacks. Reads stay unserialized. */
function createSaver(scope: Scope.Handle): Booted.Save {
  let tail: Promise<void> = Promise.resolve();
  return (input) => {
    const run = tail.then(() => saveNow(scope, input));
    tail = run.then(settleQueue, settleQueue);
    return run;
  };
}

function settleQueue(): void {}

/** Boot the server scope: PGlite at dataPath, restored list, sync source. */
export async function bootScope(dataPath: string | undefined): Promise<Booted.Composed> {
  const src = source();
  const scope = createScope({ tags: [store.config(dataPath), sync(issueList)], extensions: [src] });
  const saved = await scope.run(listIssues);
  scope.controller(issueList).set(saved);
  await scope.ready;
  return { scope, src, save: createSaver(scope) };
}

/** Admit one create payload at the route edge; shared with the HTTP operation. */
export function readCreateInput(raw: unknown): Issues.CreateInput {
  return parseCreateInput(raw);
}
