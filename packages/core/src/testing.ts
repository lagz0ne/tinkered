import { presetSym } from "./preset-symbol.ts";
import type {
  Clock as CoreClock,
  Data,
  Operation,
  Random as CoreRandom,
  Resource,
  Scope,
} from "./index.ts";
import { nextTraceWord, seededTraceRandom } from "./trace-random.ts";

export declare namespace Clock {
  /** A controllable clock for tests: reads a virtual time that moves only when advanced by hand.
   * The mock-free seam for time-dependent code — no `Date` mock, no fake timers (ADR 0034). Pass
   * it to `createScope({ clock })`. */
  export type Test = CoreClock.Handle & {
    /** Wakes every `sleep` now due, earliest first. */
    advance(ms: number): void;
    /** Set virtual time to `ms` milliseconds since the epoch. */
    setTime(ms: number): void;
  };

  /** Seeds {@link makeTestClock}: the virtual time to start at (default `0`). */
  export type Options = { readonly now?: number };
}

export declare namespace Random {
  /** Seeds {@link makeTestRandom}: the same seed replays the same `next` and `uuid` stream
   * (default `0`). */
  export type Options = { readonly seed?: number };
}

function nanosFromMillis(ms: number): bigint {
  const whole = Math.trunc(ms);
  return BigInt(whole) * 1_000_000n + BigInt(Math.round((ms - whole) * 1_000_000));
}

/** Create a controllable clock for tests: virtual time starts at `now` (default `0`) and only
 * moves when you call `advance`/`setTime`. Pass it to `createScope({ clock })` (ADR 0034). */
export function makeTestClock(options?: Clock.Options): Clock.Test {
  let now = options?.now ?? 0;
  const waiters = new Set<{ at: number; wake: () => void }>();
  const drain = (): void => {
    for (const w of [...waiters].sort((a, b) => a.at - b.at)) {
      if (w.at <= now) {
        waiters.delete(w);
        w.wake();
      }
    }
  };
  return {
    currentTimeMillis: () => Math.trunc(now),
    currentTimeNanos: () => nanosFromMillis(now),
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        if (ms <= 0) return resolve();
        const w = { at: now + ms, wake: resolve };
        waiters.add(w);
        if (signal) {
          const onAbort = (): void => {
            waiters.delete(w);
            reject(signal.reason);
          };
          w.wake = () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    advance: (ms) => {
      now += ms;
      drain();
    },
    setTime: (ms) => {
      now = ms;
      drain();
    },
  };
}

/** Create a seeded randomness source for tests: the same `seed` replays the same `next` and `uuid`
 * stream, drawn from one mulberry32 generator. Pass it to `createScope({ random })` (ADR 0062). */
export function makeTestRandom(options?: Random.Options): CoreRandom.Handle {
  let state = (options?.seed ?? 0) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uuid = (): string => {
    let out = "";
    for (let i = 0; i < 16; i++) {
      let byte = Math.trunc(next() * 256) & 0xff;
      if (i === 6) byte = (byte & 0x0f) | 0x40;
      if (i === 8) byte = (byte & 0x3f) | 0x80;
      out += byte.toString(16).padStart(2, "0");
      if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
    }
    return out;
  };
  const random = { next, uuid };
  const traceState = { a: (options?.seed ?? 0) | 0, b: 362436069, c: 521288629, d: 88675123 };
  for (let n = 0; n < 8; n++) nextTraceWord(traceState);
  seededTraceRandom.set(random, traceState);
  return random;
}

/** Test-only: substitute a node's realization for downstream consumers of a scope (ADR 0015).
 * A `data` value is validated through `parse`; an operation takes a replacement `run`; a resource
 * takes a replacement `factory` (built and torn down like the real one). Seed via
 * `createScope({ presets: [preset(node, ...)] })`. The replacement's `deps` are delivered
 * untyped (a `Record<string, unknown>`, like the real factory) — narrow at use. A `void`-returning
 * resource is the one shape whose async/sync parity the type cannot enforce; don't preset one async. */
export function preset<T>(node: Data.Cell<T>, value: T): Scope.Preset;
export function preset<T, I>(
  node: Operation.Handle<T, I>,
  run: (deps: Record<string, unknown>, ctx: Operation.Ctx<I>) => T,
): Scope.Preset;
export function preset<T>(
  node: Resource.Handle<T>,
  factory: (deps: Record<string, unknown>, ctx: Resource.Ctx) => T,
): Scope.Preset;
export function preset(node: unknown, replacement: unknown): Scope.Preset {
  return { [presetSym]: true, node, replacement } as Scope.Preset;
}
