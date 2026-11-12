import { createScope } from "@tinkered/core";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";

import { ocean } from "./ocean";

// The seam: the one place that reads the browser. The ocean gets its size, its frames and the
// visitor's motion setting as config; starting the scope starts its frame loop, and nothing else
// is global. The page comes from the same value: `water.View`.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const water = ocean({ cols: 20, rows: 20, frames: window, still });
const app = createScope({ capsules: [water] });
const live = await app.ready;

createRoot(document.getElementById("root")!).render(
  <ScopeProvider scope={live}>
    <water.View />
  </ScopeProvider>,
);
