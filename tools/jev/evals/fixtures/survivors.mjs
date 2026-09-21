// Labeled fixtures for the survivors judge (RuleTester shape: one bad, two cleans).
// Each case is a full judge state: { file, unit, line, mutator, before, after, source }.
// Fixture sources avoid backticks so they stay plain template text.

const survivor = (line, mutator, before, after, source) => ({
  file: "packages/core/src/a.ts",
  unit: "operation#a",
  line,
  mutator,
  before,
  after,
  source: source.trim(),
});

export const SURVIVOR_CASES = {
  survivorMatters: {
    bad: survivor(
      7,
      "ConditionalExpression",
      "attempt < limit",
      "attempt <= limit",
      `
const a = operation({
  label: "retry",
  input: parseRetryInput,
  depends: { net: client.net },
  run: async (deps, ctx) => {
    const limit = ctx.input.retries;
    let attempt = 0;
    for (;;) {
      try {
        return await deps.net.send(ctx.input.body);
      } catch (e) {
        attempt += 1;
        if (attempt < limit) continue;
        throw e;
      }
    }
  },
});`,
    ),
    clean: survivor(
      3,
      "StringLiteral",
      '"saveIssue"',
      '""',
      `
const a = operation({
  label: "saveIssue",
  input: parseEditInput,
  depends: { tx: store.tx },
  run: async ({ tx }, { input, clock }) => {
    const rows = await tx.select().from(issueRows).where(eq(issueRows.id, input.id));
    const saved = parseIssue(rows[0]);
    checkFresh(saved, input.baseRevision);
    return saved;
  },
});`,
    ),
    clean2: survivor(
      9,
      "ConditionalExpression",
      "xs.length === 0",
      "xs.length < 1",
      `
const a = operation({
  label: "firstOf",
  input: parseListInput,
  depends: { cache: client.cache },
  run: ({ cache }, { input }) => {
    const xs = cache.readAll(input.tag);
    if (xs.length === 0) return null;
    const head = xs[0];
    return { id: head.id, title: head.title };
  },
});`,
    ),
  },
};
