# Storm layers

## Lead fix round

Owner: playground/storm-layers writer.
Doing: save the final six quiet storm traces.
Verify: wall pixels, heading tests, trace work, all gates.
Keep all changes in this app.
Do not push.

## Look

Baseline: `origin/main` at `bca0063f`.
The four-wall shots, not the formula, gave these pairs:

- **−45°:** south high, west low; before and after.
- **45°:** south high, east high; before and after.
- **135°:** north low, east high; before and after.
- **225°:** north low, west low; before and after.

CSS applies the rightmost turn first.
Each wall turns before `rotateZ`, then `rotateX`.
South and east have front normals +y and +x.
North and west have −y and −x.
The positive tilt brings positive turned y toward us.
This agrees with all four shots.
Tests cover those pairs, angle edges, and full turns.

The picked pair was right in the first pass.
Moving the top paint into a child changed wall cover.
It showed dark walls the old tops used to hide.
The button now keeps its old background.
The flat top owns the outline.
The flat top inherits that colour.
The arrow paints inside that flat top.
The arrow box turns at full tile size, as the old arrow did.
Its SVG keeps the old 55% size.
Turning just the small path changed cover in the fade.
The top paints before the walls, as the old background did.
The two hidden wall nodes are gone from each tile.
That removes 288 nodes while the flat top adds 144.
The tile has one fewer node than the four-wall version.
The board passes the pair only when that pair changes.
Tiles still read their own wave state.
`low` still uses 0.4 of water lightness.
`high` still uses 0.52, rounded and kept at least 4.
Every picked wall colour string matches the baseline.
Reduced motion keeps the old flat view with no walls.

[Three new before/after views](proof/storm-layers.png).
[The fourth before view](proof/before-225.png).
[The fourth after view](proof/after-225.png).
Both sides use the same two waves and hand-run clock.
Each view has 121 raised tiles with the same heights.

[Wall regions, by tile and face](proof/wall-regions.json).
[Wall colours, all 144 tiles](proof/wall-colours.json).
Each wall gets a unique RGB tag for a second shot.
Its ID is tile × 4 + face, in n/s/w/e order.
The three tag channels use base 9 digits of that ID.
Each channel is 27 + digit × 28.
White and black wall shots give the amount of wall paint.
That lets the check read the tag through the scene's fade.
A 3 × 3 patch must name the same wall throughout.
Its coverage range must stay within 24 of 255 levels.
That keeps smooth fade and leaves out mixed wall edges.
Coverage below 12% is too faint to read the tag.
Both sides' regions count, so extra walls count too.
This checks each tile, not one whole-image score.
All four views have zero changed inner wall pixels.
The check includes 25,268 faded wall pixels.
The same check failed on the reviewed commit, `657d247f`.
Pixels with a channel change over 10 were:
3,250 at −45°, 5,948 at 45°, 8,988 at 135°, and 3 at 225°.
The fixed version passes with zero at all four angles.
The check runs outside the unit tests, as the brief asks.

Every changed pixel is red in these whole-view diffs:

- [−45° diff](proof/diff--45.png).
- [45° diff](proof/diff-45.png).
- [135° diff](proof/diff-135.png).
- [225° diff](proof/diff-225.png).

The full images still differ at arrow and edge pixels.
The wall interiors, including smooth fade, match exactly.

## Long tasks

The reviewed trace has 78 long tasks for 78 board updates.
Its after trace has 86 long tasks for 86 board updates.
Every long task contains a rendered board update.
A long task means main-thread work of at least 50 ms.
The count went up because more updates were drawn.
It does not count a new second task per update.

That pass also had real extra style work.
`UpdateLayoutTree` took 9.79 ms per update before,
and 13.42 ms after, in the first pair of traces.
The fix cuts the tile node count and restores the old wall cover.
There are no wall attribute or class pair rules now.
Only the picked walls exist in the tile.
The final traces will check their style work.
It also counts parent attribute changes during the storm.

The trace script is `scripts/storm-proof.mjs`.
Each browser command uses Chrome and session `storm`.
Each run owns a fresh browser socket folder.
The queue holds the job on one CPU core.
Chrome draws with the CPU, without a window.
Real graphics hardware and other browsers are not proven.
The viewport is 1280 × 900.
The storm uses height 3, speed 12, and gap 100 ms.
Both sides now use the same random seed, 7.
Three ten-second runs per side flip the order each round.
The runner starts below load 3 to leave room.
Only samples with load under 4 count.
I make no FPS gain claim.

## Checks

The new tests are plain tests of the wall picker.
The brief says that new helper needs no failure on main.
The wall screenshot check fails without this fix.
Jev found no code or test flags.
Both wall test promises have README lines.
The older README scan found 31 old gaps outside this card.
No code flags needed labels.
Core feedback: none.
No mutation run is needed: `packages/start` did not change.

Gate logs stay in the local cache:
`/home/paseo/.cache/storm-layers-proof/`.
The final exit codes will go in [the gate log](proof/gates.log).

## Prior frame comparison

[Queued comparison log](proof/ab.log).
The earlier `benchctl ab` tries returned 1 at load 4.
They gave no verdict.
This fix round makes no speed claim from those tries.

## Run the proof again

Run from the tree root with the built baseline next to it:

```bash
storm_probe=apps/playground/scripts/storm-proof.mjs
storm_chrome=../../.cache/ms-playwright/
storm_chrome+=chromium-1234/chrome-linux64/chrome
benchctl exec --timeout 900 \
  --env AGENT_BROWSER_EXECUTABLE_PATH="$storm_chrome" \
  -- node "$storm_probe" \
  ../storm-layers-base/apps/playground/dist \
  apps/playground/dist .bench/storm-review \
  measure --serve
```

Use `walls --serve` for four wall checks and three pairs.
Use `--resume` only to keep samples from the same app build.
It returns 1 if any checked wall pixel differs.
Use `capture --serve` for shots without the wall check.
Use `frames --serve` for a fixed-frame command in `ab`.
No site was published or pushed.
