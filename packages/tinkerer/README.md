# @tinker/tinkerer

Our own ReAct loop on core (ADR 0053).
The frame: one config tag, one mode tag,
one step, five cells, one turn, tool rows.

```text
tinkerer({ label: "coder" })
├── coder.config  (tag)   model, baseUrl,
│                         headers, system, …
├── coder.step    (op)    POST /chat/completions,
│                         res.sse()
├── coder.messages (cell) the wire transcript
├── coder.status  (cell)  idle|running|done|failed
├── coder.text    (cell)  streamed reply so far
├── coder.usage   (cell)  input, cached, output
└── coder.turn    (op)    prompt → step → reply
```

Recipe (see `examples/tinkerer/real.ts`):

```ts
const coder = tinkerer({ label: "coder" });
const scope = createScope({
  tags: [
    coder.config({
      model: "muse-spark",
      baseUrl: "https://api.meta.ai/v1",
      headers: { authorization: `Bearer ${key}` },
    }),
  ],
});
const session = scope.createSession();
const text = session.controller(coder.text);
text.watch((next, prev) => write(next.slice(prev.length)));
const reply = await session.run(coder.turn, {
  input: "Say hi.",
});
await scope.close();
```

## Turns

- A turn streams the reply into `text`
  and delivers the final message.
- A turn sends the transcript first with
  the system prompt and wire fields.
- A second turn keeps the transcript going.
- Usage lands from the last chunk as done.
- A stream with no finish fails the turn.
- A nearer config binding wins per key.
- A missing model fails fast, no request.
- A missing baseUrl fails with MissingConfig naming the key.
- The request carries every provider field the config
  names and asks for usage.
- A config without system starts the transcript with
  the user prompt.
- An empty raw prompt fails validation with EmptyPrompt
  as the cause; no request is sent.
- A forced close during a turn rejects the turn and
  writes no failed status.

## Tools

- Name a row with `tool(op, meta)` (an mcp
  `expose` row fits too; `respond` is ignored).
- The wire name is `meta.name ?? op.label`.
- Two rows with one wire name fail construction
  with `DuplicateTool`.
- The request lists each row as a function
  tool with its JSON schema.
- A reply with a tool call runs the tool
  as a subflow; the next step carries
  its result.
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

```ts
const box = session.controller(coder.inbox);
box.update((list) => [...list, steer("go")]);
```

## Persist

Save a conversation to a JSONL file and resume it.
`persist({ frame, file })` is an extension: install
it with `createScope({ extensions: [...] })`, then
each session it seeds `messages` from the file and
appends every new message.

- A turn's messages are appended to the file one
  JSON line each.
- A session seeds its messages from an existing
  file and appends only what is new.
- `restore(file)` reads a JSONL file into messages;
  a missing file reads as an empty transcript.
- Two files under one scope keep two transcripts
  apart.

```ts
const scope = createScope({
  tags: [coder.config({ model, baseUrl })],
  extensions: [persist({ frame: coder, file })],
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
