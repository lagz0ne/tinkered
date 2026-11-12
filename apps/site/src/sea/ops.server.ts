import { operation } from "@tinkered/core";

import { seaApi, seaPress, waves } from "./contract";

// The server's work for `seaApi`. A wave lives a few seconds, so a room holds only its last few
// waves: memory stays small with no store and no timer.

/** How long the server keeps a wave, in ms: longer than a wave lives on a tab. */
const keep = 4000;

/** The most waves one room holds; a newer press drops the oldest. */
const most = 64;

const pressWave = operation({
  label: "sea.press.do",
  input: seaPress,
  depends: { list: waves.controller },
  run: ({ list }, { input, clock }) => {
    const at = clock.currentTimeMillis();
    for (const w of list.get()) if (at - w.at > keep) list.delete({ room: w.room, id: w.id });

    const here = list.where({ room: input.room }).get();
    if (here.length >= most) list.delete({ room: input.room, id: here[0]!.id });

    list.set({ ...input, power: input.power ?? 1, at });
    return { hue: input.hue };
  },
});

/** The clock that stamps each wave's `at`. */
const readClock = operation({
  label: "sea.clock.now.do",
  input: seaApi["clock.now"].input,
  run: (_, { clock }) => clock.currentTimeMillis(),
});

/** The server's side of `seaApi`, by address: `sea.api({ implement: seaOps })`. */
export const seaOps = { "wave.press": pressWave, "clock.now": readClock } as const;
