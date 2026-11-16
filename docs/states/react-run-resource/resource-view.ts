// Words for Duke: one component reads one resource with useResource.
type V = any;

const VIEW: Record<string, string> = {
  blank: "Not rendered yet",
  fallback: "Fallback shows",
  value: "Value shows",
  boundary: "Error boundary shows",
  pending: "status pending",
  success: "status success",
  error: "status error",
};

const BUILD: Record<string, string> = {
  none: "",
  pending: "",
  ok: "",
  failed: ", build failed (kept)",
};

const viewLabel = (v: V) => `${VIEW[v.view]}${v.mode === "suspense" ? BUILD[v.b] : ""}`;

export const state = (v: V) => viewLabel(v);

export const group = (v: V) => v.mode;
export const colors = { suspense: "teal", query: "blue" };
export const title = "useResource: one component, one resource (ADR 0032)";

const LABEL: Record<string, string | null> = {
  FirstRender: "it renders: a new build",
  ReactRetries: "React renders it again",
  YouRefetch: "you refetch: a new build",
  YouRelease: "you release (useRelease)",
  YouResetBoundary: "you reset the error boundary",
  ScopeChanges: "the scope changes: it mounts again",
  OldBuildSettles: null,
};

const SETTLED: Record<string, string> = {
  ok: "the build resolves",
  failed: "the build fails",
};

export const step = (action: string, _from: V, to: V) => {
  if (action.startsWith("BuildSettles")) return SETTLED[to.b];
  return Object.hasOwn(LABEL, action) ? LABEL[action] : action;
};
