import { javascript } from "@codemirror/lang-javascript";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { resource } from "@tinker/core";
import { editFile } from "@/actions.ts";
import { followDefinition, navigationCell, trackCursor } from "@/navigation.ts";
import { activeCell, filesCell, themeCell } from "@/state.ts";
import { themeExtension } from "@/lib/themes.ts";
import { sourceFiles, type Source } from "@/lib/sources.ts";

const compartments = {
  theme: new Compartment(),
  access: new Compartment(),
};

/** Marks a document or selection swap the shell made (navigation, a reset, an echo of typing) so
 * the listener never reports it back as user input. */
const external = Annotation.define<boolean>();

/** The CodeMirror view for the Code view, as a RESOURCE: the view is built once into a detached
 * host the React component mounts by reference, and every subscription is a `watch` removed by
 * `defer` — no React effects. The resource owns the wiring: typing runs `editFile`, cursor moves
 * run `trackCursor`, F12 and modifier-click run `trackCursor` then `followDefinition`, a place
 * change swaps the document (read-only for package sources), moves the caret, and scrolls there,
 * and file or theme changes reach the view the same way. Because the view is a scope singleton
 * the editor keeps its undo history and cursor across overlay mounts. */
export const codeEditor = resource({
  label: "codeEditor",
  depends: {
    files: filesCell.controller,
    active: activeCell.controller,
    theme: themeCell.controller,
    nav: navigationCell.controller,
    edit: editFile.controller,
    track: trackCursor.controller,
    follow: followDefinition.controller,
  },
  factory: ({ files, active, theme, nav, edit, track, follow }, { defer }) => {
    const sources = () => sourceFiles(files.get());
    const host = document.createElement("div");
    host.className = "h-full overflow-hidden";

    let current = "";
    let editable = true;

    /** The file the place points at, falling back to the active tab and then the first file. */
    const shown = (): Source => {
      const name = nav.get().place?.file ?? active.get();
      const list = sources();
      const [first] = list;
      return list.find((s) => s.name === name) ?? first;
    };

    const followAt = (offset: number): void => {
      const place = { file: current, offset };
      track.run({ input: place });
      follow.run({ input: place });
    };

    const onTracked = (u: { docChanged: boolean; selectionSet: boolean; state: EditorState }) => {
      if (u.docChanged) edit.run({ input: { name: current, content: u.state.doc.toString() } });
      if (u.selectionSet)
        track.run({ input: { file: current, offset: u.state.selection.main.head } });
    };

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: [
          keymap.of([
            {
              key: "F12",
              run: () => {
                followAt(view.state.selection.main.head);
                return true;
              },
            },
          ]),
          EditorView.domEventHandlers({
            mousedown: (event, target) => {
              if (!(event.ctrlKey || event.metaKey || event.altKey)) return false;
              const pos = target.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              followAt(pos);
              return true;
            },
          }),
          javascript({ jsx: true, typescript: true }),
          compartments.theme.of(themeExtension(theme.get())),
          compartments.access.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
          EditorView.updateListener.of((u) => {
            if (u.transactions.some((tr) => tr.annotation(external))) return;
            onTracked(u);
          }),
        ],
      }),
    });
    defer(() => view.destroy());

    /** Point the view at the place: swap the document when the file changed, then move the caret. */
    const applyPlace = (): void => {
      const place = nav.get().place;
      if (!place) return;
      if (place.file === current) {
        if (place.offset !== view.state.selection.main.head)
          view.dispatch({
            selection: { anchor: place.offset },
            scrollIntoView: true,
            annotations: external.of(true),
          });
        return;
      }
      const source = sources().find((s) => s.name === place.file);
      if (source === undefined) return;
      current = source.name;
      editable = source.editable;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source.content },
        effects: compartments.access.reconfigure([
          EditorState.readOnly.of(!source.editable),
          EditorView.editable.of(source.editable),
        ]),
        annotations: external.of(true),
      });
      view.dispatch({
        selection: { anchor: Math.min(place.offset, view.state.doc.length) },
        scrollIntoView: true,
        annotations: external.of(true),
      });
    };

    /** An external content change (reset, another writer) reaches the open editable document. */
    const applyFiles = (): void => {
      if (!editable) return;
      const file = files.get().find((f) => f.name === current);
      if (file === undefined) return;
      if (file.content === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: file.content },
        annotations: external.of(true),
      });
    };

    defer(nav.watch(applyPlace));
    defer(files.watch(applyFiles));
    defer(
      theme.watch(() =>
        view.dispatch({ effects: compartments.theme.reconfigure(themeExtension(theme.get())) }),
      ),
    );

    const start = shown();
    current = start.name;
    editable = start.editable;
    view.dispatch({
      changes: { from: 0, to: 0, insert: start.content },
      effects: compartments.access.reconfigure([
        EditorState.readOnly.of(!start.editable),
        EditorView.editable.of(start.editable),
      ]),
      annotations: external.of(true),
    });
    applyPlace();
    return { host };
  },
});
