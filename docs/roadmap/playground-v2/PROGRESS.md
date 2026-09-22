# Playground: tile storm

## Request

- Show a 3D board with solid tiles and rising waves.
- Turn the board while waves keep moving with it.
- Control storm and wave settings from the game.
- Fill the page; offer game-only full screen.
- Browse files, follow symbols, and return to the last spot.
- Follow imports into the real core and React source.
- Keep game state and effects in Tinker core and React.
- Test the game through a scope with a frame tag.
- Writer: Pi, writer-gateway/xiaomi/mimo-v2.6-flash.
- Lead: Codex, review and checks.

## Shape

A source browser follows the same pattern as an IDE:
open file, follow definition, go back.
The game stays mounted while the reader browses.
A frame tag is a port: the browser supplies frames;
a test supplies frames by hand.
The existing scope clock remains the source of time.

## Work

One package: apps/playground.
No core or React package API changes are needed.
The writer uses its own worktree and commits by path.
The lead records review and observed checks here.

## Verify

- Press creates a wave that lifts nearby tiles over time.
- Live settings change wave and storm behavior.
- Board turns animate and remain correct during a wave.
- Clear removes waves; scope close cancels frames.
- A Node test drives the engine without DOM or global patches.
- Code view follows local imports and Tinker symbols.
- Going back restores the previous code location.
- Play/code/full screen keep the running game intact.
- Desktop and phone layouts fit and controls work.
- vp check, vp test, playground tests and build pass.

## Before code

SCIP indexed core, react, and playground.
Paths below are relative to apps/playground.
No old export needs removal; retain existing names where possible.

```text
== playground
  definitions
    App.  ->  example/App.tsx:57
    Editor.  ->  src/components/Editor.tsx:58
    Shade#  ->  example/state.ts:21
    View#  ->  src/state.ts:7
    View.  ->  src/actions.ts:119
    board.  ->  example/state.ts:31
    clear.  ->  example/engine.ts:30
    physics.  ->  example/state.ts:7
    press.  ->  example/engine.ts:8
    previewDocument(  ->  src/lib/preview.ts:7
    sameShade(  ->  example/state.ts:25
    shadeAt(  ->  example/engine.ts:46
    ticker.  ->  example/engine.ts:88
    viewCell.  ->  src/state.ts:62
    waves.  ->  example/state.ts:16
  references (count  symbol  file)
        3  App.  example/App.tsx
        3  App.  example/main.tsx
       14  App.  src/App.tsx
       12  App.  src/bench/runners.ts
        3  App.  src/main.tsx
        6  Editor.  src/App.tsx
       10  Editor.  src/components/Editor.tsx
        9  Shade#  example/Tile.tsx
        9  Shade#  example/engine.ts
       22  Shade#  example/state.ts
        2  View#  src/App.tsx
        2  View#  src/actions.ts
       10  View#  src/components/Editor.tsx
        1  View#  src/state.ts
        2  View.  src/App.tsx
        2  board.  example/Tile.tsx
        2  board.  example/engine.ts
        2  clear.  example/App.tsx
        2  physics.  example/engine.ts
        2  press.  example/Tile.tsx
        2  previewDocument(  src/App.tsx
        1  previewDocument(  src/lib/preview.ts
        2  sameShade(  example/Tile.tsx
        2  sameShade(  example/engine.ts
       12  sameShade(  example/state.ts
       13  shadeAt(  example/engine.ts
        2  ticker.  example/App.tsx
        2  ticker.  example/main.tsx
        4  viewCell.  src/App.tsx
        2  viewCell.  src/actions.ts
        2  waves.  example/App.tsx
        4  waves.  example/engine.ts

```

## Baseline checks

Before game or shell edits, on 2721642 plus this work card:

- `vp install`: exit 0.
- `vp run -r build`: exit 0.
- `vp check`: exit 0, no errors, 19 warnings.
- `vp run playground#test`: exit 0, 19 tests pass.
- `vp test`: exit 1, 29 files fail, 54 pass.
  It runs app files without their path aliases and React
  browser tests without browser mode; other tests time out.
  796 tests pass, 22 fail, one is skipped.
