/** Builds the HTML document that runs the user's compiled bundle inside the preview iframe.
 *
 * The iframe is same-origin (so the vendor bundles load with no CORS), and an import map points every
 * bare specifier at a self-hosted vendor bundle — one shared React, one shared engine. A `<base>`
 * tag makes the absolute vendor paths resolve against this origin even though the document is
 * injected via `srcdoc`. The document stays out of the way: edge-to-edge, no padding or base
 * element styles, so an app like the tile game can own the full page. Uncaught errors are posted
 * back to the parent for the status line. */
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <base href="${origin}/" />
    <style>
      :root { color-scheme: dark; }
      html, body { margin: 0; min-height: 100%; }
      body { font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; color: #e6f4f1;
        background: #04101f; overflow-x: hidden; }
    </style>
    <script type="importmap">${JSON.stringify(importMap)}</script>
    <script>
      function send(text) { parent.postMessage({ __pg: "error", text: String(text) }, "*"); }
      window.onerror = function (msg, _src, _line, _col, err) { send((err && err.stack) || msg); };
      window.addEventListener("unhandledrejection", function (ev) {
        send((ev.reason && ev.reason.stack) || ev.reason);
      });
      window.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") parent.postMessage({ __pg: "escape" }, "*");
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
