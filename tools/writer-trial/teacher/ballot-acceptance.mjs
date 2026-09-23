import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance for the team poll task. Runs only inside
// the disposable container: submitted code is imported here, never on the
// host. Every case comes from the frozen task text. Case-level results; any
// error or missing check fails its case, never passes. Later cases still run.
// Browser cases find things by role and accessible name only, and read table
// cells by their column header, so a different DOM layout still passes.
const root = process.argv[2];
assert.ok(root, "usage: ballot-acceptance.mjs <submission-dir>");

const results = [];
const advisory = [];
const test = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({
      name,
      pass: true,
      ...(detail === undefined ? {} : { detail: String(detail).slice(0, 160) }),
    });
  } catch (error) {
    results.push({ name, pass: false, error: (error?.message ?? String(error)).slice(0, 300) });
  }
};

for (const c of shapeCases(root).cases) results.push(c);
for (const a of shapeCases(root).advisory) advisory.push(a);
advisory.push({
  name: "ownership evidence is manual",
  detail:
    "React state shape and unknown-error rethrow are lead-review notes, never a pass; only exact-syntax shape cases fail.",
});

const finish = () => {
  for (const r of results) {
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.name}${r.pass && r.detail ? ` — ${r.detail}` : ""}${r.pass ? "" : ` — ${r.error}`}`,
    );
  }
  for (const a of advisory) console.log(`NOTE ${a.name} — ${a.detail}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`ACCEPTANCE ballot: ${results.length - failed.length}/${results.length} pass`);
  console.log(`RESULTS_JSON ${JSON.stringify({ cases: results, advisory })}`);
  process.exitCode = failed.length ? 1 : 0;
};

// ---- core checks: public entry, createScope, scope.run, scope.resolve ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-ballot-core",
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
let app;
let coreMod;
let loadError;
try {
  app = await vite.ssrLoadModule("/src/index.ts");
  coreMod = await vite.ssrLoadModule("@tinker/core");
} catch (error) {
  loadError = error?.message ?? String(error);
}

const API = [
  "PollApp",
  "castVote",
  "closePoll",
  "createPoll",
  "isError",
  "polls",
  "setLimit",
  "undoPoll",
  "votes",
  "withdrawVote",
];
const need = (value, label) => {
  assert.ok(value, `missing export: ${label}`);
  return value;
};
const pollList = (s) => s.resolve(need(app.polls, "polls"));
const voteList = (s) => s.resolve(need(app.votes, "votes"));
// Plain clones: a broken in-place write must not pass by comparing a
// record against its own mutated alias.
const plainPoll = (p) => ({ ...p, choices: [...p.choices] });
const snap = (s) => ({
  polls: pollList(s).map(plainPoll),
  votes: voteList(s).map((v) => ({ ...v })),
});
const MENU = "Pizza, Sushi, Tacos";
const create = (s, question, choices = MENU, limit = "3") =>
  s.run(app.createPoll, { input: { question, choices, limit } });
const cast = (s, pollId, voter, choice) =>
  s.run(app.castVote, { input: { pollId, voter, choice } });
const close = (s, pollId) => s.run(app.closePoll, { input: { pollId } });
const limitTo = (s, pollId, limit) => s.run(app.setLimit, { input: { pollId, limit } });
const withdraw = (s, voteId) => s.run(app.withdrawVote, { input: { voteId } });
const undo = (s) => s.run(app.undoPoll, {});
const caught = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("want a thrown managed error");
};
// One failing call: the kind, the exact payload, and polls and votes
// left exactly as they were.
const failsWith = (s, op, input, kind, payload) => {
  const before = snap(s);
  const error = caught(() => s.run(op, { input }));
  assert.equal(error?.kind, kind, `want ${kind} for ${JSON.stringify(input)}`);
  assert.deepStrictEqual(error.payload, payload);
  assert.deepStrictEqual(snap(s), before, `${kind} changed polls or votes`);
  return error;
};
// Undo history depth, read by undoing until EmptyUndo {}. It empties the
// scope's history, so it runs last in a case.
const undoCount = (s) => {
  let depth = 0;
  for (;;) {
    try {
      undo(s);
    } catch (error) {
      assert.equal(error?.kind, "EmptyUndo");
      assert.deepStrictEqual(error.payload, {});
      return depth;
    }
    depth++;
    assert.ok(depth < 200, "undo never reached EmptyUndo");
  }
};
const inScope = async (fn) => {
  const s = coreMod.createScope();
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
};
// A closed poll with no votes cannot be built through the operations
// (closing needs a vote; a closed poll refuses a withdraw), yet the task's
// repeat-close rule covers it. Write the exported cell through the scope's
// public controller to reach it. The only seeded state in this checker.
const SEED_POLL = {
  id: "seed-poll-1",
  question: "Lunch?",
  choices: ["Pizza", "Sushi"],
  limit: 3,
  closed: true,
};
const seedClosedEmpty = (s) => {
  s.controller(app.polls).set([SEED_POLL]);
};

const coreTests = [];
const core = (name, fn) => coreTests.push([name, fn]);

core("core entry exports exactly the named API", async () => {
  assert.ok(!loadError, loadError);
  for (const label of API) need(app[label], label);
  assert.deepStrictEqual(Object.keys(app).sort(), API);
  return API.join(", ");
});

core("core each scope starts with no polls, no votes, and EmptyUndo {}", () =>
  inScope((s) => {
    assert.deepStrictEqual(pollList(s), []);
    assert.deepStrictEqual(voteList(s), []);
    const error = caught(() => undo(s));
    assert.equal(error?.kind, "EmptyUndo");
    assert.deepStrictEqual(error.payload, {});
    return "empty lists, EmptyUndo {}";
  }),
);

core("core create trims the question, parses choices and limit, and appends in order", () =>
  inScope((s) => {
    const a = create(s, "  Lunch?  ", " Pizza ,Sushi,  Tacos ", " 3 ");
    assert.ok(typeof a.id === "string" && a.id.length > 0, "nonempty id");
    assert.deepStrictEqual(plainPoll(a), {
      id: a.id,
      question: "Lunch?",
      choices: ["Pizza", "Sushi", "Tacos"],
      limit: 3,
      closed: false,
    });
    const b = create(s, "Lunch?", "a,b", "1");
    const c = create(s, "Team day", "A,B,C,D,E,F", "50");
    assert.equal(new Set([a.id, b.id, c.id]).size, 3, "ids distinct");
    assert.deepStrictEqual(snap(s).polls, [
      {
        id: a.id,
        question: "Lunch?",
        choices: ["Pizza", "Sushi", "Tacos"],
        limit: 3,
        closed: false,
      },
      { id: b.id, question: "Lunch?", choices: ["a", "b"], limit: 1, closed: false },
      {
        id: c.id,
        question: "Team day",
        choices: ["A", "B", "C", "D", "E", "F"],
        limit: 50,
        closed: false,
      },
    ]);
    return "trimmed, duplicate questions, 2 and 6 choices, limits 1 and 50, creation order";
  }),
);

