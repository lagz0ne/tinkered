// Labeled fixtures for the lint + guide bank (ESLint RuleTester shape: one bad, one clean per
// judge; one case per guide option). A fixture is a Jev state: { kind, name, source } or
// { description }. Fixture sources avoid backticks so they stay plain template text.

const unit = (kind, name, source) => ({ kind, name, source: source.trim() });

export const JUDGE_CASES = {
  runForwardsToClosure: {
    bad: unit(
      "operation",
      "saveIssue",
      `
const saveIssue = operation({
  label: "saveIssue",
  input: parseEditInput,
  depends: { tx: store.tx },
  run: (deps, ctx) => saveIssueImpl(deps.tx, ctx),
});`,
    ),
    clean: unit(
      "operation",
      "saveIssue",
      `
const saveIssue = operation({
  label: "saveIssue",
  input: parseEditInput,
  depends: { tx: store.tx },
  run: async ({ tx }, { input, clock }) => {
    const rows = await tx.select().from(issueRows).where(eq(issueRows.id, input.id));
    const saved = parseIssue(rows[0]);
    checkFresh(saved, input.baseRevision);
    const updated = applyEdit(saved, input, clock.currentTimeMillis());
    await tx.update(issueRows).set(updated).where(eq(issueRows.id, updated.id));
    return updated;
  },
});`,
    ),
  },
  effectWithoutDefer: {
    bad: unit(
      "resource",
      "ticker",
      `
const ticker = resource({
  label: "ticker",
  factory: () => {
    const id = setInterval(() => tick(), 1000);
    return { stop: () => clearInterval(id) };
  },
});`,
    ),
    clean: unit(
      "resource",
      "ticker",
      `
const ticker = resource({
  label: "ticker",
  factory: (_deps, { defer }) => {
    const id = setInterval(() => tick(), 1000);
    defer(() => clearInterval(id));
    return {};
  },
});`,
    ),
  },
  stateOutsideCell: {
    bad: unit(
      "resource",
      "selection",
      `
const selection = resource({
  label: "selection",
  factory: () => {
    let selectedId: string | null = null;
    const listeners = new Set<(id: string | null) => void>();
    return {
      select: (id: string) => {
        selectedId = id;
        for (const l of listeners) l(id);
      },
      current: () => selectedId,
      onChange: (l: (id: string | null) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
  },
});`,
    ),
    clean: unit(
      "operation",
      "selectIssue",
      `
const selectedId = data<string | null>({ label: "selectedId", initial: null });
const selectIssue = operation({
  label: "selectIssue",
  depends: { selected: selectedId.controller },
  run: ({ selected }, { input }: { input: string }) => selected.set(input),
});`,
    ),
  },
  configNotTag: {
    bad: unit(
      "resource",
      "api",
      `
const api = resource({
  label: "api",
  factory: () => {
    const baseUrl = process.env.API_URL ?? "http://localhost:3000";
    return { list: () => fetch(baseUrl + "/api/issues").then((r) => r.json()) };
  },
});`,
    ),
    clean: unit(
      "resource",
      "api",
      `
const apiConfig = tag<{ baseUrl: string }>({ label: "apiConfig" });
const api = resource({
  label: "api",
  depends: { config: apiConfig },
  factory: ({ config }) => ({
    list: () => fetch(config.baseUrl + "/api/issues").then((r) => r.json()),
  }),
});`,
    ),
  },
  handRolledLifetime: {
    bad: unit(
      "resource",
      "saver",
      `
const saver = resource({
  label: "saver",
  factory: () => {
    let tail: Promise<void> = Promise.resolve();
    let closed = false;
    const waiters = new Map<string, () => void>();
    return {
      save: (id: string, body: () => Promise<void>) => {
        if (closed) return tail;
        tail = tail.then(body).then(() => waiters.get(id)?.());
        return tail;
      },
      close: () => {
        closed = true;
        return tail;
      },
    };
  },
});`,
    ),
    clean: unit(
      "resource",
      "saver",
      `
const saver = resource({
  label: "saver",
  depends: { tx: store.tx },
  factory: ({ tx }, { signal, defer }) => {
    defer((end) => {
      if (end.status !== "success") tx.rollback();
    });
    return {
      save: (row: Issues.Issue) => {
        signal.throwIfAborted();
        return tx.insert(issueRows).values(row);
      },
    };
  },
});`,
    ),
  },
  stopOnlyInDefer: {
    bad: unit(
      "operation",
      "drain",
      `
const drain = operation({
  label: "drain",
  depends: { inbox },
  run: async ({ inbox }, { defer }) => {
    let stop = false;
    defer(() => {
      stop = true;
    });
    while (!stop) await inbox.next();
  },
});`,
    ),
    clean: unit(
      "operation",
      "drain",
      `
const drain = operation({
  label: "drain",
  depends: { inbox },
  run: async ({ inbox }, { signal }) => {
    while (!signal.aborted) await inbox.next(signal);
  },
});`,
    ),
  },
  ignoresAbortAfterAwait: {
    bad: unit(
      "resource",
      "cache",
      `
const cache = resource({
  label: "cache",
  depends: { db },
  factory: async ({ db }, { defer }) => {
    const rows = await db.select().from(issueRows);
    const stream = await db.subscribe(issueRows);
    defer(() => stream.close());
    return { rows, stream };
  },
});`,
    ),
    clean: unit(
      "resource",
      "cache",
      `
const cache = resource({
  label: "cache",
  depends: { db },
  factory: async ({ db }, { defer, signal }) => {
    const rows = await db.select().from(issueRows);
    signal.throwIfAborted();
    const stream = await db.subscribe(issueRows, { signal });
    defer(() => stream.close());
    return { rows, stream };
  },
});`,
    ),
  },
};

