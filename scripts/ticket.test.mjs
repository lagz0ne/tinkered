import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A stub `vp` logs each call. With FAIL_MUTATE set, every mutate call exits 1.
// ticket.sh puts <repo>/node_modules/.bin first on PATH, so the stub wins.
const fakeVp = `#!/usr/bin/env bash
echo "$*" >> "$VP_LOG"
for arg in "$@"; do
  case "$arg" in
    mutate | *#mutate) [ -n "$FAIL_MUTATE" ] && exit 1 ;;
  esac
done
exit 0
`;

const identity = {
  GIT_AUTHOR_NAME: "ticket-test",
  GIT_AUTHOR_EMAIL: "ticket-test@example.invalid",
  GIT_COMMITTER_NAME: "ticket-test",
  GIT_COMMITTER_EMAIL: "ticket-test@example.invalid",
};

// A temp git repo with a copy of this ticket.sh and the stub vp. Kept outside the repo.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ticket-test-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, "scripts"));
  copyFileSync(join(import.meta.dirname, "ticket.sh"), join(dir, "scripts", "ticket.sh"));
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  const vp = join(dir, "node_modules", ".bin", "vp");
  writeFileSync(vp, fakeVp);
  chmodSync(vp, 0o755);
  return dir;
}

function runTicket(dir, args, env) {
  return spawnSync("bash", [join(dir, "scripts", "ticket.sh"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...identity, VP_LOG: join(dir, "vp.log"), ...env },
  });
}

await test("ticket.sh exits non-zero and makes no checkpoint when the package's mutation fails", () => {
  const dir = fixture();
  try {
    const run = runTicket(dir, ["core", "61", "mutation fails"], { FAIL_MUTATE: "1" });
    assert.notEqual(run.status, 0, run.stdout + run.stderr);
    assert.equal(spawnSync("git", ["tag"], { cwd: dir, encoding: "utf8" }).stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("ticket.sh runs only the named package's mutation lane", () => {
  const dir = fixture();
  try {
    const run = runTicket(dir, ["--check-only", "core", "61", "mutation passes"], {});
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const calls = readFileSync(join(dir, "vp.log"), "utf8").trim().split("\n");
    assert.deepEqual(
      calls.filter((call) => call.includes("mutate")),
      ["run core#mutate"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