core("core blank questions keep the original value", () =>
  inScope((s) => {
    for (const question of ["", "   ", 42, null, undefined])
      failsWith(s, app.createPoll, { question, choices: MENU, limit: "3" }, "BlankQuestion", {
        question,
      });
    assert.equal(undoCount(s), 0);
    return "raw values kept, nothing written";
  }),
);

const BAD_CHOICES = [
  "",
  "   ",
  "Pizza",
  "Pizza,",
  ",Pizza",
  "Pizza,,Sushi",
  "Pizza, ,Sushi",
  "a,b,c,d,e,f,g",
  "Pizza,Pizza",
  "Pizza, Pizza ",
  3,
  null,
  undefined,
  ["Pizza", "Sushi"],
];

core("core bad choices text reports BadChoices with the original value", () =>
  inScope((s) => {
    for (const choices of BAD_CHOICES)
      failsWith(s, app.createPoll, { question: "Lunch?", choices, limit: "3" }, "BadChoices", {
        choices,
      });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_CHOICES.length} bad values: count, empty part, duplicate, non-text`;
  }),
);

const BAD_LIMITS = [
  "",
  "   ",
  "0",
  " 0 ",
  "51",
  "+3",
  "-2",
  "3.0",
  "1.5",
  "1 2",
  "abc",
  "3a",
  "1e1",
  3,
  null,
  undefined,
  true,
];

core("core bad limit text reports BadLimit with the original value", () =>
  inScope((s) => {
    for (const limit of BAD_LIMITS)
      failsWith(s, app.createPoll, { question: "Lunch?", choices: MENU, limit }, "BadLimit", {
        limit,
      });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_LIMITS.length} bad values, none defaulted`;
  }),
);

core("core setLimit checks limit text before any other rule", () =>
  inScope((s) => {
    const open = create(s, "Lunch?");
    cast(s, open.id, "Ann", "Pizza");
    cast(s, open.id, "Bob", "Sushi");
    const shut = create(s, "Dinner?");
    cast(s, shut.id, "Cy", "Tacos");
    close(s, shut.id);
    for (const limit of ["abc", "", "0", "1 2", 3])
      failsWith(s, app.setLimit, { pollId: shut.id, limit }, "BadLimit", { limit });
    for (const limit of ["51", " ", "+1"])
      failsWith(s, app.setLimit, { pollId: open.id, limit }, "BadLimit", { limit });
    assert.equal(undoCount(s), 6);
    return "BadLimit before PollClosed and BelowVotes";
  }),
);

core("core blank voters keep the original value", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    for (const voter of ["", "  ", 7, null])
      failsWith(s, app.castVote, { pollId: poll.id, voter, choice: "Pizza" }, "BlankVoter", {
        voter,
      });
    assert.equal(undoCount(s), 1);
    return "raw values kept, no vote";
  }),
);

core("core unknown poll and vote ids report NotFound", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    const id = "missing-poll";
    failsWith(s, app.setLimit, { pollId: id, limit: "4" }, "NotFound", { id });
    failsWith(s, app.closePoll, { pollId: id }, "NotFound", { id });
    failsWith(s, app.castVote, { pollId: id, voter: "Ann", choice: "Pizza" }, "NotFound", { id });
    failsWith(s, app.withdrawVote, { voteId: "missing-vote" }, "NotFound", {
      id: "missing-vote",
    });
    const vote = cast(s, poll.id, "Ann", "Pizza");
    withdraw(s, vote.id);
    failsWith(s, app.withdrawVote, { voteId: vote.id }, "NotFound", { id: vote.id });
    assert.equal(undoCount(s), 3);
    return "set limit, close, vote, withdraw, withdrawn twice";
  }),
);

// NotFound's payload is { id: string }: an id that is not text names no
// record and still reports text. Which text is not named, so only its type
// is checked.
const notFoundText = (s, op, input) => {
  const before = snap(s);
  const error = caught(() => s.run(op, { input }));
  assert.equal(error?.kind, "NotFound", `want NotFound for ${String(Object.values(input)[0])}`);
  assert.deepStrictEqual(Object.keys(error.payload ?? {}), ["id"]);
  assert.equal(typeof error.payload.id, "string", "NotFound id is text");
  assert.deepStrictEqual(snap(s), before);
};

core("core ids that are not text report NotFound with a text id", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    cast(s, poll.id, "Ann", "Pizza");
    for (const id of [5, null, undefined, true, {}]) {
      notFoundText(s, app.setLimit, { pollId: id, limit: "4" });
      notFoundText(s, app.closePoll, { pollId: id });
      notFoundText(s, app.castVote, { pollId: id, voter: "Bob", choice: "Pizza" });
      notFoundText(s, app.withdrawVote, { voteId: id });
    }
    assert.equal(undoCount(s), 2);
    return "5 non-text ids on 4 operations, string payload";
  }),
);

core("core unknown choice reports UnknownChoice with the trimmed choice", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    create(s, "Drinks?", "Tea, Coffee");
    const vote = (choice) => ({ pollId: poll.id, voter: "Ann", choice });
    for (const [typed, trimmed] of [
      ["  Tea ", "Tea"],
      ["pizza", "pizza"],
      ["Pizza Sushi", "Pizza Sushi"],
      ["   ", ""],
      ["", ""],
    ])
      failsWith(s, app.castVote, vote(typed), "UnknownChoice", {
        pollId: poll.id,
        choice: trimmed,
      });
    assert.equal(undoCount(s), 2);
    return "another poll's choice, case, blank; payload trimmed";
  }),
);

core("core vote trims voter and choice and appends votes in order", () =>
  inScope((s) => {
    const lunch = create(s, "Lunch?");
    const drinks = create(s, "Drinks?", "Tea, Coffee");
    const first = cast(s, lunch.id, "  Ann ", " Sushi ");
    assert.ok(typeof first.id === "string" && first.id.length > 0, "nonempty vote id");
    assert.deepStrictEqual(
      { ...first },
      { id: first.id, pollId: lunch.id, voter: "Ann", choice: "Sushi" },
    );
    const second = cast(s, drinks.id, "Ann", "Tea");
    const third = cast(s, lunch.id, "Bob", "Pizza");
    assert.equal(new Set([first.id, second.id, third.id]).size, 3);
    assert.deepStrictEqual(snap(s).votes, [
      { id: first.id, pollId: lunch.id, voter: "Ann", choice: "Sushi" },
      { id: second.id, pollId: drinks.id, voter: "Ann", choice: "Tea" },
      { id: third.id, pollId: lunch.id, voter: "Bob", choice: "Pizza" },
    ]);
    return "trimmed, one vote per poll per voter, creation order";
  }),
);

core("core repeat vote returns the existing vote with no undo step", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    const vote = cast(s, poll.id, "Ann", "Sushi");
    const before = snap(s);
    assert.deepStrictEqual({ ...cast(s, poll.id, " Ann ", " Sushi ") }, { ...vote });
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "same vote, no step";
  }),
);

core("core repeat vote passes even when the poll is full", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?", MENU, "1");
    const vote = cast(s, poll.id, "Ann", "Sushi");
    const before = snap(s);
    assert.deepStrictEqual({ ...cast(s, poll.id, "Ann", "Sushi") }, { ...vote });
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "held vote beats PollFull";
  }),
);

