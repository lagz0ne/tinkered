// Reader's words for the useData scope chart.
type V = {
  given: string;
  child: string;
  held: string;
  lastRead: string;
  result: string;
  closed: string[];
  due: boolean;
};

export const title = "useData holds its scope, and a new scope mounts the subtree again";

const open = (v: V) => (v.closed.includes(v.given) ? "its scope closed" : "its scope open");

export const state = (v: V): string => {
  if (v.given === "none") return "No scope given yet";
  if (v.child === "fresh") return "A new scope: the child mounts again";
  if (v.child === "failed") return "The child raised Disposed";
  return open(v) === "its scope open"
    ? "The child shows data"
    : "The child shows data from before its scope closed";
};

export const group = (v: V): string =>
  v.child === "failed"
    ? "error"
    : v.child === "fresh"
      ? "mount"
      : v.given === "none"
        ? "start"
        : "ok";

export const colors = { start: "tan", mount: "purple", ok: "teal", error: "orange" };

function gives(from: V, to: V): string {
  if (from.given === "none") return "the provider gives a scope";
  return to.given !== from.given
    ? "the provider gives another scope"
    : "the provider renders with the same scope";
}

function renders(from: V, to: V): string {
  if (to.result === "Disposed") return "the child renders and its scope is closed";
  return from.child === "fresh" ? "the child renders the first time" : "the child renders again";
}

function closes(_from: V, to: V): string {
  return to.closed.includes(to.given) ? "the given scope closes" : "an old scope closes";
}

const SAID: Record<string, (from: V, to: V) => string> = {
  ProviderGives: gives,
  ChildRenders: renders,
  ScopeCloses: closes,
};

export const step = (action: string, from: V, to: V): string | null =>
  Object.hasOwn(SAID, action) ? SAID[action](from, to) : action;
