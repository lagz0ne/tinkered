/** A promise whose settlement a test drives by hand — the deterministic-async fixture:
 * no timers, no sleeps. Hand `promise` to the code under test, then `resolve`/`reject`
 * to advance it to a settled state on command. */
export type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
};

/** Create a {@link Deferred}. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
