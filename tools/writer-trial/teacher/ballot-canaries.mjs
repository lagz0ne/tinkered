// Reproducible canary proofs for the team poll checker.
// Builds every proof tar from the teacher-only fixture, runs the isolated
// runner in Docker, and prints one line per proof. No worker code involved.
// Usage: node tools/writer-trial/teacher/ballot-canaries.mjs
// Proof tars land in an owned /tmp/ballot-canaries-<unique> dir and are
// rebuilt on every run; only the printed case lines and exit codes are
// the evidence.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
// tinker-writer-trial:20260925, built 2026-09-25 from the current core and
// react builds (context: ~/.local/share/tinker-writer-trial/image-20260925).
// Earlier pins: sha256:91630289… (20260922 rebuilt 2026-09-24) and
// sha256:2232d27e… (20260922, no longer on this host).
// WRITER_TRIAL_IMAGE reruns these proofs on a rebuilt image (the pinned one can be lost
// when the host is rebuilt); the pinned ID stays the default and the recorded evidence.
const IMAGE =
  process.env.WRITER_TRIAL_IMAGE ??
  "sha256:ac6b1e42b3f428180c6f5109a76b238a2da5a1f4874d3750b8c1088ba36e9881";
const TOOLCHAIN = "/home/pwuser/toolchain/node_modules";
const work = join(tmpdir(), `ballot-canaries-${randomUUID()}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const pack = (dir, tar) => {
  execFileSync("tar", ["-cf", tar, "."], { cwd: dir });
  return tar;
};

// The submission layout the grading container gets at /work: src/,
// index.html, and the toolchain symlink.
const fixture = join(here, "ballot-fixture");
const base = join(work, "good");
mkdirSync(base, { recursive: true });
cpSync(join(fixture, "src"), join(base, "src"), { recursive: true });
cpSync(join(fixture, "index.html"), join(base, "index.html"));
execFileSync("ln", ["-s", TOOLCHAIN, join(base, "node_modules")]);
const goodTar = pack(base, join(work, "good.tar"));

// One edit to one fixture file. Each anchor must match exactly once, so a
// moved fixture line fails loudly instead of proving nothing.
const edit = (text, [from, to], label) => {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: anchor found ${count} times; update the script`);
  return text.replace(from, to);
};
const patch = (name, file, swaps) => {
  const dir = join(work, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
  const path = join(dir, "src", file);
  let text = readFileSync(path, "utf8");
  for (const swap of swaps) text = edit(text, swap, name);
  writeFileSync(path, text);
  return pack(dir, join(work, `${name}.tar`));
};

const run = (tar) => {
  const script = join(repo, "tools/writer-trial/ballot-acceptance.mjs");
  let out = "";
  let exit = 0;
  try {
    out = execFileSync("node", [script, tar, IMAGE], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 330000,
    });
  } catch (error) {
    out = `${error.stdout ?? ""}`;
    exit = error.status ?? 1;
  }
  const lines = out.split("\n");
  return {
    exit,
    line: lines.find((l) => l.startsWith("ACCEPTANCE")),
    json: lines.find((l) => l.startsWith("RESULTS_JSON")) ?? "",
    fails: lines.filter((l) => l.startsWith("FAIL")),
  };
};

// Strict proof: exit code alone cannot pass. A canary passes only with
// structured RESULTS_JSON, no load failure unless allowed, and the exact
// intended failures named below.
const casesOf = (r) => {
  const raw = r.json.replace(/^RESULTS_JSON\s*/, "");
  if (raw === "") throw new Error("missing RESULTS_JSON");
  return JSON.parse(raw).cases;
};
const failedNames = (r) =>
  casesOf(r)
    .filter((c) => !c.pass)
    .map((c) => c.name);
const loadFailed = (r) =>
  casesOf(r)
    .filter((c) => !c.pass && (c.error ?? "").includes("load failed"))
    .map((c) => c.name);
