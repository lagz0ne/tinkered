import { operation } from "@tinker/core";
import { z } from "zod";

import { roomName, waves } from "./contract";

// The server's work for `seaApi`. A wave lives a few seconds, so a room holds only its last few
// waves: memory stays small with no store and no timer.

/** How long the server keeps a wave, in ms: longer than a wave lives on a tab. */
const keep = 4000;

/** The most waves one room holds; a newer press drops the oldest. */
const most = 64;

const pressWave = operation({
  label: "sea.press.do",
  input: z.object({ room: roomName, x: z.number(), y: z.number() }),
  depends: { list: waves.controller },
  run: ({ list }, { input, clock, random }) => {
    const at = clock.currentTimeMillis();
    for (const w of list.get()) if (at - w.at > keep) list.delete({ room: w.room, id: w.id });

    const here = list.where({ room: input.room }).get();
    if (here.length >= most) list.delete({ room: input.room, id: here[0]!.id });

    const hue = Math.floor(random.next() * 360);
    list.set({ ...input, id: random.uuid(), hue, at });
    return { hue };
  },
});

/** The server's side of `seaApi`, by address: `sea.api({ implement: seaOps })`. */
export const seaOps = { "wave.press": pressWave } as const;
