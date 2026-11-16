// Words for Duke. One keyed resource, keys A and B, two readers.
type V = any;

const entries = (v: V) => Object.keys(v.ekey).filter((e) => v.ekey[e] !== "None");

const readers = (v: V) => Object.keys(v.rs);

const live = (v: V, e: string) =>
  v.watchers[e].length > 0 || readers(v).some((r) => v.rs[r] === "rendered" && v.rat[r] === e);

const busy = (v: V) => v.bld !== "None" || v.drain.length > 0 || v.wake.length > 0;

const readersOf = (v: V, k: string) =>
  readers(v).filter(
    (r) => ["rendered", "live"].includes(v.rs[r]) && v.rat[r] !== "None" && v.ekey[v.rat[r]] === k,
  );

const building = (v: V) => v.bld !== "None" && v.drain.length === 0;

function twoEntries(v: V): boolean {
  return Object.keys(v.map).some(
    (k) => entries(v).filter((e) => v.ekey[e] === k && live(v, e)).length > 1,
  );
}

function endWaitsNoReader(v: V): boolean {
  return (
    !busy(v) &&
    Object.keys(v.map).some(
      (k) =>
        readersOf(v, k).length === 0 && entries(v).some((e) => v.ekey[e] === k && v.ends[e] > 0),
    )
  );
}

function buildBeforeEnd(v: V): boolean {
  if (!building(v)) return false;

  const k = v.ekey[v.bld.e];
  return entries(v).some((e) => e !== v.bld.e && v.ekey[e] === k && v.ends[e] > 0);
}

function heldDropped(v: V): boolean {
  return readers(v).some((r) => {
    const e = v.rat[r];
    return ["rendered", "left"].includes(v.rs[r]) && e !== "None" && v.map[v.ekey[e]] !== e;
  });
}

function readerPart(v: V): string {
  if (readers(v).some((r) => v.rs[r] === "live")) return "a reader watches";
  if (readers(v).some((r) => v.rs[r] === "rendered")) return "a reader rendered, not subscribed";
  return "no reader";
}

function entryPart(v: V): string[] {
  if (twoEntries(v)) return ["one key has two entries"];
  if (heldDropped(v)) return ["a reader holds an entry the scope dropped"];
  return [];
}

function buildPart(v: V): string[] {
  if (!building(v)) return [];

  const by = v.bld.by === "reader" ? "a reader started it" : "the source changed";
  if (v.bld.noChange) return [`a build runs with no change (${by})`];
  if (buildBeforeEnd(v)) return [`a build runs while the other entry's end waits (${by})`];
  return [`a build runs (${by})`];
}

function endPart(v: V): string[] {
  const drain = v.drain.length > 0 ? ["ends run"] : [];
  if (v.closed && !busy(v) && entries(v).some((e) => v.ends[e] > 0)) {
    return [...drain, "an end never runs"];
  }

  if (endWaitsNoReader(v)) return [...drain, "an end waits with no reader"];
  return drain;
}

export const state = (v: V) => {
  const parts = [
    ...(v.closed ? ["Scope closed"] : []),
    readerPart(v),
    ...entryPart(v),
    ...buildPart(v),
    ...endPart(v),
  ];
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const group = (v: V) =>
  v.closed ? "closed" : v.bld !== "None" ? "building" : v.drain.length > 0 ? "ending" : "reading";

export const colors = { reading: "blue", building: "yellow", ending: "purple", closed: "tan" };

export const title =
  "A resource with config is keyed (ADR 0157): one resource, keys A and B, two readers";

function renders(from: V, to: V): string {
  const made = Object.keys(to.map).some((k) => from.map[k] === "None" && to.map[k] !== "None");
  return made
    ? "a reader renders the key [no entry: a new one]"
    : "a reader renders the key [the entry is there]";
}

function subscribes(from: V, to: V): string {
  const r = Object.keys(from.rs).find(
    (r) =>
      ["rendered", "left"].includes(from.rs[r]) &&
      (to.rs[r] !== from.rs[r] || (to.bld !== "None" && to.bld.sub === r)),
  );
  const again = r !== undefined && from.rs[r] === "left";
  const base = again
    ? "the reader that left subscribes again (StrictMode)"
    : "the reader subscribes";
  return from.closed ? `${base} [after the scope closed]` : base;
}

function writes(from: V): string {
  return from.bld.by === "reader"
    ? "the build writes a cell: WriteInRead, it throws"
    : "the build writes a cell";
}

const SAID: Record<string, (from: V, to: V) => string> = {
  ReaderRenders: renders,
  ReaderSubscribes: subscribes,
  BuildWritesCell: writes,
};

const LABEL: Record<string, string | null> = {
  ReaderLeaves: "a reader leaves",
  SourceChanges: "the source changes",
  EntryWakes: "the change wakes an entry",
  EndRuns: "an end runs",
  BuildFinishes: "the build finishes",
  BuildThrows: "the build throws",
  ScopeCloses: "the scope closes",
  Done: null,
};

export const step = (action: string, from: V, to: V) => {
  const name = action.split("(")[0];
  if (Object.hasOwn(SAID, name)) return SAID[name](from, to);
  if (Object.hasOwn(LABEL, name)) return LABEL[name];
  return action;
};
