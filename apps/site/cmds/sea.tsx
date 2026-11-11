import { ws } from "@tinker/bun/client";
import { createScope } from "@tinker/core";
import { ScopeProvider } from "@tinker/react";
import { createRoot } from "react-dom/client";

import { Ocean, ocean } from "@/play";
import { roomName, sea, tide } from "@/sea";
import { abortReasons } from "~/components/errors";

// The shared sea, one frame of `/live`: the playground's ocean as its main.tsx installs it, plus
// the sea's link and `tide({ room })`. Same App, same engine. The room comes from the link.

const room = roomName.catch("lobby").parse(new URLSearchParams(location.search).get("room"));
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const stop = new AbortController();

const app = createScope({
  signal: stop.signal,
  capsules: [
    ws.client({ url: `${location.origin.replace(/^http/, "ws")}/rpc` }),
    sea.board({ read: ws.client }),
    sea.api({ remote: ws.client }),
    ocean({ cols: 20, rows: 20, frames: window, still }),
    tide({ room }),
  ],
});

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) stop.abort(abortReasons.closed);
});

const live = await app.ready;

createRoot(document.getElementById("root")!).render(
  <ScopeProvider scope={live}>
    <Ocean />
  </ScopeProvider>,
);
