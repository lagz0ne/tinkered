export declare namespace FlightDataErrors {
  type Payload = { file: string; reason: string };
  type Of = Error & { kind: "InvalidFlightData"; payload: Payload };
}

/**
 * Keeps the reader's failure detail available to callers through the package guard.
 * @param payload - File and reason from fixture parsing; needed to explain invalid data.
 */
export function failFlightData(payload: FlightDataErrors.Payload): never {
  throw Object.assign(new Error("InvalidFlightData"), { kind: "InvalidFlightData", payload });
}

/**
 * Narrows a managed failure by its stable kind without inspecting its payload again.
 * @param error - Caught value from a package call; needed to select a managed failure.
 * @param kind - Failure kind chosen by the caller; needed to narrow the payload type.
 */
export function isError(error: unknown, kind: "InvalidFlightData"): error is FlightDataErrors.Of;
export function isError(
  error: unknown,
  kind: "InvalidFlightService",
): error is FlightServiceErrors.Of;
export function isError(
  error: unknown,
  kind: "InvalidFlightData" | "InvalidFlightService",
): boolean {
  return error instanceof Error && "kind" in error && error.kind === kind;
}

export declare namespace FlightServiceErrors {
  type Payload = { reason: string };
  type Of = Error & { kind: "InvalidFlightService"; payload: Payload };
}

/**
 * Uses a plain managed error so listener failures need no error class (ADR 0099).
 * @param payload - Reason from listener setup; needed to explain an invalid service address.
 */
export function failFlightService(payload: FlightServiceErrors.Payload): never {
  throw Object.assign(new Error("InvalidFlightService"), { kind: "InvalidFlightService", payload });
}
