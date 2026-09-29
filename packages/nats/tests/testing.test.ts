import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";
import { installNatsServer, isError } from "@tinker/nats/testing";

test("the helper fetches the pinned server once and reuses its home cache", async () => {
  const cache = await mkdtemp(join(homedir(), ".cache", "nats-test-"));
  try {
    const binary = await installNatsServer(cache);
    const files = await readdir(cache);
    const saved = await Promise.all(
      files.map(async (file) => (await stat(join(cache, file))).mtimeMs),
    );
    expect((await promisify(execFile)(binary, ["-v"])).stdout.trim()).toBe("nats-server: v2.15.0");
    expect(await installNatsServer(cache)).toBe(binary);
    expect(
      await Promise.all(files.map(async (file) => (await stat(join(cache, file))).mtimeMs)),
    ).toEqual(saved);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}, 120000);

test("a bad checksum refuses the binary", async () => {
  const binary = await installNatsServer();
  const shared = dirname(dirname(binary));
  const archive = (await readdir(shared)).find(
    (name) => name.endsWith(".tar.gz") || name.endsWith(".zip"),
  );
  if (!archive) throw new Error("the release archive is missing");
  const cache = await mkdtemp(join(homedir(), ".cache", "nats-corrupt-"));
  try {
    await writeFile(join(cache, "SHA256SUMS"), await readFile(join(shared, "SHA256SUMS")));
    await writeFile(join(cache, archive), "damaged release");
    expect.assertions(1);
    try {
      await installNatsServer(cache);
    } catch (error) {
      if (!isError(error, "ChecksumMismatch")) throw error;
      expect(error.payload.file).toBe(archive);
    }
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