- Strict style check: only S05 fails, at the old bare
  `Error` in `example/engine.ts`; the writer will replace it.

Logs for this session are in `/tmp/playground-base-*.log`.

- `vp run -r test`: exit 0, all 14 package tasks pass.
  This uses each package's own test setup.
- Browser baseline: 84 tiles load at 1280 by 850.
  The old game gets only 640 by 806 in the split view.

## Review cases

- Desktop: press a tile, see nearby tiles rise, turn twice.
- Phone: all controls reachable; no sideways page scroll.
- Storm: start, change rate, clear, stop; no hidden restart.
- Code: find a file; follow a local and library symbol.
- History: return to the same file and code position.
- Full screen: enter, exit, then keep using the same game.
- Scope: close with a frame queued; no later write occurs.

## Writer split

The first writer spent its turn planning without saving code.
Its session was stopped; the chosen model stays MiMo Flash.
Two smaller jobs now use separate worktrees:

- `playground/frames`: game engine and Node tests.
- `playground/source-links`: code links and history tests.

Both use Pi and the writer gateway.
The view work follows the engine API.
No library package changes are planned.

## Writer rotation

User choice: use the highest effort for every writer.
Rotate MiMo V2.6 Flash, GLM 5.3 Flash, and DeepSeek
V4.1 Flash through the writer gateway in Pi.
The user confirmed V4.1 after discovery found no V4.6.
Paseo reports no named profiles; use the gateway model IDs.

Record time, saved results, check exits, and review fixes.
Different tasks are not a fair speed test or a final ranking.

- MiMo: engine and source links, in progress.
  First broad task saved no code before it was stopped.
  One later reply made 3,966 tool calls; 3,917 repeated
  the same read command. A one-call rule was added.
  Files began saving after that rule; review is pending.
- GLM: 3D board and game controls, in progress.
- DeepSeek: took over engine and frame tests.
  MiMo had saved state and error files, but no engine or
  tests. Those partial files were kept for the next writer.
  No correctness rating is claimed for that partial work.

The lead stays responsible for review and observed checks.

## Page API impact

The Play view extends the input of `setView`.
The old symbol remains; its callers stay in the shell.

```text
== playground
  definitions
    setView.  ->  src/actions.ts:119
  references (count  symbol  file)
        2  setView.  src/App.tsx

```

## First view review

GLM saved the 3D view, controls, Play/Code views, and
full-screen resource. Its package tests pass 19/19;
full type checks await the engine API, so this is not Done.

Requested fixes before browser proof:

- Missing `requestFullscreen` must enter fit mode.
- A failed native exit must keep the exit button visible.
- Escape in fit mode must work while the iframe has focus.
- A covered iframe must leave the keyboard tab order.
- Shell buttons need 44 px touch targets too.

These are observed code findings, not a model ranking.

## Integrated engine and view review

The lead applied engine code from `84455a1`, then the
review delta to `21512ad`; the view is from `4ab9784`.
The combined build passes. All 31 scope tests pass.

Engine fixes from review:

- Keep the hue returned by `press`.
- Test each refused input on its own.
- Turn past one full circle in the scope test.
- Prove a live storm interval change delays the next press.

Browser checks on the combined build pass:

- Desktop: 84 solid tiles, press, four turns, storm, clear.
- Code and full screen keep the same game document alive.
- Covered game leaves the keyboard tab order.
- Native full screen enters and exits.
- A parent frame that denies full screen triggers fit mode.
- Escape from the game and the exit button both leave fit.
- Enter on a focused tile creates a wave.
- Phone at 390 by 844 has no sideways page scroll.
  All game buttons are 44 px tall; sliders are reachable.
- No page script errors in the desktop and phone runs.

The phone board edge and crowded storm label need a
small view fix. Source links still need the Code UI.
The source history review found oldest-first Back/Forward;
MiMo is fixing that with a three-place regression test.

The raw SCIP tables above were saved before code.
They are now plain text: the impact tool needs one row
per symbol, not the printed SCIP table. Final review
will retain these tables and add the tool's row format.
Its new-export scan only covers `packages/`, so app
review also reads the app index and diff directly.

