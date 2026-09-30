import { LEVELS, type Observe, type Scope } from "@tinker/core";
import { describeError } from "./observe.ts";

/** The caller supplies the phase because a Result does not say whether boot finished.
 * Read only after cleanup ends; failed work or teardown errors answer one (ADR 0085). */
export function readExitCode(
  result: Scope.Result,
  observe: Observe.Config & { clock: () => number },
  phase: "boot" | "shutdown",
): number {
  if (result.status === "failed") {
    writeFailure(observe, `${phase} failed`, describeError(result.error));
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