core("core repeat vote passes even when the poll is closed", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    const vote = cast(s, poll.id, "Ann", "Sushi");
    close(s, poll.id);
    const before = snap(s);
    assert.deepStrictEqual({ ...cast(s, poll.id, " Ann", "Sushi ") }, { ...vote });
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "held vote beats PollClosed";
  }),
);

core("core changing a vote keeps its id and position with one undo step", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    const ann = cast(s, poll.id, "Ann", "Pizza");
    const bob = cast(s, poll.id, "Bob", "Sushi");
    const before = snap(s);
    const changed = cast(s, poll.id, " Ann", "Tacos");
    assert.deepStrictEqual({ ...changed }, { ...ann, choice: "Tacos" });
    assert.deepStrictEqual(snap(s).votes, [{ ...ann, choice: "Tacos" }, { ...bob }]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "same id, same place, one step";
  }),
);

core("core changing a vote works on a full poll", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?", MENU, "2");
    const ann = cast(s, poll.id, "Ann", "Pizza");
    const bob = cast(s, poll.id, "Bob", "Sushi");
    assert.deepStrictEqual({ ...cast(s, poll.id, "Ann", "Sushi") }, { ...ann, choice: "Sushi" });
    assert.deepStrictEqual(snap(s).votes, [{ ...ann, choice: "Sushi" }, { ...bob }]);
    assert.equal(undoCount(s), 4);
    return "a held vote changes at the limit";
  }),
);

core("core a new voter on a full poll reports PollFull", () =>
  inScope((s) => {
    const full = create(s, "Lunch?", MENU, "2");
    const other = create(s, "Dinner?", MENU, "2");
    cast(s, full.id, "Ann", "Pizza");
    cast(s, full.id, "Bob", "Pizza");
    failsWith(s, app.castVote, { pollId: full.id, voter: "Cy", choice: "Pizza" }, "PollFull", {
      id: full.id,
    });
    cast(s, other.id, "Cy", "Pizza");
    return "count equals limit; other polls still take votes";
  }),
);

core("core a closed poll refuses new and changed votes, withdraw, and a new limit", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    const ann = cast(s, poll.id, "Ann", "Pizza");
    close(s, poll.id);
    const id = poll.id;
    failsWith(s, app.castVote, { pollId: id, voter: "Bob", choice: "Pizza" }, "PollClosed", { id });
    failsWith(s, app.castVote, { pollId: id, voter: "Ann", choice: "Sushi" }, "PollClosed", { id });
    failsWith(s, app.setLimit, { pollId: id, limit: "5" }, "PollClosed", { id });
    // The task does not say whether a refused withdraw names the poll or
    // the vote: either id passes.
    const before = snap(s);
    const error = caught(() => withdraw(s, ann.id));
    assert.equal(error?.kind, "PollClosed");
    assert.deepStrictEqual(Object.keys(error.payload), ["id"]);
    assert.ok([poll.id, ann.id].includes(error.payload.id), "PollClosed names the poll or vote");
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "new vote, changed vote, set limit, withdraw";
  }),
);

core("core setLimit changes only the limit with one undo step", () =>
  inScope((s) => {
    const lunch = create(s, "Lunch?");
    const dinner = create(s, "Dinner?");
    const changed = limitTo(s, lunch.id, " 5 ");
    assert.deepStrictEqual(plainPoll(changed), { ...plainPoll(lunch), limit: 5 });
    assert.deepStrictEqual(snap(s).polls, [{ ...plainPoll(lunch), limit: 5 }, plainPoll(dinner)]);
    undo(s);
    assert.deepStrictEqual(snap(s).polls, [plainPoll(lunch), plainPoll(dinner)]);
    return "limit only, order kept";
  }),
);

core("core setLimit to the limit it has passes with no step, even when closed", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    const before = snap(s);
    assert.deepStrictEqual(plainPoll(limitTo(s, poll.id, "3")), plainPoll(poll));
    assert.deepStrictEqual(snap(s), before);
    cast(s, poll.id, "Ann", "Pizza");
    const done = close(s, poll.id);
    const closed = snap(s);
    assert.deepStrictEqual(plainPoll(limitTo(s, poll.id, " 3 ")), plainPoll(done));
    assert.deepStrictEqual(snap(s), closed);
    assert.equal(undoCount(s), 3);
    return "saved poll returned, no step";
  }),
);

core("core setLimit below the vote count reports BelowVotes", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    cast(s, poll.id, "Ann", "Pizza");
    cast(s, poll.id, "Bob", "Sushi");
    failsWith(s, app.setLimit, { pollId: poll.id, limit: "1" }, "BelowVotes", {
      id: poll.id,
      votes: 2,
    });
    assert.equal(limitTo(s, poll.id, "2").limit, 2);
    return "below fails, equal passes";
  }),
);

core("core close marks the poll closed and keeps it listed", () =>
  inScope((s) => {
    const lunch = create(s, "Lunch?");
    const dinner = create(s, "Dinner?");
    cast(s, lunch.id, "Ann", "Pizza");
    const done = close(s, lunch.id);
    assert.deepStrictEqual(plainPoll(done), { ...plainPoll(lunch), closed: true });
    assert.deepStrictEqual(snap(s).polls, [
      { ...plainPoll(lunch), closed: true },
      plainPoll(dinner),
    ]);
    undo(s);
    assert.deepStrictEqual(snap(s).polls, [plainPoll(lunch), plainPoll(dinner)]);
    return "closed in place, one step";
  }),
);

core("core close repeat passes with no undo step", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    cast(s, poll.id, "Ann", "Pizza");
    const done = close(s, poll.id);
    const before = snap(s);
    assert.deepStrictEqual(plainPoll(close(s, poll.id)), plainPoll(done));
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "saved poll returned, no step";
  }),
);

core("core close repeat passes even with no votes", () =>
  inScope((s) => {
    seedClosedEmpty(s);
    const before = snap(s);
    assert.deepStrictEqual(plainPoll(close(s, SEED_POLL.id)), before.polls[0]);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 0);
    return "already closed beats NoVotes (seeded)";
  }),
);

core("core close with no votes reports NoVotes", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    failsWith(s, app.closePoll, { pollId: poll.id }, "NoVotes", { id: poll.id });
    const vote = cast(s, poll.id, "Ann", "Pizza");
    withdraw(s, vote.id);
    failsWith(s, app.closePoll, { pollId: poll.id }, "NoVotes", { id: poll.id });
    return "new poll and emptied poll";
  }),
);

