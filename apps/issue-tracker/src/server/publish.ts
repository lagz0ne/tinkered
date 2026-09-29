import { extension, type Scope } from "@tinker/core";
import { request } from "@tinker/hono";
import { describeError } from "./observe.ts";
import { publishIssues } from "./operations.ts";

/** Publish during start and after commit (ADR 0051): the `session` hook fires when each request
 * session closes, so a committed mutating request republishes the shared list
 * while manual `scope.session` saves in tests stay silent. A request session is
 * the one whose `request` tag holds this request's web Request: read the
 * method after `next()` (core keeps a session's tags readable until its hooks
 * return, ADR 0069), and run the publish op at the root only after a
 * successful close of a non-GET. The
 * `start` hand is kept as a publish thunk, never as a held handle. The row is
 * saved by then, so a publish that fails (the read after commit) must not turn
 * the answered request into a 500 — a `session` hook never throws (core); the
 * thunk logs `publish failed` and the next commit republishes. The boot publish
 * runs after `next()` and rejects `ready` on failure. */
export function publish(): Scope.Extension<void> {
  let runPublish: (() => Promise<unknown>) | undefined;
  return extension({
    label: "tracker.publish",
    start: async (scope, _ctx, next) => {
      runPublish = () =>
        scope.run({
          label: "publish after commit",
          depends: { publish: publishIssues },
          run: async ({ publish }, ctx) => {
            try {
              await publish.run();
            } catch (error) {
              ctx.log.error("publish failed", describeError(error));
            }
          },
        });
      await next();
      await scope.run(publishIssues);
    },
    session: async (handle, next) => {
      const ended = await next();
      const found = handle.resolve(request.optional);
      if (ended.status === "success" && found.present && found.value.method !== "GET")
        await runPublish?.();
      return ended;
    },
  });
}
