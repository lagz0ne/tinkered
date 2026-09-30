import { once } from "node:events";
import { createServer } from "node:http";
import { expect } from "vite-plus/test";

export type Attribute = { key: string; value: Record<string, unknown> };
export type Span = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  flags: number;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attribute[];
  events: { name: string; timeUnixNano: string; attributes: Attribute[] }[];
  status: { code: number };
};
export type Log = {
  traceId?: string;
  spanId?: string;
  flags: number;
  timeUnixNano: string;
  severityNumber: number;
  body: { stringValue: string };
  attributes: Attribute[];
};
export type Packet = {
  resourceSpans?: {
    resource: { attributes: Attribute[] };
    scopeSpans: { scope: { name: string }; spans: Span[] }[];
  }[];
  resourceLogs?: {
    resource: { attributes: Attribute[] };
    scopeLogs: { scope: { name: string }; logRecords: Log[] }[];
  }[];
};

export async function receiver() {
  const state = {
    status: 200,
    hang: false,
    packets: [] as { path: string; type?: string; body: Packet }[],
  };
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      state.packets.push({
        path: req.url!,
        type: req.headers["content-type"],
        body: JSON.parse(body),
      });
      if (!state.hang)
        res.writeHead(state.status, { "content-type": "application/json" }).end("{}");
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") return expect.unreachable();
  return {
    state,
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function spans(packets: { body: Packet }[]): Span[] {
  return packets.flatMap(
    ({ body }) =>
      body.resourceSpans?.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ) ?? [],
  );
}

export function logs(packets: { body: Packet }[]): Log[] {
  return packets.flatMap(
    ({ body }) =>
      body.resourceLogs?.flatMap((resource) =>
        resource.scopeLogs.flatMap((scope) => scope.logRecords),
      ) ?? [],
  );
}
