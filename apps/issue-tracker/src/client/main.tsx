import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createScope } from "@tinker/core";
import { subscribe } from "@tinker/sync";
import { api } from "./api.ts";
import { ScopeProvider } from "@tinker/react";
import { App } from "./App.tsx";
import { createWire, wire, wireLink } from "./connection.ts";
import { capability, detailRefresh } from "./services.ts";
import { drafter } from "./drafter.ts";
import { issueList } from "../shared/issues.ts";

/** The composition root: the only place that creates or touches the scope. The `wire` extension
 * attaches the bound link; `subscribe` sends `register` through it, which opens the stream;
 * `ready` resolves when the first snapshots land. A first-connect failure fires `onClose` once,
 * so `subscribe.start` rejects with `SyncNotReady`, `ready` rejects, and the dead page renders —
 * a second root-owned `boot` re-renders static markup between attempts, no React state. */
function boot(): void {
  const root = document.getElementById("root");
  if (root === null) return;
  const element = createRoot(root);
  const booted = start(element);
  booted.then(
    () => undefined,
    () => renderDead(element, "dead"),
  );
}

async function start(element: ReturnType<typeof createRoot>): Promise<boolean> {
  const link = createWire();
  const subscription = subscribe(link, { cells: [[issueList, "issues"]] });
  const scope = createScope({
    tags: [api.config({ baseUrl: window.location.origin }), wireLink(link)],
    extensions: [wire, subscription],
  });
  try {
    await scope.ready;
  } catch {
    await scope.close();
    renderDead(element, "dead");
    return false;
  }
  scope.resolve(detailRefresh);
  scope.resolve(drafter);
  scope.resolve(capability);
  element.render(
    <StrictMode>
      <ScopeProvider scope={scope}>
        <App />
      </ScopeProvider>
    </StrictMode>,
  );
  return true;
}

/** One dead-page phase: the first failure, the retry in flight, or the retry failed. */
type DeadPhase = "dead" | "retrying" | "failed";

/** The dead page: static markup between boot attempts — a second scope for its two transient
 * states would outlive its purpose, so the root re-renders the markup itself. */
function renderDead(element: ReturnType<typeof createRoot>, phase: DeadPhase): void {
  element.render(
    <StrictMode>
      <main>
        <h1>Issues</h1>
        <p role="alert">Could not connect. Your drafts are kept in this tab.</p>
        {phase === "retrying" ? (
          <button type="button" disabled>
            Reconnect
          </button>
        ) : (
          <button type="button" onClick={() => retry(element)}>
            Reconnect
          </button>
        )}
        {phase === "retrying" ? <p aria-live="polite">Reconnecting…</p> : null}
        {phase === "failed" ? <p role="alert">Still no connection. Try again.</p> : null}
      </main>
    </StrictMode>,
  );
  if (phase === "retrying") {
    const retried = start(element);
    retried.then(
      (recovered) => {
        if (recovered !== true) renderDead(element, "failed");
      },
      () => renderDead(element, "failed"),
    );
  }
}

/** One more boot attempt behind the retrying markup. */
function retry(element: ReturnType<typeof createRoot>): void {
  renderDead(element, "retrying");
}

boot();