// React judges: components cut to the tracker's shapes (kind "component").
export const REACT_CASES = {
  readsMoreThanRendered: {
    bad: unit(
      "component",
      "IssueTitle",
      `
function IssueTitle({ id }: { id: string }) {
  const issues = useData(issueList);
  const issue = issues.find((i) => i.id === id);
  return <h2>{issue?.title ?? "…"}</h2>;
}`,
    ),
    clean: unit(
      "component",
      "IssueTitle",
      `
function IssueTitle({ id }: { id: string }) {
  const title = useData(issueList, (list) => list.find((i) => i.id === id)?.title ?? "…");
  return <h2>{title}</h2>;
}`,
    ),
    clean2: unit(
      "component",
      "IssueForm",
      `
function IssueForm() {
  const draft = useData(newIssue);
  const type = useRun(typeNewIssue);
  return (
    <form>
      <input value={draft.title} onChange={(e) => type.run({ input: { title: e.target.value } })} />
      <textarea
        value={draft.description}
        onChange={(e) => type.run({ input: { description: e.target.value } })}
      />
    </form>
  );
}`,
    ),
  },
  subscribesToWriteOnly: {
    bad: unit(
      "component",
      "ClearDraft",
      `
function ClearDraft() {
  const [, setDraft] = useData(commentDraft, { writable: true });
  return (
    <button type="button" onClick={() => setDraft("")}>
      Clear
    </button>
  );
}`,
    ),
    clean: unit(
      "component",
      "ClearDraft",
      `
function ClearDraft() {
  const draft = useController(commentDraft);
  return (
    <button type="button" onClick={() => draft.set("")}>
      Clear
    </button>
  );
}`,
    ),
  },
  runDuringRender: {
    bad: unit(
      "component",
      "DetailPane",
      `
function DetailPane({ id }: { id: string }) {
  const load = useRun(loadDetail);
  load.run({ input: id });
  const shown = useData(detail);
  return <pre>{JSON.stringify(shown)}</pre>;
}`,
    ),
    clean: unit(
      "component",
      "DetailPane",
      `
function DetailPane({ id }: { id: string }) {
  const load = useRun(loadDetail);
  const shown = useData(detail);
  return (
    <div>
      <button type="button" onClick={() => load.run({ input: id })}>
        Load
      </button>
      <pre>{JSON.stringify(shown)}</pre>
    </div>
  );
}`,
    ),
  },
  domainLogicInRender: {
    bad: unit(
      "component",
      "EditForm",
      `
function EditForm() {
  const draft = useData(editDraft);
  const issues = useData(issueList);
  const saved = issues.find((i) => i.id === draft?.id);
  const conflict = saved !== undefined && draft !== null && saved.revision !== draft.baseRevision;
  const save = useRun(saveEdit);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!conflict) save.run({ input: draft });
      }}
    >
      {conflict ? <p role="alert">Someone else saved this issue. Reload before saving.</p> : null}
      <button type="submit" disabled={conflict}>
        Save
      </button>
    </form>
  );
}`,
    ),
    clean: unit(
      "component",
      "EditForm",
      `
function EditForm() {
  const draft = useData(editDraft);
  const notice = useData(editNotice);
  const save = useRun(saveEdit);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.run({ input: draft });
      }}
    >
      {notice ? <p role="alert">{notice.text}</p> : null}
      <button type="submit" disabled={save.isPending}>
        Save
      </button>
    </form>
  );
}`,
    ),
  },
  effectOwnedByComponent: {
    bad: unit(
      "component",
      "ReloadButton",
      `
function ReloadButton() {
  const list = useController(issueList);
  return (
    <button
      type="button"
      onClick={async () => {
        const res = await fetch("/api/issues");
        list.set(await res.json());
      }}
    >
      Reload
    </button>
  );
}`,
    ),
    clean: unit(
      "component",
      "ReloadButton",
      `
function ReloadButton() {
  const reload = useRun(reloadIssues);
  return (
    <button type="button" onClick={() => reload.run()} disabled={reload.isPending}>
      Reload
    </button>
  );
}`,
    ),
  },
};

export const UNIT_CASES = [
  { expect: "data", state: { description: "the title the user is typing in the new-issue form" } },
  {
    expect: "resource",
    state: { description: "keep one EventSource open to the server and reconnect when it drops" },
  },
  {
    expect: "operation",
    state: { description: "create an issue from a POST body, save it, and return the saved row" },
  },
  {
    expect: "tag",
    state: { description: "the base URL of the API, different in tests and in production" },
  },
  {
    expect: "glue",
    state: { description: "compute the next revision number from the saved issue and the edit" },
  },
  { expect: "resource", state: JUDGE_CASES.effectWithoutDefer.clean },
  {
    expect: "view",
    state: {
      description: "show the open issues as a list and let the user click one to select it",
    },
  },
  { expect: "view", state: REACT_CASES.readsMoreThanRendered.clean },
  {
    expect: "glue",
    state: unit(
      "function",
      "applyEdit",
      `
function applyEdit(saved: Issues.Issue, input: Issues.EditInput, now: number): Issues.Issue {
  return {
    ...saved,
    title: input.title ?? saved.title,
    status: input.status ?? saved.status,
    revision: saved.revision + 1,
    updatedAt: now,
  };
}`,
    ),
  },
];

export const TARGET_CASES = [
  {
    expect: "scope",
    state: { description: "a PGlite database opened once for the whole process" },
  },
  { expect: "session", state: { description: "a database transaction for one HTTP request" } },
];

export const DEFER_CASES = {
  bad: { description: "open a websocket to the server and push each message into a cell" },
  clean: { description: "sum the estimates of the open issues" },
};