const checkNames = (r, want) => {
  if (want.allowLoadFail !== true && loadFailed(r).length > 0)
    return `load failure, not a behavioral proof: ${loadFailed(r).join(", ")}`;
  const failed = new Set(failedNames(r));
  const missing = (want.mustFail ?? []).filter((n) => !failed.has(n));
  if (missing.length > 0) return `want failure ${missing.join(", ")}`;
  const wrong = (want.mustPass ?? []).filter((n) => failed.has(n));
  if (wrong.length > 0) return `want pass ${wrong.join(", ")}, but it failed`;
  return null;
};
const checkResult = (r, want) => {
  if (r.exit !== want.exit) return `want exit ${want.exit}, got ${r.exit}`;
  if (want.fullpass !== undefined && r.line !== want.fullpass)
    return `want ${want.fullpass}, got ${r.line ?? "(no summary)"}`;
  return checkNames(r, want);
};

// ---- good layout variant: same roles and names, different DOM ----
// Sections and divs wrap the parts, the Votes table comes first, the Polls
// columns are reordered with the question as a row header, and the
// Question input is tied to its label by useId.
const layoutTar = patch("good-layout", "PollApp.tsx", [
  [
    'import type { FormEvent, ReactElement } from "react";',
    'import { useId } from "react";\nimport type { FormEvent, ReactElement } from "react";',
  ],
  [
    "  const submit = useRun(submitPoll);\n  return (",
    "  const submit = useRun(submitPoll);\n  const questionId = useId();\n  return (",
  ],
  [
    [
      "      <label>",
      "        Question",
      "        <input",
      "          value={draft.question}",
      "          onChange={(event) => question.run({ input: { value: event.target.value } })}",
      "        />",
      "      </label>",
    ].join("\n"),
    [
      "      <div>",
      "        <label htmlFor={questionId}>Question</label>",
      "      </div>",
      "      <input",
      "        id={questionId}",
      "        value={draft.question}",
      "        onChange={(event) => question.run({ input: { value: event.target.value } })}",
      "      />",
    ].join("\n"),
  ],
  [
    [
      "      <td>{row.question}</td>",
      "      <td>{row.votes}</td>",
      "      <td>{row.leader}</td>",
      "      <td>{row.status}</td>",
      "      <td>",
    ].join("\n"),
    [
      "      <td>",
      "        <span>{row.status}</span>",
      "      </td>",
      "      <td>{row.leader}</td>",
      '      <th scope="row">{row.question}</th>',
      "      <td>{row.votes}</td>",
      "      <td>",
    ].join("\n"),
  ],
  [
    [
      "            <th>Question</th>",
      "            <th>Votes</th>",
      "            <th>Leader</th>",
      "            <th>Status</th>",
      "            <th>Actions</th>",
    ].join("\n"),
    [
      '            <th scope="col">Status</th>',
      '            <th scope="col">Leader</th>',
      '            <th scope="col">Question</th>',
      '            <th scope="col">Votes</th>',
      '            <th scope="col">Actions</th>',
    ].join("\n"),
  ],
  [
    [
      "      <main>",
      "        <PollForm />",
      "        <Notice />",
      "        <PollTable />",
      "        <VoteForm />",
      "        <VoteTable />",
      "      </main>",
    ].join("\n"),
    [
      "      <div>",
      '        <section aria-label="Votes area">',
      "          <VoteTable />",
      "          <VoteForm />",
      "        </section>",
      '        <section aria-label="Polls area">',
      "          <div>",
      "            <PollTable />",
      "          </div>",
      "          <PollForm />",
      "        </section>",
      "        <footer>",
      "          <Notice />",
      "        </footer>",
      "      </div>",
    ].join("\n"),
  ],
]);

// ---- good in-cell variant: no Actions column; Close sits inside the
// Status cell and Withdraw inside the Choice cell. The task names the
// buttons, not where they go.
const inCellTar = patch("good-in-cell", "PollApp.tsx", [
  [
    [
      "      <td>{row.status}</td>",
      "      <td>",
      '        {row.status === "Closed" ? null : (',
    ].join("\n"),
    ["      <td>", "        {row.status}", '        {row.status === "Closed" ? null : ('].join(
      "\n",
    ),
  ],
  ["            <th>Status</th>\n            <th>Actions</th>", "            <th>Status</th>"],
  [
    "      <td>{row.choice}</td>\n      <td>\n        <button",
    "      <td>\n        {row.choice}\n        <button",
  ],
  ["          <th>Choice</th>\n          <th>Actions</th>", "          <th>Choice</th>"],
]);

