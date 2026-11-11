import { capsule } from "@tinker/core";

import { ticker } from "./engine";
import { board, cols, frames, heading, physics, rows, storm, walls, waves } from "./state";

/**
 * The ocean's door: `ocean({ cols, rows, frames })` in the scope's capsules. It starts the frame
 * loop and stops it when the scope closes.
 */
export const ocean = capsule({
  label: "ocean",
  config: { cols: cols.required, rows: rows.required, frames: frames.required },
  exports: { physics, waves, storm, heading, walls, board },
  hooks: {
    async start({ load, next }) {
      await load(ticker, { role: "worker", explain: "Paints the board each frame" });
      await next();
    },
  },
});
