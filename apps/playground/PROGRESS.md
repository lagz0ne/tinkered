# Storm layers

## Change

- Baseline: `origin/main` at `bca0063f`.
- The flat top holds the arrow and the top colour.
- The parent picks walls from its current heading.
  Tiles keep their own wave subscriptions.
- South follows cosine; east follows sine.
  At the start heading, south and west face the viewer.
  The study's fixed north/west cut was only a probe.
- Edge-on walls have no visible area.
  Tests cover both sides of each edge and full turns.
- Reduced motion keeps the old flat view with no walls.

Assume the app's fixed positive tilt and no perspective.
The app only turns around the board's vertical axis.
No new package API or Core change was needed.

## Proof

[Three before/after views](proof/storm-layers.png).
Both sides use the same two waves and hand-run clock.
Each view has 121 raised tiles with the same heights.
The headings are −45°, 45°, and 135°.
I checked the walls, colours, arrows, and layout.
Some edge pixels differ after the arrow is flattened.
The views are not pixel-identical.

[Storm samples](proof/storm-layers.json).
The full layer rows and traces stay in the local cache:
`/home/paseo/.cache/storm-layers-proof/`.
The script is `scripts/storm-proof.mjs`.
Every browser command uses Chrome and session `storm`.
The queue held the job on one CPU core.
Chrome drew with the CPU.
The queued runs used Chrome for Testing 151.0.7922.34.
The viewport was 1280 × 900.
The storm used height 3, speed 12, and gap 100 ms.

Three ten-second runs per side, with the order flipped:

- **Load:** 3.36 to 3.96 during every kept sample.
  The script waited whenever load reached 4.
- **Layers:** 873 before; 585 after.
- **Arrow layers:** 144 before; 0 after.
- **Wall layers:** 576 before; 288 after.
- **Layer memory, middle value:** 19.88 MiB before;
  17.77 MiB after.
  This is the DevTools estimate: width × height × 4.
  It counts layers that draw.
- **Frames shown per second, middle value:**
  7.56 before; 8.37 after.
  The trace counts unique presented frame IDs.
  Submit events can count one frame more than once.
- **Long tasks:** 78, 78, 77 before;
  86, 92, 85 after.
  Each takes at least 50 ms on the game's main thread.
- **Time over 50 ms, middle value:**
  1971.58 ms before; 1441.46 ms after.

Chrome ran without a window.
Real graphics hardware and other browsers are not proven.
I make no FPS gain claim.

## Checks

The new tests are plain tests of the wall picker.
The brief says they need no failure on main.
Jev found no flags in the changed code or these two tests.
Both new test promises have README lines.
The full README scan found 31 gaps in older tests.
Those tests and their promises are outside this card.
No code flags needed labels.
Core feedback: none.

Every required gate returned 0:

- `git fetch origin` and `git rebase origin/main`.
- `vp install`.
- `vp run -r build`.
- `vp check`: 28 warnings, the same as the clean baseline.
- `vp run -r test`: 10 tasks; Playground 68 tests passed.
- `vp run prose`.
- `vp run @tinker-start-scaffold#check`.
  Its real browser and Docker checks also passed.
- `pnpm validate`: all 18 lanes passed.
- Strict style census on every changed TypeScript file.

No mutation run was required: `packages/start` did not change.

## Frame comparison

[Queued comparison log](proof/ab.log).
The commands ran from the clean pinned baseline tree.
The candidate tree was also clean.
The same app settings drove 60 frame callbacks per side.
The command includes browser and app startup.
It used two rounds with one timed run per side per round.

**No verdict.**
`benchctl ab` returned 1 when load reached 4.
Longer 120-frame tries were also rejected for load.
A shorter comparison still could not hold a quiet window.
The six ten-second trace samples above all stayed below 4.
Their frame rates are observations, not a proven speed gain.

Repeated browser close/open also exposed a socket race.
Each proof run now owns a fresh socket folder.
Every command still uses session `storm`.
The later runs passed that step and rejected only the load.

## Run the proof again

Run from the tree root with the built baseline next to it.
This is the exact queued trace command used here:

```bash
storm_probe=apps/playground/scripts/storm-proof.mjs
storm_chrome=../../.cache/ms-playwright/
storm_chrome+=chromium-1234/chrome-linux64/chrome
benchctl exec --timeout 900 \
  --env AGENT_BROWSER_EXECUTABLE_PATH="$storm_chrome" \
  -- node "$storm_probe" \
  ../storm-layers-base/apps/playground/dist \
  apps/playground/dist .bench/storm-proof \
  measure --serve
```

Use `frames --serve` for a fixed-frame command in `ab`.
Use `capture --serve` for the three image pairs.
No site was published or pushed.
