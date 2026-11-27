# 0172 Each install of a capsule owns its units

Date: 2026-11-27. Status: accepted (Duke, 2026-11-27 08:38 UTC: "good"); not built (#73).
Direction: Duke, 2026-11-27 06:45 UTC, option A
("Each install owns its units"; B: the app
declares a second capsule; C: one throttler
with lanes).
Builds on: ADR 0059 (a namespace), ADR 0151
(a slot arrives as `depends` delivers it).
Changes: the `DuplicateCapsule` rule (ADR 0121).

## What the user said

Duke, 06:34 UTC: "actually, way easier to have
throttle capsule. can have each instance of
throttle capsule if they are different, no need
to use .as"

```ts
smtpMail({ throttle: ... mailThrottler.runner })
```

## Context

The pattern lab (project files
`tinkered/patterns/lab`, main `1ce6491`) has a
`throttler` capsule. Its `runner` op books a
turn in a cell. A backend fills its `throttle`
slot with it. One install works.

Two installs do not:

- A second `throttler(...)` raises
  `DuplicateCapsule` at `createScope`
  (`lab/gaps/gaps.test.ts`).
- An install held in a const gives the same
  unit: `mailPace.runner === throttler.runner`.
  Two installs would share one turn cell and
  one `gapMs` tag.

Core already has the storage for it. ADR 0059
decision 9 says one declaration serves two
instances through a namespace. A probe on main
`1ce6491` ran one `runner` in two namespaces,
each with its own `gapMs` binding:

```ts
const mailNs = namespace({ tags: [gapMs(100)] });
const slackNs = namespace({ tags: [gapMs(1000)] });
scope.run(runner, { ns: mailNs }); // turn 0
scope.run(runner, { ns: mailNs }); // turn 100
scope.run(runner, { ns: slackNs }); // turn 0
scope.run(runner, { ns: slackNs }); // turn 1000
// resolve(turn, { ns: mailNs }) === 200
// resolve(turn, { ns: slackNs }) === 2000
```

So the gap is not storage. It is the name: the
cmd cannot say "this install's runner".

## Precedent

- **Guice `PrivateModule`.** A module's bindings
  are private. It exposes some keys. The same
  module installs twice when each install
  exposes its keys under its own annotation.
- **Effect `LayerMap`** (ADR 0059): one layer,
  one instance per key.
- **resilience4j, Polly.** A rate limiter is an
  instance with its own config and its own
  state; an app makes one per provider.

Where ours is simpler: the install value is the
key. The cmd names no string.

## Decision

1. **An install is one capsule call.** A capsule
   installed once acts as today: its config binds
   on the root, its cells use the default bucket.
   Apps with one install of each capsule do not
   change.
2. **Two installs of one capsule: each owns a
   namespace.** Its config tags bind in that
   namespace. Its cells keep their state there.
   Its hooks run there. `DuplicateCapsule` goes:
   two installs are allowed.
3. **An install's export is its unit in its
   namespace.** `mailPace.runner` is `runner`
   that runs with `ns: mailPace`'s namespace. A
   slot that holds it delivers it so (ADR 0151).
4. **The bare handle names no install.** With
   two installs, a slot filled with
   `throttler.runner` is refused at
   `createScope` with `InstallNotNamed`. Duke,
   2026-11-27 07:08 UTC: "shouldn't they use
   mailPace.runner?" (Q1, option A).
5. **Reads take the install's export.**
   `scope.resolve(mailPace.turn)` reads that
   install's bucket.
6. **Two installs and a `target: "scope"`
   resource refuse to start.** A scope-target
   resource is blind to the namespace (ADR 0059
   decision 8), so two installs would share it.
   When a capsule installed twice has a unit that
   depends on one, `createScope` raises
   `ScopeResourceShared`. Duke, 2026-11-27
   08:05 UTC: "if multiple instances of capsule
   running and having scope of the same
   resource, do throw error" (Q2).
7. **The graph check finds the same case.**
   `tinker check` prints one finding at its graph
   stage, before any run. Duke, 08:05 UTC: "it
   should have the same issue at graph level".
8. **Each error names the intent and the way
   out**, not the rule it broke. Duke,
   08:13 UTC: "not duplicateCapsule, but more
   like the intention, multiple capsules
   registering scope level resources, and way
   out".

```text
ScopeResourceShared: smtp is installed 2 times,
  and smtp.deliver depends on smtp.pool, a scope
  resource. Both installs would share one pool.
  Way out: give smtp.pool target: "namespace"
  (one per install), or install smtp once.

InstallNotNamed: throttler is installed 2 times,
  and mail.smtp.throttle holds throttler.runner,
  which names no install.
  Way out: fill it from one install, as
  mailPace.runner.
```

`tinker check` prints the first as
`tinker/scope-shared`, with the same way out. 9. **`target: "scope"` stays.** Duke, 08:05 UTC:
"ignore that for now" (removing it).

```ts
const mailPace = throttler({ gapMs: 100 });
const slackPace = throttler({ gapMs: 1000 });

createScope({
  capsules: [
    mailPace,
    slackPace,
    smtpMail({ throttle: mailPace.runner }),
    slackPost({ throttle: slackPace.runner }),
    mail({ backend: smtpMail.deliver }),
  ],
});
```

## Not decided

- **Q3. The graph.** One line per op, as today,
  or one per install?

## Cost

- Core size: owed. Measured with `pnpm validate`
  before the build card.
- Hot path: one install keeps today's path. Only
  a second install mints a namespace.

## Proof owed

- A Core test, red on main: two installs of one
  capsule, two paces, two turn cells.
- The lab: `mailPace` and `slackPace` fill two
  backends; `tinker check: OK`.
