# @tinker/tinkerer

Our own ReAct loop on core (ADR 0053).
The frame: one config tag, one step, four
cells, one turn. No tools yet (t02).

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

## Errors

`StreamEnded { label }` — the stream ended
with no `finish_reason` seen.
`MissingConfig { label, key }` — `model` or
`baseUrl` missing after the merge.
`EmptyPrompt { label }` — the turn got
an empty prompt, so no request went out.

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
