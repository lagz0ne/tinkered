import { capsule, resource, tag } from "@tinker/core";
import type { Data } from "@tinker/core";

import { ocean } from "@/play";

import { seaApi, seaBoard } from "./contract";
import type { SeaWave } from "./contract";

// The tide: what turns the playground's ocean into a shared one. It adds no component and
// changes no engine op. It wraps one move, `press`, and lands the room's waves.

/** The room this tab is in: the cmd reads it from the link. */
const room = tag<string>({ label: "tide.room" });

/**
 * The tab's copy of the waves: the board's own keyed cell, which a read's `cell` names. A unit
 * cannot name a part whose key comes at run time (Core gap, docs/roadmap/core-feedback.md), so
 * `shore` takes the cell's controller and joins `where({ room })` itself, as `useData` does.
 */
const copy = seaBoard.waves.where({}).cell as Data.Keyed<SeaWave, { room: string; id: string }>;

/** A wave lands only if it began this close to the room's newest, by the server's clock. */
const together = 300;

/**
 * Lands each wave the server adds to the room, once, when this tab sees it arrive. A tab that
 * joins a busy room gets the room's last seconds in one answer: only the newest waves of it
 * land, so the joiner does not see seconds of waves start at once.
 */
const shore = resource({
  label: "tide.shore",
  depends: { room: room.required, waves: copy.controller, land: ocean.land.controller },
  factory: ({ room, waves, land }, { defer }) => {
    const part = waves.where({ room });
    let seen = new Set<string>();
    defer(
      part.watch((next) => {
        const newest = Math.max(...next.map((w) => w.at));
        const fresh = next.filter((w) => !seen.has(w.id) && w.at >= newest - together);
        seen = new Set(next.map((w) => w.id));
        for (const w of fresh) land.run({ input: w });
      }),
    );
    return room;
  },
});

/**
 * `tide({ room })`, after `ocean(...)` and the sea's board and api in the cmd's capsules.
 * - start: loads `shore`, so the room's waves land here.
 * - run: a `press` goes to the server as `wave.press`, not to this tab. The server's write comes
 *   back to every tab in the room, this one too, and lands. The storm presses through it as well.
 */
export const tide = capsule({
  label: "tide",
  config: { room: room.required },
  hooks: {
    async start({ load, next }) {
      await load(shore, { role: "worker", explain: "Lands the room's waves" });
      await next();
    },
    run({ op, call, next, run, config }) {
      if (op !== ocean.press) return next();

      const input = { room: config.room, ...Object(call?.input) };
      return run(seaApi["wave.press"], { input }, { role: "handler", explain: "A press" });
    },
  },
});