core("core withdraw removes the vote with one undo step", () =>
  inScope((s) => {
    const poll = create(s, "Lunch?");
    const ann = cast(s, poll.id, "Ann", "Pizza");
    const bob = cast(s, poll.id, "Bob", "Sushi");
    const before = snap(s);
    assert.equal(withdraw(s, ann.id), undefined);
    assert.deepStrictEqual(snap(s).votes, [{ ...bob }]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "vote gone, undo brings it back in place";
  }),
);

core("core failed actions leave polls, votes, and undo unchanged", () =>
  inScope((s) => {
    const full = create(s, "Full?", MENU, "1");
    cast(s, full.id, "Ann", "Pizza");
    const shut = create(s, "Shut?");
    cast(s, shut.id, "Ann", "Pizza");
    close(s, shut.id);
    const idle = create(s, "Idle?");
    const busy = create(s, "Busy?");
    cast(s, busy.id, "Ann", "Pizza");
    cast(s, busy.id, "Bob", "Sushi");
    const tries = [
      [app.createPoll, { question: " ", choices: MENU, limit: "2" }, "BlankQuestion"],
      [app.createPoll, { question: "Q?", choices: "Pizza", limit: "2" }, "BadChoices"],
      [app.createPoll, { question: "Q?", choices: MENU, limit: "0" }, "BadLimit"],
      [app.setLimit, { pollId: busy.id, limit: "x" }, "BadLimit"],
      [app.setLimit, { pollId: busy.id, limit: "1" }, "BelowVotes"],
      [app.setLimit, { pollId: shut.id, limit: "9" }, "PollClosed"],
      [app.castVote, { pollId: busy.id, voter: " ", choice: "Pizza" }, "BlankVoter"],
      [app.castVote, { pollId: "missing-poll", voter: "Cy", choice: "Pizza" }, "NotFound"],
      [app.castVote, { pollId: busy.id, voter: "Cy", choice: "Tea" }, "UnknownChoice"],
      [app.castVote, { pollId: shut.id, voter: "Bob", choice: "Pizza" }, "PollClosed"],
      [app.castVote, { pollId: full.id, voter: "Bob", choice: "Pizza" }, "PollFull"],
      [app.closePoll, { pollId: idle.id }, "NoVotes"],
      [app.withdrawVote, { voteId: "missing-vote" }, "NotFound"],
    ];
    for (const [op, input, kind] of tries) {
      const before = snap(s);
      assert.equal(caught(() => s.run(op, { input }))?.kind, kind);
      assert.deepStrictEqual(snap(s), before, `${kind} changed polls or votes`);
    }
    assert.equal(undoCount(s), 9);
    assert.deepStrictEqual(snap(s), { polls: [], votes: [] });
    return `${tries.length} failures, no write, no step`;
  }),
);

core("core undo restores the exact polls and votes in order", () =>
  inScope((s) => {
    const steps = [snap(s)];
    const lunch = create(s, "Lunch?");
    steps.push(snap(s));
    const drinks = create(s, "Drinks?", "Tea, Coffee");
    steps.push(snap(s));
    cast(s, lunch.id, "Ann", "Pizza");
    steps.push(snap(s));
    const bob = cast(s, drinks.id, "Bob", "Tea");
    steps.push(snap(s));
    cast(s, lunch.id, "Ann", "Tacos");
    steps.push(snap(s));
    limitTo(s, drinks.id, "5");
    steps.push(snap(s));
    withdraw(s, bob.id);
    steps.push(snap(s));
    close(s, lunch.id);
    for (const want of steps.reverse()) {
      assert.equal(undo(s), undefined);
      assert.deepStrictEqual(snap(s), want);
    }
    assert.equal(caught(() => undo(s))?.kind, "EmptyUndo");
    return "eight steps back, exact order";
  }),
);

core("core ids stay unique and are never reused after undo", () =>
  inScope((s) => {
    const a = create(s, "Lunch?");
    const b = create(s, "Dinner?");
    const v = cast(s, a.id, "Ann", "Pizza");
    undo(s);
    undo(s);
    undo(s);
    const seen = new Set([a.id, b.id, v.id]);
    const c = create(s, "Lunch?");
    const d = create(s, "Dinner?");
    const w = cast(s, c.id, "Ann", "Pizza");
    for (const id of [c.id, d.id, w.id]) assert.ok(!seen.has(id), `id ${id} reused`);
    assert.equal(new Set([c.id, d.id, w.id]).size, 3);
    return "fresh ids after undo";
  }),
);

core("core two scopes share nothing", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    const poll = create(a, "Lunch?");
    cast(a, poll.id, "Ann", "Pizza");
    assert.deepStrictEqual(snap(b), { polls: [], votes: [] });
    assert.equal(caught(() => undo(b))?.kind, "EmptyUndo");
    create(b, "Dinner?");
    assert.deepStrictEqual(
      pollList(a).map((p) => p.question),
      ["Lunch?"],
    );
    assert.equal(voteList(a).length, 1);
    return "separate records and history";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core thrown errors narrow through isError", () =>
  inScope((s) => {
    const bad = caught(() => create(s, "Lunch?", MENU, "abc"));
    assert.ok(app.isError(bad, "BadLimit"), "want BadLimit");
    assert.ok(!app.isError(bad, "NotFound"), "BadLimit is not NotFound");
    assert.deepStrictEqual(bad.payload, { limit: "abc" });
    const gone = caught(() => close(s, "missing-poll"));
    assert.ok(app.isError(gone, "NotFound"), "want NotFound");
    const empty = caught(() => undo(s));
    assert.ok(app.isError(empty, "EmptyUndo"), "want EmptyUndo");
    return "BadLimit, NotFound, EmptyUndo";
  }),
);

// ---- browser checks: real Chromium, fresh mounts ----
const URL_ROOT = "http://127.0.0.1:5173";
const browserTests = [];
const browser = (name, fn) => browserTests.push([name, fn]);

const questionBox = (scope) => scope.getByLabel("Question", { exact: true });
const choicesBox = (scope) => scope.getByLabel("Choices", { exact: true });
const limitBox = (scope) => scope.getByLabel("Limit", { exact: true });
const voterBox = (scope) => scope.getByLabel("Voter", { exact: true });
const pollBox = (scope) => scope.getByRole("combobox", { name: "Poll", exact: true });
const choiceBox = (scope) => scope.getByRole("combobox", { name: "Choice", exact: true });
const pollsTable = (scope) => scope.getByRole("table", { name: "Polls", exact: true });
const votesTable = (scope) => scope.getByRole("table", { name: "Votes", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });

const pause = () => new Promise((done) => setTimeout(done, 50));
// Poll a read until it equals the wanted value; the last read is the error.
const settle = async (read, want) => {
  let last;
  for (let i = 0; i < 60; i++) {
    last = await read();
    if (JSON.stringify(last) === JSON.stringify(want)) return;
    await pause();
  }
  assert.deepStrictEqual(last, want);
};

const cellsOf = async (row) => {
  const cells = row
    .getByRole("cell")
    .or(row.getByRole("columnheader"))
    .or(row.getByRole("rowheader"));
  // A cell's own text without its controls: the task names the buttons
  // but not where they sit, so a Close or Withdraw button inside the
  // Status or Choice cell must not change what the cell says.
  return cells.evaluateAll((all) =>
    all.map((cell) => {
      const copy = cell.cloneNode(true);
      for (const control of copy.querySelectorAll("button, input, select, textarea, [role=button]"))
        control.remove();
      return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    }),
  );
};
// Rows of a named table by header text: the header row is the first row
// naming every wanted column, whatever role its cells get. Extra columns
// and column order are free; hidden (filtered) rows are skipped by role.
const readTable = async (table, columns) => {
  const rows = [];
  for (const row of await table.getByRole("row").all()) rows.push(await cellsOf(row));
  const head = rows.findIndex((cells) => columns.every((column) => cells.includes(column)));
  assert.ok(head >= 0, `want columns ${columns.join(", ")}; found ${rows[0]?.join(", ") ?? ""}`);
  const at = columns.map((column) => rows[head].indexOf(column));
  return rows.slice(head + 1).map((cells) => at.map((i) => cells[i]));
};
const POLL_COLUMNS = ["Question", "Votes", "Leader", "Status"];
const pollRowsOf = (scope) => readTable(pollsTable(scope), POLL_COLUMNS);
const questions = async (scope) =>
  (await readTable(pollsTable(scope), ["Question"])).map((row) => row[0]);
const voteRowsOf = (scope) => readTable(votesTable(scope), ["Poll", "Voter", "Choice"]);

const optionsOf = (select) =>
  select
    .locator("option")
    .evaluateAll((all) => all.map((o) => [o.textContent?.trim() ?? "", o.value]));
const optionLabels = async (select) => (await optionsOf(select)).map(([label]) => label);
const chosenLabel = (select) =>
  select.evaluate((el) => el.selectedOptions[0]?.textContent?.trim() ?? "");

// One shared alert block: more than one role=alert fails. Empty or absent
// both count as no notice.
const alertText = async (scope) => {
  const alerts = scope.getByRole("alert");
  const count = await alerts.count();
  assert.ok(count <= 1, `want one shared alert, found ${count}`);
  return count === 0 ? "" : (await alerts.first().innerText()).trim();
};
const seeAlert = async (scope, kind) => {
  let last = "";
  for (let i = 0; i < 60; i++) {
    last = await alertText(scope);
    if (last.includes(kind)) return;
    await pause();
  }
  assert.fail(`want alert ${kind}, got "${last}"`);
};
const noAlert = (scope) => settle(() => alertText(scope), "");

const addPoll = async (scope, question, choices, limit) => {
  await questionBox(scope).fill(question);
  await choicesBox(scope).fill(choices);
  await limitBox(scope).fill(limit);
  await button(scope, "Create poll").click();
};
const addPolls = async (scope, rows) => {
  for (const [question, choices, limit] of rows) {
    await addPoll(scope, question, choices, limit);
    await button(scope, `Close ${question}`).first().waitFor();
  }
};
const voteAs = async (scope, question, voter, choice) => {
  await pollBox(scope).selectOption({ label: question });
  await voterBox(scope).fill(voter);
  await choiceBox(scope).selectOption({ label: choice });
  await button(scope, "Vote").click();
};
const raiseBlankQuestion = async (scope) => {
  await questionBox(scope).fill("   ");
  await choicesBox(scope).fill("Pizza, Sushi");
  await limitBox(scope).fill("2");
  await button(scope, "Create poll").click();
  await seeAlert(scope, "BlankQuestion");
};
const open = async (page) => {
  await page.goto(URL_ROOT);
  await pollsTable(page).waitFor();
};
const LUNCH = ["Lunch?", "Pizza, Sushi, Tacos", "3"];

browser("browser loads empty forms, both tables, and the filters", async (page) => {
  await open(page);
  for (const box of [questionBox, choicesBox, limitBox, voterBox])
    assert.equal(await box(page).inputValue(), "");
  assert.equal(await pollBox(page).inputValue(), "");
  assert.equal(await choiceBox(page).inputValue(), "");
  assert.deepStrictEqual(await optionLabels(pollBox(page)), ["Choose poll"]);
  assert.deepStrictEqual(await optionLabels(choiceBox(page)), ["Choose choice"]);
  for (const name of ["Create poll", "Vote", "Undo", "All", "Open", "Closed"])
    await button(page, name).waitFor();
  assert.ok(await button(page, "Undo").isEnabled(), "Undo enabled on empty history");
  assert.deepStrictEqual(await pollRowsOf(page), []);
  assert.deepStrictEqual(await voteRowsOf(page), []);
  assert.equal(await alertText(page), "");
  return "inputs empty, Choose poll, Choose choice, tables with named columns";
});

browser("browser create poll appends a row and clears all three inputs", async (page) => {
  await open(page);
  await addPoll(page, "  Lunch?  ", "Pizza, Sushi", " 2 ");
  await settle(() => pollRowsOf(page), [["Lunch?", "0", "None", "Open"]]);
  for (const box of [questionBox, choicesBox, limitBox])
    assert.equal(await box(page).inputValue(), "");
  await addPoll(page, "Team day", "A, B, C", "5");
  await settle(
    () => pollRowsOf(page),
    [
      ["Lunch?", "0", "None", "Open"],
      ["Team day", "0", "None", "Open"],
    ],
  );
  assert.equal(await alertText(page), "");
  return "trimmed, Leader None, creation order, inputs cleared";
});

browser("browser bad poll input keeps the form text and shows the kind", async (page) => {
  await open(page);
  await addPoll(page, "Lunch?", "Pizza, Sushi", "abc");
  await seeAlert(page, "BadLimit");
  assert.equal(await questionBox(page).inputValue(), "Lunch?");
  assert.equal(await choicesBox(page).inputValue(), "Pizza, Sushi");
  assert.equal(await limitBox(page).inputValue(), "abc");
  await limitBox(page).fill("");
  await button(page, "Create poll").click();
  await seeAlert(page, "BadLimit");
  await limitBox(page).fill("2");
  await choicesBox(page).fill("Pizza");
  await button(page, "Create poll").click();
  await seeAlert(page, "BadChoices");
  assert.equal(await choicesBox(page).inputValue(), "Pizza");
  assert.equal(await limitBox(page).inputValue(), "2");
  assert.deepStrictEqual(await pollRowsOf(page), []);
  return "abc and blank limit, one choice refused; text kept";
});

browser("browser blank question keeps the form text and shows BlankQuestion", async (page) => {
  await open(page);
  await raiseBlankQuestion(page);
  assert.equal(await questionBox(page).inputValue(), "   ");
  assert.equal(await choicesBox(page).inputValue(), "Pizza, Sushi");
  assert.equal(await limitBox(page).inputValue(), "2");
  assert.deepStrictEqual(await pollRowsOf(page), []);
  return "BlankQuestion, text kept, nothing saved";
});

browser(
  "browser Poll lists every poll and Choice lists the chosen poll's choices",
  async (page) => {
    await open(page);
    await addPolls(page, [LUNCH, ["Drinks?", "Tea, Coffee", "3"]]);
    const options = await optionsOf(pollBox(page));
    assert.deepStrictEqual(
      options.map(([label]) => label),
      ["Choose poll", "Lunch?", "Drinks?"],
    );
    assert.equal(options[0][1], "");
    assert.ok(options[1][1] !== "" && options[2][1] !== "", "ids as values");
    assert.notEqual(options[1][1], options[2][1]);
    assert.deepStrictEqual(await optionLabels(choiceBox(page)), ["Choose choice"]);
    await pollBox(page).selectOption({ label: "Lunch?" });
    await settle(() => optionLabels(choiceBox(page)), ["Choose choice", "Pizza", "Sushi", "Tacos"]);
    assert.equal(await choiceBox(page).inputValue(), "");
    await pollBox(page).selectOption({ label: "Drinks?" });
    await settle(() => optionLabels(choiceBox(page)), ["Choose choice", "Tea", "Coffee"]);
    return "creation order, ids as values, choices in typed order";
  },
);

browser("browser choosing a different poll resets Choice", async (page) => {
  await open(page);
  await addPolls(page, [
    ["Lunch?", "Pizza, Sushi", "3"],
    ["Dinner?", "Sushi, Tacos", "3"],
  ]);
  await pollBox(page).selectOption({ label: "Lunch?" });
  await voterBox(page).fill("Ann");
  await choiceBox(page).selectOption({ label: "Sushi" });
  await pollBox(page).selectOption({ label: "Dinner?" });
  await settle(() => choiceBox(page).inputValue(), "");
  assert.equal(await voterBox(page).inputValue(), "Ann");
  await button(page, "Vote").click();
  await seeAlert(page, "UnknownChoice");
  assert.deepStrictEqual(await voteRowsOf(page), []);
  await choiceBox(page).selectOption({ label: "Sushi" });
  await button(page, "Vote").click();
  await settle(() => voteRowsOf(page), [["Dinner?", "Ann", "Sushi"]]);
  return "Sushi on both polls; the switch empties Choice";
});

browser("browser vote adds a row and keeps the vote form", async (page) => {
  await open(page);
  await addPolls(page, [LUNCH]);
  await voteAs(page, "Lunch?", " Ann ", "Sushi");
  await settle(() => voteRowsOf(page), [["Lunch?", "Ann", "Sushi"]]);
  await settle(() => pollRowsOf(page), [["Lunch?", "1", "Sushi", "Open"]]);
  assert.equal(await voterBox(page).inputValue(), " Ann ");
  assert.equal(await chosenLabel(pollBox(page)), "Lunch?");
  assert.equal(await choiceBox(page).inputValue(), "Sushi");
  await button(page, "Withdraw Ann from Lunch?").waitFor();
  assert.equal(await alertText(page), "");
  return "vote row, count, Leader, form kept";
});

browser(
  "browser Leader breaks ties by choice order and a changed vote stays in place",
  async (page) => {
    await open(page);
    await addPolls(page, [["Lunch?", "Pizza, Sushi, Tacos", "5"]]);
    await voteAs(page, "Lunch?", "Ann", "Sushi");
    await settle(() => pollRowsOf(page), [["Lunch?", "1", "Sushi", "Open"]]);
    await voteAs(page, "Lunch?", "Bob", "Pizza");
    await settle(() => pollRowsOf(page), [["Lunch?", "2", "Pizza", "Open"]]);
    await voteAs(page, "Lunch?", "Cy", "Sushi");
    await settle(() => pollRowsOf(page), [["Lunch?", "3", "Sushi", "Open"]]);
    await voteAs(page, "Lunch?", "Ann", "Tacos");
    await settle(
      () => voteRowsOf(page),
      [
        ["Lunch?", "Ann", "Tacos"],
        ["Lunch?", "Bob", "Pizza"],
        ["Lunch?", "Cy", "Sushi"],
      ],
    );
    await settle(() => pollRowsOf(page), [["Lunch?", "3", "Pizza", "Open"]]);
    return "1-1 tie to Pizza, 2-1 Sushi, change in place, 1-1-1 to Pizza";
  },
);

browser(
  "browser a full poll shows Full, refuses a new voter, and takes a changed vote",
  async (page) => {
    await open(page);
    await addPolls(page, [["Lunch?", "Pizza, Sushi", "2"]]);
    await voteAs(page, "Lunch?", "Ann", "Pizza");
    await voteAs(page, "Lunch?", "Bob", "Sushi");
    await settle(() => pollRowsOf(page), [["Lunch?", "2", "Pizza", "Full"]]);
    await voteAs(page, "Lunch?", "Cy", "Pizza");
    await seeAlert(page, "PollFull");
    assert.equal(await voterBox(page).inputValue(), "Cy");
    assert.equal(await choiceBox(page).inputValue(), "Pizza");
    assert.equal(await button(page, "Close Lunch?").count(), 1);
    await voteAs(page, "Lunch?", "Bob", "Pizza");
    await settle(
      () => voteRowsOf(page),
      [
        ["Lunch?", "Ann", "Pizza"],
        ["Lunch?", "Bob", "Pizza"],
      ],
    );
    await noAlert(page);
    await settle(() => pollRowsOf(page), [["Lunch?", "2", "Pizza", "Full"]]);
    return "Full status, PollFull, change at the limit";
  },
);

browser("browser Close closes a poll and a blocked close shows NoVotes", async (page) => {
  await open(page);
  await addPolls(page, [LUNCH, ["Dinner?", "Pizza, Sushi", "3"]]);
  assert.ok(await button(page, "Close Dinner?").isEnabled(), "Close stays enabled");
  await button(page, "Close Dinner?").click();
  await seeAlert(page, "NoVotes");
  await voteAs(page, "Lunch?", "Ann", "Tacos");
  await button(page, "Close Lunch?").click();
  await settle(
    () => pollRowsOf(page),
    [
      ["Lunch?", "1", "Tacos", "Closed"],
      ["Dinner?", "0", "None", "Open"],
    ],
  );
  assert.equal(await button(page, "Close Lunch?").count(), 0);
  assert.equal(await button(page, "Close Dinner?").count(), 1);
  return "NoVotes shown; Closed status, no Close Lunch?";
});

browser("browser Withdraw removes a vote and a closed poll refuses it", async (page) => {
  await open(page);
  await addPolls(page, [LUNCH]);
  await voteAs(page, "Lunch?", "Ann", "Pizza");
  await voteAs(page, "Lunch?", "Bob", "Sushi");
  await button(page, "Withdraw Ann from Lunch?").click();
  await settle(() => voteRowsOf(page), [["Lunch?", "Bob", "Sushi"]]);
  await settle(() => pollRowsOf(page), [["Lunch?", "1", "Sushi", "Open"]]);
  await button(page, "Close Lunch?").click();
  await settle(() => pollRowsOf(page), [["Lunch?", "1", "Sushi", "Closed"]]);
  await button(page, "Withdraw Bob from Lunch?").click();
  await seeAlert(page, "PollClosed");
  assert.deepStrictEqual(await voteRowsOf(page), [["Lunch?", "Bob", "Sushi"]]);
  return "vote gone, count drops; PollClosed on a closed poll";
});

browser("browser filters show Open (with Full) and Closed rows live", async (page) => {
  await open(page);
  await addPolls(page, [
    ["Full?", "Pizza, Sushi", "1"],
    ["Busy?", "Pizza, Sushi", "3"],
    ["Shut?", "Pizza, Sushi", "3"],
  ]);
  await voteAs(page, "Full?", "Ann", "Pizza");
  await voteAs(page, "Busy?", "Ann", "Pizza");
  await voteAs(page, "Shut?", "Ann", "Pizza");
  await button(page, "Close Shut?").click();
  await settle(
    () => pollRowsOf(page),
    [
      ["Full?", "1", "Pizza", "Full"],
      ["Busy?", "1", "Pizza", "Open"],
      ["Shut?", "1", "Pizza", "Closed"],
    ],
  );
  await button(page, "Open").click();
  await settle(() => questions(page), ["Full?", "Busy?"]);
  await button(page, "Closed").click();
  await settle(() => questions(page), ["Shut?"]);
  await button(page, "Open").click();
  await settle(() => questions(page), ["Full?", "Busy?"]);
  await button(page, "Close Busy?").click();
  await settle(() => questions(page), ["Full?"]);
  await button(page, "All").click();
  await settle(() => questions(page), ["Full?", "Busy?", "Shut?"]);
  return "Open keeps Full, filters hide rows only, update without another click";
});

browser("browser typing clears an earlier alert", async (page) => {
  await open(page);
  await raiseBlankQuestion(page);
  await choicesBox(page).fill("Pizza, Tacos");
  await noAlert(page);
  await button(page, "Create poll").click();
  await seeAlert(page, "BlankQuestion");
  await limitBox(page).fill("3");
  await noAlert(page);
  await button(page, "Create poll").click();
  await seeAlert(page, "BlankQuestion");
  await voterBox(page).fill("Ann");
  await noAlert(page);
  await button(page, "Create poll").click();
  await seeAlert(page, "BlankQuestion");
  await questionBox(page).fill("Lunch?");
  await noAlert(page);
  return "Choices, Limit, Voter, and Question typing clear";
});

browser("browser choosing a poll or a choice clears an earlier alert", async (page) => {
  await open(page);
  await addPolls(page, [LUNCH]);
  await raiseBlankQuestion(page);
  await pollBox(page).selectOption({ label: "Lunch?" });
  await noAlert(page);
  await button(page, "Create poll").click();
  await seeAlert(page, "BlankQuestion");
  await choiceBox(page).selectOption({ label: "Sushi" });
  await noAlert(page);
  return "Poll and Choice selects clear";
});

browser("browser filtering clears an earlier alert", async (page) => {
  await open(page);
  await raiseBlankQuestion(page);
  await button(page, "Open").click();
  await noAlert(page);
  await button(page, "Create poll").click();
  await seeAlert(page, "BlankQuestion");
  await button(page, "All").click();
  await noAlert(page);
  return "Open and All clear";
});

browser("browser a passing no-op vote clears an earlier alert", async (page) => {
  await open(page);
  await addPolls(page, [LUNCH]);
  await voteAs(page, "Lunch?", "Ann", "Pizza");
  await settle(() => voteRowsOf(page), [["Lunch?", "Ann", "Pizza"]]);
  await raiseBlankQuestion(page);
  await button(page, "Vote").click();
  await noAlert(page);
  assert.deepStrictEqual(await voteRowsOf(page), [["Lunch?", "Ann", "Pizza"]]);
  await button(page, "Undo").click();
  await settle(() => voteRowsOf(page), []);
  await button(page, "Undo").click();
  await settle(() => pollRowsOf(page), []);
  return "repeat vote passes, clears, adds no step";
});

browser(
  "browser undo restores records and keeps form text, selections, and filter",
  async (page) => {
    await open(page);
    await addPolls(page, [
      ["Lunch?", "Pizza, Sushi", "3"],
      ["Dinner?", "Tea, Coffee", "3"],
    ]);
    await voteAs(page, "Dinner?", "Bob", "Tea");
    await button(page, "Close Dinner?").click();
    await voteAs(page, "Lunch?", "Ann", "Sushi");
    await settle(
      () => voteRowsOf(page),
      [
        ["Dinner?", "Bob", "Tea"],
        ["Lunch?", "Ann", "Sushi"],
      ],
    );
    const lunchId = await pollBox(page).inputValue();
    await button(page, "Open").click();
    await settle(() => questions(page), ["Lunch?"]);
    await questionBox(page).fill("Brunch?");
    await choicesBox(page).fill("Eggs, Toast");
    await limitBox(page).fill("4");
    await button(page, "Undo").click();
    await settle(() => voteRowsOf(page), [["Dinner?", "Bob", "Tea"]]);
    await settle(() => pollRowsOf(page), [["Lunch?", "0", "None", "Open"]]);
    assert.equal(await questionBox(page).inputValue(), "Brunch?");
    assert.equal(await choicesBox(page).inputValue(), "Eggs, Toast");
    assert.equal(await limitBox(page).inputValue(), "4");
    assert.equal(await pollBox(page).inputValue(), lunchId);
    assert.equal(await voterBox(page).inputValue(), "Ann");
    assert.equal(await choiceBox(page).inputValue(), "Sushi");
    await button(page, "Undo").click();
    await settle(() => questions(page), ["Lunch?", "Dinner?"]);
    return "records back; text, poll, voter, choice, and Open filter kept";
  },
);

browser("browser undo that removes the chosen poll keeps it as Removed poll", async (page) => {
  await open(page);
  await addPolls(page, [LUNCH, ["Dinner?", "Tea, Coffee", "3"]]);
  await pollBox(page).selectOption({ label: "Dinner?" });
  await voterBox(page).fill("Ann");
  await choiceBox(page).selectOption({ label: "Tea" });
  const dinnerId = await pollBox(page).inputValue();
  await button(page, "Undo").click();
  await settle(() => questions(page), ["Lunch?"]);
  assert.equal(await pollBox(page).inputValue(), dinnerId);
  assert.equal(await chosenLabel(pollBox(page)), "Removed poll");
  assert.deepStrictEqual(await optionLabels(choiceBox(page)), ["Choose choice"]);
  assert.ok((await optionLabels(pollBox(page))).includes("Lunch?"), "Lunch? still listed");
  await button(page, "Vote").click();
  await seeAlert(page, "NotFound");
  assert.equal(await voterBox(page).inputValue(), "Ann");
  assert.deepStrictEqual(await voteRowsOf(page), []);
  await pollBox(page).selectOption({ label: "Lunch?" });
  await settle(() => optionLabels(choiceBox(page)), ["Choose choice", "Pizza", "Sushi", "Tacos"]);
  return "Removed poll kept selected with no choices; vote reports NotFound";
});

browser("browser undo on empty history shows EmptyUndo", async (page) => {
  await open(page);
  await button(page, "Undo").click();
  await seeAlert(page, "EmptyUndo");
  await addPoll(page, ...LUNCH);
  await noAlert(page);
  await settle(() => questions(page), ["Lunch?"]);
  return "EmptyUndo shown, next create clears it";
});

// Runs inside the page: one ordinary async function passed directly to
// page.evaluate. All helpers nest INSIDE it, so the serialized closure is
// self-contained.
const mountSecondRoot = async () => {
  const entryCandidates = ["/src/index.ts", "/src/index.tsx"];
  const pickEntry = async () => {
    for (const entry of entryCandidates) {
      try {
        return await import(entry);
      } catch {}
    }
    throw new Error("cannot import submission entry");
  };
  const ownJsx = (mod) => mod?.jsx ?? mod?.jsxs;
  const inheritedJsx = (mod) =>
    mod?.default?.jsx ?? mod?.default?.createElement ?? mod?.createElement;
  const firstJsx = (mod) => ownJsx(mod) ?? inheritedJsx(mod);
  const probeDirectJsx = async () =>
    firstJsx(await import("/@id/__x00__react/jsx-runtime").catch(() => null));
  const probeBareJsx = async () => firstJsx(await import("react/jsx-runtime").catch(() => null));
  const probeJsxRuntime = async () => {
    const direct = await probeDirectJsx();
    if (typeof direct === "function") return direct;
    return probeBareJsx();
  };
  const candidatePaths = (paths) =>
    paths.filter((p) => p.includes("jsx-runtime") || p.includes("react")).slice(0, 8);
  const loadCandidateJsx = async (cand) => {
    try {
      const jsx = firstJsx(await import(cand));
      return typeof jsx === "function" ? jsx : undefined;
    } catch {
      return undefined;
    }
  };
  const scanJsxCandidates = async (paths) => {
    for (const cand of candidatePaths(paths)) {
      const jsx = await loadCandidateJsx(cand);
      if (typeof jsx === "function") return jsx;
    }
    return undefined;
  };
  const pickClientPath = (paths) => {
    const pick = (...subs) => paths.find((p) => subs.every((s) => p.includes(s)));
    return pick("react-dom", "client") ?? "/node_modules/.vite/deps/react-dom_client.js";
  };
  const loadCreateRoot = async (clientPath) => {
    const clientMod = await import(clientPath);
    const createRoot = clientMod.createRoot ?? clientMod.default?.createRoot ?? clientMod.default;
    if (typeof createRoot !== "function") throw new Error("cannot load createRoot");
    return createRoot;
  };
  const resolveJsx = async (paths) => {
    const probed = await probeJsxRuntime();
    if (typeof probed === "function") return probed;
    const scanned = await scanJsxCandidates(paths);
    if (typeof scanned === "function") return scanned;
    throw new Error("cannot load jsx runtime");
  };
  // Keep the full module URL (path plus query): a second copy of React
  // would reset useId counters and collide labels across roots.
  const modulePath = (name) => {
    const url = new URL(name);
    return url.pathname + url.search;
  };
  const paths = performance.getEntriesByType("resource").map((r) => modulePath(r.name));
  const appMod = await pickEntry();
  if (!appMod?.PollApp) throw new Error("cannot import submission entry");
  const jsx = await resolveJsx(paths);
  const createRoot = await loadCreateRoot(pickClientPath(paths));
  const holder = document.createElement("div");
  holder.id = "teacher-second-root";
  document.body.appendChild(holder);
  createRoot(holder).render(jsx(appMod.PollApp));
};

// First root: records, a closed row hidden by the Open filter, votes,
// typed text, and a chosen poll, voter, and choice. The second root
// changes everything of its own; the first must not move.
const seedFirstRoot = async (first) => {
  await addPolls(first, [
    ["Lunch?", "Pizza, Sushi", "3"],
    ["Dinner?", "Tea, Coffee", "3"],
  ]);
  await voteAs(first, "Dinner?", "Bob", "Tea");
  await button(first, "Close Dinner?").click();
  await voteAs(first, "Lunch?", "Ann", "Pizza");
  await settle(
    () => voteRowsOf(first),
    [
      ["Dinner?", "Bob", "Tea"],
      ["Lunch?", "Ann", "Pizza"],
    ],
  );
  await button(first, "Open").click();
  await questionBox(first).fill("Kept");
  await limitBox(first).fill("9");
  await settle(() => questions(first), ["Lunch?"]);
};
const changeSecondRoot = async (second) => {
  assert.deepStrictEqual(await pollRowsOf(second), []);
  assert.deepStrictEqual(await voteRowsOf(second), []);
  assert.equal(await questionBox(second).inputValue(), "");
  assert.equal(await pollBox(second).inputValue(), "");
  await addPolls(second, [["Brunch?", "Eggs, Toast", "2"]]);
  await voteAs(second, "Brunch?", "Zed", "Eggs");
  await settle(() => voteRowsOf(second), [["Brunch?", "Zed", "Eggs"]]);
  await button(second, "Closed").click();
  await raiseBlankQuestion(second);
};
const firstUnmoved = async (first, lunchId) => {
  await settle(() => questions(first), ["Lunch?"]);
  assert.deepStrictEqual(await voteRowsOf(first), [
    ["Dinner?", "Bob", "Tea"],
    ["Lunch?", "Ann", "Pizza"],
  ]);
  assert.equal(await questionBox(first).inputValue(), "Kept");
  assert.equal(await limitBox(first).inputValue(), "9");
  assert.equal(await voterBox(first).inputValue(), "Ann");
  assert.equal(await pollBox(first).inputValue(), lunchId);
  assert.equal(await choiceBox(first).inputValue(), "Pizza");
  assert.equal(await alertText(first), "");
};

browser("browser two PollApps share nothing", async (page) => {
  try {
    await open(page);
    const first = page.locator("#root");
    await seedFirstRoot(first);
    const lunchId = await pollBox(first).inputValue();
    await page.evaluate(mountSecondRoot);
    const second = page.locator("#teacher-second-root");
    await pollsTable(second).waitFor();
    await changeSecondRoot(second);
    await firstUnmoved(first, lunchId);
    await button(first, "Undo").click();
    await settle(() => voteRowsOf(first), [["Dinner?", "Bob", "Tea"]]);
    assert.deepStrictEqual(await voteRowsOf(second), [["Brunch?", "Zed", "Eggs"]]);
    await seeAlert(second, "BlankQuestion");
    assert.equal(await questionBox(second).inputValue(), "   ");
    await settle(() => questions(second), []);
    return "records, text, selections, filter, notice, and undo separate";
  } finally {
    await page
      .evaluate(() => document.getElementById("teacher-second-root")?.remove())
      .catch(() => {});
  }
});

// No entry, no browser: fail every case on the load error instead of
// burning timeouts on a page that can never boot.
if (loadError) {
  for (const [name] of [...coreTests, ...browserTests])
    results.push({ name, pass: false, error: `load failed: ${loadError}`.slice(0, 300) });
  await vite.close();
  finish();
  process.exit(process.exitCode);
}
for (const [name, fn] of coreTests) await test(name, fn);
await vite.close();

const server = await createServer({
  root,
  cacheDir: "/tmp/teacher-ballot-browser",
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "@tinker/core", "@tinker/react"],
  },
  configFile: false,
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  logLevel: "silent",
});
let browserHandle;
try {
  await server.listen();
  browserHandle = await chromium.launch({ headless: true });
  const page = await browserHandle.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  for (const [name, fn] of browserTests) await test(name, () => fn(page));
} catch (error) {
  const message = (error?.message ?? String(error)).slice(0, 300);
  for (const [name] of browserTests) {
    if (!results.some((r) => r.name === name)) results.push({ name, pass: false, error: message });
  }
} finally {
  await browserHandle?.close();
  await server.close();
}

finish();
