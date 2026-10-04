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

The Start scaffold ships three units:

- `httpBackend` in `src/scaffold/http-backend.ts`.
  A tag with the built-in `fetch` signature.
  Its default calls the built-in; tests bind a fake.
- `http` in `src/scaffold/backend/http.ts`.
  A session-target resource that sends through `httpBackend`.
  It joins the caller's signal, its cleanup signal,
  and the optional `backendStop` and `requestStop` signals.
- `httpRequest` in `src/scaffold/backend/http.ts`.
  An operation with label `http.request`.
  Its branded input checks an HTTP or HTTPS URL,
  a required method, optional headers, and optional body text.
  The method accepts HTTP token characters and becomes upper-case.
  Its result holds status, headers as string arrays, and body text.
  Each `set-cookie` value stays separate.
  Other native header values stay joined in one array entry.

A caller imports through the server seam,
depends on `httpRequest.controller`, and runs it:

```ts
import { operation } from "@tinker/core";
import { httpRequest } from "@/lib/tinker.server";
import { raise } from "@/errors";

export const postNotice = operation({
  label: "postNotice",
  depends: { request: httpRequest.controller },
  run: async ({ request }) => {
    const reply = await request.run({
      rawInput: {
        url: "https://api.example.com/notices",
        method: "POST",
        body: "The order is ready.",
      },
    });
    if (reply.status < 200 || reply.status >= 300) {
      raise("NotificationFailed", {});
    }
    return { sent: true };
  },
});
```

`rawInput` lets the request schema check and brand the input once.
Typed `input` accepts only that checked shape.
The caller maps the reply to a feature value or managed error (ADR 0103).

With observation on, each request makes two spans:

- `http.request`, a child of the caller's span.
- `http <METHOD> <path>`, a child of `http.request`.
  It records method, path, and reply status.
  The path has no query string.

The request inherits the caller's cancel signal through Core.
Nothing passes `ctx` around; the input is the request values.
Non-2xx statuses are results, not request failures.
Sending or body-reading failures raise `HttpRequestFailed`.
Its payload keeps method, path, and only the cause's name and code.
Caller cancellation keeps Core's cancelled result.

`backendStop` and `requestStop` are tags in `backend/lifetime.ts`.
Their labels are `lifetime.backendStop` and `lifetime.requestStop`.
The server entry binds the backend's original stop signal.
Start middleware binds the native request's signal per session.
These signals stop HTTP before graceful shutdown joins running work.
Forced close cancels through the caller's signal.
Resource cleanup aborts the resource's own stop signal.

A direct graceful close with no aborted stop tag still waits
for a pending request.
Core has no session close-start hook to stop that wait.
Cleanup runs after Core joins the work; it cannot end that wait first.

App code never calls `fetch` directly.
`check:plain` bans built-in fetch value uses across `src/`.
Only the `httpBackend` default in `src/scaffold/http-backend.ts` may use it.
App code may not reference `http` or `httpBackend`, even through aliases.
Outside `src/scaffold/`, the check also bans:

- Value imports from `node:http`, `node:https`, `node:http2`,
  `http`, `https`, `http2`, `ws`, and `ofetch`.
- Value imports from `undici`, `axios`, `ky`, `node-fetch`,
  `got`, and `superagent`.
- Value imports from `node:net`, `node:tls`, `net`, `tls`,
  `node:dgram`, and `dgram`.
- Literal subpaths, re-exports, dynamic imports, and `require`
  of those modules.
- Computed import and `require` paths, and `createRequire` uses.
- `XMLHttpRequest` and `navigator.sendBeacon` value uses,
  including destructured globals and literal bracket access.

The check also bans:

- Any app use of the global `Response` outside `src/routes/`
  and `src/scaffold/`, including type references.
- Operations with `Request` input or `Response` output.
  Only the named `handleAuth` mount is excepted (ADR 0103).

Type-only imports and exports remain allowed.
Native `WebSocket` and `EventSource` are outside this HTTP rule (ADR 0048).
Their sync transport resources own and close them through `ctx.defer`.
Jev rule S24 is on again for every suite, and names `httpRequest`.
The fixed telemetry sender uses `httpBackend` directly without request spans.
`telemetryBackend` is retired.

## Consequences

- Every app request through `httpRequest` is on the span tree and in the graph.
- Tests swap `httpBackend`; nobody patches the global `fetch`.
- Each request adds a subflow run and its nested HTTP span.
- Direct graceful close needs a stop signal to end a pending HTTP wait.
- Telemetry's own requests must not open spans of their own,
  or telemetry would trace itself; its sender uses `httpBackend` directly.
