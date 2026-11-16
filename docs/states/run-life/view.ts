// Reader: Duke. Words: what the app sees of one run of `outer` that calls `inner`.
type V = any;

function innerPart(v: V): string {
  if (v.b !== "running") return "outer's body runs";
  if (v.sig) return "inner runs, its signal aborted, closing not";
  return "inner runs";
}

const RUN: Record<string, (v: V) => string> = {
  hook: () => "outer's run hook runs",
  body: innerPart,
  ended: () => "outer's body returned",
  done: () => "outer finished",
};

const SCOPE: Record<string, string> = {
  open: "",
  closing: ", scope closing",
  closed: ", scope closed",
};

function mark(v: V): string {
  return v.stale === "ran" && v.staleWhen === "closing" ? ", a finished run started inner" : "";
}

export const state = (v: V): string => `${RUN[v.a](v)}${SCOPE[v.lc]}${mark(v)}`;

export const group = (v: V): string => (v.lc === "open" ? "open" : v.lc);

export const colors = { open: "blue", closing: "yellow", closed: "tan" };

export const title = "One run of outer, with a run hook, that calls inner";

const NEXT: Record<string, string> = {
  once: "the hook calls next()",
  twice: "the hook calls next() twice",
  skip: "the hook returns without next()",
};

const CALL: Record<string, string> = {
  plain: "outer calls inner",
  signal: "outer calls inner with a signal",
  settle: "outer settles inner with a signal",
};

const END: Record<string, string> = {
  ok: "inner returns",
  panic: "inner throws a panic",
  managed: "inner throws a managed error",
  own: "inner rejects with its signal's reason",
  wrapped: "inner rejects with a wrapped reason",
};

function calls(_from: V, to: V): string {
  return to.preAborted ? `${CALL[to.kind]} [signal already aborted]` : CALL[to.kind];
}

function leaked(_from: V, to: V): string {
  return to.stale === "ran"
    ? "code calls the leaked deps.inner: it runs"
    : "code calls the leaked deps.inner: Disposed";
}

const SAID: Record<string, (from: V, to: V) => string> = {
  HookRuns: (_from, to) => NEXT[to.mode],
  CallsInner: calls,
  InnerEnds: (_from, to) => END[to.bOut],
  LeakedSubflowCalled: leaked,
};

const LABEL: Record<string, string | null> = {
  CallerAbortsSignal: "the caller aborts inner's signal",
  OuterBodyReturns: "outer's body catches and returns",
  OuterFinishes: "outer's defers run, the run ends",
  AppClosesGracefully: "the app calls close({ graceful: true })",
  CloseEnds: "the close drains and seals the scope",
  Done: null,
};

export const step = (action: string, from: V, to: V): string | null => {
  const name = action.split("(")[0];
  if (Object.hasOwn(SAID, name)) return SAID[name](from, to);
  if (Object.hasOwn(LABEL, name)) return LABEL[name];
  return action;
};
