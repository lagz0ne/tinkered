// Words for Duke. The round of ADR 0152: one scope, cells A and B,
// watchers a1 and a2 on A, b1 on B.
type V = any;

const CELL_OF: Record<string, string> = { a1: "A", a2: "A", b1: "B" };

const missed = (v: V) =>
  Object.keys(v.heard).some((w) => v.heard[w] !== v.val[CELL_OF[w]] && !v.excused.includes(w));

function restLabel(v: V): string {
  if (!v.inRound) return "Nothing runs";
  if (missed(v)) return "Round flag stuck on: a watcher missed a write";
  return "Round flag stuck on, nothing runs";
}

const firstRound = (v: V) => v.depth === 0 && !(v.phase === "next" && v.waiting.length > 0);

function roundLabel(v: V): string {
  const base = firstRound(v) ? "A write's round: its watchers hear it" : "Waiting rounds run";
  return v.failed === "none" ? base : `${base}, an error is held`;
}

export const state = (v: V) => (v.phase === "rest" ? restLabel(v) : roundLabel(v));

export const group = (v: V) => {
  if (v.phase !== "rest") return "round";
  return v.inRound ? "stuck" : "rest";
};

export const colors = { rest: "blue", round: "yellow", stuck: "tan" };

export const title = "A write in a round waits for the round (ADR 0152): cells A and B";

function ends(_from: V, to: V): string {
  return to.outcome === "ok"
    ? "the last round ends: the write returns"
    : "the last round ends: the write throws the first error";
}

function eqThrows(from: V): string {
  const first = from.cur.d === 0 && !from.cur.cold;
  return first ? "the cell's eq throws [first round of a write]" : "the cell's eq throws [caught]";
}

const SAID: Record<string, (from: V, to: V) => string> = {
  RoundsEnd: ends,
  EqThrows: eqThrows,
};

const LABEL: Record<string, string | null> = {
  YouWrite: "you write a cell",
  YouRelease: "you release a cell",
  ReaderBuildWrites: "a reader's build writes a cell: WriteInRead",
  EqSame: "no change since the last telling",
  EqDiffers: "the value changed: the round tells",
  WatcherHears: "a watcher hears the write",
  WatcherWrites: "a watcher writes the other cell: its round waits",
  WatcherThrows: "a watcher throws",
  RoundTold: "every watcher of the round heard it",
  NextRound: "the next waiting round runs",
  TooDeep: "a round past the limit: UpdateDepth",
  Done: null,
};

export const step = (action: string, from: V, to: V) => {
  const name = action.split("(")[0];
  if (Object.hasOwn(SAID, name)) return SAID[name](from, to);
  if (Object.hasOwn(LABEL, name)) return LABEL[name];
  return action;
};
