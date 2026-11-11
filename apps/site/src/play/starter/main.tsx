import { createScope } from "@tinker/core";
import { ScopeProvider } from "@tinker/react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ocean } from "./ocean";

// The seam: the one place that reads the browser. The ocean gets its size, its frames and the
// visitor's motion setting as config; starting the scope starts its frame loop, and nothing else is global.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const app = createScope({ capsules: [ocean({ cols: 20, rows: 20, frames: window, still })] });
const live = await app.ready;

createRoot(document.getElementById("root")!).render(
  <ScopeProvider scope={live}>
    <App />
  </ScopeProvider>,
);
