import { Plus, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils.ts";

type FileTabsProps = {
  files: readonly string[];
  active: string;
  onSelect: (name: string) => void;
  onAdd: () => void;
  onClose: (name: string) => void;
  onRename: (from: string, to: string) => void;
};

/** A file switcher with a sliding active-tab indicator. Double-click a tab to rename it. */
export function FileTabs({
  files,
  active,
  onSelect,
  onAdd,
  onClose,
  onRename,
}: FileTabsProps): ReactElement {
  const strip = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<string, HTMLDivElement>());
  const [pill, setPill] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  const [editing, setEditing] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = tabs.current.get(active);
    const box = strip.current;
    if (el && box) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active, files]);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div
        ref={strip}
        className="relative flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          className="pointer-events-none absolute inset-y-1 rounded-md bg-accent transition-all duration-200 ease-out"
          style={{ left: pill.left, width: pill.width }}
        />
        {files.map((name) => (
          <div
            key={name}
            ref={(el) => {
              if (el) tabs.current.set(name, el);
              else tabs.current.delete(name);
            }}
            onClick={() => onSelect(name)}
            onDoubleClick={() => setEditing(name)}
            className={cn(
              "group relative z-10 flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors select-none",
              name === active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {editing === name ? (
              <input
                autoFocus
                defaultValue={name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setEditing(null);
                  const to = e.target.value.trim();
                  if (to && to !== name) onRename(name, to);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="w-24 bg-transparent font-mono text-xs outline-none"
              />
            ) : (
              <span className="font-mono">{name}</span>
            )}
            {files.length > 1 && editing !== name && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(name);
                }}
                className="grid size-4 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                aria-label={`Close ${name}`}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="New file"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
