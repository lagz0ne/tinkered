import { createScope } from "@tinker/core";
import { ScopeProvider } from "@tinker/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App.tsx";
import { bundler, persistence, runtime } from "@/services.ts";
import "@/globals.css";

// The composition root. The app owns its scope; the services are resources, so resolving them is
// what starts them — persistence hydrates the cells from storage before the first paint, the
// runtime starts listening to the preview, the bundler compiles what is open. React gets a scope
// to read from and operations to run, and nothing else.
const scope = createScope();
scope.resolve(persistence);
scope.resolve(runtime);
scope.resolve(bundler);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ScopeProvider scope={scope}>
      <App />
    </ScopeProvider>
  </StrictMode>,
);
