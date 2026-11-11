import { createScope } from "@tinker/core";
import { ScopeProvider } from "@tinker/react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ocean } from "./ocean";

// The seam: the one place that reads the browser. The ocean gets its size and its frames as
// config; starting the scope starts its frame loop, and nothing else is global.
const app = createScope({ capsules: [ocean({ cols: 12, rows: 12, frames: window })] });
const live = await app.ready;

createRoot(document.getElementById("root")!).render(
  <ScopeProvider scope={live}>
    <App />
  </ScopeProvider>,
);
