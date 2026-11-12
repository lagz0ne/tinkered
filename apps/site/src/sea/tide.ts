import { capsule, data, operation, resource, tag } from "@tinkered/core";
import type { Data } from "@tinkered/core";

import { ocean } from "@/play";

import { seaApi, seaBoard, seaPress } from "./contract";
import type { SeaWave } from "./contract";

// The tide: what turns the playground's ocean into a shared one. It adds no component. It wraps
// one move, `press`, and lands the room's waves.
//
// A press is optimistic, as a TanStack Query mutation with `onMutate` is: the wave starts in this
// tab at once, and the call to the room follows. So a slow link never delays the touch.
//
// The room's waves are state, not events: each has the server's time of its start. So a tab
// lands a wave at its real age, and every tab shows the same sea, also a tab that joins late.

/** The room this tab is in: the cmd reads it from the link. */
const room = tag<string>({ label: "tide.room" });

/** The ids of the waves this tab sent. Each has started here, so its echo must not land again. */
const sent = data<string[]>({ label: "tide.sent", initial: [] });

/**
 * The tab's copy of the waves: the board's own keyed cell, which a read's `cell` names. A unit
 * cannot name a part whose key comes at run time (Core gap, docs/roadmap/core-feedback.md), so
 * `arrive` takes the cell's controller and joins `where({ room })` itself, as `useData` does.
 */
const copy = seaBoard.waves.where({}).cell as Data.Keyed<SeaWave, { room: string; id: string }>;

/** The ids of the room's waves this tab has dealt with: each lands once, or not at all. */
const seen = data<string[]>({ label: "tide.seen", initial: [] });

/**
 * How far the server's clock is ahead of this tab's, in ms; null until the server answers. A
 * wave's `at` is on the server's clock, so this is what tells its age. Firebase gives the same
 * number as `serverTimeOffset`.
 */
const ahead = data<number | null>({ label: "tide.ahead", initial: null });

/**
 * Asks the server's time, as Cristian's algorithm does: the answer is taken to be half the round
 * trip old, so it is off by half a round trip at most. A fault leaves the clock unknown: the
 * next change of the room's waves asks again.
 */
const sync = operation({
  label: "tide.sync",
  depends: { ahead: ahead.controller, now: seaApi["clock.now"].controller },
  run: async ({ ahead, now }, { clock }) => {
    const asked = clock.currentTimeMillis();
    const told = await now.settle({ input: null });
    if (told.status === "success") ahead.set(told.value - (asked + clock.currentTimeMillis()) / 2);
  },
});

/**
 * Lands each wave of the room that is new to this tab, at its real age. Not this tab's own:
 * those started at the press. So a tab that joins sees what the others see now: a wave in flight
 * joins mid-flight, and a wave that has ended does not start again (`land` drops it). Until the
 * clock is known it lands nothing and asks for the clock.
 */
const arrive = operation({
  label: "tide.arrive",
  depends: {
    room: room.required,
    waves: copy.controller,
    ahead,
    seen: seen.controller,
    sent: sent.controller,
    sync: sync.controller,
    land: ocean.land.controller,
  },
  run: ({ room, waves, ahead, seen, sent, sync, land }, { clock }) => {
    if (ahead === null) return sync.run();

    const next = waves.where({ room }).get();
    const known = new Set([...seen.get(), ...sent.get()]);
    seen.set(next.map((w) => w.id));

    const now = clock.currentTimeMillis() + ahead;
    for (const { id, x, y, hue, power, at } of next) {
      if (!known.has(id)) land.run({ input: { x, y, hue, power, age: Math.max(0, now - at) } });
    }
  },
});

/** Runs `arrive` when the room's waves change, and when the clock becomes known. */
const shore = resource({
  label: "tide.shore",
  depends: {
    room: room.required,
    waves: copy.controller,
    ahead: ahead.controller,
    arrive: arrive.controller,
  },
  factory: ({ room, waves, ahead, arrive }, { defer }) => {
    defer(waves.where({ room }).watch(() => void arrive.run()));
    defer(ahead.watch(() => void arrive.run()));
    void arrive.run();
    return room;
  },
});

/** Tells the room about a wave that has started here: it deals the id, notes it, and calls. */
const send = operation({
  label: "tide.send",
  input: seaPress.pick({ x: true, y: true, hue: true, power: true }),
  depends: { room: room.required, sent: sent.controller, call: seaApi["wave.press"].controller },
  run: ({ room, sent, call }, { input, random }) => {
    const id = random.uuid();
    sent.update((ids) => [...ids.slice(-63), id]);
    return call.run({ input: { ...input, room, id } });
  },
});

/**
 * `tide({ room })`, after `ocean(...)` and the sea's board and api in the cmd's capsules.
 * - start: loads `shore`, so the room's waves land here, each at its real age.
 * - run: `event.is(ocean.press)` picks the one move and gives the event that op's types. The
 *   press runs here first (`next`), so the wave starts on the touch. Then the hook sends it to
 *   the room, with the hue this tab dealt. The storm presses through it as well.
 */
export const tide = capsule({
  label: "tide",
  config: { room: room.required },
  hooks: {
    async start({ load, next }) {
      await load(shore, { role: "worker", explain: "Lands the room's waves" });
      await next();
    },
    run(event) {
      if (!event.is(ocean.press)) return event.next();

      const input = { ...event.input, hue: event.next() };
      return event.run(
        send,
        { input },
        { role: "handler", explain: "Tells the room about the wave" },
      );
    },
  },
});
