import { capsule, data, remoteData, rpc } from "@tinker/core";
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

/** Ask: a press is a call; the server deals the hue, so every tab sees the same colour. */
export const seaApi = rpc({
  "wave.press": {
    input: z.object({ room: roomName, x: tile, y: tile }),
    output: z.object({ hue: z.number() }),
  },
});

/**
 * The shared sea's one capsule, for both sides. The page's door is `@/sea`; the server's is
 * `@/sea/index.server`, so the server never pulls the ocean or the page.
 * - `board`: each room's waves (remote data, keyed by room).
 * - `api`: a press, as a call (rpc).
 */
export const sea = capsule({ label: "sea", exports: { board: seaBoard, api: seaApi } });
