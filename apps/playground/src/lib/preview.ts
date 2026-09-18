/** Builds the HTML document that runs the user's compiled bundle inside the preview iframe.
 *
 * The iframe is same-origin (so `/vendor/*` loads with no CORS), and an import map points every
 * bare specifier at a self-hosted vendor bundle — one shared React, one shared engine. A `<base>`
 * tag makes the absolute `/vendor` paths resolve against this origin even though the document is
 * injected via `srcdoc`. Uncaught errors are posted back to the parent for the status line. */
export function previewDocument(compiledJs: string): string {
  const origin = location.origin;
  const importMap = {
    imports: {
      "@tinker/core": "/vendor/core.mjs",
      "@tinker/react": "/vendor/tinker-react.mjs",
      react: "/vendor/react.mjs",
      "react/jsx-runtime": "/vendor/react-jsx-runtime.mjs",
      "react-dom": "/vendor/react-dom.mjs",
      "react-dom/client": "/vendor/react-dom-client.mjs",
    },
  };
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <base href="${origin}/" />
    <style>
      :root { color-scheme: light; }
      body { font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; color: #18181b; background: #fff; }
      button { font: inherit; padding: 6px 12px; margin: 4px 4px 4px 0; border-radius: 8px;
        border: 1px solid #e4e4e7; background: #fafafa; cursor: pointer; transition: background .15s ease; }
      button:hover { background: #f4f4f5; }
      h1 { font-size: 1.4rem; font-weight: 650; letter-spacing: -0.01em; }
    </style>
    <script type="importmap">${JSON.stringify(importMap)}</script>
    <script>
      function send(text) { parent.postMessage({ __pg: "error", text: String(text) }, "*"); }
      window.onerror = function (msg, _src, _line, _col, err) { send((err && err.stack) || msg); };
      window.addEventListener("unhandledrejection", function (ev) {
        send((ev.reason && ev.reason.stack) || ev.reason);
      });
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
${compiledJs}
      parent.postMessage({ __pg: "ok" }, "*");
    </script>
  </body>
</html>`;
}
