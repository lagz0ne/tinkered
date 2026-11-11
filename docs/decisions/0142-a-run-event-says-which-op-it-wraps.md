# 0142 A run event says which op it wraps

Date: 2026-11-11. Status: accepted (Duke, 16:30:
"I follow ur rec"); built.
Changes: the `run` hook event of a capsule
(ADR 0050, 0051).

## What the user said

The site's tide capsule read its caller's value
as `Object(call?.input)`. Duke, 14:32: "Explain
to me the call of capsule, why it is using a
weird looking pattern of Object(call. Input)".

The answer was: one run hook serves every
operation, so Core types its event as `unknown`.
The hook already knows the op (`op === press`),
but the compiler does not. So the writer hid a
cast.

## Context

Two facts in the code made the cast.

1. **No link from `op` to the types.** The event
   has `op`, `call`, and `next`. A check of `op`
   narrows nothing else: `call.input` and
   `next()` stay `unknown`.
2. **A hook runs before the parser.** A caller
   may send `rawInput`. Then `call.input` is
   absent, and only `next()` parses. A hook that
   needs the input must parse by itself, or hand
   the raw value to a second op.

## Precedent

- **Redux Toolkit, `action.match`.** One reducer
  or middleware sees every action as `unknown`.
  `increment.match(action)` is a type guard: a
  true answer gives the action its payload type.
- **Koa, `ctx.is(type)`.** Middleware asks the
  context what the request is. Our run hooks are
  the same onion, so the event answers.
- **TypeScript, a `this` type guard.** A method
  that returns `this is T` narrows the object it
  is called on.

Ours is simpler in one way: an op is one value,
so the guard is one identity check. There is no
string type and no list of matchers.

## Decision

1. `event.is(op)` says if this run is `op`'s.
   A true answer narrows the event: `op`,
   `call`, `input`, and `next()` take the op's
   own types.
2. `event.input` is the input the body gets: the
   caller's `input`, or its `rawInput` through
   the op's parser.

```ts
run(event) {
  if (!event.is(press)) return event.next();

  const hue = event.next();
  const input = { ...event.input, hue };
  return event.run(send, { input }, meta);
}
```

Rules:

- The event asks, not the op. An op handle is a
  plain value made once; the event is where the
  call lives.
- `is` and `input` sit on the event's prototype.
  An event that never asks pays nothing, and its
  shape does not change.
- `input` parses at each read. `next()` parses
  again for the body: the parser stays the one
  door. A parser is pure, so the two answers are
  equal.
- A bad raw input raises `DataValidationFailed`
  at the read, as `next()` does.
- An inline run has no parser: `input` is the
  caller's `input`.
- Call it as `event.is(op)`. The type refuses a
  bare `is(op)` taken off the event.

## Cost

- Size: Core with rpc is 32,829 B. It was
  32,767 B, 1 byte under the cap. The cap goes
  from 32,768 B to 33,792 B (1 KiB, as the last
  steps). Core without rpc stays under its cap.
- Speed: no change on a run that does not ask.
- A hook that reads `input` of a raw call pays
  one more parse.

## Not done

- No `op.match(event)`. One way to ask.
- No guard on `write`, `resolve`, or `session`
  events. No one asked.
- No list form `event.is(a, b)`.
