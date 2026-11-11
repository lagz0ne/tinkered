import { javascript } from "@codemirror/lang-javascript";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { resource } from "@tinker/core";
import { githubLight } from "@uiw/codemirror-theme-github";
import { basicSetup } from "codemirror";

import { editFile } from "./ops";
import { active, files } from "./state";

/** Marks a change the editor got from the cells (a reset), so it is not sent back as typing. */
const echo = Annotation.define<boolean>();

/**
 * The CodeMirror view, built once into a detached host the page mounts by reference. Typing runs
 * `editFile`; a tab switch swaps the document, and each file keeps its own undo history; a change
 * from outside (a reset) reaches the open document. JSX is parsed only in `.tsx` files.
 */
export const editor = resource({
  label: "play.editor",
  depends: { files: files.controller, active: active.controller, edit: editFile.controller },
  factory: ({ files, active, edit }, { defer }) => {
    const host = document.createElement("div");
    host.className = "editor-host";
    const states = new Map<string, EditorState>();
    let shown = "";

    const view = new EditorView({ parent: host });
    defer(() => view.destroy());

    const typed = EditorView.updateListener.of((u) => {
      if (!u.docChanged || u.transactions.some((t) => t.annotation(echo))) return;
      edit.run({ input: { name: shown, content: u.state.doc.toString() } });
    });

    const swap = () => {
      const file = files.get().find((f) => f.name === active.get());
      if (!file || file.name === shown) return;

      states.set(shown, view.state);
      const kept = states.get(file.name);
      shown = file.name;
      view.setState(
        kept?.doc.toString() === file.content
          ? kept
          : EditorState.create({
              doc: file.content,
              extensions: [
                basicSetup,
                javascript({ typescript: true, jsx: file.name.endsWith(".tsx") }),
                githubLight,
                typed,
              ],
            }),
      );
    };

    const sync = () => {
      const file = files.get().find((f) => f.name === shown);
      const doc = view.state.doc;
      if (!file || file.content === doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: file.content },
        annotations: echo.of(true),
      });
    };

    swap();
    defer(active.watch(swap));
    defer(files.watch(sync));
    return { host };
  },
});
