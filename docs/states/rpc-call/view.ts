// Reader: Duke. Each chart state names where the two calls are, in the app's words.
type V = Record<string, any>;

function ended(v: V, c: number): string {
  if (v.ended[c] === "linkUnsent") {
    if (v.ran[c].includes(v.endAttempt[c])) return "failed as not sent, but the server ran it";
    if (v.msg[c] !== "none") return "failed as not sent, its frame still waits";
  }

  return v.ended[c] === "value" ? "got its reply" : "ended with a fault";
}

const stage = (v: V, c: number): string => {
  const p = v.phase[c];
  const m = v.msg[c];

  if (p === "idle") return "not called";
  if (p === "renewing" || p === "resending") return "waits for renew";
  if (p === "asking") return m === "queued" || m === "opening" ? "waits to go out" : "on the wire";
  return ended(v, c);
};

export const title = "rpc calls over one ws link";

const links: Record<string, string> = { none: "no link", opening: "link opening", up: "link up" };

export const state = (v: V): string => {
  const a = stage(v, 1);
  if (v.phase[2] === undefined) {
    // One call: name the link where it decides what happens next.
    const waits = a === "waits to go out" || a === "failed as not sent, its frame still waits";
    return waits ? `The call ${a}, ${links[v.link]}` : `The call ${a}`;
  }

  const b = stage(v, 2);
  if (a === b) return `Both calls: ${a}`;
  return [a, b].sort().join(" / ");
};

const moved = (from: V, to: V): number =>
  Object.keys(from.msg)
    .map(Number)
    .find((k) => from.msg[k] !== to.msg[k]) as number;

function answers(from: V, to: V): string {
  const c = moved(from, to);
  if (from.msg[c] === "stray") return "the server runs a lost frame";
  return to.reply[c] === "refused" ? "the server refuses" : "the server answers";
}

function arrives(from: V, to: V): string {
  const c = moved(from, to);
  if (to.phase[c] === "renewing") return "a refusal arrives, renew starts";
  if (to.ended[c] === "value") return "the reply arrives";
  if (to.ended[c] !== from.ended[c]) return "a fault arrives";
  return "a reply with no caller is dropped";
}

function renewEnds(_from: V, to: V): string {
  return to.renew === "idle" && Object.values(to.phase).includes("resending")
    ? "renew says yes"
    : "renew says no";
}

const SAID: Record<string, (from: V, to: V) => string> = {
  ServerAnswers: answers,
  ReplyArrives: arrives,
  RenewEnds: renewEnds,
};

const LABEL: Record<string, string | null> = {
  CallSent: "the app calls",
  FrameGoesOut: "the frame goes out",
  LinkOpens: "the link opens",
  LinkCloses: "the link closes",
  Resend: "the call is sent again, same id",
  Done: null,
};

export const step = (action: string, from: V, to: V): string | null => {
  if (Object.hasOwn(SAID, action)) return SAID[action](from, to);
  if (Object.hasOwn(LABEL, action)) return LABEL[action];
  return action;
};
