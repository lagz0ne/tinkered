// Words for Duke: one plain (not keyed) key of a reading root.
// A link fault and no fault act the same here, so they share a label.
type V = any;

const PHASE: Record<string, string> = {
  opening: "Stream opening",
  reading: "Reading values",
  sleeping: "Waits, then opens again",
};

export const state = (v: V) => {
  if (v.phase === "stopped") return "Stopped (root closed)";
  const refused = v.keyFault === "refused" ? ", key shows refused" : "";
  return `${PHASE[v.phase]}${refused}`;
};

export const title = "A plain key's stream on a reading root (ADR 0140)";

const LABEL: Record<string, string | null> = {
  StreamOpens: "the stream opens",
  ValueComes: "a value comes",
  StreamEnds: "the stream ends or the link breaks",
  SleepEnds: "the wait ends: it opens again",
  RootCloses: "the root closes",
  Done: null,
};

export const step = (action: string, _from: V, to: V) => {
  if (action.startsWith("StreamFails")) {
    return to.keyFault === "refused" ? "the server refuses it" : LABEL.StreamEnds;
  }
  return Object.hasOwn(LABEL, action) ? LABEL[action] : action;
};
