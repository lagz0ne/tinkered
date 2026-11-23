// Words for Duke: a client's keyed parts A and B on the key "tasks"
// (ADR 0136-0139), and the key's one fault in board.faults.
type V = any;

const STATUS: Record<string, string> = {
  pending: "Pending",
  ready: "Ready",
  refused: "Refused",
  link: "Link fault",
};

const STREAM: Record<string, string> = {
  opening: "stream opening",
  open: "watching",
  backoff: "stream retries soon",
  parked: "no stream, waits for a trigger",
};

const KEY_FAULT: Record<string, string> = {
  none: "No fault",
  refused: "refused",
  link: "link",
};

function awaited(v: V, p: string): string {
  return v.invAt[p] > 0 ? ", your invalidate waits" : "";
}

function partLabel(v: V, p: string): string {
  if (v.status[p] === "none") return "Not read";
  return `${STATUS[v.status[p]]}, ${STREAM[v.stream[p]]}${awaited(v, p)}`;
}

// member.cfg reads part A alone, so only the parts in the spec show.
export const state = (v: V) => ({
  ...Object.fromEntries(Object.keys(v.status).map((p) => [`Part ${p}`, partLabel(v, p)])),
  "board.faults.tasks": KEY_FAULT[v.keyFault],
});

export const title = "Two parts of one keyed board (ADR 0136-0139): A and B on tasks";

const LABEL: Record<string, string | null> = {
  ReaderReads: "a reader reads the part",
  ReaderLeaves: "a reader leaves",
  StreamOpens: "the stream opens",
  StreamRefused: "the server refuses the stream",
  ServerSignals: "the server signals: an ask goes out",
  ServerSignalsMember: "the server signals one member: an ask for it goes out",
  YouInvalidate: "you invalidate the part",
  InvalidateReturns: "your invalidate returns",
  AskAnswered: "an answer comes",
  AskRefused: "the ask is refused",
  LinkDrops: "the link drops",
  AskLinkFault: "an ask fails: link",
  StreamLinkFault: "the stream fails: link",
  LinkReturns: "the link returns",
  StreamRetries: "the stream retries",
};

export const step = (action: string) => {
  const name = action.split("(")[0];
  return Object.hasOwn(LABEL, name) ? LABEL[name] : action;
};
