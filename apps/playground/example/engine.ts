import { operation, resource } from "@tinker/core";
import { raise } from "./errors";
import {
  angle,
  board,
  frames,
  grid,
  IDLE,
  physics,
  random,
  sameShade,
  stormOn,
  targetAngle,
  waves,
  type Physics,
  type Shade,
  type Wave,
} from "./state";

/** The settings a live control may write; every one of them is a finite number. */
const SETTINGS = ["speed", "ring", "reach", "life", "height", "stormRate"] as const;

const TURN_MS = 250;

const soften = (progress: number): number => {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
};

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** One tile press: tile coordinates, not pixels. */
type Press = { x: number; y: number };

/** A press is an OPERATION: typed input, declared deps, runs on every call. Testable as
 * `scope.run(press, { input: { x, y } })` then reading the `waves` cell. The id is derived from the
 * list and the ambient clock. No counters, no globals. The parser is the door: it admits the one
 * shape a press has; anything else is refused with `BadPress`, which reaches the caller as core's
 * DataValidationFailed carrying it as the cause. Returns the hue it dealt. */
export const press = operation({
  label: "press",
  input: (raw): Press => {
    const p = raw as { x?: unknown; y?: unknown } | null | undefined;
    if (p && isNumber(p.x) && isNumber(p.y)) return { x: p.x, y: p.y };
    raise("BadPress", "a press is { x, y } with finite numbers");
  },
  depends: { waves: waves.controller, random: random.required },
  run: ({ waves, random: roll }, { input, clock }) => {
    const hue = Math.floor(roll() * 360);
    const start = clock.currentTimeMillis();
    waves.update((list) => [
      ...list,
      { id: (list.at(-1)?.id ?? 0) + 1, x: input.x, y: input.y, hue, start },
    ]);
    return hue;
  },
});

/** Clearing the board is an operation too — no input, two declared deps: every wave goes, and the
 * storm stops pressing. From React it is `useRun(clear)`; from a test it is `scope.run(clear)`.
 * Same code path either way. */
export const clear = operation({
  label: "clear",
  depends: { waves: waves.controller, stormOn: stormOn.controller },
  run: ({ waves, stormOn }) => {
    waves.set([]);
    stormOn.set(false);
  },
});

/** Write part of the physics while the waves keep moving: the ticker reads the cell every frame, so
 * a new value lands on the next one. The parser is the door for live controls: it admits a partial
 * record whose values are finite numbers and refuses anything else with `BadPhysics`. */
export const setPhysics = operation({
  label: "setPhysics",
  input: (raw): Partial<Physics> => {
    const patch = raw as Partial<Record<keyof Physics, unknown>> | null | undefined;
    if (!patch || typeof patch !== "object")
      raise("BadPhysics", "physics is a partial record of numbers");
    const next: Partial<Physics> = {};
    for (const key of SETTINGS) {
      const value = patch[key];
      if (value === undefined) continue;
      if (!isNumber(value)) raise("BadPhysics", `${key} is not a number`);
      next[key] = value;
    }
    return next;
  },
  depends: { physics: physics.controller },
  run: ({ physics }, { input }) => physics.update((prev) => ({ ...prev, ...input })),
});

/** The storm switch: while it is on, the ticker presses a random tile every `stormRate` ms. */
export const setStorm = operation({
  label: "setStorm",
  input: (raw): boolean =>
    typeof raw === "boolean" ? raw : raise("BadStorm", "the storm is on or off"),
  depends: { stormOn: stormOn.controller },
  run: ({ stormOn }, { input }) => stormOn.set(input),
});

/** Turn the board a quarter turn clockwise (1) or anticlockwise (-1). The target moves at once and
 * the ticker animates `angle` toward it. Targets accumulate: four turns are a full turn, and the
 * number grows past 360 without wrapping. */
export const turn = operation({
  label: "turn",
  input: (raw): -1 | 1 => (raw === -1 || raw === 1 ? raw : raise("BadTurn", "a turn is -1 or 1")),
  depends: { targetAngle: targetAngle.controller },
  run: ({ targetAngle }, { input }) => targetAngle.update((to) => to + input * 90),
});

/** The look of one tile is a PURE function of (waves, now, physics). No hidden state: hand it a
 * fixed `now` and a wave list and you can assert colours in a test. A front is strongest right on
 * its ring and fainter the further the tile is from the press; `height` scales how high it lifts
 * the tile. Where two fronts meet, their hues are blended (circular mean, weighted by intensity)
 * and the shade deepened so the zone reads as its own colour, not either wave's. */
