# Playground: tile storm

## Sessions lab — 2026-09-30

Source: `a8f131ff`; React adapter: `878ca7ba`.
The new Sessions tab shows two separate project drafts.
Harbor and Beacon each use a stable namespace key.
A route owns a session; its form owns a child session.
Reset title clears one field and keeps its notes.
Reset form closes the child and starts fresh fields.
Leave route closes the route and its child form.
Return opens a fresh draft with the saved project brief.
Refetch brief rebuilds only that project's named resource.
Its build count records real local builds.
Form and route close abort the form's temporary signal.

The lab uses the ocean's ink, salt, foam, and lime colors.
Phone tabs use two rows; fields use readable 16-pixel text.
All Sessions buttons meet 44 pixels.
View source opens the real Sessions code.
The ocean document stays mounted through all four views.
The storm and benchmark workload do not change.

All 64 app tests pass, including five new Sessions checks.
The full build, check, tests, and all 48 release lanes pass.
Browser checks pass at 1,440, 390, and 320 pixels.
They cover all resets, sibling drafts, caches, and code navigation.
There is no side scroll or page error at those sizes.
A separate reader also checked keyboard reset and route return.
The isolated React fault check passes at 93.10, above its floor of 85.
The live release remains in review.
Proof files are under `.bench/react-namespaces`.

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

## Motion and style follow-up

The user asked Codex to make this change directly.
The user clarified that sluggish animation is the main issue.
The tile currently starts a 160 ms CSS transition for every
frame update. Its walls also change width and height each
frame. The shell still uses white default component colors
beside the dark game.

Plan: remove the extra motion delay, give new waves a short
rise, keep wall dimensions fixed, and use one ocean palette
for the shell. Measure before and after on the same browser.
Keep the frame source and game state in Tinker.

## Motion follow-up proof

Codex made the edits directly, as the user requested.

- The shell now uses ocean colors, seafoam focus rings,
  and dark native controls. New sessions use One Dark.
  Stored editor theme choices are kept.
- Removed the tile's extra 160 ms transform transition.
  Tinker frame updates now set the shown position directly.
- Waves rise over 90 ms and settle during their last 250 ms.
  Slow waves no longer drop away at their time limit.
- Board turns ease at both ends over 250 ms, using scope time.
- Wall faces keep fixed 1 px dimensions and stretch with
  transforms. Back faces are hidden. Face styles are direct;
  changing a tile no longer propagates custom properties
  through every face. Arrows stay mounted and use opacity.

Browser diagnostics used headless Chromium at 1280 by 850,
a storm, 180 sampled frames, and 4x CPU slowdown.
Three runs were taken for each version. The following are
medians, not a promise about frame rates on user devices:

- Mean tile position lag: 7.94 px before; below 0.001 px after.
- Style work per run: 15.75 s before; 1.77 s after.
- Layout work per run: 2.76 s before; 0.039 s after.
- Main-thread work per run: 29.48 s before; 7.01 s after.
- Median frame gap: 183 ms before; 50 ms after under slowdown.

The first pass removed the extra transition and layout size
changes. A second pass removed inherited face variables and
arrow mount changes; that removed more style and layout work.
An unthrottled diagnostic still showed a 33 ms median gap on
this headless host. No universal 60 fps claim is made.

Observed checks:

- Playground build and `vp check`: exit 0, 19 old warnings.
- Scope tests: 56 pass, including three new motion tests.
- All three motion regressions fail on the old engine.
  The fixed source was restored byte for byte after that run.
- Strict style census: exit 0.
- Browser: matching shell color, One Dark default, four turns,
  no tile transition, fixed wall dimensions, no script errors.
- Phone: no sideways scroll; a 400-frame maximum-height
  storm scan showed no tile clipping through four turns.
- Source search, F12, history, and game identity checks pass.

SCIP was rebuilt. Old `TURN_PER_MS` has no definition or
references. Existing Tile, ticker, and themeCell callers stay
in the view, services, and their scope tests. No public
signature changed. The game impact check has no discrepancy.

