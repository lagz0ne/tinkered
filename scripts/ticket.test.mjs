import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A stub `vp` logs each call. It resolves names as the real vp does, for the fixture's
// packages (core, react, start):
//   name#task with an unknown name runs nothing and exits 0;
//   -F with an unknown name exits 1 only with --fail-if-no-match.
// With FAIL_MUTATE set, every mutate call exits 1.
// ticket.sh puts <repo>/node_modules/.bin first on PATH, so the stub wins.
const fakeVp = `#!/usr/bin/env bash
echo "$*" >> "$VP_LOG"
known=" core react start "
strict=0
prev=""
for arg in "$@"; do
  [ "$arg" = --fail-if-no-match ] && strict=1
done
for arg in "$@"; do
  case "$prev" in
    -F)
      case "$known" in
        *" $arg "*) ;;
        *)
          echo "error: No packages matched the filter: $arg" >&2
          [ "$strict" = 1 ] && exit 1
          exit 0 ;;
      esac ;;
  esac
  case "$arg" in
    *#*)
      name="\${arg%%#*}"
      case "$known" in *" $name "*) ;; *) exit 0 ;; esac ;;
  esac
  prev="$arg"
done
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
      ["run --fail-if-no-match -F core mutate"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test("ticket.sh exits non-zero for a name that no package has", () => {
  // A typo, and a folder name: the package is @tinker-start-scaffold, not start-scaffold.
  for (const name of ["nope", "start-scaffold"]) {
    const dir = fixture();
    try {
      const run = runTicket(dir, ["--check-only", name, "61", "unknown package"], {});
      assert.notEqual(run.status, 0, `${name}: ${run.stdout}${run.stderr}`);
      assert.match(run.stderr, /No packages matched the filter/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

await test("ticket.sh rejects a ticket NN that is not a number, before any gate runs", () => {
  for (const nn of ["abc", "6x", ""]) {
    const dir = fixture();
    try {
      const run = runTicket(dir, ["--check-only", "core", nn, "not a number"], {});
      assert.notEqual(run.status, 0, `NN "${nn}": ${run.stdout}${run.stderr}`);
      assert.equal(existsSync(join(dir, "vp.log")), false, `NN "${nn}" ran a gate`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

await test("ticket.sh accepts ticket NN 0", () => {
  const dir = fixture();
  try {
    const run = runTicket(dir, ["--check-only", "--no-mutation", "core", "0", "zero"], {});
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
