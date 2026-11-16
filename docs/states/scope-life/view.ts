// Reader: Duke. Words: what the app sees on the root handle.
type V = Record<string, any>;

const reasons: Record<string, string> = {
  signal: "the signal's reason",
  closing: "the closing reason",
  error: "the start error",
  timeout: "StartTimeout",
};

export const title = "A root with a stop signal and two capsules that listen after next()";

function open(v: V): string {
  if (v.ready === "resolved") return "Ready, both ports open";
  if (v.halt) return "Stop signal fired, a start hook still runs";
  return "Starting";
}

function closedAs(v: V): string {
  // A path where the signal came first shows what ready got; other ends show only the Result.
  if (v.firstStop !== "signal" || (v.closed === "cancelled" && v.readyReason === "signal")) {
    return `Closed: ${v.closed}`;
  }

  return `Closed: ${v.closed}, ready rejected with ${reasons[v.readyReason]}, after the stop signal`;
}

export const state = (v: V): string => {
  if (v.chain === "notStarted") {
    return v.preAborted ? "Not started, signal already aborted" : "Not started";
  }

  if (v.closeState === "none") return open(v);
  if (v.closeState !== "done") {
    return v.closeMode === "forced" ? "Closing, forced" : "Closing, graceful";
  }

  return closedAs(v);
};

export const group = (v: V): string => {
  if (v.closeState === "done") return "closed";
  if (v.closeState !== "none") return "closing";
  if (v.ready === "resolved") return "open";
  return "starting";
};

export const colors = { starting: "blue", open: "teal", closing: "yellow", closed: "tan" };

const SAID: Record<string, (to: V) => string> = {
  ScopeStarts: (to) =>
    to.chain === "settled" ? "the scope starts, no hook runs" : "the scope starts",
  Hook1CallsNext: (to) =>
    to.h1 === "out" ? "a hook calls next(), it rejects" : "capsule 1 calls next()",
  Hook2CallsNext: (to) =>
    to.h2 === "out" ? "a hook calls next(), it rejects" : "capsule 2 calls next(), both listen",
  UserCloses: (to) =>
    to.closeMode === "forced" ? "the app calls close()" : "the app calls close({ graceful })",
};

const LABEL: Record<string, string | null> = {
  HookThrows: "a start hook throws",
  StartTimesOut: "the start times out",
  SignalAborts: "the stop signal fires",
  CloseHookRuns: "a close hook runs",
  ScopeCloses: "the close hooks ran, the scope closes",
  Done: null,
};

export const step = (action: string, _from: V, to: V): string | null => {
  if (Object.hasOwn(SAID, action)) return SAID[action](to);
  if (Object.hasOwn(LABEL, action)) return LABEL[action];
  return action;
};
