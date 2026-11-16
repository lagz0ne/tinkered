// Reader's words for the SessionProvider + Suspense + StrictMode chart.
type V = {
  mounted: boolean;
  shown: string;
  eff: string;
  replay: boolean;
  owned: number;
  renderDue: boolean;
  build: Record<string, string>;
};

const data = (v: V) => (v.owned === 0 ? "none" : v.build[v.owned]);

export const title = "SessionProvider inside Suspense, under StrictMode";

function replayed(v: V): string {
  return data(v) === "ready"
    ? "Child shows, StrictMode replays the effect"
    : "Session open, StrictMode replays the effect";
}

function settled(v: V): string {
  if (v.shown === "fallback") {
    return data(v) === "ready" ? "Fallback shows, data loaded" : "Fallback shows, data loads";
  }

  if (data(v) === "ready") {
    return v.renderDue ? "Child shows, about to render again" : "Child shows the session's data";
  }

  return "New session open, child not drawn yet";
}

export const state = (v: V): string => {
  if (!v.mounted) return "Not on the page";
  if (v.eff === "due") return "Mounted, no session yet";
  if (v.replay) return replayed(v);
  return settled(v);
};

export const group = (v: V): string => {
  if (!v.mounted) return "off";
  if (v.shown === "fallback") return "wait";
  if (!v.replay && !v.renderDue && data(v) === "ready") return "ok";
  return "busy";
};

export const colors = { off: "tan", wait: "yellow", ok: "teal", busy: "purple" };

function rendered(from: V, to: V): string {
  if (to.shown === "fallback") return "the child asks for the session's data and suspends";
  return from.shown === "fallback" ? "the child shows again" : "the child renders";
}

const LABEL: Record<string, string> = {
  PageMounts: "the page mounts the provider",
  EffectSetup: "the effect opens a session",
  StrictRemount: "StrictMode closes the session and opens a new one",
  DataLoads: "the session's data loads",
  ParentRerenders: "the page above re-renders",
  PageUnmounts: "the page removes the provider",
};

export const step = (action: string, from: V, to: V): string | null => {
  if (action === "Render") return rendered(from, to);
  if (Object.hasOwn(LABEL, action)) return LABEL[action];
  return action;
};
