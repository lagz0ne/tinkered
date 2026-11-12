import { javascript } from "@codemirror/lang-javascript";
import { Annotation, Compartment, EditorState, Prec } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { resource } from "@tinkered/core";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { basicSetup } from "codemirror";

import { back, editFile, follow, forward, track } from "./ops";
import { library } from "./sources";
import { files, nav, theme } from "./state";

/** Marks a change the editor got from the cells (a jump, a reset), so it is not sent back. */
const echo = Annotation.define<boolean>();

/** The editor's colours, by theme name. */
const themes = { "github-light": githubLight, "github-dark": githubDark, "one-dark": oneDark };

/**
 * The CodeMirror view, built once into a detached host the page mounts by reference. It shows
 * the place on screen: a tab, editable, or a library source, read only. Each file keeps its own
 * undo history. Typing runs `editFile`; a cursor move runs `track`; F12 or a modifier click runs
 * `follow`; Alt+Left and Alt+Right step back and forward . JSX is parsed only in `.tsx` files.
 */
export const editor = resource({
  label: "play.editor",
  depends: {
    files: files.controller,
    nav: nav.controller,
    theme: theme.controller,
    edit: editFile.controller,
    track: track.controller,
    follow: follow.controller,
    back: back.controller,
    forward: forward.controller,
  },
  factory: (deps, { defer }) => {
    const host = document.createElement("div");
    host.className = "editor-host";
    const colours = new Compartment();
    const states = new Map<string, EditorState>();
    let shown = "";

    const view = new EditorView({ parent: host });
    defer(() => view.destroy());

    const wiring = [
      // Highest, so Alt+Arrow is ours before basicSetup's own Alt+Arrow keys.
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event, v) => {
            if (event.key === "F12") {
              void deps.follow.run({ input: { file: shown, offset: v.state.selection.main.head } });
            } else if (!event.altKey) return false;
            else if (event.key === "ArrowLeft") deps.back.run();
            else if (event.key === "ArrowRight") deps.forward.run();
            else return false;
            return true;
          },
          mousedown: (event, v) => {
            if (!(event.ctrlKey || event.metaKey || event.altKey)) return false;
            const at = v.posAtCoords({ x: event.clientX, y: event.clientY });
            if (at === null) return false;

            void deps.follow.run({ input: { file: shown, offset: at } });
            return true;
          },
        }),
      ),
      EditorView.updateListener.of((u) => {
        if (u.transactions.some((t) => t.annotation(echo))) return;
        if (u.docChanged) {
          deps.edit.run({ input: { name: shown, content: u.state.doc.toString() } });
        }
        if (u.selectionSet) {
          deps.track.run({ input: { file: shown, offset: u.state.selection.main.head } });
        }
      }),
    ];

    const show = () => {
      const { file, offset } = deps.nav.get().place;
      const tab = deps.files.get().find((f) => f.name === file);
      const source = tab ?? library.find((s) => s.name === file);
      if (!source) return;

      if (file !== shown) {
        states.set(shown, view.state);
        const kept = states.get(file);
        shown = file;
        view.setState(
          kept?.doc.toString() === source.content
            ? kept
            : EditorState.create({
                doc: source.content,
                extensions: [
                  basicSetup,
                  javascript({ typescript: true, jsx: file.endsWith(".tsx") }),
                  colours.of(themes[deps.theme.get()]),
                  EditorState.readOnly.of(!tab),
                  wiring,
                ],
              }),
        );
      }

      const anchor = Math.min(offset, view.state.doc.length);
      if (anchor === view.state.selection.main.head) return;
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        annotations: echo.of(true),
      });
    };

    const sync = () => {
      const tab = deps.files.get().find((f) => f.name === shown);
      const doc = view.state.doc;
      if (!tab || tab.content === doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: tab.content },
        annotations: echo.of(true),
      });
    };

    show();
    defer(deps.nav.watch(show));
    defer(deps.files.watch(sync));
    defer(
      deps.theme.watch(() =>
        view.dispatch({ effects: colours.reconfigure(themes[deps.theme.get()]) }),
      ),
    );
    return { host };
  },
});
