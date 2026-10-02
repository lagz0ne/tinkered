import { spawn } from "node:child_process";
import { operation } from "@tinker/core";
import type { Operation } from "@tinker/core";
import { z } from "zod";
import { cwd } from "./read.ts";

export const bashDescription =
  "Run a bash command in cwd; answers its combined output and exit code";

export const bashInput = {
  command: z.string().min(1),
  timeout: z.number().int().positive().optional(),
};

export type BashInput = {
  readonly command: string;
  readonly timeout?: number;
};

const bashSchema = z.object(bashInput);

/** The default wait before a command is killed, in milliseconds. */
const defaultTimeout = 30_000;

/** The most output kept, in characters; the head is dropped, the tail stays. */
const outputCap = 20_000;

/** The shipped `bash` tool: `{ command, timeout? }` → `bash -c command` in cwd, stdout and
 * stderr merged in arrival order, then `[exit <code>]` when non-zero, `[timed out after <ms> ms]`
 * when the timeout killed it. A forced close kills it through the signal. */
export const bash: Operation.Handle<Promise<string>, BashInput> = operation({
  label: "bash",
  input: (raw: unknown): BashInput => bashSchema.parse(raw),
  depends: { cwd: cwd.required },
  run: (deps, ctx) => runCommand(deps.cwd, ctx.input, ctx.signal),
});

type Ended = { readonly code: number | null; readonly timedOut: boolean };

function runCommand(base: string, input: BashInput, signal: AbortSignal): Promise<string> {
  const timeout = input.timeout ?? defaultTimeout;
  const child = spawn("bash", ["-c", input.command], {
    cwd: base,
    stdio: ["ignore", "pipe", "pipe"],
    signal,
  });
  const chunks: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  return new Promise<string>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(readOutcome(chunks.join(""), { code, timedOut }, timeout));
    });
  });
}

function readOutcome(output: string, ended: Ended, timeout: number): string {
  const kept = output.length > outputCap ? `…${output.slice(-outputCap)}` : output;
  if (ended.timedOut) return `${kept}\n[timed out after ${timeout} ms]`;
  if (ended.code !== 0) return `${kept}\n[exit ${ended.code ?? "signal"}]`;
  return kept;
}