Writer cleanup is complete through Paseo's workspace API.
The tsunami, source, and visual writer workspaces and their
five agents were archived; all three directories were removed.
The visual writer's two unstaged files were checked byte for
byte against committed `c070795` before removal. Nothing
unique was discarded. This working checkout is retained.

Advisory follow-up: preflight found no file-level issue.
The component notes correctly identify React views.
The quarter-turn constant is game behavior, not caller
configuration. Frame cancellation and watch cleanup are
both owned by `defer`; those two findings were labeled false.
The slow-wave and eased-turn titles name the measured
outcomes, so their title findings were labeled false too.
The older wave title already has a false label on record.
Calibration was run and saved with the new review labels.

## Playground release

User requested commit, push, and release.
Merged current origin/main (`f7e8ed5`) into the playground
branch. Both sets of review labels were retained.
Combined build and checks pass; 56 playground tests pass.

The existing Dokploy compose is named playground, ID
`vGQY1X2XEn7f7dyzt9LqP`, using a local static nginx image.
Release will keep its domain, network, and settings intact.
Only the image is rebuilt, then Dokploy redeploys the app.

Release checks: the full package run had one Drizzle test
hit its five-second timeout under parallel load.
The unchanged Drizzle suite passed when run alone.
The merged review cases were calibrated and saved.

