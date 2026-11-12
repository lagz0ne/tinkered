import { operation, resource } from "@tinkered/core";

import { draw } from "./draw";
import { blow, expire, paint, rotate } from "./engine";
import { cols, frames, rows } from "./state";

// The frame loop. The capsule's start hook loads `ticker`; closing the scope stops it.

/** One frame: expire, blow, paint, rotate, all at one `now`; then draw what changed. */
export const step = operation({
  label: "ocean.step",
  depends: {
    expire: expire.controller,
    blow: blow.controller,
    paint: paint.controller,
    rotate: rotate.controller,
    draw: draw.controller,
  },
  run: ({ expire, blow, paint, rotate, draw }, { clock }) => {
    const now = clock.currentTimeMillis();
    expire.run({ input: now });
    blow.run({ input: now });

    paint.run({ input: now });
    rotate.run({ input: now });
    draw.run();
  },
});

/** The frame loop: one step a frame, until the scope closes. Its value is the board's size. */
export const ticker = resource({
  label: "ocean.ticker",
  depends: {
    frames: frames.required,
    step: step.controller,
    cols: cols.required,
    rows: rows.required,
  },
  factory: ({ frames, step, cols, rows }, { defer }) => {
    let id = 0;
    const frame = () => {
      step.run();
      id = frames.requestAnimationFrame(frame);
    };

    id = frames.requestAnimationFrame(frame);
    defer(() => frames.cancelAnimationFrame(id));
    return { cols, rows };
  },
});
