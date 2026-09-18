import { javascript } from "@codemirror/lang-javascript";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { themeExtension, type ThemeId } from "@/lib/themes.ts";

type EditorProps = {
  value: string;
  onChange: (value: string) => void;
  theme: ThemeId;
};

/** A controlled CodeMirror 6 editor. The view is created once; the doc swaps when the active file
 * changes and the theme swaps through a compartment — neither rebuilds the editor. */
export function Editor({ value, onChange, theme }: EditorProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const themeComp = useRef(new Compartment());

  useEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          javascript({ jsx: true, typescript: true }),
          themeComp.current.of(themeExtension(theme)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Create once; value/theme are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the document when the active file changes (external update, not user typing).
  useEffect(() => {
    const editor = view.current;
    if (editor && value !== editor.state.doc.toString()) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  // Swap the theme without rebuilding the editor.
  useEffect(() => {
    view.current?.dispatch({ effects: themeComp.current.reconfigure(themeExtension(theme)) });
  }, [theme]);

  return <div ref={container} className="h-full overflow-hidden" />;
}
