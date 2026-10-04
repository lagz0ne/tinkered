import { operation, resource, tag } from "@tinker/core";
import { z } from "zod";

/** Tests bind this tag; service code sends through httpRequest instead. */
export const httpBackend = tag<typeof fetch>({
  label: "http.backend",
  default: (input, init) => fetch(input, init),
});

const requestShape = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  method: z
    .string()
    .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
    .toUpperCase(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
});

/** The service owns requests through body reading; its close hook stops them before draining. */
export const http = resource({
  label: "http",
  depends: { send: httpBackend },
  factory: ({ send }, ctx) => {
    const stop = new AbortController();
    ctx.defer(() => stop.abort());
    return {
      close() {
        stop.abort();
      },
      async send(url: string, init: RequestInit & { signal: AbortSignal }) {
        const response = await send(url, {
          ...init,
          signal: AbortSignal.any([init.signal, stop.signal]),
        });
        await response.arrayBuffer();
        return { status: response.status };
      },
    };
  },
});

/** Statuses are replies; sending and body reading failures raise HttpRequestFailed. */
export const httpRequest = operation({
  label: "http.request",
  input: requestShape,
  depends: { http },
  run: ({ http }, ctx) => {
    const { url, method, headers, body } = ctx.input;
    const path = new URL(url).pathname;
    return ctx.obs.child(`http ${method} ${path}`, async (span) => {
      if (span) {
        span.attributes["http.request.method"] = method;
        span.attributes["url.path"] = path;
      }
      try {
        const response = await http.send(url, { method, headers, body, signal: ctx.signal });
        if (span) span.attributes["http.response.status_code"] = response.status;
        return response;
      } catch {
        ctx.signal.throwIfAborted();
        return ctx.raise("HttpRequestFailed", { method, path });
      }
    });
  },
});
