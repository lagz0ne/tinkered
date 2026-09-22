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
