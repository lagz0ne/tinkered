# @tinker/tinkerer

Our own ReAct loop on core (ADR 0053).
One frame declares the tools and gate once.
Namespaces keep each coder's state and config apart.
`label` is optional; it names spans and errors,
not storage. The default is `"tinkerer"`.

```text
one tinkerer() frame
  ├── config, mode (tags)
  ├── turn → step → http.send (ops)
  └── messages, status, text,
      usage, settings, inbox (cells)
          ├── namespace A: coder A's values
          └── namespace B: coder B's values
```

Two coders from one frame
(see `examples/tinkerer/real.ts`):

```ts
const coder = tinkerer();
const a = namespace({
  tags: [
    coder.config({
      model: "muse-spark",
      baseUrl: urlA,
    }),
  ],
});
const b = namespace({
  tags: [
    coder.config({
      model: "muse-spark",
      baseUrl: urlB,
    }),
  ],
});
const scope = createScope();
const session = scope.createSession();
const first = await session.run(coder.turn, {
  input: "Say hi.",
  ns: a,
});
const second = await session.run(coder.turn, {
  input: "Say hi.",
  ns: b,
});
const historyA = session.resolve(coder.messages, {
  ns: a,
});
const boxB = session.controller(coder.inbox, {
  ns: b,
});
await scope.close();
```

Use `createSession({ ns: a })` when every call
in that session belongs to A. Use `ns` on each
run and controller when one session serves both.
The same frame keeps each coder's messages,
status, text, usage, settings, and inbox apart.
A turn reads that namespace's tag bindings.
With the default label, the span tree is:

```text
tinkerer.turn
  tinkerer.http.step
    http.send
      http.attempt
```

`tools` and `gate` still shape the graph;
build a separate frame if either differs.

## Turns

- A turn streams the reply into `text`
  and delivers the final message.
- A turn sends the transcript first with
  the system prompt and wire fields.
- A second turn keeps the transcript going.
- Usage lands from the last chunk as done,
  the provider's cached tokens included.
- A fresh frame starts with empty messages and
  text, `idle` status, and zero usage.
- Each tag and cell is named after the frame's
  label: `coder.messages`, `coder.mode`.
- A stream with no finish fails the turn.
- A nearer config binding wins per key.
- A missing model fails fast, no request.
- A missing baseUrl fails with MissingConfig naming the key.
- The request carries every provider field the config
  names and asks for usage.
- A config without system starts the transcript with
  the user prompt.
- A raw prompt that is not a non-empty string
  fails validation with EmptyPrompt as the
  cause; no request is sent.
- A forced close during a turn rejects the turn and
  writes no failed status.

## Tools

- Name a row with `tool(op, meta)` (an mcp
  `expose` row fits too; `respond` is ignored).
- The wire name is `meta.name ?? op.label`.
- Two rows with one wire name fail construction
  with `DuplicateTool`.
- The request lists each row's name,
  description and JSON schema as a
  function tool.
- A reply with a tool call runs the tool
  as a subflow; the next step carries
  its result.
- Streamed tool-call pieces accrue by index;
  a piece may carry only more arguments.
- A piece with no id, name or arguments leaves
  those three fields as empty strings.
- An unknown tool answers not-found;
  the loop keeps going.
- A tool call whose arguments are not JSON answers
  the model with an error result; the tool never runs.
- A reply cut by the token limit fails
  every call without running it.
- A throwing tool answers failed; the loop
  keeps going.
- Without a sequential row a reply's calls run at
  once; a `sequential` row runs them one at a time.
  Results keep the model's order either way.
- A tool's non-string value reaches the model as
  JSON; `undefined` as an empty string.
- A tool whose own input fails validation answers
  the model with the cause's message.
- A reply whose tool calls carry no text sends
  `null` as the assistant message's content.
- A request with no rows carries no `tools` field.
- `read` returns a window of lines and
  refuses a path outside `cwd`.

The shipped rows, pi's set: `shippedTools` =
`[readTool, editTool, writeTool, bashTool]`.
Each shipped tool reads the `cwd` tag.

- `write` creates the file under cwd with its
  parents and reports the byte count.
- `edit` replaces the one exact match and
  refuses zero or many matches with `EditMiss`.
- `write` and `edit` refuse a path outside cwd
  before touching the disk.
- `bash` runs the command in cwd and answers its
  merged output with a non-zero exit code.
- `bash` kills a command at its timeout
  (default 30 s) and says so.
- `bash` keeps the last 20000 characters of a
  huge output and marks the cut with `…`.
- `bash` gives the command no stdin, so `cat`
  returns at once.
- A command that dies by a signal answers
  `[exit signal]`.
- A forced close during `bash` kills the command
  and rejects the run.

## Mode

- Three values, weakest first: `read-only`,
  `workspace-write`, `full-access`.
- Each row names the least mode it needs
  (`meta.mode`, default `read-only`).
- A read-only mode blocks a workspace-write
  tool and tells the model why.
- Bind the `mode` tag in a session;
  full-access lets the same tool run.
- `workspace-write` lets `write` and `edit` run
  in a reply and blocks `bash` in the same reply;
  `bash` needs `full-access`.
- Turn start seeds the `settings` cell from
  the tags: mode plus model and options.
- Every step and every tool call reads
  `settings`; mode always goes with
  the next call.

## Gate

