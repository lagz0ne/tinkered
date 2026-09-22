import coreErrors from "../../../../packages/core/src/errors.ts?raw";
import coreIndex from "../../../../packages/core/src/index.ts?raw";
import reactErrors from "../../../../packages/react/src/errors.ts?raw";
import reactIndex from "../../../../packages/react/src/index.ts?raw";
import type { PlaygroundFile } from "@/lib/files.ts";

/** One file navigation can open: an editable tab or a bundled package source. `editable` marks the
 * ones held in `filesCell`; package sources are text only and never enter the session. */
export type Source = { name: string; content: string; editable: boolean };

/** The real `@tinker` sources shipped with the playground, read as text (`?raw`) so imports in the
 * example can link into the library itself. */
export const PACKAGE_SOURCES: readonly Source[] = [
  { name: "@tinker/core/index.ts", content: coreIndex, editable: false },
  { name: "@tinker/core/errors.ts", content: coreErrors, editable: false },
  { name: "@tinker/react/index.ts", content: reactIndex, editable: false },
  { name: "@tinker/react/errors.ts", content: reactErrors, editable: false },
];

/** Everything openable: the editable session files first, then the read-only package sources. */
export function sourceFiles(files: readonly PlaygroundFile[]): readonly Source[] {
  const editable = files.map((f) => ({ name: f.name, content: f.content, editable: true }));
  return [...editable, ...PACKAGE_SOURCES];
}