Released `playground-2026.09.22` from `00841b8`.
Main and the feature branch are pushed.
[Release and static archive](https://github.com/lagz0ne/tinkered/releases/tag/playground-2026.09.22).
[Live playground](https://playground.tini.works).

Dokploy deployment `TK0c9An1hfBUpF57d3_Rh` is done.
Its log confirms the container was recreated and started.
The container is healthy and uses the new image:
`sha256:e5b4a567ccb394a83024794196280c9011a7b3676062908782b7ddefb31a7bf1`.
The live index hash matches the checked build.
The domain, port, path, and service mapping are unchanged.

Live browser checks pass at desktop and phone widths:
styles, waves, four turns, source search, F12, read-only
package files, cursor history, and phone Follow controls.
Native fullscreen, fit fallback, and iframe Escape pass.
No script errors were observed.

Rollback image: `tinkered-playground:before-playground-2026.09.22`.
To roll back, tag that image as `tinkered-playground:latest`,
then redeploy this compose through the Dokploy API.

## Reset demo button

Android Edge feedback: make resetting the saved demo easy.
Play now shows a text-labeled Reset demo button, at least
44 pixels tall. Code keeps the compact button.
Both use the existing Tinker reset operation.
The tooltip says that saved code edits are replaced.

Phone regression at 390 pixels: seed the old saved Ripples
project, tap Reset demo, see Tile storm, then reload.
The new starter stays selected and dirty is false.
The old release fails at the missing Play reset button.
The changed build passes, with no sideways scroll or errors.
Build and check pass; 56 scope tests pass.
Style census passes. Advisory view findings describe the
React view components correctly; no model change is needed.

Shipped commit `478cfff` to main and the live playground.
Dokploy deployment `Ma0ZPG_56nFfEuFtrbUmu` finished.
Its log confirms recreation and startup; the image is healthy.
The live index hash matches the checked build.
The same phone reset and reload regression passes live.
This checks phone-sized Chromium, not a physical Android Edge.

## Benchmark short samples

A 1.90 ms Preact sample stopped the entire benchmark.
The fixed initial batches could fall below the 2 ms floor.
Short update, fan-out, and mount batches now grow until
their combined measured time reaches that floor.
All timed work counts in the average, including short batches.
The render-count guards remain in place for every batch.
Eight attempts bound a timer that never advances.
Mount cleanup stays outside the timing window.
Failed runs release their live trees, and the error replaces
the initial click-to-run prompt.

No existing public signature changed.
The new measurement function is exported for browser-free
sampling tests. SCIP indexed the app directly; the shared
index script covers packages, so it cannot see this app.
The prior package lookup for measureBatch returned none.
The app index reports these callers:

```impact playground-benchmark-batches
measureBatch
  src/bench/runners.ts: 4
  src/bench/sampling.ts: 2
  src/index.ts: 1
  tests/benchmark.test.ts: 4
endUpdates
  src/bench/BenchPage.tsx: 3
  src/bench/runners.ts: 2
```

Build and check pass; 59 tests pass.
With batch growth disabled, the short-timing regressions
fail (2 failed, 1 passed); with growth, all three pass.
Three complete phone-sized Chromium benchmark runs pass.
These runs prove completion, not a library speed claim.
Style census passes. Advisory view and operation notes
match the existing benchmark design. The sampler counter
is measurement state outside the competing stores; moving
it into Tinker would add Tinker work to every competitor.
The stateOutsideCell finding is labeled false.

Shipped `917d950` to main and the live playground.
Dokploy deployment `A7XH6WQQ9fZhLC0h3LMl-` is done.
The deployment log confirms startup; the image is healthy.
The live index hash matches the checked build.
A full benchmark run on the live site produced results,
including Preact Signals, with no page errors.
This was phone-sized Chromium, not physical Android Edge.
The existing domain mapping is unchanged.
Review labels were recalibrated after the false finding.

## Tile storm detail pass

Date: 2026-09-30.
Status: Done; pushed and deployed; live checks pass.
Owner: lead (playground release).
Writer: Astra, xhigh; package: playground.

The user asked to finish the authoring changes and deploy the playground.
Keep the same ocean tile concept and refine its look and small details.
The checked authoring branch is the build base.
The vendor files and browsable package sources must come from that base.

The view may change type, spacing, color, light, and control layout.
Keep waves, board turns, sliders, storm, keyboard input, and clear.
Keep the same game alive across Play, Code, Benchmark, and full screen.
Keep saved user code and provide the existing Reset demo action.

Verify with build/check, package and app tests, and style census.
Review the real page at desktop and phone widths.
Check the deployed files against the build after Dokploy reports done.

User follow-up: crisp isometric tiles and drawn wave vectors.
The sea should feel endless beyond the frame.
Buttons and panels need the same care as the tiles.
Apply the same detail to Code and Benchmark.
Keep benchmark work and counts fair; do not change the numbers for looks.
A second Astra writer owns Benchmark and source-view components.
The first writer owns the sea, the shell, and Code layout.

## Detail pass proof

The scene, controls, Code, and Benchmark now share one ocean palette.
The board uses an isometric view and fades past the frame.
All 144 live tiles keep their solid walls and wave direction arrows.
Keyboard focus fits the full board so every tile can be reached.
The extra face shadows and gradients are gone.
Each arrow changes its own path color, which cuts inherited style work.
The engine and storm pace stay the same.

Checked render source: `217a0218`.
The final unit-label fix is `0d6f5320`.
The release includes authoring checkpoint `dfaad530` and landing record `d9444e68`.
The browser vendor files and package sources are rebuilt from that source.

Observed gates at `9737a017`:

- Full build: exit 0.
- Check: exit 0; no errors and 28 existing warnings.
- All 17 package and app test tasks: exit 0.
- All 48 release lanes: pass.
- Strict style census and TSDoc check: exit 0.
- Lead Jev review: zero flags.
- Review labels were calibrated and committed at `5ed4dc3e`.

The final unit fix also passes build, check, and all 59 playground tests.
Its browser check fails before the fix and passes after it.
At 1440, 390, and 320 pixels, the heading keeps `µs` in lower case.
Uppercase styling had made the microsecond unit look like milliseconds.
No benchmark timing code or sample counts changed.

Browser checks cover real controls, four turns, tall waves, and full screen.
The phone has no sideways scroll and controls are at least 44 pixels tall.
Reduced motion keeps colors and arrows while stopping the tile lift.
The same game document stays alive across Play, Code, and Benchmark.
Source search, read-only files, symbol jumps, and history pass.
Final visual review found no remaining layout defect.

## Storm drawing check

The host queue ran the same browser probe on one CPU core.
Before: the polished scene at `153c5137`.
After: the render fix at `217a0218`.
Both use the same engine, 144 tiles, storm, and viewport of 1440 by 1000.
Each run warms 60 frames and samples 180 frames.
Seven paired rounds alternate the order of the two builds.

Queue job: `f49e8ae54c06`.
Verdict: **b is faster**.
Command median: 32,159 ms before; 23,949 ms after.
The command took 25.5% less time.
Its 95% gap range was -16,347 to -7,763 ms.
This includes browser startup and warmup.
It is a headless stress check, not a device frame-rate promise.

Three retained browser traces per side also show less drawing work:

- Median frame gap: 116.6 ms before; 83.3 ms after.
- Style work over the sampled frames: 4.592 s before; 1.466 s after.
- Main-thread work: 11.281 s before; 7.475 s after.
- All runs kept 144 tiles and reported no page errors.

The first trace showed that removing the field mask did not help.
Removing face effects and inherited arrow color did help.
That is why the fix changes the faces and arrow paths.

## Benchmark page proof

The queue ran three complete browser benchmarks.
Every library returned its real results with no page errors.
The phone page fits without sideways scroll.
One Tinker slice update renders one component.
The Context baseline renders all 50 components for that change.
The bars use each column's full median scale.
Speed labels keep the existing spread and gap checks.
Results still include cases where other libraries are faster.

Temporary browser preview:
<https://p-50bd6dbbd2a1.preview.tini.works>.
The public release uses the existing playground domain.

## Final source gates

The lead reran the full gates after unit fix `0d6f5320`.
Full build, check, all 17 test tasks, and all 48 release lanes pass.
Check still reports no errors and 28 existing warnings.
The last test run used 16 valid cache results and one fresh tracker result.
The writer had already run the 59 playground tests on this exact source.
Prose also passes.

A final queued browser benchmark uses the final build.
Every library returns results and the actual heading keeps `µs`.
There are no page errors or phone scroll issues.
The timed storm source is unchanged by the unit-label fix.

Final logs:

- `/tmp/tinkered-playground-release-build.log`
- `/tmp/tinkered-playground-release-check.log`
- `/tmp/tinkered-playground-release-tests.log`
- `/tmp/tinkered-playground-release-validate.log`
- `/tmp/tinkered-playground-final-census.log`
- `/tmp/tinkered-playground-final-tsdoc.log`
- `/tmp/tinkered-playground-final-review.log`
- `/tmp/tinkered-playground-storm-ab.log`
- `/tmp/tinkered-playground-final-browser-benchmark.log`

## Detail pass release

Released source: `c55801d3`, pushed to main.
[Live playground](https://playground.tini.works).
Dokploy deployment `0VnmMiw0C2em0uYXyidCf` is done.
The deployment log confirms the container was recreated and started.
The container is healthy and uses the checked image:
`sha256:d865814ba5ad4da09ee0edea1dbad701528ca4e6fd112c5bcf78a31305de1217`.

The live index, Core vendor file, and React vendor file match the build byte for byte.
The Core vendor file also matches the built Core package.
Main's fresh build and check pass, with the same 28 warnings.
The domain, path, port, service, and network settings stay the same.

Live browser checks pass at 1440, 390, and 320 pixels.
The storm has 144 tiles and tall waves.
Four turns fit the keyboard view at both phone widths.
Source search, read-only Core, F12, and Back work.
The same storm stays alive through Code, Benchmark, and full screen.
Reduced motion and Clear work.
No page errors were observed.
This checks phone-sized Chromium, not a physical Android phone.

The live vendor probe uses a namespace with an ocean project tag.
An object run hook receives that exact namespace and returns 42.
Its close hook runs once, and graceful close returns success.

Rollback image: `tinkered-playground:before-playground-217a0218`.
Tag that image as `tinkered-playground:latest`, then redeploy this same compose to roll back.

Live proof logs:

- `/tmp/tinkered-playground-live-browser.log`
- `/tmp/tinkered-playground-live-deploy-log.json`
- `/tmp/tinkered-playground-main-build.log`
- `/tmp/tinkered-playground-main-check.log`
