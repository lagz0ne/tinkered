import { Plus, X } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils.ts";

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
    <div className="flex min-w-0 items-center gap-1">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {files.map((name) => (
          <div key={name} className="flex shrink-0 items-center gap-0.5">
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
                className="h-11 w-28 rounded-md bg-accent px-2.5 font-mono text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect(name)}
                onDoubleClick={() => onRenameOpen(name)}
                aria-current={name === active}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium transition-colors select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                  name === active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="font-mono">{name}</span>
              </button>
            )}
            {files.length > 1 && renaming !== name && (
              <button
                type="button"
                onClick={() => onClose(name)}
                aria-label={`Close ${name}`}
                className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        aria-label="New file"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
