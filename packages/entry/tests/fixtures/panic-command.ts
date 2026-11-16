import { defineMain, observeServerPanics, runMain } from "@/cmd";

/** A server command whose root close fails: a panic aborts it, and its close then rejects. */
const main = defineMain(async ({ signal, exit, stderr }) => {
  const closed = new Promise<void>((_, reject) =>
    signal.addEventListener("abort", () => reject(new Error("close failed"))),
  );
  observeServerPanics(exit.bind(null, 1), closed, stderr);

  setTimeout(() => Promise.reject(new Error("panic")));
  return { closed };
});

await runMain(main);