export function shadeAt(x: number, y: number, list: Wave[], now: number, p: Physics): Shade {
  const hits: { w: Wave; i: number; angle: number }[] = [];
  for (const w of list) {
    const age = now - w.start;
    const d = Math.hypot(x - w.x, y - w.y);
    const r = (age / 1000) * p.speed;
    const front = Math.exp(-(((d - r) / p.ring) ** 2));
    const fade = Math.max(0, 1 - d / p.reach);
    const i = front * fade * soften(age / 90) * soften((p.life - age) / 250);
    if (i > 0.04) hits.push({ w, i, angle: Math.atan2(y - w.y, x - w.x) });
  }
  const [top, second] = hits.sort((a, b) => b.i - a.i);
  if (top === undefined) return IDLE;
  const converge = second !== undefined && second.i > top.i * 0.3;

  let h = top.w.hue;
  let s = 62;
  let l = 90 - 32 * top.i;
  if (converge) {
    let sx = 0;
    let sy = 0;
    for (const { w, i } of hits) {
      sx += Math.cos((w.hue * Math.PI) / 180) * i;
      sy += Math.sin((w.hue * Math.PI) / 180) * i;
    }
    h = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
    s = 80;
    l = 64 - 16 * top.i;
  }
  return {
    h: Math.round(h),
    s,
    l: Math.round(l),
    a: Math.round((top.angle * 180) / Math.PI / 10) * 10,
    i: Math.round(top.i * 20) / 20,
    z: Math.round(top.i * p.height * 100) / 100,
    c: converge,
  };
}

/** The engine is a RESOURCE: built once per scope, its deps declared, its cleanup a `defer` the
 * scope runs on close. It owns ONE frame loop. Each frame it reads the ambient clock, prunes the
 * waves that outlived `life`, presses a random tile when the storm is on and its cadence is due,
 * recomputes the board once (and writes it only when some tile's look changed), animates the
 * board's angle toward its target by the elapsed time, and asks for the next frame. Its value is
 * the grid size the board renders. */
export const ticker = resource({
  label: "ticker",
  depends: {
    grid: grid.required,
    frames: frames.required,
    random: random.required,
    press: press.controller,
    physics: physics.controller,
    stormOn: stormOn.controller,
    waves: waves.controller,
    board: board.controller,
    angle: angle.controller,
    targetAngle: targetAngle.controller,
  },
  factory: (deps, { defer, clock }) => {
    const { cols, rows } = deps.grid;
    const schedule = deps.frames;
    const roll = deps.random;
    let frame = 0;
    let lastStorm = clock.currentTimeMillis();
    let motion = { from: deps.angle.get(), to: deps.targetAngle.get(), start: lastStorm };
    defer(
      deps.targetAngle.watch(() => {
        motion = {
          from: deps.angle.get(),
          to: deps.targetAngle.get(),
          start: clock.currentTimeMillis(),
        };
      }),
    );

    /** Drop the waves that outlived `life`. */
    const expire = (now: number, life: number) => {
      const all = deps.waves.get();
      const live = all.filter((w) => now - w.start < life);
      if (live.length !== all.length) deps.waves.set(live);
    };

    /** Press one random tile when the storm is on and its cadence is due. */
    const storm = (now: number, rate: number) => {
      if (deps.stormOn.get() && now - lastStorm >= rate) {
        lastStorm = now;
        deps.press.run({
          input: { x: Math.floor(roll() * cols), y: Math.floor(roll() * rows) },
        });
      }
    };

    /** Recompute the board once, and write it only when some tile's look changed. */
    const paint = (now: number, settings: Physics) => {
      const list = deps.waves.get();
      const prev = deps.board.get();
      let changed = prev.length !== cols * rows;
      const next: Shade[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const shade = list.length ? shadeAt(x, y, list, now, settings) : IDLE;
          if (!changed && !sameShade(prev[next.length], shade)) changed = true;
          next.push(shade);
        }
      }
      if (changed) deps.board.set(next);
    };

    /** Ease into and out of each turn, using scope time so frame rate does not change its length. */
    const rotate = (now: number) => {
      if (deps.angle.get() === motion.to) return;
      const progress = soften((now - motion.start) / TURN_MS);
      deps.angle.set(motion.from + (motion.to - motion.from) * progress);
    };

    const step = () => {
      const now = clock.currentTimeMillis();
      const settings = deps.physics.get();
      expire(now, settings.life);
      storm(now, settings.stormRate);
      paint(now, settings);
      rotate(now);
      frame = schedule.request(step);
    };
    frame = schedule.request(step);
    defer(() => schedule.cancel(frame));
    return { cols, rows };
  },
});
