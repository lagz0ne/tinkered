import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";

const release = "https://github.com/nats-io/nats-server/releases/download/v2.15.0";
const cache = join(homedir(), ".cache", "tinkered", "nats-server", "2.15.0");
const architectures: Record<string, string> = { x64: "amd64", ia32: "386", arm: "arm7" };
const host = `${process.platform === "win32" ? "windows" : process.platform}-${architectures[process.arch] ?? process.arch}`;
const stem = `nats-server-v2.15.0-${host}`;
const windows = process.platform === "win32";
const archive = `${stem}.${windows ? "zip" : "tar.gz"}`;
const binary = windows ? "nats-server.exe" : "nats-server";
const execute = promisify(execFile);

export declare namespace NatsServer {
  type Handle = {
    url: string;
    /** Loopback-only NATS monitor for test assertions about open connections. */
    monitorUrl: string;
    /** The temporary store belongs to this server and is removed by close. */
    storeDir: string;
    /** The caller owns the server. Close waits for exit and removes its temp store. */
    close(): Promise<void>;
  };
}

/** Fetch the official release once into the user's home cache.
 * Verify the saved archive against the release's SHA256SUMS on every call.
 * A custom cache directory lets tests check damaged downloads without changing the shared cache.
 * The archive and SHA256SUMS are kept beside the extracted release folder. */
export async function installNatsServer(directory = cache): Promise<string> {
  await mkdir(directory, { recursive: true });
  const cached = existsSync(join(directory, archive));
  const read = cached ? (name: string) => readFile(join(directory, name)) : fetchFile;
  const checksums = await read("SHA256SUMS");
  const bytes = await read(archive);
  checkArchive(bytes, checksums.toString());
  if (!cached) {
    const staging = await mkdtemp(join(directory, sep));
    try {
      await writeFile(join(staging, archive), bytes);
      await writeFile(join(staging, "SHA256SUMS"), checksums);
      await rename(join(staging, "SHA256SUMS"), join(directory, "SHA256SUMS"));
      await rename(join(staging, archive), join(directory, archive));
    } finally {
      await rm(staging, { recursive: true });
    }
  }
  const executable = join(directory, stem, binary);
  if (!existsSync(executable)) {
    const staging = await mkdtemp(join(directory, sep));
    try {
      await execute("tar", ["-xf", join(directory, archive), "-C", staging]);
      await mkdir(join(directory, stem), { recursive: true });
      await rename(join(staging, stem, binary), executable);
    } finally {
      await rm(staging, { recursive: true });
    }
  }
  return executable;
}

async function fetchFile(name: string): Promise<Buffer> {
  const response = await fetch(`${release}/${name}`);
  return Buffer.from(await response.arrayBuffer());
}

function checkArchive(bytes: Buffer, checksums: string): void {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const match = checksums.split(/\r?\n/).includes(`${digest}  ${archive}`);
  if (!match) raise("ChecksumMismatch", { file: archive });
}

/** Start a real server on free loopback ports with its own temp store.
 * Tests may supply NATS config, such as a user's subject permissions. */
export async function startNatsServer(config = ""): Promise<NatsServer.Handle> {
  const executable = await installNatsServer();
  const store = await mkdtemp(join(tmpdir(), "tinker-nats-"));
  const configFile = join(store, "server.conf");
  await writeFile(configFile, config);
  const child = spawn(executable, [
    "-a",
    "127.0.0.1",
    "-p",
    "-1",
    "-m",
    "-1",
    "-sd",
    store,
    "-c",
    configFile,
  ]);
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  let output = "";
  const ready = new Promise<{ url: string; monitorUrl: string }>((resolve) => {
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
      const port = /Listening for client connections on 127\.0\.0\.1:(\d+)/.exec(output)?.at(1);
      const monitor = /Starting http monitor on 127\.0\.0\.1:(\d+)/.exec(output)?.at(1);
      if (port && monitor) {
        resolve({ url: `nats://127.0.0.1:${port}`, monitorUrl: `http://127.0.0.1:${monitor}` });
      }
    });
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => (closing ??= stop());
  async function stop(): Promise<void> {
    child.kill();
    await exited.finally(() => rm(store, { recursive: true }));
  }
  try {
    const addresses = await Promise.race([
      ready,
      exited.then(() => raise("ServerStopped", { output, storeDir: store })),
    ]);
    return { ...addresses, storeDir: store, close };
  } catch (error) {
    await close();
    throw error;
  }
}
