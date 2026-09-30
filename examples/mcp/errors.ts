import type { Scope } from "@tinker/core";

/** A successful run must still report a failed client close, root, or root teardown. */
export function checkClosed(client: PromiseSettledResult<void>, root: Scope.Result): void {
  if (client.status === "rejected") throw client.reason;
  if (root.status === "failed") throw root.error;
  if (root.teardownErrors?.length) {
    const [error] = root.teardownErrors;
    throw error;
  }
}
