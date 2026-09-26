import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { backend, HttpResponse, type HttpClient, type HttpRequest } from "@tinker/http";
import {
  bash,
  cwd,
  edit,
  isError,
  shippedTools,
  tinkerer,
  write,
  type Tinkerer,
} from "../src/index.ts";

const answer = readFileSync(new URL("./fixtures/answer.sse", import.meta.url));

/** A fresh temp dir holding `notes.txt` with three lines. */
function notesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tinkerer-files-"));
  writeFileSync(join(dir, "notes.txt"), "alpha\nbeta\ngamma\n");
  return dir;
}

/** A backend that answers `bodies[n]` to the n-th request, then repeats the last. */
function scripted(seen: HttpRequest.Record[], bodies: (string | Uint8Array)[]): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, {
      status: 200,
      body: bodies[Math.min(seen.length - 1, bodies.length - 1)] ?? answer,
    });
  };
}

/** One streamed reply asking for `calls`, each `{ name, args }`, then `[DONE]`. */
function askingFor(calls: readonly { name: string; args: string }[]): string {
  const pieces = calls.map((call, index) =>
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index,
                id: `call_${index}`,
                type: "function",
                function: { name: call.name, arguments: call.args },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
  );
  const end = JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
  return [...pieces, end].map((data) => `data: ${data}\n\n`).join("") + "data: [DONE]\n\n";
}

/** The tool messages of a transcript, in order. */
function toolMessages(transcript: readonly Tinkerer.Message[]): string[] {
  return transcript.flatMap((message) => (message.role === "tool" ? [message.content] : []));
}

test("write creates the file under cwd with its parents and reports the byte count", async () => {
  const dir = notesDir();
  const scope = createScope({ tags: [cwd(dir)] });
  const said = await scope.run(write, { rawInput: { path: "deep/er/new.txt", content: "héllo" } });
  expect(said).toBe("Wrote 6 bytes to deep/er/new.txt");
  expect(readFileSync(join(dir, "deep/er/new.txt"), "utf8")).toBe("héllo");
  await scope.close();
});

test("edit replaces the one exact match and refuses zero or many matches with EditMiss", async () => {
  const dir = notesDir();
  const scope = createScope({ tags: [cwd(dir)] });
  const said = await scope.run(edit, {
    rawInput: { path: "notes.txt", oldText: "beta", newText: "BETA" },
  });
  expect(said).toBe("Edited notes.txt");
  expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("alpha\nBETA\ngamma\n");
  writeFileSync(join(dir, "notes.txt"), "a\na\n");
  for (const [oldText, count] of [
    ["zeta", 0],
    ["a", 2],
  ] as const) {
    try {
      await scope.run(edit, { rawInput: { path: "notes.txt", oldText, newText: "x" } });
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "EditMiss")) throw error;
      expect(error.payload).toEqual({ label: "edit", path: "notes.txt", count });
    }
  }
  expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("a\na\n");
  await scope.close();
});

test("write and edit refuse a path outside cwd before touching the disk", async () => {
  const dir = notesDir();
  const inner = join(dir, "inner");
  mkdirSync(inner);
  const scope = createScope({ tags: [cwd(inner)] });
  const attempts: readonly (() => Promise<string>)[] = [
    () => scope.run(write, { rawInput: { path: "../escape.txt", content: "x" } }),
    () => scope.run(edit, { rawInput: { path: "../notes.txt", oldText: "a", newText: "b" } }),
  ];
  for (const attempt of attempts) {
    try {
      await attempt();
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "PathOutsideCwd")) throw error;
      expect(error.payload.path.startsWith("../")).toBe(true);
    }
  }
  expect(existsSync(join(dir, "escape.txt"))).toBe(false);
  expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("alpha\nbeta\ngamma\n");
  await scope.close();
});

test("read-only blocks write and edit in the same reply", async () => {
  const dir = notesDir();
  const coder = tinkerer({ label: "coder", tools: shippedTools });
  const seen: HttpRequest.Record[] = [];
  const reply = askingFor([
    { name: "write", args: JSON.stringify({ path: "out.txt", content: "made" }) },
    {
      name: "edit",
      args: JSON.stringify({ path: "notes.txt", oldText: "alpha", newText: "ALPHA" }),
    },
  ]);
  const scope = createScope({
    tags: [
      backend(scripted(seen, [reply, answer])),
      coder.config({ model: "m", baseUrl: "https://api" }),
      cwd(dir),
    ],
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "go" });
  expect(toolMessages(session.resolve(coder.messages))).toEqual([
    "Tool write is blocked: mode is read-only, it needs workspace-write",
    "Tool edit is blocked: mode is read-only, it needs workspace-write",
  ]);
  expect(existsSync(join(dir, "out.txt"))).toBe(false);
  await scope.close();
});

