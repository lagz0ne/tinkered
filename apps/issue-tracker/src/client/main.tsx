import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { connectTab } from "./sync.ts";

/** One tab: connect, then render once the first snapshot landed.
 * Every failure path renders its own message, so boot never rejects. */
function boot(): void {
  const root = document.getElementById("root");
  if (root === null) return;
  const element = createRoot(root);
  connectTab(window.location.origin).then(renderLive, renderDead);

  function renderLive(connected: Awaited<ReturnType<typeof connectTab>>): void {
    element.render(
      <StrictMode>
        <App connected={connected} />
      </StrictMode>,
    );
  }

  function renderDead(): void {
    element.render(
      <StrictMode>
        <main>
          <h1>Issues</h1>
          <p role="alert">Could not connect. Reload to try again.</p>
        </main>
      </StrictMode>,
    );
  }
}

boot();
