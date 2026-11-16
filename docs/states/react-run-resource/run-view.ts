// Words for Duke: one component with useRun(op), async runs.
// success and error act the same here, so they share a label.
type V = any;

const STATUS: Record<string, string> = {
  idle: "idle",
  pending: "pending",
  success: "success or error",
  error: "success or error",
};

const busy = (v: V) => v.flight.length > 0;

// An older run still in flight changes nothing the reader sees here.
const shown = (v: V) => `Shown: ${STATUS[v.status]}`;

export const state = (v: V) => {
  if (!v.mounted) return busy(v) ? "Unmounted, a run in flight" : "Unmounted";
  if (v.live) return shown(v);
  return busy(v) ? "Hidden by Suspense, a run in flight" : "Hidden by Suspense";
};

export const group = (v: V) => (v.mounted ? (v.live ? "shown" : "hidden") : "gone");
export const colors = { shown: "blue", hidden: "tan", gone: "purple" };
export const title = "useRun: one component, async runs (ADR 0032)";

const LABEL: Record<string, string | null> = {
  Attach: "the layout effect runs (mount or show)",
  YouRun: "you run",
  YouReset: "you reset",
  SuspenseHides: "a Suspense above hides it",
  Unmount: "it unmounts",
  Done: null,
};

export const step = (action: string) => {
  if (action.startsWith("RunSettles")) return "a run settles";
  return Object.hasOwn(LABEL, action) ? LABEL[action] : action;
};
