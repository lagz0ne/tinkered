# 0090 A call signal owns and stops one action

Date: 2026-09-30. Status: accepted.

## Context

Tinkerer steering must stop a pending HTTP read or retry wait.
Stopping the conversation would also discard the work that should continue.
The user chose a Core call signal over an HTTP-only stop setting.

## Decision

Add `signal` to the existing invocation object.
Use the tagged-call child session as the precedent for its owner.
The child owns the action, subflows, session resources, and cleanup.
Its namespace selects settings; it does not own lifetime.

```ts
await step.settle({
  input: "check the services",
  signal: stepStop.signal,
});
```

An abort stops that child and waits for its cleanup.
An already-aborted signal starts no body.
A handled cancelled result leaves the caller's owner alive.
Calls without a signal keep their existing lifetime and results.
This is a work-cancellation signal, unlike the graceful root stop in ADR 0085.
Core must still fit its approved 16 KiB gzip cap.
Proof belongs in the authoring track.
