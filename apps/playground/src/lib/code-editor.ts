import { javascript } from "@codemirror/lang-javascript";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { resource } from "@tinker/core";
import { basicSetup } from "codemirror";
import { editFile } from "@/actions.ts";
import { followDefinition, goBack, goForward, navigationCell, trackCursor } from "@/navigation.ts";
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
 * run `trackCursor`, F12 and modifier-click run `trackCursor` then `followDefinition`, Alt+Arrow
 * runs `goBack`/`goForward`, a place change swaps the document (read-only for package sources),
 * moves the caret, and scrolls there, and file or theme changes reach the view the same way. Each
 * file keeps its OWN EditorState in a cache, so undo history and per-file edits never leak across
 * a file switch, and the syntax extension parses JSX only where the filename is `.tsx`. */
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
    back: goBack.controller,
    forward: goForward.controller,
  },
  factory: ({ files, active, theme, nav, edit, track, follow, back, forward }, { defer }) => {
    const sources = () => sourceFiles(files.get());
    const host = document.createElement("div");
    host.className = "h-full overflow-hidden";

    let current = "";
    let editable = true;
    const cache = new Map<string, EditorState>();

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

    const extensions = (): readonly Extension[] => [
      keymap.of([
        {
          key: "F12",
          run: () => {
            followAt(view.state.selection.main.head);
            return true;
          },
        },
        {
          key: "Alt-ArrowLeft",
          run: () => {
            back.run();
            return true;
          },
        },
        {
          key: "Alt-ArrowRight",
          run: () => {
            forward.run();
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
      basicSetup,
      javascript({ typescript: true, jsx: current.endsWith(".tsx") }),
      compartments.theme.of(themeExtension(theme.get())),
      compartments.access.of([
        EditorState.readOnly.of(!editable),
        EditorView.editable.of(editable),
        EditorView.contentAttributes.of({ tabIndex: "0" }),
      ]),
      EditorView.updateListener.of((u) => {
        if (u.transactions.some((tr) => tr.annotation(external))) return;
        onTracked(u);
      }),
    ];

    const view = new EditorView({
      parent: host,
      state: EditorState.create({ extensions: extensions() }),
    });
    defer(() => view.destroy());

    /** Put a file on screen: a fresh state when there is no live cache entry (or it went stale),
     * so undo never pastes one file into another; the outgoing state is cached first. */
    const swapTo = (source: Source, offset: number): void => {
      if (current !== source.name) cache.set(current, view.state);
      const cached = cache.get(source.name);
      const reuse = cached?.doc.toString() === source.content ? cached : undefined;
      current = source.name;
      editable = source.editable;
      view.setState(reuse ?? EditorState.create({ doc: source.content, extensions: extensions() }));
      cache.set(source.name, view.state);
      view.dispatch({
        selection: { anchor: Math.min(offset, view.state.doc.length) },
        scrollIntoView: true,
        annotations: external.of(true),
      });
      view.dispatch({
        effects: [
          compartments.access.reconfigure([
            EditorState.readOnly.of(!source.editable),
            EditorView.editable.of(source.editable),
            EditorView.contentAttributes.of({ tabIndex: "0" }),
          ]),
          compartments.theme.reconfigure(themeExtension(theme.get())),
        ],
      });
    };

    /** Point the view at the place: swap the document when the file changed, then move the caret
     * — clamped in both branches, so a stale offset after edits still lands inside the document. */
    const applyPlace = (): void => {
      const place = nav.get().place;
      if (!place) return;
      if (place.file === current) {
        const anchor = Math.min(place.offset, view.state.doc.length);
        if (anchor !== view.state.selection.main.head)
          view.dispatch({
            selection: { anchor },
            scrollIntoView: true,
            annotations: external.of(true),
          });
        return;
      }
      const source = sources().find((s) => s.name === place.file);
      if (source === undefined) return;
      swapTo(source, place.offset);
    };

    /** An external content change (reset, another writer) reaches the open editable document. */
    const applyFiles = (): void => {
      if (!editable) return;
      const file = files.get().find((f) => f.name === current);
      if (file === undefined || file.content === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: file.content },
        annotations: external.of(true),
      });
    };

    const start = shown();
    current = start.name;
    editable = start.editable;
    swapTo(start, nav.get().place?.offset ?? 0);
    track.run({ input: { file: start.name, offset: 0 } });

    defer(nav.watch(applyPlace));
    defer(files.watch(applyFiles));
    defer(
      theme.watch(() =>
        view.dispatch({ effects: compartments.theme.reconfigure(themeExtension(theme.get())) }),
      ),
    );
    return { host };
  },
});