Jev review found no source issue in the engine or view.
Its commit-message warning was checked against the code
and tests; it adds no code finding. The lift-test title
names the wave motion it proves, so its vague-title hit
was labeled false. Calibration was run and saved.

## Impact rows for review

These rows name the known files for the changed game API.
The earlier raw tables remain the before-code evidence.
Tests now call the same public actions as the view.

```impact playground/tsunami
playground press. example/engine.ts example/Tile.tsx tests/engine.test.ts
playground clear. example/engine.ts example/App.tsx tests/engine.test.ts
playground physics. example/state.ts example/engine.ts example/App.tsx
playground setPhysics. example/engine.ts example/App.tsx tests/engine.test.ts
playground setStorm. example/engine.ts example/App.tsx tests/engine.test.ts
playground turn. example/engine.ts example/App.tsx tests/engine.test.ts
playground angle. example/state.ts example/engine.ts example/App.tsx tests/engine.test.ts
playground stormOn. example/state.ts example/engine.ts example/App.tsx tests/engine.test.ts
playground ticker. example/engine.ts example/App.tsx example/main.tsx tests/engine.test.ts
```

```impact playground/page
playground setView. src/actions.ts src/App.tsx
```

## Source review

The source model from `cac9734` is integrated.
Review found Back and Forward used the oldest history
entry. Fix `5244860` takes the newest entry instead.
It also stops false import links from destructured
parameters and loop locals.

The writer ran the new tests against the old source:
2 failed and 15 passed. Both pass with the fixes.
The combined playground now passes all 48 tests.
Source preflight and lint found no issues.
Two test-title notes were checked, labeled false, and
included in a fresh saved calibration run.

GLM added the Code UI in `f27e939`. Browser review
confirmed a Ctrl-click reaches the real core declaration.
Code review requested these fixes before acceptance:

- Show search hits while typing and close the picker.
- Support keyboard clicks in the file list.
- Restore editor shortcuts and isolate undo by file.
- Keep navigation aligned with add, close, and rename.
- Clamp saved cursor positions after source changes.
- Show the current path and a named Follow button.
- Use the right parser for `.ts` and `.tsx` source.
- Leave read-only source open to keyboard navigation.

The first scene size fix still clipped one tile by
2.46 px during a turn at maximum wave height.
The next view fix must cover motion between headings.

## Writer observations so far

These are observations from this task, not a model ranking.
All three used the highest offered effort, `max`.

- DeepSeek finished the engine from the saved state file.
  One review round restored the press return value and
  strengthened time and rotation tests. Its final engine
  passes 12 scope tests and real-browser game checks.
- MiMo finished the source model after a parser correction.
  Review then found history order and shadowed-name bugs;
  its fix added tests that fail on the old code.
  Its earlier stalled and repeated-tool turns remain
  part of the record above.
- GLM saved the 3D game, full-screen shell, and Code UI.
  Review fixed full-screen and keyboard edge cases.
  The first Code UI still needed the fixes listed above.
  Passing type checks did not prove those controls worked.

No library API workaround needs a new core ticket here.
The playground has no mutation task; no mutation score
or library size claim is made for this app-only change.

## Code UI browser proof

The lead applied `8a54c68` and rebuilt the preview.
The following checks pass in Chromium:

- Search opens example and package sources.
- F12 on `createScope` lands at its real declaration.
- Follow symbol on `useResource` lands in React source.
- Package source rejects typing and remains focusable.
- Back restores the exact character offset.
- Several Back and Forward steps visit the right files.
- A source jump leaves the game document alive.
- Phone taps follow core, return, and search React.
- Desktop and phone runs have no script errors.
- Undo in one file cannot paste another file's text.
- Each file keeps its own Undo history across switches.
- New files open for editing; closing one switches source.

At maximum wave height, a phone frame scan sampled
100 frames per turn through four right turns.
No tile bounds crossed the scene in that run.
The four buttons remain 44 px tall. The game scrolls
vertically on the phone; it has no sideways page scroll.

The latest remaining review fix is tab state and history
for renamed or closed files. It stays in Review until
its scope tests and browser checks pass.

