import { useData, useRun } from "@tinker/react";
import { FileCode, Lock, Search } from "lucide-react";
import type { ReactElement } from "react";
import { setPickerOpen, setSearch } from "@/actions.ts";
import { openSource } from "@/navigation.ts";
import { PACKAGE_SOURCES } from "@/lib/sources.ts";
import { filesCell, pickerOpenCell, searchCell } from "@/state.ts";

const sameNames = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((name, i) => name === b[i]);

/** The searchable list of everything openable: the editable session files first, then the
 * read-only package sources. The query and the open/closed state are shell cells through
 * `setSearch` and `setPickerOpen` — focus or typing shows the list, a choice or Escape closes it —
 * and choices run on `onClick`, so keyboard and assistive activation work like a mouse click. */
export function SourcePicker({ active }: { active: string }): ReactElement {
  const names = useData(filesCell, (files) => files.map((f) => f.name), sameNames);
  const query = useData(searchCell);
  const open = useData(pickerOpenCell);
  const type = useRun(setSearch);
  const toggle = useRun(setPickerOpen);
  const jump = useRun(openSource);

  const all = [...names, ...PACKAGE_SOURCES.map((s) => s.name)];
  const needle = query.trim().toLowerCase();
  const hits = all.filter((name) => name.toLowerCase().includes(needle));
  const [firstHit] = hits;

  const pick = (file: string) => {
    jump.run({ input: { file, offset: 0 } });
    type.run({ input: "" });
    toggle.run({ input: false });
  };

  return (
    <div className="relative min-w-0 flex-1">
      <label className="flex h-11 items-center gap-2 rounded-lg border bg-muted px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          placeholder="Search files…"
          aria-label="Search files"
          onFocus={() => toggle.run({ input: true })}
          onChange={(e) => {
            type.run({ input: e.target.value });
            toggle.run({ input: true });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && firstHit !== undefined) pick(firstHit);
            if (e.key === "Escape") toggle.run({ input: false });
          }}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {open && (
        <ul className="absolute inset-x-0 top-12 z-20 max-h-72 overflow-y-auto rounded-lg border bg-background p-1 shadow-lg">
          {hits.map((name) => {
            const editable = names.includes(name);
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => pick(name)}
                  aria-current={name === active}
                  className={
                    "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-xs transition-colors " +
                    (name === active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground")
                  }
                >
                  <FileCode className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
                  {!editable && (
                    <span className="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <Lock className="size-3" />
                      read-only
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {hits.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">no files match</li>
          )}
        </ul>
      )}
    </div>
  );
}