// ---- bad variants: each must fail its named case ----
// (a) Blank limit text becomes 10 instead of BadLimit.
const blankLimitTar = patch("bad-blank-limit", "model.ts", [
  [
    "function readLimit(raw: unknown): number {\n",
    'function readLimit(raw: unknown): number {\n  if (typeof raw === "string" && raw.trim() === "") return 10;\n',
  ],
]);

// The same-vote check and the closed-poll guard in castVote, in the
// fixture's order.
const SAME_VOTE = "      if (held !== undefined && held.choice === choice) return held;\n";
const CLOSED_GUARD = '      if (poll.closed) throw fail("PollClosed", { id: poll.id });\n';

// (b) The closed-poll guard runs before the same-vote check, so a repeat
// of the held vote on a closed poll reports PollClosed.
const repeatClosedTar = patch("bad-repeat-vote-closed", "model.ts", [
  [SAME_VOTE + CLOSED_GUARD, CLOSED_GUARD + SAME_VOTE],
]);

// The already-closed check and the no-votes guard in closePoll.
const ALREADY_CLOSED = "    if (poll.closed) return poll;\n";
const NO_VOTES_GUARD =
  '    if (voteCount(cells.votes.get(), poll.id) === 0) throw fail("NoVotes", { id: poll.id });\n';

// (c1) The no-votes guard runs first, so closing a closed poll with no
// votes reports NoVotes.
const closeNoVotesTar = patch("bad-close-repeat-no-votes", "model.ts", [
  [ALREADY_CLOSED + NO_VOTES_GUARD, NO_VOTES_GUARD + ALREADY_CLOSED],
]);

// (c2) No already-closed check: closing a closed poll writes it again and
// adds an undo step.
const closeChangesTar = patch("bad-close-repeat-changes", "model.ts", [
  [ALREADY_CLOSED + NO_VOTES_GUARD, NO_VOTES_GUARD],
]);

// (d) The Open filter shows only Open polls and hides Full ones.
const openHidesFullTar = patch("bad-open-hides-full", "screen.ts", [
  [
    '  return filter === "Closed" ? status === "Closed" : status !== "Closed";\n',
    "  return status === filter;\n",
  ],
]);

// (e) Choosing another poll keeps the old choice.
const keepChoiceTar = patch("bad-poll-keeps-choice", "screen.ts", [
  [
    '      vote.pollId === input.pollId ? vote : { ...vote, pollId: input.pollId, choice: "" },\n',
    "      ({ ...vote, pollId: input.pollId }),\n",
  ],
]);

const UNDO_ANCHOR =
  "  depends: { shown: notice.controller, undo: undoPoll.controller },\n  run: ({ shown, undo }) => {\n";

// (f1) Undo also puts the filter back to All.
const undoFilterTar = patch("bad-undo-resets-filter", "screen.ts", [
  [
    UNDO_ANCHOR,
    '  depends: { shown: notice.controller, undo: undoPoll.controller, filter: pollFilter.controller },\n  run: ({ shown, undo, filter }) => {\n    filter.set("All");\n',
  ],
]);

// (f2) Undo also clears the typed new-poll text.
const undoTextTar = patch("bad-undo-clears-text", "screen.ts", [
  [
    UNDO_ANCHOR,
    "  depends: { shown: notice.controller, undo: undoPoll.controller, draft: pollDraft.controller },\n  run: ({ shown, undo, draft }) => {\n    draft.set(emptyPoll);\n",
  ],
]);

// (g1) An empty starter: nothing at all under /work.
const emptyDir = join(work, "empty");
mkdirSync(emptyDir, { recursive: true });
const emptyTar = pack(emptyDir, join(work, "empty.tar"));

// (g2) A blank Vite starter: it boots and exports nothing.
const starterDir = join(work, "starter");
mkdirSync(join(starterDir, "src"), { recursive: true });
cpSync(join(fixture, "index.html"), join(starterDir, "index.html"));
writeFileSync(join(starterDir, "src", "index.ts"), "export {};\n");
writeFileSync(
  join(starterDir, "src", "main.tsx"),
  'const root = document.getElementById("root");\nif (root !== null) root.textContent = "Hello";\n',
);
execFileSync("ln", ["-s", TOOLCHAIN, join(starterDir, "node_modules")]);
const starterTar = pack(starterDir, join(work, "starter.tar"));

