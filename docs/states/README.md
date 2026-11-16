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

All five specs describe commit `3ff6778`
(release 0.28.0).

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

- **keyed-resource** — 5 rules break.
  Cards: `core/keyed-entry-dropped`,
  `core/keyed-watch-after-close`.
- **scope-life** — 3 rules break.
  Card: `core/stop-signal-then-later-event`
  (Blocked: Duke picks).
- **rpc-call** — 1 rule breaks.
  Card: `bun/client-drop-keeps-frames`.
- **session-provider** — 1 rule breaks.
  Card: `react/strict-session-suspense`.
- **usedata-scope** — rules hold.

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

The session loop under StrictMode is
[session-provider](session-provider/README.md).
