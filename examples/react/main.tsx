import { createRoot } from "react-dom/client";
import { App, FormApp } from "./index.ts";
import "./style.css";

/** The browser owns this element; each provider owns and closes its scope. */
export function mountExample(element: HTMLElement): void {
  createRoot(element).render(
    <main>
      <h1>React examples</h1>
      <section aria-labelledby="basic-title">
        <h2 id="basic-title">Counter and profile</h2>
        <p>Count, reset, save a document, and read the recorded spans.</p>
        <App />
      </section>
      <section aria-labelledby="form-title">
        <h2 id="form-title">Draft form</h2>
        <p>Saving returns the draft and clears both fields. It stays in this browser.</p>
        <FormApp />
      </section>
    </main>,
  );
}
