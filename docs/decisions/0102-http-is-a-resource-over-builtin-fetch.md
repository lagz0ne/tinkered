# 0102 HTTP is a resource over built-in fetch

Date: 2026-10-04. Status: accepted. Refines: 0035, 0100, 0101.

## Context

The DeepSeek flight trial called the global `fetch` from inside operations.
Those calls had no span and no edge in the graph.
A scope close could not abort them.
Jev rule S24 was off for the trial, because the Start scaffold
shipped no HTTP client after `@tinker/http` became copied source.

The user ruled: fetch is a resource, so it shows on the span,
and it wraps the built-in.

## Precedent

ADR 0035, on Effect's `HttpClient`: a `backend` tag holds the function
that sends a request (Effect's `Fetch` tag, Go's `Transport`).
A client resource sends through it.
An HTTP call is an operation, so its span nests by construction.

Where we are simpler: no frame, no config tag, no retry.
The scaffold ships three declared units and nothing else.

## Decision

The Start scaffold ships, in `src/scaffold/backend/http.ts`:

```ts
// Wraps the built-in once; tests bind a fake here.
export const httpBackend = tag<typeof fetch>({
  label: "http.backend",
  default: (input, init) => fetch(input, init),
});

// Owns every request in flight; scope close aborts them.
export const http = resource({
  label: "http",
  depends: { send: httpBackend },
  factory: ({ send }, ctx) => ({ send /* + abort on close */ }),
});

// One call = one child span `http <METHOD> <path>`.
export const httpRequest = operation({
  label: "http.request",
  input: requestShape, // url, method, headers, body
  depends: { http },
  run: ({ http }, ctx) => /* send, record status */,
});
```

A caller depends on `httpRequest.controller` and runs it.
The request inherits the caller's cancel signal.
Its span is a child of the caller's span, with method, path, and status.
Nothing passes `ctx` around; the input is exactly the request.

App code never calls `fetch` directly.
`check:plain` fails on built-in fetch in `src/` outside `src/scaffold/http-backend.ts`.
Jev rule S24 is on again for every suite, and names `httpRequest`.
The telemetry sender uses `httpBackend` too; `telemetryBackend` goes.

## Consequences

- Every outgoing request is on the span tree and in the graph.
- Tests swap `httpBackend`; nobody patches the global `fetch`.
- One more hop per request: a subflow run. It is cheap next to a network call.
- Telemetry's own requests must not open spans of their own,
  or telemetry would trace itself; its sender uses `httpBackend` directly.
