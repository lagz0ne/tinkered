import { expect, test } from "vite-plus/test";

/** A command run as its own process: a panic there must not end this test run. */
const command = new URL("./fixtures/panic-command.ts", import.meta.url).pathname;

test("a panic exits 1 even when the root's own close fails", async () => {
  const child = Bun.spawn([process.execPath, command], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "ignore",
    stderr: "pipe",
  });

  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);

  expect(code).toBe(1);
  expect(stderr).toContain("server close failed: ");
});
