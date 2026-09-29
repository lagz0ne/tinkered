import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
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
  if (!existsSync(join(directory, archive))) {
    const staging = await mkdtemp(join(directory, "download-"));
    try {
      const checksums = await fetchFile("SHA256SUMS");
      const bytes = await fetchFile(archive);
      checkArchive(bytes, checksums.toString());
      await writeFile(join(staging, archive), bytes);
      await writeFile(join(staging, "SHA256SUMS"), checksums);
      await rename(join(staging, "SHA256SUMS"), join(directory, "SHA256SUMS"));
      await rename(join(staging, archive), join(directory, archive));
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  checkArchive(
    await readFile(join(directory, archive)),
    await readFile(join(directory, "SHA256SUMS"), "utf8"),
  );
  const executable = join(directory, stem, binary);
  if (!existsSync(executable)) {
    const staging = await mkdtemp(join(directory, "extract-"));
    try {
      await execute("tar", ["-xf", join(directory, archive), "-C", staging, `${stem}/${binary}`]);
      await mkdir(join(directory, stem), { recursive: true });
      await rename(join(staging, stem, binary), executable);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return executable;
}

async function fetchFile(name: string): Promise<Buffer> {
  const url = `${release}/${name}`;
  const response = await fetch(url);
  if (!response.ok) raise("DownloadFailed", { url, status: response.status });
  return Buffer.from(await response.arrayBuffer());
}

function checkArchive(bytes: Buffer, checksums: string): void {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const match = checksums.split(/\r?\n/).some((line) => line.trim() === `${digest}  ${archive}`);
  if (!match) raise("ChecksumMismatch", { file: archive });
}

/** Start a real server on a free loopback port. Each call owns a separate temp store. */
export async function startNatsServer(): Promise<NatsServer.Handle> {
  const executable = await installNatsServer();
  const store = await mkdtemp(join(tmpdir(), "tinker-nats-"));
  const child = spawn(executable, ["-a", "127.0.0.1", "-p", "-1", "-m", "-1", "-sd", store], {
    stdio: ["ignore", "ignore", "pipe"],
  });
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
      if (port && monitor && output.includes("Server is ready")) {
        resolve({ url: `nats://127.0.0.1:${port}`, monitorUrl: `http://127.0.0.1:${monitor}` });
      }
    });
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => (closing ??= stop());
  async function stop(): Promise<void> {
    child.kill("SIGTERM");
    try {
      await exited;
    } finally {
      await rm(store, { recursive: true, force: true });
    }
  }
  try {
    const addresses = await Promise.race([
      ready,
      exited.then(() => raise("ServerStopped", { output })),
    ]);
    return { ...addresses, close };
  } catch (error) {
    await close();
    throw error;
  }
}
