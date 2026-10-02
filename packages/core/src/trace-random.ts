import type { Random } from "./index.ts";

export declare namespace TraceRandom {
  type State = { a: number; b: number; c: number; d: number };
}

/** Both public entries retain one private stream per test handle (ADR 0086). */
export const seededTraceRandom = new WeakMap<Random.Handle, TraceRandom.State>();

/** Marsaglia's xorshift128: four nonzero-together 32-bit words, never user draws. */
export function nextTraceWord(state: TraceRandom.State): number {
  const t = state.a ^ (state.a << 11);
  state.a = state.b;
  state.b = state.c;
  state.c = state.d;
  return (state.d = state.d ^ (state.d >>> 19) ^ t ^ (t >>> 8));
}
