import { useData, useResource, useRun } from "@tinker/react";

import { editor } from "./editor";
import {
  addFile,
  back,
  closeFile,
  forward,
  open,
  renameFile,
  reset,
  setRenaming,
  setTheme,
  setView,
} from "./ops";
import { bundler, persistence, preview } from "./services";
import { library } from "./sources";
import { bundle, dirty, files, nav, renaming, status, theme, view } from "./state";

// The play page: the preview runs the bundle in a frame; Code puts the editor beside it. The page
// holds no state: the ops write the cells, the services compile and keep the session.

/** The modules the bundle imports by bare name: one React, one Core and zod, served by the site. */
const importMap = JSON.stringify({
  imports: {
    "@tinker/core": "/vendor/core.mjs",
    "@tinker/react": "/vendor/tinker-react.mjs",
    react: "/vendor/react.mjs",
    "react/jsx-runtime": "/vendor/react-jsx-runtime.mjs",
    "react-dom": "/vendor/react-dom.mjs",
    "react-dom/client": "/vendor/react-dom-client.mjs",
    zod: "/vendor/zod.mjs",
  },
});

function Tabs() {
  const list = useData(files);
  const shown = useData(nav, (n) => n.place.file);
  const editing = useData(renaming);
  const select = useRun(open);
  const close = useRun(closeFile);
  const add = useRun(addFile);
  const rename = useRun(renameFile);
  const box = useRun(setRenaming);

  return (
    <div className="tabs" role="tablist" aria-label="Files">
      {list.map((f) =>
        editing === f.name ? (
          <input
            key={f.name}
            className="tab rename"
            aria-label={`Rename ${f.name}`}
            defaultValue={f.name}
            autoFocus
            onBlur={() => box.run({ input: null })}
            onKeyDown={(e) => {
              if (e.key === "Escape") box.run({ input: null });
              if (e.key !== "Enter") return;
              const to = e.currentTarget.value.trim();
              if (to) rename.run({ input: { from: f.name, to } });
              box.run({ input: null });
            }}
          />
        ) : (
          <span key={f.name} className={f.name === shown ? "tab on" : "tab"}>
            <button
              type="button"
              role="tab"
              aria-selected={f.name === shown}
              onClick={() => select.run({ input: { file: f.name, offset: 0 } })}
              onDoubleClick={() => box.run({ input: f.name })}
            >
              {f.name}
            </button>
            {list.length > 1 && (
              <button
                type="button"
                className="close"
                aria-label={`Close ${f.name}`}
                onClick={() => close.run({ input: f.name })}
              >
                ×
              </button>
            )}
          </span>
        ),
      )}
      <button type="button" className="tab add" aria-label="New file" onClick={() => add.run()}>
        +
      </button>
    </div>
  );
}

/** Back, forward, a library source to open, and the editor's colours. */
function Tools() {
  const n = useData(nav);
  const colours = useData(theme);
  const go = useRun(open);
  const stepBack = useRun(back);
  const stepForward = useRun(forward);
  const paint = useRun(setTheme);
  const reading = library.some((s) => s.name === n.place.file);

  return (
    <div className="tools">
      <button
        type="button"
        aria-label="Back (Alt+Left)"
        disabled={!n.back.length}
        onClick={() => stepBack.run()}
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Forward (Alt+Right)"
        disabled={!n.forward.length}
        onClick={() => stepForward.run()}
      >
        →
      </button>
      <select
        aria-label="Open a library source"
        value={reading ? n.place.file : ""}
        onChange={(e) => go.run({ input: { file: e.currentTarget.value, offset: 0 } })}
      >
        <option value="" disabled>
          Library source…
        </option>
        {library.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      {reading && <span className="reading">read only · F12 to follow</span>}
      <select
        aria-label="Editor colours"
        value={colours}
        onChange={(e) => paint.run({ rawInput: e.currentTarget.value })}
      >
        <option value="github-light">GitHub Light</option>
        <option value="github-dark">GitHub Dark</option>
        <option value="one-dark">One Dark</option>
      </select>
    </div>
  );
}

function Editor() {
  const { host } = useResource(editor);
  return (
    <div
      className="editor"
      ref={(el) => {
        if (el && el.firstElementChild !== host) el.replaceChildren(host);
      }}
    />
  );
}

function Preview() {
  const code = useData(bundle);
  return code === null ? (
    <div className="preview waiting">Compiling the starter…</div>
  ) : (
    // The document the frame runs: the import map, an error relay to the page, then the bundle.
    <iframe
      className="preview"
      title="Preview"
      srcDoc={`<!doctype html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${location.origin}/" />
<style>html,body{margin:0;min-height:100%}body{font:15px/1.5 system-ui,sans-serif}</style>
<script type="importmap">${importMap}</script>
<script>
  const say = (text) => parent.postMessage({ tinkerPlay: "error", text: String(text) }, "*");
  addEventListener("error", (e) => say((e.error && e.error.stack) || e.message));
  addEventListener("unhandledrejection", (e) => say((e.reason && e.reason.stack) || e.reason));
</script></head>
<body><div id="root"></div>
<script type="module">
${code.replaceAll("</script", "<\\/script")}
parent.postMessage({ tinkerPlay: "ok" }, "*");
</script></body></html>`}
    />
  );
}

function Status() {
  const s = useData(status);
  const changed = useData(dirty);
  const back = useRun(reset);
  return (
    <p className={`play-status ${s.kind}`} role="status">
      <span>
        {s.text}
        {s.ms !== undefined && s.kind !== "error" && <small> {Math.round(s.ms)} ms</small>}
      </span>
      {changed && (
        <button type="button" onClick={() => back.run()}>
          Reset to the starter
        </button>
      )}
    </p>
  );
}

/** `/play`: the starter project, compiled and run in this browser. */
export function PlayPage() {
  useResource(persistence);
  useResource(bundler);
  useResource(preview);
  const mode = useData(view);
  const show = useRun(setView);

  return (
    <main className="play" data-view={mode}>
      <div className="play-bar">
        <div className="switch" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={mode === "play"}
            onClick={() => show.run({ input: "play" })}
          >
            Play
          </button>
          <button
            type="button"
            aria-pressed={mode === "code"}
            onClick={() => show.run({ input: "code" })}
          >
            Code
          </button>
        </div>
        <Status />
        <button
          type="button"
          className="full"
          onClick={(e) =>
            void e.currentTarget.closest(".play")?.querySelector(".preview")?.requestFullscreen()
          }
        >
          Full screen
        </button>
      </div>
      <div className="panes">
        {mode === "code" && (
          <section className="code" aria-label="Code">
            <Tabs />
            <Tools />
            <Editor />
          </section>
        )}
        <Preview />
      </div>
    </main>
  );
}
