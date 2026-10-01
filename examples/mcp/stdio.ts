import type { Readable, Writable } from "node:stream";
import { extension, tag } from "@tinker/core";
import { stop } from "@tinker/process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { searchMcp } from "./search.ts";

export declare namespace Stdio {
  /** Borrowed streams: the transport removes its listeners but does not end the streams. */
  type Streams = { input: Readable; output: Writable };
}

export const streams = tag<Stdio.Streams>({ label: "stdio.streams" });

/** Start after the MCP driver; every listener and transport belongs to this root. */
export const stdio = extension({
  label: "stdio.server",
  hooks: {
    start: async (event) => {
      await event.next();
      const server = event.resolve(searchMcp);
      const { input, output } = event.resolve(streams.required);
      const done = event.resolve(stop.required);
      const transport = new StdioServerTransport(input, output);
      event.defer(() => transport.close());
      event.defer(() => {
        server.server.onclose = undefined;
        return server.close();
      });
      event.defer(() => {
        input.removeListener("end", done);
      });
      input.once("end", done);
      server.server.onclose = done;
      await server.connect(transport);
      if (input.readableEnded) done();
    },
  },
});
