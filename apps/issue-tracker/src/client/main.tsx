import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { connectTab } from "./sync.ts";

function boot(): void {
  const root = document.getElementById("root");
  if (root === null) return;
  const element = createRoot(root);
  connectTab(window.location.origin).then(renderLive, renderDead);

  function renderLive(connected: Awaited<ReturnType<typeof connectTab>>): void {
    element.render(
      <StrictMode>
        <App initial={connected} baseUrl={window.location.origin} />
      </StrictMode>,
    );
  }

  function renderDead(): void {
    element.render(
      <StrictMode>
        <main>
          <h1>Issues</h1>
          <p role="alert">Could not connect. Your drafts are kept in this tab.</p>
          <RetryFirst />
        </main>
      </StrictMode>,
    );
  }

  function RetryFirst(): ReactNode {
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    async function retry(): Promise<void> {
      setPending(true);
      setFailed(false);
      try {
        const connected = await connectTab(window.location.origin);
        setPending(false);
        renderLive(connected);
      } catch {
        setPending(false);
        setFailed(true);
      }
    }
    return (
      <>
        <button type="button" onClick={retry} disabled={pending}>
          Reconnect
        </button>
        {pending ? <p aria-live="polite">Reconnecting…</p> : null}
        {failed ? <p role="alert">Still no connection. Try again.</p> : null}
      </>
    );
  }
}

boot();
