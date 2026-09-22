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

```impact playground/tsunami
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

```impact playground/page
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
