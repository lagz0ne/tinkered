import { createScope, extension, type Scope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  supplierApp,
  paymentApp,
  supplierId,
  port,
  host,
  controlToken,
  stopSignal,
  webhookUrl,
  webhookSecret,
} from "../src/index.ts";
import { requests } from "../services/http.ts";

const services = [
  { name: "supplier", app: supplierApp },
  { name: "payment", app: paymentApp },
];
const logSchema = z.object({ data: z.array(z.object({ route: z.string(), status: z.number() })) });

test.each(services)(
  "resolving $name requests twice does not register the HTTP stack twice",
  async ({ app }) => {
    const stop = new AbortController();
    let capture!: (scope: Scope.Handle) => void;
    const created = new Promise<Scope.Handle>((resolve) => {
      capture = resolve;
    });
    const scope = createScope({
      signal: stop.signal,
      extensions: [
        extension({
          label: "capture service session",
          hooks: {
            session(event) {
              capture(event.handle);
              return event.next();
            },
          },
        }),
        app,
      ],
      tags: [
        supplierId("supplier-a"),
        port(0),
        host("127.0.0.1"),
        controlToken("grader"),
        stopSignal(stop.signal),
        webhookUrl("http://127.0.0.1:1"),
        webhookSecret("requests-test"),
      ],
    });
    try {
      await scope.ready;
      const session = await created;
      session.resolve(requests);
      session.resolve(requests);
      const { url } = scope.resolve(app);
      await (await fetch(`${url}/missing`)).arrayBuffer();
      const log = logSchema.parse(
        await (
          await fetch(`${url}/control/calls`, { headers: { authorization: "Bearer grader" } })
        ).json(),
      );
      expect(log.data.filter((call) => call.route === "GET /missing")).toEqual([
        { route: "GET /missing", status: 404 },
      ]);
    } finally {
      stop.abort();
      await scope.closed;
    }
  },
);
