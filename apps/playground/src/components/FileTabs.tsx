import { FileCode2, Plus, X } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type FileTabsProps = {
  files: readonly string[];
  active: string;
  renaming: string | undefined;
  onRenameOpen: (name: string | undefined) => void;
  onSelect: (name: string) => void;
  onAdd: () => void;
  onClose: (name: string) => void;
  onRename: (from: string, to: string) => void;
};

/** A file switcher: one wrapper per tab holding the filename button (or the inline rename input)
 * and a sibling Close button — no interactive element inside another, so the DOM matches the
 * keyboard. Close is a real 44px button, visible without hover for touch. The active tab is
 * shaded by CSS, and the open-rename state arrives from a Tinker cell. Double-click a tab to
 * rename it. */
export function FileTabs({
  files,
  active,
  renaming,
  onRenameOpen,
  onSelect,
  onAdd,
  onClose,
  onRename,
}: FileTabsProps): ReactElement {
  return (
    <div className="file-tabs">
      <div className="file-tabs-scroll">
        {files.map((name) => (
          <div key={name} className={cn("file-tab", name === active && "file-tab-active")}>
            {renaming === name ? (
              <input
                autoFocus
                defaultValue={name}
                onBlur={(e) => {
                  onRenameOpen(undefined);
                  const to = e.target.value.trim();
                  if (to && to !== name) onRename(name, to);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") onRenameOpen(undefined);
                }}
                aria-label={`Rename ${name}`}
                className="file-tab-rename"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(name)}
                onDoubleClick={() => onRenameOpen(name)}
                aria-current={name === active}
                className="file-tab-name"
              >
                <FileCode2 aria-hidden="true" className="size-3.5" />
                <span>{name}</span>
              </button>
            )}
            {files.length > 1 && renaming !== name && (
              <button
                type="button"
                onClick={() => onClose(name)}
                aria-label={`Close ${name}`}
                className="file-tab-close"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={onAdd} className="file-tab-add" aria-label="New file">
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
