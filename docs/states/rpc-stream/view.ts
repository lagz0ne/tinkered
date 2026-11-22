// Words for Duke: one rpc stream call and its reader's for-await loop.
type V = any;

const PATH: Record<string, string> = {
  remote: "Call to a server",
  here: "Call run here (implement)",
};

const GOT: Record<string, string> = {
  clean: "Loop ended clean",
  link: "Loop threw link",
  failed: "Loop threw failed",
  abort: "Loop threw AbortError",
};

/** Shown on every call with a signal or tags: before ADR 0169 a call run here waited there. */
const waiting = (v: V) =>
  v.hasSignal || v.hasTags ? "Call sent, with a signal or tags" : "Call sent";

const reading = (v: V) => (v.src === "running" ? "Reading" : "Reading, the op stopped");

function inner(v: V): string {
  if (v.call === "pending") return waiting(v);
  if (v.reader === "left") return "Reader left (break)";
  if (v.reader === "ended" || v.reader === "threw") return GOT[v.got];
  return reading(v);
}

export const state = (v: V) => [PATH[v.path], inner(v)];

export const group = (v: V) => v.path;
export const colors = { remote: "blue", here: "teal" };
export const title = "An rpc stream call and its reader (ADR 0133, ADR 0169)";

const LABEL: Record<string, string | null> = {
  CallAnswers: "the call answers",
  OpSends: "the op sends a value",
  OpEnds: "the op ends",
  ReaderGetsValue: "the loop gets a value",
  ReaderLoopEnds: "the loop reaches the end",
  ReaderBreaks: "the reader breaks",
  SignalAborts: "the caller's signal aborts",
  LinkCloses: "the link closes",
  Done: null,
};

export const step = (action: string) => (Object.hasOwn(LABEL, action) ? LABEL[action] : action);
