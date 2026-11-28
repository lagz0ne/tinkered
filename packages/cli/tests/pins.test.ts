import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, expect, test } from "vite-plus/test";

import { main } from "@/index";

/** This package's folder: an app links its `node_modules`, so it has `vp`, Core and zod. */
const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** One run traces each test file, then runs the app's tests once a mutant: it takes a while. */
const slow = { timeout: 600_000 };

/** The pattern lab: dispatch, a flaky mail backend and mail, and signup with one listener. */
const lab: Record<string, string> = {
  "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "tinker.json": JSON.stringify({ tests: `${at("node_modules/.bin/vp")} test run` }),
  ".gitignore": "node_modules\n.cache\n",
  "tsconfig.json": JSON.stringify({
    extends: at("base/tsconfig.json"),
    compilerOptions: {
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      paths: { "@/*": ["./src/*"] },
    },
    include: ["src"],
  }),
  "vite.config.ts": `import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
export default defineConfig({
  cacheDir: ".cache",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { server: { deps: { inline: ["vite-plus"] } } },
});
`,
  "src/mail/letter.ts": `import { z } from "zod";
export const letter = z.object({ to: z.string(), subject: z.string(), body: z.string() });
export type Letter = z.infer<typeof letter>;
`,
  "src/mail/index.ts": `import { capsule, operation, tag, type Operation } from "@tinkered/core";
import { letter, type Letter } from "./letter";
const backend = tag<Operation.Handle<void, Letter>>({ label: "mail.backend" });
const send = operation({
  label: "mail.send",
  input: letter,
  depends: { backend },
  run: ({ backend }, { input }) => backend.run({ input }),
});
export const mail = capsule({ label: "mail", config: { backend: backend.required }, exports: { send } });
`,
  "src/mail/flaky.server.ts": `import { capsule, data, operation } from "@tinkered/core";
import { letter, type Letter } from "./letter";
const sent = data<Letter[]>({ label: "mail.flaky.sent", initial: [] });
const deliver = operation({
  label: "mail.flaky.deliver",
  input: letter,
  depends: { sent: sent.controller },
  run: ({ sent }, { input }) => {
    if (input.to.endsWith("@down.io")) throw new Error("provider refused " + input.to);
    sent.update((list) => [...list, input]);
  },
});
export const flakyMail = capsule({ label: "mail.flaky", exports: { sent, deliver } });
`,
  "src/throttle/dispatch.server.ts": `import { capsule, data, operation, tag, type Operation } from "@tinkered/core";
import { letter, type Letter } from "@/mail/letter";
type Item = { letter: Letter; tries: number };
const inner = tag<Operation.Handle<void, Letter>>({ label: "dispatch.inner" });
const everyMs = tag<number>({ label: "dispatch.everyMs" });
const tries = tag<number>({ label: "dispatch.tries", default: 3 });
const line = data<Item[]>({ label: "dispatch.line", initial: [] });
const dead = data<Item[]>({ label: "dispatch.dead", initial: [] });
const deliver = operation({
  label: "dispatch.deliver",
  input: letter,
  depends: { line: line.controller },
  run: ({ line }, { input }) => {
    line.update((list) => [...list, { letter: input, tries: 0 }]);
  },
});
const sendOne = operation({
  label: "dispatch.sendOne",
  depends: { inner: inner.controller, tries, line: line.controller, dead: dead.controller },
  run: async ({ inner, tries, line, dead }) => {
    const [first, ...rest] = line.get();
    if (!first) return { kind: "idle" as const };
    line.set(rest);
    const result = await inner.settle({ input: first.letter });
    if (result.status === "success") return { kind: "sent" as const };
    const item = { letter: first.letter, tries: first.tries + 1 };
    if (item.tries < tries) line.update((list) => [...list, item]);
    else dead.update((list) => [...list, item]);
    return { kind: "failed" as const };
  },
});
const pump = operation({
  label: "dispatch.pump",
  depends: { everyMs, sendOne: sendOne.controller },
  run: async ({ everyMs, sendOne }, { clock, signal }) => {
    for (;;) {
      const slept = await clock.sleep(everyMs, signal).then(() => true, () => false);
      if (!slept) return;
      await sendOne.run();
    }
  },
});
export const dispatch = capsule({
  label: "dispatch",
  config: { inner: inner.required, everyMs: everyMs.required, tries },
  exports: { deliver, line, dead },
  hooks: {
    async start({ next, run }) {
      await next();
      void run(pump, {}, { role: "handler", explain: "Sends one letter per tick" });
    },
  },
});
`,
  "src/signup/index.server.ts": `import { capsule, data, operation, tag, type Operation } from "@tinkered/core";
import { z } from "zod";
export const member = z.object({ email: z.string() });
export type Member = z.infer<typeof member>;
const listener = tag<Operation.Handle<unknown, Member>>({ label: "signup.on" });
const members = data<Member[]>({ label: "signup.members", initial: [] });
const join = operation({
  label: "signup.join",
  input: member,
  depends: { on: listener.all, members: members.controller },
  run: async ({ on, members }, { input }) => {
    members.update((list) => [...list, input]);
    for (const each of on) await each.run({ input });
    return { kind: "joined" as const };
  },
});
export const signup = capsule({ label: "signup", config: { on: listener.all }, exports: { join, members } });
`,
  "src/welcome/index.server.ts": `import { capsule, data, operation } from "@tinkered/core";
import { member } from "@/signup/index.server";
const greeted = data<string[]>({ label: "welcome.greeted", initial: [] });
const greet = operation({
  label: "welcome.greet",
  input: member,
  depends: { greeted: greeted.controller },
  run: ({ greeted }, { input }) => {
    greeted.update((list) => [...list, input.email]);
  },
});
export const welcome = capsule({ label: "welcome", exports: { greet, greeted } });
`,
  "tests/dispatch.test.ts": `import { createScope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";
import { exits } from "${at("src/test")}";
import { mail } from "@/mail";
import { flakyMail } from "@/mail/flaky.server";
import { dispatch } from "@/throttle/dispatch.server";
const a = { to: "a@x.io", subject: "hi", body: "one" };
const b = { to: "b@down.io", subject: "hi", body: "two" };
test("dispatch sends each letter and gives up on a host that is down", async () => {
  const clock = makeTestClock();
  const scope = createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      flakyMail,
      dispatch({ inner: flakyMail.deliver, everyMs: 100, tries: 2 }),
      mail({ backend: dispatch.deliver }),
    ],
  });
  await scope.run(mail.send, { input: a });
  await scope.run(mail.send, { input: b });
  const dead = scope.resolve(dispatch.dead);
  await expect
    .poll(() => {
      clock.advance(100);
      return dead.get().map(({ letter }) => letter.to);
    })
    .toEqual([b.to]);
  expect(scope.resolve(flakyMail.sent).get()).toEqual([a]);
  expect(scope.resolve(dispatch.line).get()).toEqual([]);
  await scope.close();
});
`,
  "tests/signup.test.ts": `import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { exits } from "${at("src/test")}";
import { signup } from "@/signup/index.server";
import { welcome } from "@/welcome/index.server";
test("a member who joins is greeted", async () => {
  const scope = createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), welcome, signup({ on: [welcome.greet] })],
  });
  expect(await scope.run(signup.join, { input: { email: "a@x.io" } })).toEqual({ kind: "joined" });
  expect(scope.resolve(welcome.greeted).get()).toEqual(["a@x.io"]);
});
`,
};

