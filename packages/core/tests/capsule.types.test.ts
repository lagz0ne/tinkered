import { expectTypeOf, test } from "vite-plus/test";

import * as core from "@/index";
import { capsule, createScope, data, operation, resource, tag, type Scope } from "@/index";

const smtpUrl = tag<string>({ label: "tt.smtpUrl" });
const from = tag({ label: "tt.from", default: "noreply@example.com" });
const send = operation({ label: "tt.send", run: () => "sent" });
const meta = { role: "setup", explain: "Type check only" } as const;

/** Never called: it only has to type-check. */
const install = (options: Scope.RootOptions): void => void options;

test("A01 a required key left out is a type error", () => {
  const mail = capsule({ label: "tt", config: { smtpUrl, from } });

  mail({ smtpUrl: "smtp://x" });
  // @ts-expect-error a required key is left out
  mail({});
  // @ts-expect-error a capsule with a required key needs its values
  mail();
});

test("A04 no hook event has resolve, controller or scope; each has config and load", () => {
  capsule({
    label: "tt",
    config: { from },
    hooks: {
      start: (event) => {
        expectTypeOf(event).not.toHaveProperty("resolve");
        expectTypeOf(event).not.toHaveProperty("controller");
        expectTypeOf(event).not.toHaveProperty("scope");
        expectTypeOf(event.config.from).toEqualTypeOf<string>();
        expectTypeOf(event).toHaveProperty("load");
      },
      resolve: (event) => {
        expectTypeOf(event).not.toHaveProperty("resolve");
        expectTypeOf(event).not.toHaveProperty("controller");
        expectTypeOf(event).toHaveProperty("config");
        return event.next();
      },
      run: (event) => {
        expectTypeOf(event).not.toHaveProperty("resolve");
        expectTypeOf(event).not.toHaveProperty("controller");
        expectTypeOf(event).toHaveProperty("load");
        return event.next();
      },
      write: (event) => {
        expectTypeOf(event).not.toHaveProperty("resolve");
        expectTypeOf(event).not.toHaveProperty("controller");
        event.next();
      },
      close: (event) => {
        expectTypeOf(event).not.toHaveProperty("resolve");
        expectTypeOf(event).not.toHaveProperty("controller");
        expectTypeOf(event).not.toHaveProperty("scope");
        return event.next();
      },
      session: (event) => {
        expectTypeOf(event).not.toHaveProperty("resolve");
        expectTypeOf(event).not.toHaveProperty("controller");
        return event.next();
      },
    },
  });
});

test("load, run and settle type as the spec says, and meta is required", () => {
  const pool = resource({ label: "tt.pool", factory: () => ({ open: true }) });
  const count = data({ label: "tt.count", initial: 0 });

  capsule({
    label: "tt",
    hooks: {
      start: async ({ load, run, settle }) => {
        expectTypeOf(load(pool, meta)).toEqualTypeOf<Promise<{ open: boolean }>>();
        expectTypeOf(load(count, meta)).toEqualTypeOf<Scope.DataController<number>>();
        expectTypeOf(run(send, {}, meta)).toEqualTypeOf<Promise<string>>();
        expectTypeOf(settle(send, {}, meta)).toEqualTypeOf<Promise<core.RunResult<string>>>();

        // @ts-expect-error a load needs its meta
        await load(pool);
        // @ts-expect-error a run needs its meta
        await run(send, {});
        // @ts-expect-error a role is one of four words
        await load(pool, { role: "boot", explain: "x" });
      },
    },
  });
});

test("A12 an export named label, config, hooks or exports is a type error", () => {
  /** Never called: each call raises ReservedExport; it only has to type-check. */
  const declare = (): void => {
    // @ts-expect-error label is reserved
    capsule({ label: "tt", exports: { label: send } });
    // @ts-expect-error config is reserved
    capsule({ label: "tt", exports: { config: send } });
    // @ts-expect-error hooks is reserved
    capsule({ label: "tt", exports: { hooks: send } });
    // @ts-expect-error exports is reserved
    capsule({ label: "tt", exports: { exports: send } });
    // @ts-expect-error tags is reserved
    capsule({ label: "tt", exports: { tags: send } });
  };

  expectTypeOf(declare).toBeFunction();
});

test("A14 health() with no config type-checks; an uncalled capsule with a required key does not", () => {
  const health = capsule({ label: "tt.health" });
  const mail = capsule({ label: "tt.mail", config: { smtpUrl } });

  install({ capsules: [health()] });
  install({ capsules: [mail({ smtpUrl: "smtp://x" })] });
  // @ts-expect-error a required key is unfilled
  install({ capsules: [mail] });
});

test("A18 Core has no extension export, and createScope({ extensions }) is a type error", () => {
  expectTypeOf<typeof core>().not.toHaveProperty("extension");
  // @ts-expect-error the extensions option is gone
  createScope({ extensions: [] });
});

test("exports type onto the handle and the binding as the same units", () => {
  const mail = capsule({ label: "tt", config: { smtpUrl }, exports: { send } });

  expectTypeOf(mail.send).toEqualTypeOf(send);
  expectTypeOf(mail({ smtpUrl: "smtp://x" }).send).toEqualTypeOf(send);
});

test("A21 a tag export types onto the handle as the same tag", () => {
  const request = tag<Request>({ label: "tt.request" });
  const http = capsule({ label: "tt.http", exports: { request } });

  expectTypeOf(http.request).toEqualTypeOf(request);
  expectTypeOf(http().request).toEqualTypeOf(request);
});

test("A25 a capsule's tags take the shape createScope's tags take", () => {
  const side = tag<string>({ label: "tt.side" });
  const tags: Scope.RootOptions["tags"] = [side("server"), null, [side("x")]];

  capsule({ label: "tt.side", tags });
  // @ts-expect-error a tag binding, not a raw value
  capsule({ label: "tt.side", tags: ["server"] });
});
