import { createScope, type Scope } from "@tinker/core";
import { source, sync, type Sync } from "@tinker/sync";
import { issueList, type Issues } from "../shared/issues.ts";
import { addComment, createIssue, editIssue, listIssues, readDetail } from "./operations.ts";
import { store } from "./store.ts";

export declare namespace Booted {
  /** Save one issue: the queued savers owned by the booted authority. */
  export type Save = {
    readonly create: (input: Issues.CreateInput) => Promise<Issues.Issue>;
    readonly edit: (input: Issues.EditInput) => Promise<Issues.Issue>;
    readonly comment: (input: Issues.CommentInput) => Promise<Issues.Comment>;
  };
  /** The booted server composition: the owning root, the exact source
   * extension installed on it, its savers, and its serialized detail
   * reader. Callers resolve this same src object; a fresh source() call
   * is a different identity. */
  export type Composed = {
    readonly scope: Scope.Handle;
    readonly src: Scope.Extension<Sync.Source>;
    readonly save: Save;
    readonly detail: (id: string) => Promise<Issues.Detail>;
  };
}

async function publishList(scope: Scope.Handle): Promise<void> {
  const all = await scope.run(listIssues);
  scope.controller(issueList).set(all);
}

async function saveNow<T>(scope: Scope.Handle, work: (s: Scope.Handle) => Promise<T>): Promise<T> {
  const saved = await scope.session(work);
  await publishList(scope);
  return saved;
}

function createSerial(scope: Scope.Handle): {
  save: Booted.Save;
  detail: (id: string) => Promise<Issues.Detail>;
} {
  let tail: Promise<void> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work);
    tail = run.then(settleQueue, settleQueue);
    return run;
  }
  return {
    save: {
      create: (input) => enqueue(() => saveNow(scope, (s) => s.run(createIssue, { input }))),
      edit: (input) => enqueue(() => saveNow(scope, (s) => s.run(editIssue, { input }))),
      comment: (input) => enqueue(() => saveNow(scope, (s) => s.run(addComment, { input }))),
    },
    detail: (id) => enqueue(() => scope.session((s) => s.run(readDetail, { input: id }))),
  };
}

function settleQueue(): void {}

/** Boot the owning scope with its save queue. Each save runs its short
 * transaction, then closes and publishes the committed list through the
 * root controller. Detail reads serialize on the same queue. */
export async function bootScope(dataPath: string | undefined): Promise<Booted.Composed> {
  const src = source();
  const scope = createScope({ tags: [store.config(dataPath), sync(issueList)], extensions: [src] });
  await publishList(scope);
  await scope.ready;
  const serial = createSerial(scope);
  return { scope, src, save: serial.save, detail: serial.detail };
}
