import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createScope } from "@tinker/core";
import { subscribe } from "@tinker/sync";
import { api } from "./api.ts";
import { ScopeProvider } from "@tinker/react";
import { App } from "./App.tsx";
import { wire } from "./connection.ts";
import { capability, detailRefresh } from "./services.ts";
import { drafter } from "./drafter.ts";
import { issueList } from "../shared/issues.ts";

/** The composition root: the only place that creates or touches the scope. Nothing is built
 * before `createScope`: `subscribe` resolves the `wire` resource inside the scope and holds it as
 * its transport, its `register` opens the stream with the keys in the URL, and `ready` resolves
 * when the first snapshots land. Until then the page shows "Connecting…", however long the
 * browser keeps reconnecting (a server that is down). A stream the browser gives up on before the
 * first snapshot fires `onClose` once, so `subscribe.start` rejects with `SyncNotReady`, `ready`
 * rejects, and the dead page renders — static markup the root re-renders between attempts, no
 * React state. */
function boot(): void {
  const root = document.getElementById("root");
  if (root === null) return;
  const element = createRoot(root);
  attempt(element, "dead");
}

/** One boot attempt; a failed one shows the dead page in the given phase. */
function attempt(element: ReturnType<typeof createRoot>, phase: DeadPhase): void {
  start(element).then(
    (booted) => {
      if (booted !== true) renderDead(element, phase);
    },
    () => renderDead(element, phase),
  );
}

async function start(element: ReturnType<typeof createRoot>): Promise<boolean> {
  renderConnecting(element);
  const scope = createScope({
    tags: [api.config({ baseUrl: window.location.origin })],
    extensions: [subscribe(wire, { cells: [[issueList, "issues"]] })],
  });
  try {
    await scope.ready;
  } catch {
    await scope.close();
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

/** The page while the first snapshot is on its way. */
function renderConnecting(element: ReturnType<typeof createRoot>): void {
  element.render(
    <StrictMode>
      <main>
        <h1>Issues</h1>
        <p aria-live="polite">Connecting…</p>
      </main>
    </StrictMode>,
  );
}

/** One dead-page phase: the first failure, or a Reconnect that failed too. */
type DeadPhase = "dead" | "failed";

/** The dead page: static markup between boot attempts. Reconnect starts one more attempt, which
 * shows "Connecting…" until it boots or fails. */
function renderDead(element: ReturnType<typeof createRoot>, phase: DeadPhase): void {
  element.render(
    <StrictMode>
      <main>
        <h1>Issues</h1>
        <p role="alert">Could not connect. Your drafts are kept in this tab.</p>
        <button type="button" onClick={() => attempt(element, "failed")}>
          Reconnect
        </button>
        {phase === "failed" ? <p role="alert">Still no connection. Try again.</p> : null}
      </main>
    </StrictMode>,
  );
}

boot();
