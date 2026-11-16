// Reader: Duke. Words: what the app sees of two resources, A reads B.
type V = any;

const RES = ["A", "B"];

const made = (v: V): number[] => Array.from({ length: v.made }, (_, at) => at + 1);

const unfinished = (v: V) => made(v).filter((i) => !v.finished[i]);

const held = (v: V, i: number) => made(v).some((j) => v.needs[j].includes(i));

const canFinish = (v: V, i: number) => !v.finished[i] && v.end[i] !== "none" && !held(v, i);

const hookList = (v: V, i: number): number[] => Object.values(v.hooks[i] ?? {}) as number[];

/** A hook from a good build that ran with an end other than its release's or close's. */
function wrongEnd(v: V): boolean {
  return made(v).some((i) =>
    hookList(v, i).some((h) => {
      if (!v.hookOk[h] || v.runs[h] === 0) return false;
      const want = v.endBy[i] === "release" ? "released" : "close";
      return v.hookEnd[h] !== want;
    }),
  );
}

const mutual = (v: V) =>
  made(v).some((i) => v.needs[i].some((j: number) => v.needs[j].includes(i)));

function kept(v: V): boolean {
  const i = v.cur.A;
  return i !== 0 && v.failed[i];
}

function openPart(v: V): string {
  if (unfinished(v).some((i) => v.end[i] !== "none")) return "Released, an end waits";
  if (mutual(v)) return "A and B failed, each holds the other";
  if (v.node.A === "built") return "A built";
  if (kept(v)) return "A failed, its instance kept";
  return "A not built";
}

function closePart(v: V): string {
  if (unfinished(v).length === 0) return "Closed";
  if (!made(v).some((i) => canFinish(v, i))) return "Close hangs: A and B hold each other";
  return "Closing, ends run";
}

export const state = (v: V): string => {
  const base = v.closing ? closePart(v) : openPart(v);
  return wrongEnd(v) ? `${base}, a good build's hook got "failed"` : base;
};

export const group = (v: V): string => {
  if (!v.closing) return "open";
  return unfinished(v).length === 0 ? "closed" : "closing";
};

export const colors = { open: "blue", closing: "yellow", closed: "tan" };

export const title = "Two resources, A reads B (B may read A), both factories defer an end";

function resolved(from: V, to: V): string {
  if (to.node.A === "built") return "you resolve A: it builds";
  if (from.dep.B === "A" && from.node.B === "unbuilt") {
    return "you resolve A: CircularResource (B reads A)";
  }

  if (to.node.B === "built") return "you resolve A: A's factory throws";
  return "you resolve A: B's factory throws";
}

function released(from: V, to: V): string {
  const r = RES.find((x) => from.node[x] !== to.node[x] || from.cur[x] !== to.cur[x]) ?? "A";
  return `you release ${r}`;
}

function endsRun(from: V): string {
  return from.closing ? "an instance's ends run" : "the released ends run";
}

const SAID: Record<string, (from: V, to: V) => string> = {
  YouResolve: resolved,
  YouRelease: released,
  EndsRun: endsRun,
};

const LABEL: Record<string, string | null> = {
  YouClose: "you call close()",
  Done: null,
};

export const step = (action: string, from: V, to: V) => {
  const name = action.split("(")[0];
  if (Object.hasOwn(SAID, name)) return SAID[name](from, to);
  if (Object.hasOwn(LABEL, name)) return LABEL[name];
  return action;
};
