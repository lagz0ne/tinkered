import { raise } from "@/errors.ts";

const MIN_SAMPLE_MS = 2;

/** Measure milliseconds per operation, growing short batches until their combined time clears
 * the timing floor. Each batch returns only its work time, excluding setup and cleanup. Every
 * batch contributes to both totals; fast batches are never discarded in favor of slow ones. */
export function measureBatch(
  library: string,
  initial: number,
  take: (count: number) => number,
): number {
  let elapsed = 0;
  let operations = 0;
  let batch = initial;
  for (let attempt = 0; attempt < 8; attempt++) {
    elapsed += take(batch);
    operations += batch;
    if (elapsed >= MIN_SAMPLE_MS) return elapsed / operations;
    batch *= 2;
  }
  return raise("HarnessInvariant", {
    library,
    reason: "the timer stayed too coarse after larger batches; retry with this tab visible",
  });
}
