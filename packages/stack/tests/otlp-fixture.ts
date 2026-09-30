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

export class Receiver {
  state = {
    status: 200,
    hang: false,
    packets: [] as { path: string; type?: string; body: Packet }[],
  };
  private server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      this.state.packets.push({
        path: req.url!,
        type: req.headers["content-type"],
        body: JSON.parse(body),
      });
      if (!this.state.hang)
        res.writeHead(this.state.status, { "content-type": "application/json" }).end("{}");
    });
  });
  url = "";

  async listen(): Promise<this> {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (!address || typeof address === "string") return expect.unreachable();
    this.url = `http://127.0.0.1:${address.port}`;
    return this;
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
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