## Final proof

The final tab fixes are integrated from `2ae4a12` and
`e1f1857`. Tabs use Tinker state, with separate real
buttons for opening and closing a file. Both are 44 px.
Close prunes history; rename keeps history offsets and
changes the stored filename. The writer's two new tests
fail on the old code and pass with these fixes.

Lead checks on `2cf51fc`:

- `vp run -r build`: exit 0.
- `vp check`: exit 0, no errors, 19 existing warnings.
- `vp run -r test`: exit 0, all 14 package tasks pass.
  Playground: 53 tests across six files, all pass.
  The other 13 tasks use valid cached results.
- Strict style census for example, shell, and tests: exit 0.
- `vp run prose`: exit 0 before the final record commit.
- Root `vp test` has the baseline setup failures listed
  above; it is not reported as green.

Final browser review also passes:

- Desktop and phone source search, symbol jumps, history.
- Read-only core can follow its own import with F12.
  Alt+Left returns to the core file.
- Rename Enter commits; Escape cancels.
- Tab Enter opens; Close Enter removes the file.
- Back skips closed files and uses renamed filenames.
- No script errors in these final runs.

The game, full screen, and maximum-height wave scan
passed as recorded above. The later edits only changed
the Code tabs and file actions.

Temporary preview for review:
<https://p-9b276e97cabf.preview.tini.works>
It serves this worktree's built app, not a production deploy.

SCIP was rebuilt for playground, core, and React.
Old `EditorPane` has no definition or references.
No existing public game name was removed.
The game and page impact checks report zero discrepancies.
The app-only limit of the impact tool is recorded above.

Final old-symbol output:

```text
== playground
  definitions
  references (count  symbol  file)
    (none)
```

Final source and action references:

```text
== playground
  definitions
    addFile.  ->  src/actions.ts:53
    closeFile.  ->  src/actions.ts:78
    codeEditor.  ->  src/lib/code-editor.ts:29
    followDefinition.  ->  src/navigation.ts:61
    goBack.  ->  src/navigation.ts:76
    goForward.  ->  src/navigation.ts:93
    openSource.  ->  src/navigation.ts:49
    renameFile.  ->  src/actions.ts:108
    setView.  ->  src/actions.ts:157
    trackCursor.  ->  src/navigation.ts:110
  references (count  symbol  file)
        2  addFile.  src/App.tsx
        4  addFile.  tests/actions.test.ts
        2  addFile.  tests/bundler.test.ts
        2  closeFile.  src/App.tsx
        5  closeFile.  tests/actions.test.ts
        2  codeEditor.  src/App.tsx
        2  codeEditor.  src/components/Editor.tsx
        2  followDefinition.  src/App.tsx
        1  followDefinition.  src/index.ts
        2  followDefinition.  src/lib/code-editor.ts
       21  followDefinition.  tests/navigation.test.ts
        2  goBack.  src/App.tsx
        1  goBack.  src/index.ts
        2  goBack.  src/lib/code-editor.ts
        3  goBack.  tests/actions.test.ts
        9  goBack.  tests/navigation.test.ts
        2  goForward.  src/App.tsx
        1  goForward.  src/index.ts
        2  goForward.  src/lib/code-editor.ts
        5  goForward.  tests/navigation.test.ts
        2  openSource.  src/App.tsx
        2  openSource.  src/components/SourcePicker.tsx
        1  openSource.  src/index.ts
        9  openSource.  tests/actions.test.ts
        7  openSource.  tests/navigation.test.ts
        2  renameFile.  src/App.tsx
        4  renameFile.  tests/actions.test.ts
        2  setView.  src/App.tsx
        2  trackCursor.  src/App.tsx
        1  trackCursor.  src/index.ts
        2  trackCursor.  src/lib/code-editor.ts
        2  trackCursor.  tests/navigation.test.ts
```

The writer rotation log remains a first sample.
DeepSeek completed the engine; MiMo completed source
resolution; GLM completed the game and shell.
All required lead review and observed checks.
The UI needed more browser fix rounds than the scope code.
Future comparisons should keep tasks similar in size.
