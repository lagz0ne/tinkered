export declare namespace FlightDataErrors {
  type Payload = { file: string; reason: string };
}

class FlightDataError extends Error {
  name = "InvalidFlightData";
  payload: FlightDataErrors.Payload;

  constructor(payload: FlightDataErrors.Payload) {
    super(payload.reason);
    this.payload = payload;
  }
}

export function failFlightData(payload: FlightDataErrors.Payload): never {
  throw new FlightDataError(payload);
}

export function isError(error: unknown, name: "InvalidFlightData"): error is FlightDataError;
export function isError(error: unknown, name: "InvalidFlightService"): error is FlightServiceError;
export function isError(
  error: unknown,
  name: "InvalidFlightData" | "InvalidFlightService",
): boolean {
  return (
    (error instanceof FlightDataError || error instanceof FlightServiceError) && error.name === name
  );
}

export declare namespace FlightServiceErrors {
  type Payload = { reason: string };
}

class FlightServiceError extends Error {
  name = "InvalidFlightService";
  payload: FlightServiceErrors.Payload;

  constructor(payload: FlightServiceErrors.Payload) {
    super(payload.reason);
    this.payload = payload;
  }
}

export function failFlightService(payload: FlightServiceErrors.Payload): never {
  throw new FlightServiceError(payload);
}
