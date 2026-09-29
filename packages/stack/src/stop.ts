import { LEVELS, type Observe, type Scope } from "@tinker/core";
import { describeError } from "./observe.ts";

/** Borrow the root to join boot and close. A failed ready starts cleanup in core
 * but does not join it, so await close before reporting the failure (ADR 0078). */
export async function runUntilStop(
  scope: Pick<Scope.Handle, "ready" | "close">,
  stop: AbortSignal,
  observe: Observe.Config & { clock: () => number },
): Promise<number> {
  try {
    await scope.ready;
  } catch (error) {
    await scope.close();
    writeFailure(observe, "boot failed", describeError(error));
    return 1;
  }
  await new Promise<void>((resolve) => {
    if (stop.aborted) resolve();
    else stop.addEventListener("abort", () => resolve(), { once: true });
  });
  const result = await scope.close({ graceful: true });
  if (result.status === "failed") {
    writeFailure(observe, "shutdown failed", describeError(result.error));
    return 1;
  }
  if (result.teardownErrors !== undefined && result.teardownErrors.length > 0) {
    writeFailure(observe, "shutdown failed", {
      teardown: result.teardownErrors.map(describeError),
    });
    return 1;
  }
  return 0;
}

function writeFailure(
  observe: Observe.Config & { clock: () => number },
  message: string,
  attributes: Record<string, unknown>,
): void {
  observe.log?.({
    time: observe.clock(),
    level: LEVELS.error,
    message,
    attributes,
    span: undefined,
  });
}
