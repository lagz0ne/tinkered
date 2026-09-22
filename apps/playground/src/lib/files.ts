import app from "../../example/App.tsx?raw";
import engine from "../../example/engine.ts?raw";
import errors from "../../example/errors.ts?raw";
import index from "../../example/index.ts?raw";
import main from "../../example/main.tsx?raw";
import state from "../../example/state.ts?raw";
import tile from "../../example/Tile.tsx?raw";

/** One editor tab = one file in the virtual project. */
export type PlaygroundFile = { name: string; content: string };

/** The bundler entry. The preview runs this file; other files are reached via relative imports. */
export const ENTRY = "main.tsx";

/** The default project — the Ripples example. Its sources are real modules under `example/`
 * (consumer code, like the repo's `examples/`: type-checked against the workspace packages by
 * `vp check`, written in the consumer idiom rather than package rules), loaded here as text (`?raw`)
 * for the editor. The preview compiles them in the browser with esbuild-wasm. */
export const DEFAULT_FILES: readonly PlaygroundFile[] = [
  { name: "main.tsx", content: main },
  { name: "state.ts", content: state },
  { name: "errors.ts", content: errors },
  { name: "engine.ts", content: engine },
  { name: "index.ts", content: index },
  { name: "Tile.tsx", content: tile },
  { name: "App.tsx", content: app },
];
