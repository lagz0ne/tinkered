import { capsule, data, remoteData, rpc } from "@tinkered/core";
import { z } from "zod";

// The shared sea's contract: both sides import it. A room is a sea; each press there is a wave
// that every tab reading the room sees. The server is the only writer.

/** A room's name: lowercase, digits and dashes, as a link would carry it. */
export const roomName = z.string().regex(/^[a-z0-9-]{1,24}$/);

const tile = z.number().int().min(0).max(63);

const wave = z.object({
  room: z.string(),
  id: z.string(),
  x: tile,
  y: tile,
  hue: z.number(),
  power: z.number(),
  /** The server's clock when the wave began; it drops a wave a few seconds later. */
  at: z.number(),
});

export type SeaWave = z.infer<typeof wave>;

/** The waves, by room: a tab reads one room with `where({ room })`. */
export const waves = data({
  label: "sea.waves",
  mode: "keyed",
  parse: wave,
  key: (w) => ({ room: w.room, id: w.id }),
});

/** Read: each room's waves go to every tab that reads the room. */
export const seaBoard = remoteData({ waves });

/**
 * A press, as the tab sends it. The tab deals the wave's id and hue, because its own wave has
 * already started there; the server keeps them, so every tab sees the same colour.
 */
export const seaPress = z.object({
  room: roomName,
  id: z.string().min(1).max(64),
  x: tile,
  y: tile,
  hue: z.number().int().min(0).max(359),
  power: z.number().min(0).max(1).optional(),
});

/**
 * Ask: a press is a call. `clock.now` is the server's clock, in ms: a wave's `at` is on that
 * clock, so a tab asks for it to tell how old a wave is.
 */
export const seaApi = rpc({
  "wave.press": { input: seaPress, output: z.object({ hue: z.number() }) },
  "clock.now": { input: z.null(), output: z.number() },
});

/**
 * The shared sea's one capsule, for both sides. The page's door is `@/sea`; the server's is
 * `@/sea/index.server`, so the server never pulls the ocean or the page.
 * - `board`: each room's waves (remote data, keyed by room).
 * - `api`: a press, as a call (rpc).
 */
export const sea = capsule({ label: "sea", exports: { board: seaBoard, api: seaApi } });
