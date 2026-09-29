import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { connect } from "@nats-io/transport-node";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vite-plus/test";
import { installNatsServer, isError, startNatsServer } from "@tinker/nats/testing";

async function bindPort(url: string): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(url).port), "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("the helper fetches the pinned server once and reuses its home cache", async () => {
  const cache = await mkdtemp(join(homedir(), ".cache", "nats-test-"));
  try {
    const binary = await installNatsServer(cache);
    const files = await readdir(cache);
    expect(files.sort()).toEqual(
      [
        "SHA256SUMS",
        basename(dirname(binary)),
        `${basename(dirname(binary))}.${process.platform === "win32" ? "zip" : "tar.gz"}`,
      ].sort(),
    );
    const saved = await Promise.all(
      files.map(async (file) => (await stat(join(cache, file))).mtimeMs),
    );
    expect((await promisify(execFile)(binary, ["-v"])).stdout.trim()).toBe("nats-server: v2.15.0");
    expect(await installNatsServer(cache)).toBe(binary);
    expect(
      await Promise.all(files.map(async (file) => (await stat(join(cache, file))).mtimeMs)),
    ).toEqual(saved);
    await rm(binary);
    expect((await promisify(execFile)(await installNatsServer(cache), ["-v"])).stdout.trim()).toBe(
      "nats-server: v2.15.0",
    );
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}, 120000);

test("a bad checksum refuses the binary", async () => {
  const binary = await installNatsServer();
  const shared = dirname(dirname(binary));
  expect(shared).toBe(join(homedir(), ".cache", "tinkered", "nats-server", "2.15.0"));
  const archive = (await readdir(shared)).find(
    (name) => name.endsWith(".tar.gz") || name.endsWith(".zip"),
  );
  if (!archive) throw new Error("the release archive is missing");
  const cache = await mkdtemp(join(homedir(), ".cache", "nats-corrupt-"));
  try {
    await writeFile(join(cache, "SHA256SUMS"), await readFile(join(shared, "SHA256SUMS")));
    await writeFile(join(cache, archive), "damaged release");
    expect.assertions(2);
    try {
      await installNatsServer(cache);
    } catch (error) {
      if (isError(error, "InvalidConfig")) throw error;
      if (!isError(error, "ChecksumMismatch")) throw error;
      expect(error.payload.file).toBe(archive);
    }
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test("download errors name the URL and status while bad bytes fail checksum", async () => {
  const binary = await installNatsServer();
  const shared = dirname(dirname(binary));
  const archive = `${basename(dirname(binary))}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
  const checksums = await readFile(join(shared, "SHA256SUMS"));
  const cache = await mkdtemp(join(homedir(), ".cache", "nats-download-"));
  let status = 404;
  let failedFile = "SHA256SUMS";
  const server = createHttpServer((request, response) => {
    response.writeHead(request.url === `/${failedFile}` ? status : 200);
    response.end(request.url === "/SHA256SUMS" ? checksums : "wrong archive bytes");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP port is missing");
    const downloadBase = `http://127.0.0.1:${address.port}`;
    for (failedFile of ["SHA256SUMS", archive]) {
      for (status of [404, 429]) {
        await installNatsServer(cache, { downloadBase }).then(
          () => expect.unreachable(),
          (error: unknown) => {
            if (!isError(error, "DownloadFailed")) throw error;
            expect(error.payload).toEqual({ url: `${downloadBase}/${failedFile}`, status });
          },
        );
      }
    }
    status = 200;
    await installNatsServer(cache, { downloadBase }).then(
      () => expect.unreachable(),
      (error: unknown) => {
        if (!isError(error, "ChecksumMismatch")) throw error;
        expect(error.payload.file).toBe(archive);
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(cache, { recursive: true, force: true });
  }
});

test("a started server closes its connections and frees both ports and its store", async () => {
  const server = await startNatsServer();
  const peer = await connect({ servers: server.url, reconnect: false });
  try {
    expect(existsSync(server.storeDir)).toBe(true);
    expect(await (await fetch(`${server.monitorUrl}/varz`)).json()).toMatchObject({
      host: "127.0.0.1",
      port: Number(new URL(server.url).port),
    });
    await server.close();
    expect(peer.isClosed()).toBe(true);
    expect(existsSync(server.storeDir)).toBe(false);
    await bindPort(server.url);
    await bindPort(server.monitorUrl);
    await server.close();
  } finally {
    await peer.close();
    await server.close();
  }
});

test("a server that rejects its config removes its store before reporting failure", async () => {
  expect.assertions(1);
  try {
    await startNatsServer("authorization { invalid: [ }");
  } catch (error) {
    if (isError(error, "ChecksumMismatch")) throw error;
    if (!isError(error, "ServerStopped")) throw error;
    await expect(stat(error.payload.storeDir)).rejects.toMatchObject({ code: "ENOENT" });
  }
});
