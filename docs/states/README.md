# States: the chart is the contract

Each state machine gets a spec, a chart and path tests here.
Code changes only where a rule breaks.
Duke picked this on 2026-11-16 (option A).

## Words

- **spec** — the model of one machine, in TLA+:
  `<Name>.tla` and its `.cfg`.
- **rule** — one line the spec must keep.
  Each rule is an ADR decision, by number.
  `d5` means decision 5.
- **chart** — `chart.mmd`: the states and steps,
  in the reader's words (from `view.ts`).
- **path** — the shortest list of steps
  from the start to a state that breaks a rule.
- **path test** — that path, run as a real test
  on the real code.

## One folder per machine

Each `docs/states/<machine>/` holds:

- `<Name>.tla` and `<Name>.cfg` — the spec.
- `view.ts` — the words on each state and step.
- `chart.mmd` — the chart the check draws.
- `paths/` — the path tests.
- `README.md` — the rules, the chart, each bug path,
  what the spec leaves out, and the rerun command.

remote-part and react-run-resource hold two specs each,
as their source did.
Each spec there has its own `.cfg`, view and chart.

The first five specs describe commit `3ff6778`
(release 0.28.0).
round, resource-life, session-life, run-life,
remote-part, rpc-stream and react-run-resource
describe `c9c8817`;
its Core and React lines match `3ff6778`.

## Run the check

The tool is `statechart`, from the pstack skill:
https://github.com/cursor/plugins/tree/main/pstack/skills/statechart
Pin it at commit `bf0c7cd`.

It needs TLC (TLA+ tools 1.7.4) and Java.
The first run installs both with mise.

```sh
cd docs/states/keyed-resource
statechart KeyedResource.tla \
  --config KeyedResource.cfg \
  --view view.ts --out "$(mktemp -d)"
```

- Exit 0: every rule holds.
- Exit 1: a rule breaks.
  The out folder's `report.md` names it
  and gives its path.

A check reads the spec, not the code.
So a bug counts only when its path fails
as a real test.

## Path tests

The files in `paths/` end in `.txt`.
No test runner, lint or type check reads them,
so main stays green.

- A path test that fails today shows a bug.
  Its fix card moves it into the package's tests,
  without the `.txt`, and makes it pass.
- A path test that passes today (a control,
  the useData path) waits here in the same form.

## Machines

- **keyed-resource** — 0 rules break now
  (fixes `ff565316`, `d842e0bd`);
  the spec still shows 5.
  Cards: `core/keyed-entry-dropped`,
  `core/keyed-watch-after-close`.
- **scope-life** — 3 rules break.
  Card: `core/stop-signal-then-later-event`
  (Blocked: Duke picks).
- **rpc-call** — 0 rules break now (fix `730d7e26`);
  the spec still shows 1.
  Card: `bun/client-drop-keeps-frames`.
- **session-provider** — 1 rule breaks.
  Card: `react/strict-session-suspense`.
- **usedata-scope** — rules hold.
- **round** — 0 rules break now (fix `0ebef947`);
  the spec still shows 2.
  Card: `core/round-stuck-after-eq-throw`.
  2 cases with no rule yet.
- **resource-life** — 0 rules break now
  (fixes `b9bec7b5`, `e9242ca7`);
  the spec still shows 3.
  Cards: `core/resource-failed-stays`,
  `core/resource-cycle-holds-close`.
  1 case with no rule yet.
- **session-life** — 1 rule breaks now
  (fix `cdc2c742`);
  the spec still shows 3.
  Cards: `core/close-from-defer-skips-hooks`,
  `core/session-handle-after-body`.
  2 cases with no rule yet.
- **run-life** — 1 rule breaks now
  (fix `890b720c`);
  the spec still shows 2.
  Card: `core/own-signal-leaves-closing`.
  The other break waits for a rule:
  1 case with no rule yet.
- **remote-part** — RemotePart: 1 rule breaks now
  (fixes `fb7679b4`, `ee58cbaa`);
  the spec still shows 3.
  KeyStream: 1 rule breaks.
  Cards: `core/remote-parked-part-wakes`,
  `core/invalidate-refused-returns-early`,
  `core/refused-key-reopens`.
  1 case with no rule yet.
- **rpc-stream** — 0 rules break now
  (fix `b0b86a5e`, `62b3364f`); the spec still shows 1.
  Card: `core/own-signal-stream-failed`.
  Its `.txt` test pins `core/local-stream-signal`.
- **react-run-resource** — UseRun: 0 rules break now
  (fix `495e2c29`);
  the spec still shows 2.
  UseResource: rules hold.
  Card: `react/use-run-hidden`.

The 7 cases with no rule yet wait for Duke
(card `core/states-rules-undecided`, Blocked).

## Bugs, by number

The cards on `TODO.md` use these numbers.

1. A dropped entry: the last watcher leaves,
   the entry leaves the map,
   but a holder can subscribe again.
   A second entry builds.
   [keyed-resource](keyed-resource/README.md), cause A.
2. A watch after the close builds,
   and its end never runs.
   [keyed-resource](keyed-resource/README.md), cause B.
3. A stop signal, then a later event:
   the later event wins.
   [scope-life](scope-life/README.md).
4. `drop()` keeps the frames,
   so a call failed as `link, sent: false` still goes out.
   [rpc-call](rpc-call/README.md).
5. An eq that throws in a write's first round
   leaves the round flag on.
   No watcher in the process hears a write after.
   [round](round/README.md).
6. A good build after a failed sync build
   ends `failed`, not `released`
   or the close's status.
   [resource-life](resource-life/README.md).
7. A reads B, B reads A:
   each instance holds the other,
   and `close()` stays open.
   [resource-life](resource-life/README.md).
8. A session's defer calls `root.close()`:
   the root's close hook never runs,
   and a graceful close turns forced.
   [session-life](session-life/README.md).
9. In a graceful root close,
   a leaked session handle still takes `onClose`
   after its body ended.
   [session-life](session-life/README.md).
10. A call stopped by its own signal
    does not abort `ctx.closing`,
    so a wait on it hangs.
    [run-life](run-life/README.md).
11. A parked part wakes from a late answer:
    refused turns `ready` with no stream,
    and a link fault never heals.
    [remote-part](remote-part/README.md).
12. `await invalidate` on a refused part
    returns before any ask.
    [remote-part](remote-part/README.md).
13. A plain key the server refuses
    opens its stream again by itself.
    [remote-part](remote-part/README.md).
14. Your own `signal` ends a remote stream
    as `failed`.
    [rpc-stream](rpc-stream/README.md).
15. A Suspense hide and show
    clears a running `useRun` to `idle`.
    [react-run-resource](react-run-resource/README.md).
16. `onSuccess` never fires when a run ends
    while hidden or after unmount.
    [react-run-resource](react-run-resource/README.md).

The session loop under StrictMode is
[session-provider](session-provider/README.md).
