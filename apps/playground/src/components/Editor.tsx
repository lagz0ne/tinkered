import { useResource } from "@tinker/react";
import type { ReactElement } from "react";
import { codeEditor } from "@/lib/code-editor.ts";

/** The mount point of the `codeEditor` resource's host. The component holds no editor state at
 * all: the resource owns the CodeMirror view for the whole scope, and the callback ref simply
 * attaches the host element — re-attaching an unchanged host is a no-op, so re-renders and overlay
 * switches never rebuild the editor or disturb its undo history and cursor. */
export function Editor(): ReactElement {
  const editor = useResource(codeEditor);
  return (
    <div
      ref={(el) => {
        if (el !== null && el.firstElementChild !== editor.host) el.replaceChildren(editor.host);
      }}
      className="h-full min-h-0"
    />
  );
}
