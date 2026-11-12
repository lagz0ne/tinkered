import { capsule } from "@tinkered/core";

import { App } from "./App";
import { clear, land, press, setStorm, tune, turn } from "./engine";
import { ticker } from "./loop";
import { board, cols, frames, heading, physics, rows, still, storm, walls, waves } from "./state";

/**
 * The ocean's door: `ocean({ cols, rows, frames })` in the scope's capsules. It starts the frame
 * loop and stops it when the scope closes. `still: true` is for reduced motion: flat water.
 * - Its moves are exports, so another capsule can wrap one: a press can go to a server, and the
 *   server's wave can land here.
 * - Its page is an export too: `<water.View />`, where `water = ocean({ ... })`. So no one imports a
 *   component file: the view comes with the capsule that feeds it.
 */
export const ocean = capsule({
  label: "ocean",
  config: {
    cols: cols.required,
    rows: rows.required,
    frames: frames.required,
    still,
  },
  exports: {
    physics,
    waves,
    storm,
    heading,
    walls,
    board,
    press,
    land,
    clear,
    tune,
    setStorm,
    turn,
    View: App,
  },
  hooks: {
    async start({ load, next }) {
      await load(ticker, { role: "worker", explain: "Paints the board each frame" });
      await next();
    },
  },
});
