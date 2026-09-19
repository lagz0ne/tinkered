import { javascript } from "@codemirror/lang-javascript";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { themeExtension, type ThemeId } from "@/lib/themes.ts";

/** Marks a document swap the shell made (tab switch, reset) so it is not reported as a user edit. */
const external = Annotation.define<boolean>();

type EditorProps = {
  value: string;
  onChange: (value: string) => void;
  theme: ThemeId;
};

/** A controlled CodeMirror 6 editor. The view is created once from the mount-time `value` and
 * `theme` (held in a ref so the create-once effect owns no reactive input); afterwards the doc swaps
 * when `value` changes and the theme swaps through a compartment — neither rebuilds the editor. A
 * doc swap carries the `external` annotation so it is never reported back as typing. */
export function Editor({ value, onChange, theme }: EditorProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const themeComp = useRef(new Compartment());
  const initial = useRef({ value, theme });

  useEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          basicSetup,
          javascript({ jsx: true, typescript: true }),
          themeComp.current.of(themeExtension(initial.current.theme)),
          EditorView.updateListener.of((u) => {
            const typed = u.docChanged && !u.transactions.some((tr) => tr.annotation(external));
            if (typed) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (editor && value !== editor.state.doc.toString()) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: external.of(true),
      });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: themeComp.current.reconfigure(themeExtension(theme)) });
  }, [theme]);

  return <div ref={container} className="h-full overflow-hidden" />;
}
