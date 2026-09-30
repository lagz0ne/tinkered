import type { Readable, Writable } from "node:stream";
import { data, extension, tag } from "@tinker/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { searchMcp } from "./search.ts";

export declare namespace Stdio {
  /** Borrowed streams: the transport removes its listeners but does not end the streams. */
  type Streams = { input: Readable; output: Writable };
}

export const streams = tag<Stdio.Streams>({ label: "stdio.streams" });
export const stopping = data({ label: "stdio.stopping", initial: false });

/** Start after the MCP driver; every listener and transport belongs to this root. */
export const stdio = extension({
  label: "stdio.server",
  hooks: {
    start: async (event) => {
      await event.next();
      const server = event.resolve(searchMcp);
      const { input, output } = event.resolve(streams);
      const stopped = event.controller(stopping);
      const transport = new StdioServerTransport(input, output);
      const done = (): void => {
        if (!event.signal.aborted) stopped.set(true);
      };
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
