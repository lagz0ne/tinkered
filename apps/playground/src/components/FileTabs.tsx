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

/** A file switcher: one 44px tab per file, the active one shaded by CSS — no measured pill. Tabs
 * are real buttons (keyboard activation), close is a span button with its own Enter/Space
 * handling, and the open-rename state arrives from a Tinker cell, not component state. Double-click
 * a tab to rename it. */
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
          <button
            key={name}
            type="button"
            onClick={() => onSelect(name)}
            onDoubleClick={() => onRenameOpen(name)}
            aria-current={name === active}
            className={cn(
              "group relative z-10 flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              name === active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {renaming === name ? (
              <input
                autoFocus
                defaultValue={name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  onRenameOpen(undefined);
                  const to = e.target.value.trim();
                  if (to && to !== name) onRename(name, to);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") onRenameOpen(undefined);
                }}
                className="w-24 bg-transparent font-mono text-xs outline-none"
              />
            ) : (
              <span className="font-mono">{name}</span>
            )}
            {files.length > 1 && renaming !== name && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(name);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose(name);
                  }
                }}
                className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="size-3" />
              </span>
            )}
          </button>
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
