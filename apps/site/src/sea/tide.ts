import { capsule, data, operation, resource, tag } from "@tinker/core";
import type { Data } from "@tinker/core";
import { z } from "zod";

import { ocean } from "@/play";

import { seaApi, seaBoard, seaPress } from "./contract";
import type { SeaWave } from "./contract";

// The tide: what turns the playground's ocean into a shared one. It adds no component and
// changes no engine op. It wraps one move, `press`, and lands the room's waves.
//
// A press is optimistic, as a TanStack Query mutation with `onMutate` is: the wave starts in this
// tab at once, and the call to the room follows. So a slow link never delays the touch.

/** The room this tab is in: the cmd reads it from the link. */
const room = tag<string>({ label: "tide.room" });

/** The ids of the waves this tab sent. Each has started here, so its echo must not land again. */
const sent = data<string[]>({ label: "tide.sent", initial: [] });

/**
 * The tab's copy of the waves: the board's own keyed cell, which a read's `cell` names. A unit
 * cannot name a part whose key comes at run time (Core gap, docs/roadmap/core-feedback.md), so
 * `shore` takes the cell's controller and joins `where({ room })` itself, as `useData` does.
 */
const copy = seaBoard.waves.where({}).cell as Data.Keyed<SeaWave, { room: string; id: string }>;

/** A wave lands only if it began this close to the room's newest, by the server's clock. */
const together = 300;

/**
 * Lands each wave the server adds to the room, once, when this tab sees it arrive. Not this
 * tab's own: those started at the press. A tab that joins a busy room gets the room's last
 * seconds in one answer: only the newest waves of it land, so the joiner does not see seconds
 * of waves start at once.
 */
const shore = resource({
  label: "tide.shore",
  depends: {
    room: room.required,
    waves: copy.controller,
    sent: sent.controller,
    land: ocean.land.controller,
  },
  factory: ({ room, waves, sent, land }, { defer }) => {
    const part = waves.where({ room });
    let seen = new Set<string>();
    defer(
      part.watch((next) => {
        const newest = Math.max(...next.map((w) => w.at));
        const known = new Set([...seen, ...sent.get()]);
        const fresh = next.filter((w) => !known.has(w.id) && w.at >= newest - together);
        seen = new Set(next.map((w) => w.id));
        for (const w of fresh) land.run({ input: w });
      }),
    );
    return room;
  },
});

/**
 * Tells the room about a wave that has started here: it deals the id, notes it, and calls. Its
 * door parses the press, so the hook can hand over the caller's value as it came.
 */
const send = operation({
  label: "tide.send",
  input: z.object({
    press: seaPress.pick({ x: true, y: true, power: true }),
    hue: seaPress.shape.hue,
  }),
  depends: { room: room.required, sent: sent.controller, call: seaApi["wave.press"].controller },
  run: ({ room, sent, call }, { input: { press, hue }, random }) => {
    const id = random.uuid();
    sent.update((ids) => [...ids.slice(-63), id]);
    return call.run({ input: { ...press, hue, room, id } });
  },
});

/**
 * `tide({ room })`, after `ocean(...)` and the sea's board and api in the cmd's capsules.
 * - start: loads `shore`, so the room's waves land here.
 * - run: a `press` runs here first (`next`), so the wave starts on the touch. Then the hook
 *   sends it to the room, with the hue this tab dealt. The storm presses through it as well.
 */
export const tide = capsule({
  label: "tide",
  config: { room: room.required },
  hooks: {
    async start({ load, next }) {
      await load(shore, { role: "worker", explain: "Lands the room's waves" });
      await next();
    },
    run({ op, call, next, run }) {
      if (op !== ocean.press) return next();

      // One hook serves every op, so Core types the caller's value as unknown: `send` parses it.
      const rawInput = { press: call?.input ?? call?.rawInput, hue: next() };
      return run(send, { rawInput }, { role: "handler", explain: "Tells the room about the wave" });
    },
  },
});