A gate decides each tool call before it runs. The
slot takes an operation, so an operation fills it
(ADR 0057): declare one whose `ctx.input` is the
request and whose value is the decision. Because
it is an ordinary operation it may declare
`depends` — read a cell, apply a policy, or ask a
human through a driver.

- A blocking gate answers the model with a declined
  result and the tool never runs.
- An allowing gate lets the tool run.
- The gate receives the tool name, the parsed
  arguments, the mode, and the wire call.
- A gate may read a cell to decide, so a policy or a
  human can drive it.

```ts
const guard: Tinkerer.Gate = operation({
  label: "guard",
  run: (_deps, ctx) => {
    if (ctx.input.name === "bash") {
      return { allow: false, reason: "no" };
    }
    return { allow: true };
  },
});
const coder = tinkerer({
  label: "coder",
  tools: shippedTools,
  gate: guard,
});
```

The slot's type names the input, so `ctx.input` is
typed with no parse and no cast.

## Inbox

Talk to a running turn through the `inbox` cell.
Push an entry with `steer(content, patch?)` or
`queue(content, patch?)`; `patch` may carry a
`mode` or `options` that patches `settings` when
the entry is consumed.

- A queued entry continues the turn when the
  model would stop.
- A queued entry patches the settings the next
  step reads.
- No pending entry ends the turn after one step.
- A steer interrupts the step in flight, keeps
  the partial text as an assistant message, and
  re-enters as a user message.
- A steer carrying a mode patches the settings
  before the next step.
- A steer drops the tool calls still streaming;
  none of them runs.
- A steer with no text in flight adds no
  assistant message.

```ts
const box = session.controller(coder.inbox);
box.update((list) => [...list, steer("go")]);
```

## Persist

Save a conversation to a JSONL file and resume it.
`persist({ frame, file })` is an extension: install
it with `createScope({ extensions: [...] })`, then
each session it seeds `messages` from the file and
appends every new message. For parallel coders in
one session, install one extension and file per
namespace: `persist({ frame, ns: a, file: aFile })`.
Without `ns`, it follows the session's ambient
namespace. Never share a file between coders.

- A turn's messages are appended to the file one
  JSON line each.
- A session seeds its messages from an existing
  file and appends only what is new.
- `restore(file)` reads a JSONL file into messages;
  a missing file reads as an empty transcript.
- A session with no file to read keeps the
  messages it inherited.
- Two files under one scope keep two transcripts
  apart.

```ts
const scope = createScope({
  tags: [coder.config({ model, baseUrl })],
  extensions: [persist({ frame: coder, file })],
});
```

## CLI

The author declares the `ask` command:
`<app> ask "<prompt>"` runs one turn and prints
the answer. `text` and `turn` are public on the
frame, so the command declares them itself; the
route row is a `@tinker/process` route. Model,
base URL, key, `cwd`, and `mode` are the scope's
config, bound by the composition root.

- `ask` runs one turn and prints the answer with
  exit code 0.
- `ask` with no prompt exits with a usage code.
- An unknown command exits with a usage code.
- `ask` joins the prompt words with spaces and
  drops `--flags`.

```ts
const ask = operation({
  label: "ask",
  depends: {
    argv: argv.required,
    io: io.required,
    text: coder.text.controller,
    turn: coder.turn,
  },
  run: async ({ argv, io, text, turn }) => {
    // read the prompt, stream the turn, exit
  },
});

const shell = {
  name: "tinkerer",
  version: "0.0.0",
  commands: [
    {
      name: "ask",
      description: "run one turn and stream the answer",
      entry: () => ({
        op: ask,
        options: {
          tags: [
            coder.config({
              model: "m",
              baseUrl: "https://api",
            }),
          ],
        },
      }),
    },
  ],
};
```

The composition root binds config and runs the
shell with `run` or `main`, or by hand when it also
reads `--cwd` and `--mode` into the `cwd` and
`mode` tags.

## Log lines

A scope with a log sink sees one line per step.

- `tinkerer tool { name, ok }` — one per tool
  call.
- Each executed tool call logs `ok` true.
- A call that never runs logs `ok` false:
  unknown, blocked, bad arguments, or cut.
- `tinkerer gate { name, allow }` — the call's
  name and whether the gate allowed it.
- `tinkerer turn { finish, input, output }` —
  the turn's finish reason and output tokens.

```ts
createScope({
  observe: { log: (entry) => console.log(entry) },
});
```

## Errors

`StreamEnded { label }` — the stream ended
with no `finish_reason` seen.
`MissingConfig { label, key }` — `model` or
`baseUrl` missing after the merge.
`EmptyPrompt { label }` — the turn got
an empty prompt, so no request went out.
`DuplicateTool { label, name }` — two rows
share one wire name at construction.
`EditMiss { label, path, count }` — `edit` found
zero or several matches.
`PathOutsideCwd { label, path }` — `read`
was asked for a path outside `cwd`.
An unbound tag fails with `MissingTag`, which
names the tag: `coder.config`, `tinkerer.cwd`.

`isError(value, kind)` is true only for an
`Error` carrying that `kind`.

## Test recipe

Bind the shared `backend` tag with a
closure that records the outgoing request
and answers the recorded fixture at 200:

```ts
const seen: HttpRequest.Record[] = [];
const fake: HttpClient.Backend = async (request) => {
  seen.push(request);
  return HttpResponse.make(request, {
    status: 200,
    body: answer,
  });
};
createScope({
  tags: [backend(fake), coder.config({ model, baseUrl })],
});
```
