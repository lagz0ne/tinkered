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

export function isError(error: unknown, name: "InvalidFlightData"): error is FlightDataError {
  return error instanceof FlightDataError && error.name === name;
}
