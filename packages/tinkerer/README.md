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
      headers: { authorization: `B ${key}` },
    }),
  ],
});
const session = scope.createSession();
session.controller(coder.text).watch((next, prev) => write(next.slice(9)));
const reply = await session.run(coder.turn, { input: "Say hi." });
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
- Two rows with one name fail the build
  with `DuplicateTool`.
- The request lists each row as a function
  tool with its JSON schema.
- A reply with a tool call runs the tool
  as a subflow; the next step carries
  its result.
- An unknown tool answers not-found;
  the loop keeps going.
- Bad JSON args answer with the parse message.
- A reply cut by the token limit fails
  every call without running it.
- A throwing tool answers failed; the loop
  keeps going.
- Calls run side by side unless a row says
  `sequential`; results keep model order.
- `read` returns a window of lines and
  refuses a path outside `cwd`.

## Mode

- Three values, weakest first: `read-only`,
  `workspace-write`, `full-access`.
- Each row names the least mode it needs
  (`meta.mode`, default `read-only`).
- A read-only mode blocks a workspace-write
  tool and tells the model why.
- Bind the `mode` tag in a session;
  full-access lets the same tool run.
- Turn start seeds the `settings` cell from
  the tags: mode plus model and options.
- Every step and every tool call reads
  `settings`; mode always goes with
  the next call.

## Errors

`StreamEnded { label }` — the stream ended
with no `finish_reason` seen.
`MissingConfig { label, key }` — `model` or
`baseUrl` missing after the merge.
`EmptyPrompt { label }` — the turn got
an empty prompt, so no request went out.
`DuplicateTool { label, name }` — two rows
share one wire name at construction.
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
createScope({ tags: [backend(fake), coder.config({ model, baseUrl })] });
```
