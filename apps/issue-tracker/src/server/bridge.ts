import { createScope, type Scope } from "@tinker/core";
import { source, sync, type Sync } from "@tinker/sync";
import { issueList, parseCreateInput, type Issues } from "../shared/issues.ts";
import { createIssue, listIssues } from "./operations.ts";
import { store } from "./store.ts";

/** Run the save: one short transaction, then publish the committed list on the
 * owning root. A rejected save publishes nothing. */
async function saveNow(scope: Scope.Handle, raw: unknown): Promise<Issues.Issue> {
  const input = parseCreateInput(raw);
  const saved = await scope.session((s) => s.run(createIssue, { input }));
  const all = await scope.run(listIssues);
  scope.controller(issueList).set(all);
  return saved;
}

/** PGlite is single-connection: short write transactions queue here instead of
 * overlapping held-open callbacks. Reads stay unserialized. */
export function createSaver(scope: Scope.Handle): (raw: unknown) => Promise<Issues.Issue> {
  let tail: Promise<void> = Promise.resolve();
  return (raw) => {
    const run = tail.then(() => saveNow(scope, raw));
    tail = run.then(onSettled, onSettled);
    return run;
  };
}

function onSettled(): void {}

/** The booted server composition: the owning root plus the exact source
 * extension installed on it. Callers resolve this same object; a fresh
 * source() call is a different identity and will not resolve. */
export type Booted = {
  readonly scope: Scope.Handle;
  readonly src: Scope.Extension<Sync.Source>;
};

/** Boot the server scope: PGlite at dataPath, restored list, sync source. */
export async function bootScope(dataPath: string | undefined): Promise<Booted> {
  const src = source();
  const scope = createScope({ tags: [store.config(dataPath), sync(issueList)], extensions: [src] });
  const saved = await scope.run(listIssues);
  scope.controller(issueList).set(saved);
  await scope.ready;
  return { scope, src };
}
