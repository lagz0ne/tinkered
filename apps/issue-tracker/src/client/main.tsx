import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createScope } from "@tinker/core";
import { subscribe, sync } from "@tinker/sync";
import { api } from "./api.ts";
import { ScopedApp } from "./App.tsx";
import { reconnectingTransport, wire } from "./connection.ts";
import { detailRefresh, liveness } from "./services.ts";
import { issueList } from "../shared/issues.ts";

/** The composition root: the only place that creates or touches the scope. The transport starts
 * connecting in its constructor; `subscribe` sends `register` through the queued `send`, and
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
    () => renderDead(element),
  );
}

async function start(element: ReturnType<typeof createRoot>): Promise<boolean | void> {
  const transport = reconnectingTransport(window.location.origin);
  const subscription = subscribe(transport);
  const scope = createScope({
    tags: [sync(issueList), api.config({ baseUrl: window.location.origin }), wire(transport)],
    extensions: [subscription],
  });
  try {
    await scope.ready;
  } catch {
    await scope.close();
    renderDead(element);
    return false;
  }
  scope.resolve(liveness);
  scope.resolve(detailRefresh);
  element.render(
    <StrictMode>
      <ScopedApp scope={scope} />
    </StrictMode>,
  );
}

/** The dead page: static markup between boot attempts — a second scope for its two transient
 * states would outlive its purpose, so the root re-renders the markup itself. */
function renderDead(element: ReturnType<typeof createRoot>): void {
  element.render(
    <StrictMode>
      <main>
        <h1>Issues</h1>
        <p role="alert">Could not connect. Your drafts are kept in this tab.</p>
        <button type="button" onClick={() => renderRetrying(element)}>
          Reconnect
        </button>
      </main>
    </StrictMode>,
  );
}

/** The retrying page: shown while the next boot attempt connects. */
function renderRetrying(element: ReturnType<typeof createRoot>): void {
  element.render(
    <StrictMode>
      <main>
        <h1>Issues</h1>
        <p role="alert">Could not connect. Your drafts are kept in this tab.</p>
        <button type="button" disabled>
          Reconnect
        </button>
        <p aria-live="polite">Reconnecting…</p>
      </main>
    </StrictMode>,
  );
  const retried = start(element);
  retried.then(
    (recovered) => {
      if (recovered !== true) renderFailed(element);
    },
    () => renderFailed(element),
  );
}

/** The failed page: the attempt after the dead page also failed. */
function renderFailed(element: ReturnType<typeof createRoot>): void {
  element.render(
    <StrictMode>
      <main>
        <h1>Issues</h1>
        <p role="alert">Could not connect. Your drafts are kept in this tab.</p>
        <button type="button" onClick={() => renderRetrying(element)}>
          Reconnect
        </button>
        <p role="alert">Still no connection. Try again.</p>
      </main>
    </StrictMode>,
  );
}

boot();
