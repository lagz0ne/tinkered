import { createScope } from "@tinker/core";
import { ScopeProvider, useResource } from "@tinker/react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ticker } from "./engine";

/** Building the resource starts the wave engine. The provider OWNS the scope: it creates it here
 * and closes it on unmount, and closing runs every resource's `defer` — the engine stops itself, so
 * there is nothing to clean up by hand. */
function Engine(): ReactElement {
  useResource(ticker);
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <ScopeProvider create={() => createScope()}>
    <Engine />
  </ScopeProvider>,
);
