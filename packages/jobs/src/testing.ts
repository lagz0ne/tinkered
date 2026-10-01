import { jobsClock } from "./time.ts";

/** Binds a real pg-boss test clock in the scope. Advance drives both the poll timers
 * and the database clock; no global patch or wall-clock sleep is needed. */
export async function createJobsClock(now: string) {
  const { TestClock } = await import("pg-boss");
  const clock = new TestClock(now);
  return { binding: jobsClock(clock), advance: (ms: number) => clock.tick(ms) };
}