const UNDO_CASE = "browser undo restores records and keeps form text, selections, and filter";
const FULL = "ACCEPTANCE ballot: 57/57 pass";
const cases = [
  { label: "good fixture accepts", tar: goodTar, want: { exit: 0, fullpass: FULL } },
  { label: "good layout variant accepts", tar: layoutTar, want: { exit: 0, fullpass: FULL } },
  { label: "good in-cell buttons accept", tar: inCellTar, want: { exit: 0, fullpass: FULL } },
  {
    label: "(a) blank limit becomes 10 rejects",
    tar: blankLimitTar,
    want: {
      exit: 1,
      mustFail: ["core bad limit text reports BadLimit with the original value"],
      mustPass: ["core create trims the question, parses choices and limit, and appends in order"],
    },
  },
  {
    label: "(b) repeat vote on a closed poll reports PollClosed rejects",
    tar: repeatClosedTar,
    want: {
      exit: 1,
      mustFail: ["core repeat vote passes even when the poll is closed"],
      mustPass: [
        "core repeat vote returns the existing vote with no undo step",
        "core repeat vote passes even when the poll is full",
      ],
    },
  },
  {
    label: "(c1) closing a closed poll with no votes reports NoVotes rejects",
    tar: closeNoVotesTar,
    want: {
      exit: 1,
      mustFail: ["core close repeat passes even with no votes"],
      mustPass: [
        "core close repeat passes with no undo step",
        "core close with no votes reports NoVotes",
      ],
    },
  },
  {
    label: "(c2) closing a closed poll changes it rejects",
    tar: closeChangesTar,
    want: {
      exit: 1,
      mustFail: ["core close repeat passes with no undo step"],
      mustPass: ["core close marks the poll closed and keeps it listed"],
    },
  },
  {
    label: "(d) Open filter hides Full polls rejects",
    tar: openHidesFullTar,
    want: {
      exit: 1,
      mustFail: ["browser filters show Open (with Full) and Closed rows live"],
      mustPass: ["browser typing clears an earlier alert"],
    },
  },
  {
    label: "(e) choosing another poll keeps the old choice rejects",
    tar: keepChoiceTar,
    want: {
      exit: 1,
      mustFail: ["browser choosing a different poll resets Choice"],
      mustPass: ["browser Poll lists every poll and Choice lists the chosen poll's choices"],
    },
  },
  {
    label: "(f1) undo resets the filter rejects",
    tar: undoFilterTar,
    want: { exit: 1, mustFail: [UNDO_CASE] },
  },
  {
    label: "(f2) undo clears the form text rejects",
    tar: undoTextTar,
    want: { exit: 1, mustFail: [UNDO_CASE] },
  },
  {
    label: "(g1) empty starter rejects",
    tar: emptyTar,
    want: { exit: 1, allowLoadFail: true, mustFail: ["shape: src present"] },
  },
  {
    label: "(g2) blank app starter rejects",
    tar: starterTar,
    want: {
      exit: 1,
      allowLoadFail: true,
      mustFail: ["core entry exports exactly the named API"],
    },
  },
];

// `--only <label prefix>` runs a subset while tuning; a full run is the proof.
const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : "";
let failed = 0;
for (const { label, tar, want } of cases.filter((c) => c.label.startsWith(only))) {
  const r = run(tar);
  const problem = checkResult(r, want);
  if (problem !== null) failed++;
  const caughtBy = want.mustFail ? ` — caught by: ${want.mustFail.join("; ")}` : "";
  console.log(
    `${problem === null ? "CANARY-PASS" : "CANARY-FAIL"} ${label} — exit ${r.exit} — ${r.line ?? "(no summary)"}${problem === null ? caughtBy : ` — ${problem}`}`,
  );
  for (const f of r.fails.slice(0, 4)) console.log(`    ${f}`);
  if (r.fails.length > 4) console.log(`    ... ${r.fails.length - 4} more FAIL lines`);
}
process.exitCode = failed ? 1 : 0;
