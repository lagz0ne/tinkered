// Reader: Duke. Words: what the app sees of a root, its session, and a grandchild.
type V = any;

const LAYER_NAME: Record<string, string> = { R: "root", S: "session", G: "grandchild" };

const ROOT: Record<string, (v: V) => string> = {
  open: () => "Root open",
  hooks: () => "Root close hook runs",
  closing: (v) => `Root closing (${v.md.R})`,
  closed: (v) => `Root closed: ${v.res.R}`,
};

function sessionPart(v: V): string {
  if (v.cl.S === "closed") return "session closed";
  if (v.body.S === "run") return v.cl.G === "open" ? "both bodies run" : "session body runs";
  return "session closing";
}

function marks(v: V): string {
  if (v.late) return ", late onClose taken";
  if (v.cl.R === "closed" && v.hookRuns === 0) return ", close hook skipped";
  if (v.md.R !== "none" && v.md.R !== v.firstAsk) return ", graceful turned forced";
  return "";
}

export const state = (v: V): string => `${ROOT[v.cl.R](v)}, ${sessionPart(v)}${marks(v)}`;

export const group = (v: V): string => {
  if (v.cl.R === "closed") return "closed";
  return v.cl.R === "open" ? "open" : "closing";
};

export const colors = { open: "blue", closing: "yellow", closed: "tan" };

export const title = "A root with a close hook, a session, and a grandchild";

/** The one layer whose field changed in the step. */
function changed(from: V, to: V, field: string): string {
  return ["G", "S", "R"].find((l) => from[field][l] !== to[field][l]) ?? "R";
}

function bodyEnds(from: V, to: V): string {
  const l = changed(from, to, "body");
  const how: Record<string, string> = {
    ok: "returns",
    threw: "throws",
    cancelled: "stops on its signal",
  };
  return `the ${LAYER_NAME[l]} body ${how[to.body[l]]}`;
}

function drain(from: V, to: V): string {
  const l = changed(from, to, "cl");
  if (l === "S" && to.reenter && from.cl.R !== to.cl.R) {
    return "the session's defer calls root.close()";
  }
  return `the ${LAYER_NAME[l]}'s defers run`;
}

function appCloses(_from: V, to: V): string {
  return to.firstAsk === "graceful"
    ? "the app calls root.close({ graceful: true })"
    : "the app calls root.close()";
}

function reaches(from: V, to: V): string {
  return `the close reaches the ${LAYER_NAME[changed(from, to, "cl")]}`;
}

const SAID: Record<string, (from: V, to: V) => string> = {
  BodyEnds: bodyEnds,
  Drain: drain,
  AppClosesRoot: appCloses,
  CloseReachesChild: reaches,
};

const LABEL: Record<string, string | null> = {
  BodyOpensGrandchild: "the session body opens a grandchild",
  BodyClosesItsSession: "the session body calls close() on itself",
  CloseHookRuns: "the close hook calls next()",
  AbortLands: "the forced close aborts the subtree",
  LeakedHandleOnClose: "code calls onClose on the leaked handle",
  Done: null,
};

export const step = (action: string, from: V, to: V): string | null => {
  const name = action.split("(")[0];
  if (Object.hasOwn(SAID, name)) return SAID[name](from, to);
  if (Object.hasOwn(LABEL, name)) return LABEL[name];
  return action;
};
