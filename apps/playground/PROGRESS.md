# Storm layers

## Lead fix round

Owner: playground/storm-layers writer.
Review: code, images, and six quiet storm traces saved.
Next: lead reviews the wall proof and the remaining count rise.
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
The flat top repeats that colour without CSS inheritance.
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
3,792 at −45°, 9,719 at 45°, 11,807 at 135°, and 3 at 225°.
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

[Six quiet runs and trace paths](proof/storm-layers.json).
The trace job returned 0: `b7a17198235b`.
Its measured code is `bc95a783`, before the whitespace rebase.
Later app source changes contain blank lines only.

Three ten-second runs used the same controls and seed.
Order: before/after, after/before, before/after.
Before load: 3.44–3.89.
After load: 3.38–3.90.
Every kept load sample is below 4.
Busy samples were rejected.

- Long tasks before: 78, 73, 74.
- Long tasks after: 83, 81, 82.
- Board updates before: 78, 73, 74.
- Board updates after: 86, 84, 82.

The raw long-task count still rises.
I do not call that noise or claim the count is fixed.
Every long task contains a rendered board update.
The trace shows more board updates in the after windows.

A long task takes at least 50 ms on the main thread.
Blocking time counts just the time beyond those 50 ms.
Its median fell from 2199 to 1032 ms per window.
Mean long-task length, then median across runs: 80.0 to 62.7 ms.

The first pass had extra style work: 9.79 to 13.42 ms per update.
The final median is 9.82 before and 9.95 ms after.
There is no clear style gain to claim from these three runs.
The final paint median is 30.25 to 23.02 ms per update.
The final layer work median is 25.31 to 18.16 ms per update.

The trace guided two fixes to extra work.
Only the picked walls exist; there are no wall pair selector rules.
Node count is 1,241 before and 1,097 after.
An inherited top background caused 81–89 ms of style work per update.
The top now takes the same colour value directly.

The storm changed the parent tilt attributes zero times on both sides.
Rotor is not the source of these storm long tasks.
For turns, the board now reads just the wall pair.
That pair stays the same between angle edges.
Each tile still reads its own wave state.

Layers: 873 before and 585 after in every run.
Wall layers: 576 to 288.
Arrow layers: 144 to zero; the flat top paints the arrow.
The raw buffer estimate rises: 20.86 to 26.38 MiB.
It sums each drawn layer's width × height × 4.
It is not measured graphics memory; I claim no memory gain.

The original button background is needed for matching wall cover.
The flat top repeats it and owns the outline and arrow.
All 144 button paint records are one rectangle, rather than three commands.
[Paint records](proof/paint-commands.json) show that change.
They do not prove how many graphics bytes Chrome keeps.

The trace script is `scripts/storm-proof.mjs`.
Each browser command uses Chrome and session `storm`.
Each run owns a fresh browser socket folder.
The queue holds the job on one CPU core.
Chrome draws with the CPU, without a window.
Real graphics hardware and other browsers are not proven.

The viewport is 1280 × 900.
The storm uses height 3, speed 12, and gap 100 ms.
Both sides use random seed 7 and a live ten-second clock.
Births follow frame callbacks, so the exact event stream is not fixed.
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
All required gates returned 0 after the rebase to `0ca40d05`.
The blank-line lint passes.
[Gate exit codes](proof/gates.log).

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
benchctl exec --json --timeout 1800 \
  --env AGENT_BROWSER_EXECUTABLE_PATH="$storm_chrome" \
  -- node "$storm_probe" \
  ../storm-layers-base/apps/playground/dist \
  apps/playground/dist .bench/storm-direct \
  measure --serve
```

Use `walls --serve` for four wall checks and three pairs.
Use `--resume` only to keep samples from the same app build.
It returns 1 if any checked wall pixel differs.
Use `capture --serve` for shots without the wall check.
Use `frames --serve` for a fixed-frame command in `ab`.
No site was published or pushed.

## Fix-round commits

- `637cd052`: playground: restore wall cover and remove extra arrow span.
- `079e44cd`: playground: retry trace samples that cross the load limit.
- `8f7bd51d`: playground: save wall regression and gate proof in the app.
- `614519a6`: playground: resume kept traces after a queue timeout.
- `5809917d`: playground: give the flat top its own zero-depth plane.
- `91d1e315`: playground: turn the arrow path without restyling its SVG root.
- `174844d5`: playground: keep four-wall cover with fewer tile nodes.
- `76c04886`: playground: avoid inherited top colour style work.
- `e23e3aaa`: playground: use the requested load limit for trace samples.
- `7be4c90b`: playground: space proof statements for the new lint rule.