/** A fresh copy of `files` in a temp folder, its own git repo with one commit. */
function appOf(files: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "tinker-pins-app-"));
  folders.push(folder);
  symlinkSync(at("node_modules"), join(folder, "node_modules"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "lab");
  return folder;
}

/** The lab's app files, less its code and tests: an app's frame. */
const frame = Object.fromEntries(Object.entries(lab).filter(([path]) => !path.includes("/")));

/** One op answering a `total`, and a traced test that does not read it. */
const counted = {
  ...frame,
  "src/count.ts": `import { operation } from "@tinkered/core";
import { z } from "zod";
export const count = operation({
  label: "count.add",
  input: z.array(z.string()),
  run: (_, { input }) => ({ kind: "added" as const, total: input.length }),
});
`,
  "tests/count.test.ts": `import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { exits } from "${at("src/test")}";
import { count } from "@/count";
test("count adds", async () => {
  const scope = createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] });
  expect(await scope.run(count, { input: ["a", "b"] })).toMatchObject({ kind: "added" });
});
`,
};

test(
  "a fact no test checks lives: each swap of an answer no caller reads, and a write no test reads",
  slow,
  () => {
    const folder = appOf(lab);

    const { code, out } = main(["pins", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe(
      [
        ...[
          "failed->idle",
          "failed->sent",
          "idle->failed",
          "idle->sent",
          "sent->failed",
          "sent->idle",
        ].flatMap((fact) => [
          `src/throttle/dispatch.server.ts:17 dispatch.sendOne swap ${fact} lives`,
          "  reached by: tests/dispatch.test.ts",
        ]),
        "src/signup/index.server.ts:7 signup.join drop signup.members lives",
        "  reached by: tests/signup.test.ts",
        "pins: 16 mutants, 7 live, 2 test files, 0 not traced",
        "",
      ].join("\n"),
    );
  },
);

test(
  "a test file whose scope lists no exits is not traced, and the write it checks still lives",
  slow,
  () => {
    const folder = appOf({
      ...lab,
      "tests/members.test.ts": `import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { signup } from "@/signup/index.server";
import { welcome } from "@/welcome/index.server";
test("a member who joins is a member", async () => {
  const scope = createScope({ capsules: [welcome, signup({ on: [welcome.greet] })] });
  await scope.run(signup.join, { input: { email: "a@x.io" } });
  expect(scope.resolve(signup.members).get()).toEqual([{ email: "a@x.io" }]);
});
`,
    });

    const { out } = main(["pins", folder, "--json"], "/");

    const swaps = ["failed->idle", "failed->sent", "idle->failed", "idle->sent", "sent->failed"];
    expect(JSON.parse(out)).toMatchObject({
      mutants: 16,
      files: 3,
      untraced: ["tests/members.test.ts"],
      live: [...swaps, "sent->idle", "signup.members"].map((fact) => ({ fact })),
    });
  },
);

test("with no op changed since the ref, it breaks no fact", slow, () => {
  const folder = appOf(lab);

  const { code, out } = main(["pins", folder, "--since", "HEAD"], "/");

  expect(code).toBe(0);
  expect(out).toBe("pins: 0 mutants, 0 live, 2 test files, 0 not traced\n");
});

test("a test that checks an op's answers kills its swaps", slow, () => {
  const folder = appOf(lab);
  const path = "src/throttle/dispatch.server.ts";
  const code = lab[path] ?? "";
  writeFileSync(join(folder, path), code.replace("const sendOne", "export const sendOne"));
  writeFileSync(
    join(folder, "tests/send-one.test.ts"),
    `import { createScope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";
import { exits } from "${at("src/test")}";
import { flakyMail } from "@/mail/flaky.server";
import { dispatch, sendOne } from "@/throttle/dispatch.server";
test("sendOne answers idle, then sent, then failed", async () => {
  const scope = createScope({
    clock: makeTestClock(),
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      flakyMail,
      dispatch({ inner: flakyMail.deliver, everyMs: 100, tries: 1 }),
    ],
  });
  expect(await scope.run(sendOne)).toEqual({ kind: "idle" });
  await scope.run(dispatch.deliver, { input: { to: "a@x.io", subject: "hi", body: "one" } });
  expect(await scope.run(sendOne)).toEqual({ kind: "sent" });
  await scope.run(dispatch.deliver, { input: { to: "b@down.io", subject: "hi", body: "two" } });
  expect(await scope.run(sendOne)).toEqual({ kind: "failed" });
  await scope.close();
});
`,
  );

  const { out } = main(["pins", folder, "--since", "HEAD", "--json"], "/");

  expect(JSON.parse(out)).toEqual({ kind: "ran", mutants: 9, files: 3, untraced: [], live: [] });
});

test("an answer field no test reads lives as an empty answer", slow, () => {
  const folder = appOf(counted);

  const { out } = main(["pins", folder], "/");

  expect(out).toBe(
    [
      "src/count.ts:3 count.add empty added lives",
      "  reached by: tests/count.test.ts",
      "pins: 1 mutant, 1 live, 1 test file, 0 not traced",
      "",
    ].join("\n"),
  );
});

test("the text names each test file it could not trace", slow, () => {
  const folder = appOf({
    ...counted,
    "tests/plain.test.ts": `import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { count } from "@/count";
test("count adds, with no exits", async () => {
  const scope = createScope({});
  expect(await scope.run(count, { input: ["a"] })).toEqual({ kind: "added", total: 1 });
});
`,
  });

  const { out } = main(["pins", folder], "/");

  expect(out).toBe(
    [
      "src/count.ts:3 count.add empty added lives",
      "  reached by: tests/count.test.ts",
      "  not traced: tests/plain.test.ts",
      "pins: 1 mutant, 1 live, 2 test files, 1 not traced",
      "",
    ].join("\n"),
  );
});

test("--since counts a file git does not track yet as changed", slow, () => {
  const folder = appOf(frame);
  for (const [path, text] of Object.entries(counted).filter(([path]) => path.includes("/"))) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }

  const { out } = main(["pins", folder, "--since", "HEAD"], "/");

  expect(out).toBe(
    [
      "src/count.ts:3 count.add empty added lives",
      "  reached by: tests/count.test.ts",
      "pins: 1 mutant, 1 live, 1 test file, 0 not traced",
      "",
    ].join("\n"),
  );
});

test(
  "an answer that is not plain JSON data stays green under trace, and gets no empty twin",
  slow,
  () => {
    const folder = appOf({
      ...frame,
      "src/stamp.ts": `import { operation } from "@tinkered/core";
export const at = operation({ label: "stamp.at", run: () => ({ kind: "stamped" as const, at: new Date(0) }) });
export const tally = operation({ label: "stamp.tally", run: () => ({ kind: "tallied" as const, total: 1n }) });
`,
      "tests/stamp.test.ts": `import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { exits } from "${at("src/test")}";
import { at, tally } from "@/stamp";
test("stamp answers", async () => {
  const scope = createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] });
  expect(await scope.run(at)).toMatchObject({ kind: "stamped" });
  expect(await scope.run(tally)).toMatchObject({ kind: "tallied" });
});
`,
    });

    const { code, out } = main(["pins", folder], "/");

    expect(code).toBe(0);
    expect(out).toBe("pins: 0 mutants, 0 live, 1 test file, 0 not traced\n");
  },
);

test("a refusal is never swapped to another answer", slow, () => {
  const folder = appOf({
    ...frame,
    "src/api.ts": `import { operation, rpc, transport } from "@tinkered/core";
import { z } from "zod";
export const api = rpc({ echo: { input: z.number(), output: z.object({ kind: z.literal("echoed") }) } });
export const echo = operation({
  label: "echo",
  input: api.echo.input,
  run: () => ({ kind: "echoed" as const }),
});
export const guard = operation({
  label: "guard",
  input: transport.hook.start,
  run: (_, { input }) => (input.input === 0 ? input.refuse({}) : { kind: "open" as const }),
});
`,
    "tests/api.test.ts": `import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { exits } from "${at("src/test")}";
import { api, echo, guard } from "@/api";
test("the guard refuses zero", async () => {
  const scope = createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), api({ implement: { echo }, onStart: [guard] })],
  });
  expect(await scope.settle(api.echo, { input: 1 })).toMatchObject({ status: "success" });
  expect(await scope.settle(api.echo, { input: 0 })).toMatchObject({ status: "failed" });
  await scope.close();
});
`,
  });

  const { out } = main(["pins", folder], "/");

  expect(out).toBe("pins: 0 mutants, 0 live, 1 test file, 0 not traced\n");
});

test("a call that a hook makes inside a slot op's run gets no fail", slow, () => {
  const folder = appOf({
    ...frame,
    "src/signup/index.server.ts": lab["src/signup/index.server.ts"] ?? "",
    "src/welcome/index.server.ts": lab["src/welcome/index.server.ts"] ?? "",
    "src/audit.server.ts": `import { capsule, data, operation } from "@tinkered/core";
import { z } from "zod";
import { signup } from "@/signup/index.server";
const noted = data<string[]>({ label: "audit.noted", initial: [] });
const note = operation({
  label: "audit.note",
  input: z.string(),
  depends: { noted: noted.controller },
  run: ({ noted }, { input }) => {
    noted.update((list) => [...list, input]);
  },
});
export const audit = capsule({
  label: "audit",
  exports: { note, noted },
  hooks: {
    async run(event) {
      if (event.is(signup.join)) {
        await event.run(note, { input: "join" }, { role: "handler", explain: "Notes each join" });
      }
      return event.next();
    },
  },
});
`,
    "tests/signup.test.ts": `import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";
import { exits } from "${at("src/test")}";
import { audit } from "@/audit.server";
import { signup } from "@/signup/index.server";
import { welcome } from "@/welcome/index.server";
test("a join is noted, greeted and kept", async () => {
  const scope = createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), audit, welcome, signup({ on: [welcome.greet] })],
  });
  expect(await scope.run(signup.join, { input: { email: "a@x.io" } })).toEqual({ kind: "joined" });
  expect(scope.resolve(audit.noted).get()).toEqual(["join"]);
  expect(scope.resolve(welcome.greeted).get()).toEqual(["a@x.io"]);
  expect(scope.resolve(signup.members).get()).toEqual([{ email: "a@x.io" }]);
});
`,
  });

  const { out } = main(["pins", folder], "/");

  expect(out).toBe("pins: 4 mutants, 0 live, 1 test file, 0 not traced\n");
});

test("a test file that fails with no fault in stops the run with its output", slow, () => {
  const folder = appOf({
    ...lab,
    "tests/broken.test.ts": `import { expect, test } from "vite-plus/test";
test("one is two", () => {
  expect(1).toBe(2);
});
`,
  });

  const { code, out } = main(["pins", folder], "/");

  expect(code).toBe(1);
  expect(out).toContain("one is two");
  expect(out).toMatch(
    /\ntinker pins: tests\/broken\.test\.ts fails with no mutant in\.\nNext: make it pass, then run `tinker pins` again\.\n$/,
  );
});

test("an app with no tests command has nothing to pin", () => {
  const folder = appOf({ ...frame, "tinker.json": "{}" });

  const { code, out } = main(["pins", folder], "/");

  expect(code).toBe(1);
  expect(out).toBe("tinker pins: tinker.json has no `tests` command, so no test can pin a fact.\n");
});