test("write and edit refuse a path that resolves to the parent folder itself", async () => {
  const dir = notesDir();
  const inner = join(dir, "inner");
  mkdirSync(inner);
  const scope = createScope({ tags: [cwd(inner)] });
  const attempts: readonly [string, () => Promise<string>][] = [
    ["write", () => scope.run(write, { rawInput: { path: "..", content: "x" } })],
    ["edit", () => scope.run(edit, { rawInput: { path: "..", oldText: "a", newText: "b" } })],
  ];
  for (const [label, attempt] of attempts) {
    try {
      await attempt();
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "PathOutsideCwd")) throw error;
      expect(error.payload).toEqual({ label, path: ".." });
    }
  }
  expect(existsSync(join(dir, "x"))).toBe(false);
  await scope.close();
});

test("bash runs the command in cwd and answers its merged output with a non-zero exit code", async () => {
  const dir = notesDir();
  const scope = createScope({ tags: [cwd(dir)] });
  const ok = await scope.run(bash, { rawInput: { command: "cat notes.txt | head -1 && pwd" } });
  expect(ok).toBe(`alpha\n${dir}\n`);
  const failed = await scope.run(bash, {
    rawInput: { command: "echo out; echo err 1>&2; exit 3" },
  });
  expect(failed).toBe("out\nerr\n\n[exit 3]");
  await scope.close();
});

test("bash kills a command at its timeout and says so", async () => {
  const scope = createScope({ tags: [cwd(notesDir())] });
  const said = await scope.run(bash, {
    rawInput: { command: "echo start; sleep 5", timeout: 1000 },
  });
  expect(said).toBe("start\n\n[timed out after 1000 ms]");
  await scope.close();
});

test("bash keeps the tail of a large output and marks the cut", async () => {
  const scope = createScope({ tags: [cwd(notesDir())] });
  const said = await scope.run(bash, {
    rawInput: { command: "head -c 25000 /dev/zero | tr '\\0' 'y'" },
  });
  expect(said.startsWith("…")).toBe(true);
  expect(said.length).toBe(20001);
  expect(said.endsWith("y")).toBe(true);
  await scope.close();
});

test("bash keeps an output of exactly 20000 characters whole", async () => {
  const scope = createScope({ tags: [cwd(notesDir())] });
  const said = await scope.run(bash, {
    rawInput: { command: "head -c 20000 /dev/zero | tr '\\0' 'y'" },
  });
  expect(said.length).toBe(20000);
  expect(said.startsWith("…")).toBe(false);
  await scope.close();
});

test("bash gives the command no stdin so a reader returns at once", async () => {
  const scope = createScope({ tags: [cwd(notesDir())] });
  const said = await scope.run(bash, { rawInput: { command: "cat", timeout: 2000 } });
  expect(said).toBe("");
  await scope.close();
});

test("bash answers [exit signal] when the command dies by a signal", async () => {
  const scope = createScope({ tags: [cwd(notesDir())] });
  const said = await scope.run(bash, { rawInput: { command: "kill -9 $$" } });
  expect(said).toBe("\n[exit signal]");
  await scope.close();
});

test("a forced close during bash kills the command and rejects the run", async () => {
  const scope = createScope({ tags: [cwd(notesDir())] });
  const session = scope.createSession();
  const started = Date.now();
  const running = session.run(bash, { rawInput: { command: "sleep 5" } });
  const settled = running.then(
    () => "resolved",
    () => "rejected",
  );
  await session.close();
  expect(await settled).toBe("rejected");
  expect(Date.now() - started).toBeLessThan(2000);
  await scope.close();
});

test("workspace-write lets write run in a reply and blocks bash in the same reply", async () => {
  const dir = notesDir();
  const coder = tinkerer({ label: "coder", tools: shippedTools });
  const seen: HttpRequest.Record[] = [];
  const reply = askingFor([
    { name: "write", args: JSON.stringify({ path: "out.txt", content: "made" }) },
    { name: "bash", args: JSON.stringify({ command: "echo no" }) },
  ]);
  const scope = createScope({
    tags: [
      backend(scripted(seen, [reply, answer])),
      coder.config({ model: "m", baseUrl: "https://api" }),
      coder.mode("workspace-write"),
      cwd(dir),
    ],
  });
  const session = scope.createSession();
  await session.run(coder.turn, { input: "go" });
  expect(toolMessages(session.resolve(coder.messages))).toEqual([
    "Wrote 4 bytes to out.txt",
    "Tool bash is blocked: mode is workspace-write, it needs full-access",
  ]);
  expect(readFileSync(join(dir, "out.txt"), "utf8")).toBe("made");
  await scope.close();
});
