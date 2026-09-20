import { extension, type Scope } from "@tinker/core";
import { request } from "@tinker/hono";
import { publishIssues } from "./operations.ts";

/** Publish after commit (ADR 0051): the `session` hook fires when each request
 * session closes, so a committed mutating request republishes the shared list
 * while manual `scope.session` saves in tests stay silent. A request session is
 * the one whose `request` tag holds this request's web Request: capture the
 * method before `next()` (a read would cross the closed layer after), and run
 * the publish op at the root only after a successful close of a non-GET. The
 * `start` hand is kept as a publish thunk, never as a held handle. */
export function publishAfterCommit(): Scope.Extension<void> {
  let runPublish: (() => Promise<unknown>) | undefined;
  return extension({
    label: "tracker.publishAfterCommit",
    start: (scope, _ctx, next) => {
      runPublish = () => scope.run(publishIssues);
      return next();
    },
    session: async (handle, next) => {
      const found = handle.resolve(request.optional);
      const method = found.present ? found.value.method : undefined;
      const ended = await next();
      if (ended.status === "success" && method !== undefined && method !== "GET")
        await runPublish?.();
      return ended;
    },
  });
}
