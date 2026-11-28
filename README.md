# Tinker

Tinker is a small set of libraries for apps that
you and an AI agent write together.

- **App logic** is capsules. Each one holds its
  operations and data cells, and exports what
  others may use (`@tinkered/core`).
- **The page** reads those cells
  (`@tinkered/react`).
- **The server** runs on Bun (`@tinkered/bun`).
- **The check** runs your types and rules, and
  prints the fix for each finding
  (`@tinkered/cli`, the `tinker` command).

Each package ships its own skills: the rules for
its code, for the version you installed.

## How it fits

```text
you or your agent write code
   |
tinker check
   |  types first, then rules
   |  each finding prints its fix
fix, then check again
   |
tinker check: OK
```

One turn of the loop, step by step:

1. **Write.** You or the agent add a function.
2. **Check.** `tinker check` runs the app's
   `tsc` and lint, then Tinker's rules. Only the
   first stage that fails prints.
3. **Read.** Each finding is `file:line rule
what`, then its fix from the skill.
4. **Load more.** `tinker skill load <skill>`
   prints the whole skill, from the package
   version you have.
5. **Fix.** Check again. Only
   `tinker check: OK` says the work is done.

The skills come with the package, through
[TanStack Intent](https://tanstack.com/intent)
(ADR 0143). So the advice always matches the code
you have.

## Start a new app

The fastest way in. The
[tinker-app](https://github.com/lagz0ne/tinker-app)
template has the skills, the checks, and the
`AGENTS.md` block set up.

```bash
bunx degit lagz0ne/tinker-app my-app
cd my-app && bun install
bun run dev
```

Before you call a change done:

```bash
bunx tinker check    # types, then rules
bun run check:style  # format and lint
bun run check        # types, tests, build
```

## Add Tinker to an app you have

### 1. Install the packages

```bash
bun add @tinkered/core @tinkered/react
bun add -d @tinkered/cli
```

Add `@tinkered/bun` for the server half.
All packages share one version.

### 2. Let your agent find the skills

In `package.json`, allow the Tinker skills:

```json
"intent": {
  "skills": ["@tinkered/*"]
}
```

Then write the agent block:

```bash
bunx intent install
```

It writes an `AGENTS.md` block.
The block tells the agent to list the skills and
load the one that fits before it edits code.
For Claude Code, put `@AGENTS.md` in `CLAUDE.md`.

See what you got:

```bash
bunx tinker skill list
```

### 3. Turn on the check

Extend the base config, and place the gates:

```json
{ "extends": "@tinkered/cli/tsconfig.json" }
```

```ts
import { gates } from "@tinkered/cli/config";

lint: {
  overrides: [{ files: ["src/**"], rules: gates }],
},
```

```json
"scripts": {
  "check:tinker": "bun --bun tinker check"
}
```

A finding is one line, then its fix:

```text
src/add.ts:1 tinker/plain a plain function
  Right: make it an operation and name it in
  `depends`, as `double` above.
  more: tinker skill load @tinkered/core#core/operation

tinker check: rules failed.
Next: fix each finding, then run `tinker check`
again.
```

#### What `tinker/plain` asks

Every named function in `src/`, `cmds/` and
`tinker/` is an operation. So each call is a
span in the trace, and what it needs comes
through the scope, not through an import.

Before: a plain function. The check flags it.

```ts
export function add(a: number, b: number) {
  return a + b;
}
```

After: an operation. The check passes it.

```ts
import { operation } from "@tinkered/core";

type Pair = { a: number; b: number };

export const add = operation({
  label: "math.add",
  run: (_deps, { input }: { input: Pair }) =>
    input.a + input.b,
});
```

Call it through a scope:
`await scope.run(add, { input: { a: 1, b: 2 } })`.

These functions pass with no change:

- **Inline:** no name, written where it is used,
  such as a callback or a JSX handler.
- **A body Core calls:** the `run` of an
  `operation`, `resource`, `tag` or `data`, or a
  capsule hook.
- **An option of a library call:** such as a
  handler in `Bun.serve({ ... })`.
- **Owned:** named inside a passing function, and
  returned or handed to a call.
- **A React component:** a capitalized function
  in a `.tsx` file that returns JSX.
- **An entry:** each function the app lists in
  `tinker.json` with a reason, such as
  shadcn's `cn`.

A function that passes is not called by name.
Only a closure may be: a function that reads a
name of a function around it. A pure function in
`useCallback`, called as `add(1, 2)`, is a
finding (ADR 0149).

Workflow SDK flows are next: in a `*.flow.ts`
file, a function that starts with
`"use workflow"` or `"use step"` passes
([PR #36](https://github.com/lagz0ne/tinkered/pull/36),
ADR 0148, not merged yet).

Exit `0` is done, `1` has findings, `2` is a
bad call, config or tool. So CI can gate on it.

An exception goes in `tinker.json`, with its
reason as text. A finding that waits on a
Tinker change gets a gap marker. Both are in the
[cli README](packages/cli/README.md).

### 4. Add the lint rules (optional)

The same package has an Oxlint plugin. It checks
where a cell write may go, and how a body reads
as steps.

```ts
jsPlugins: [
  {
    name: "tinker",
    specifier: "@tinkered/cli/lint",
  },
],
```

The rule list is in the
[cli README](packages/cli/README.md#lint-rules).

## Build with capsules

An app is capsules. You build capsules, and you
use other capsules. That is all.

- **A capsule** is one feature: its config, its
  units, its hooks, and what it exports.
- **Its units** (operations, data cells,
  resources, tags) are private. Only its
  `exports` are seen from outside.
- **A slot** is a config key that holds another
  capsule's export. The cmd fills it.
- **A cmd** installs capsules, with values, in
  `createScope({ capsules })`.

It is the Terraform module model: inputs
(`config`), outputs (`exports`), and one root
that calls them.

### The task: a welcome mail

"Send a welcome mail when someone signs up."
It sounds simple. Then the real needs come, one
at a time. Each need is one new capsule, and one
or two new lines in the cmd. The sign-up code
never changes.

The whole app, with a test per step:
[`examples/welcome`](examples/welcome).

### Step 1. Sign-up sends a mail

`mail` is what features call. It hands each
letter to a backend in its slot.

```ts
const backend = tag<Operation.Handle<void, Letter>>({
  label: "mail.backend",
});

const send = operation({
  label: "mail.send",
  input: letter,
  depends: { backend },
  run: ({ backend }, { input }) =>
    backend.run({ input }),
});

export const mail = capsule({
  label: "mail",
  config: { backend: backend.required },
  exports: { send },
});
```

`signup` keeps the member, then calls each
listener in its list slot, `on`. `welcome.greet`
is one listener: it calls `mail.send`.

```ts
// cmds/server.ts
capsules: [
  memoryMail(),
  mail({ backend: memoryMail.deliver }),
  welcome(),
  signup({ on: [welcome.greet] }),
];
```

`memoryMail` keeps each letter in a cell. Tests
and dev use it. Nothing goes out.

### Step 2. The provider takes 10 mails a second

A `throttler` gives one turn per `gapMs`. The
SMTP backend waits for a turn in its slot.

```ts
capsules: [
  throttler({ gapMs: 100 }),
  smtpMail({ throttle: throttler.runner }),
  mail({ backend: smtpMail.deliver }),
  welcome(),
  signup({ on: [welcome.greet] }),
];
```

Now three sign-ups at once take 200 ms. The
third member waits for the provider.

### Step 3. Sign-up must not wait, and the provider fails

An `outbox` puts each letter in line and answers
at once. Its start hook runs a pump: one send
per tick, a failed send goes to the back of the
line, and after `tries` it goes to `dead`.

```ts
export const outbox = capsule({
  label: "outbox",
  config: {
    inner: inner.required,
    everyMs: everyMs.required,
    tries,
  },
  exports: { enqueue, line, dead },
  hooks: {
    async start({ next, run }) {
      await next();
      void run(pump, {}, {
        role: "handler",
        explain: "Sends one letter per tick",
      });
    },
  },
});
```

```ts
capsules: [
  throttler({ gapMs: 100 }),
  smtpMail({ throttle: throttler.runner }),
  outbox({
    inner: smtpMail.deliver,
    everyMs: 50,
  }),
  mail({ backend: outbox.enqueue }),
  welcome(),
  signup({ on: [welcome.greet] }),
];
```

### Step 4. A deploy must not lose mail

The pump sleeps on the scope's closing signal.
A graceful close keeps running work alive, so the
pump sends what is left. A forced close aborts
it.

```ts
for (;;) {
  const slept = await clock
    .sleep(everyMs, stopping)
    .then(() => true, () => false);
  if (!slept) break;
  await sendOne.run();
}
if (!signal.aborted) await drain.run();
```

`scope.close({ graceful: true })` sends both
letters in line. `scope.close()` drops them.

### Step 5. Support asks: did Ana get her mail?

An `audit` capsule sees each `mail.send` in its
run hook. No other capsule changes.

```ts
export const audit = capsule({
  label: "audit",
  exports: { seen },
  hooks: {
    run(event) {
      if (event.is(mail.send)) {
        const { to, subject } = event.input;
        const line = `${to}: ${subject}`;
        event.load(seen, kept).update(
          (list) => [...list, line],
        );
      }
      return event.next();
    },
  },
});
```

Add `audit()` to the cmd. Five steps, eight
capsules, and `signup.ts` is still the file of
step 1.

### See it without a run: `tinker.graph`

`tinker graph --write` reads the code and writes
one line per operation and per hook. Commit it.
Here, long lines wrap and empty parts are cut.

```text
outbox.pump exits{value} reads{} writes{}
  calls{outbox.drain,outbox.sendOne}
  uses{outbox.stopping}
outbox.sendOne exits{failed,idle,sent}
  calls{slot:outbox.inner}
hook outbox#start runs{outbox.pump}
hook audit#run writes{audit.seen.update}
  wraps{mail.send}
```

Drop the drain from the pump, and `tinker check`
stops at the graph:

```text
src/outbox/index.server.ts:76 tinker/graph
  outbox.pump: calls{outbox.sendOne},
  tinker.graph says
  calls{outbox.drain,outbox.sendOne}
  Right: read the change. If you meant it, run
  `tinker graph --write` and commit the file.
```

### Test it: real capsules, a test clock

A test installs the same capsules, with a test
backend in the slot. No mock, no sleep.

```ts
const scope = await createScope({
  clock,
  capsules: [
    exits({ file: process.env.TINKER_EXITS }),
    flakyMail(),
    outbox({
      inner: flakyMail.deliver,
      everyMs: 100,
      tries: 2,
    }),
    mail({ backend: outbox.enqueue }),
    welcome(),
    signup({ on: [welcome.greet] }),
  ],
}).ready;

await scope.run(signup.join, {
  input: { email: "b@down.io" },
});
clock.advance(200);
// outbox.dead holds b@down.io
```

`exits` records each answer a test reaches.
Remove that test, and the check names the gap:

```text
src/outbox/index.server.ts:34 tinker/exit
  `outbox.sendOne` answers `failed`, and no
  test reaches it
```

### Trace it: `devtools()`

Devtools is a capsule too. Add it, and read each
span, with the capsule of each exported unit:

```text
signup.join [signup] joined
  welcome.greet [welcome]
    mail.send [mail]
      outbox.enqueue [outbox]
outbox.pump
  outbox.sendOne sent
    mail.smtp.deliver [mail.smtp]
      throttler.runner [throttler]
  outbox.drain drained
    outbox.sendOne idle
```

`scope.capsules` lists each install: its
config, its exports, and each unit its hooks
loaded, with a `role` and an `explain`.

### Next: one capsule, two installs

Mail and Slack each get their own pace
(ADR 0172):

```ts
const mailPace = throttler({ gapMs: 100 });
const slackPace = throttler({ gapMs: 1000 });

capsules: [
  mailPace,
  slackPace,
  smtpMail({ throttle: mailPace.runner }),
  slackPost({ throttle: slackPace.runner }),
];
```

Not built yet: [#73](https://github.com/lagz0ne/tinkered/issues/73).
Today a second install raises `DuplicateCapsule`.

Load the rules: `bunx tinker skill load @tinkered/core#core/capsule`.

## Upgrade

```bash
bun update --latest '@tinkered/*'
```

Then run `bunx tinker check`.
The skills move with the code. What changed is
in the [changelog](CHANGELOG.md).

## The packages

- [`@tinkered/core`](packages/core/README.md):
  scope, operations, data cells, keyed resources,
  capsules, rpc, remote data.
- [`@tinkered/react`](packages/react/README.md):
  hooks that read cells and run operations.
- [`@tinkered/bun`](packages/bun/README.md):
  the server, the socket, and Bun's SQL drivers.
- [`@tinkered/cli`](packages/cli/README.md):
  `tinker check`, `tinker skill`, the gates and
  the lint plugin.

More to read:

- [Authoring packages and apps](docs/best-practices.md):
  units, owners, and namespace instances.
- [Decisions](docs/decisions/): why each rule
  is what it is.
- [Glossary](docs/glossary.md): the words we use.

## Work on Tinker itself

This repo uses Vite+ (`vp`). The rules for
contributors are in `CLAUDE.md`.

```bash
vp install
vp run -r build   # apps read the built dist
vp run -r test
vp run dev        # the site
```

`vp run ready` runs every gate, mutation too.

Start, the old base and its CLI, was sunset on
2026-11-01 ([ADR 0122](docs/decisions/0122-start-sunset.md)).
Its code is in tag `start-archive`.
