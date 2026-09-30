# 0088 Keep the graph static; close the session to discard state

Date: 2026-09-30.
Status: accepted.
Replaces: 0087's namespace disposal rule and proposed `scope.dispose(ns)`.
Keeps: 0087's extension control through namespace tags.
Builds on: 0059, 0060, 0064, and 0070.

## Context

The user clarified that an unwanted instance can be discarded with its session.
The authored graph should stay immutable and static to keep state simple.
The existing scope and session ownership rules already fit this choice.

The precedent is a fixed program with a separate execution state per run.
The declared units and their dependency edges stay the same.
Each session holds its own live values.
Ending one session does not change the program.

## Decision

- Declare the API units and their dependency edges once.
  Keep namespace keys and their bindings immutable.
- Mutable live state belongs to a scope or session under those keys.
- An instance that needs its own disposable state gets an owning session.
  Closing that session uses core's existing close and cleanup rules.
- Its disposable clients use `target: "session"`.
  Shared directory management can use `target: "scope"`.
- Namespace tags tell extensions what state to manage.
  Extensions must act in the correct session and namespace.
- Discarding state leaves the authored graph and namespace key reusable.

At the composition root:

```ts
const githubSession = scope.createSession({ ns: github });
const cloudflareSession = scope.createSession({
  ns: cloudflare,
});

await githubSession.close();
```

This is existing API.
GitHub's session-owned client ends.
Cloudflare's client and the shared scope-owned directory service remain live.

## Limits and follow-up

Static declarations do not mean eager builds; resources can still be lazy.
This decision is an authoring rule, not a claim that core deep-freezes objects.

A `target: "namespace"` resource is root-owned (ADR 0064).
Closing a child session does not dispose that resource.
A session-target resource belongs to the asking session, so a request child
gets its own instance rather than its parent's instance.

Passing `ns` switches storage within the current session.
It does not switch to a persistent sibling session (ADR 0059).
ADR 0089 defines lazy hook access to the current session and namespace.

A direct core-entry probe proved separate session clients, one shared resource,
cleanup of one session, fresh state in a new session using the same key,
and final cleanup when the root closes.
