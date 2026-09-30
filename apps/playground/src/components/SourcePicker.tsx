import { useData, useRun } from "@tinker/react";
import { ArrowUpRight, FileCode, Lock, Search, SearchX, X } from "lucide-react";
import { useId, type ReactElement } from "react";
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
  const resultsId = useId();

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
    <div className="source-picker">
      <label className="source-search">
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <input
          value={query}
          placeholder="Search files…"
          aria-label="Search files"
          aria-controls={open ? resultsId : undefined}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => toggle.run({ input: true })}
          onChange={(e) => {
            type.run({ input: e.target.value });
            toggle.run({ input: true });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && firstHit !== undefined) pick(firstHit);
            if (e.key === "Escape") toggle.run({ input: false });
          }}
        />
        <span className="source-search-hint" aria-hidden="true">
          ↵
        </span>
      </label>
      {open && (
        <div className="source-results">
          <div className="source-results-heading">
            <span>{hits.length} files found</span>
            <button
              type="button"
              aria-label="Close file search"
              onClick={() => toggle.run({ input: false })}
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
          <ul id={resultsId}>
            {hits.map((name) => {
              const editable = names.includes(name);
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => pick(name)}
                    aria-current={name === active}
                    className="source-result"
                  >
                    <FileCode aria-hidden="true" className="size-4 shrink-0" />
                    <span className="source-result-name">{name}</span>
                    {!editable && (
                      <span className="source-result-access">
                        <Lock aria-hidden="true" className="size-3" />
                        <span>read-only</span>
                      </span>
                    )}
                    <ArrowUpRight aria-hidden="true" className="source-result-arrow size-3.5" />
                  </button>
                </li>
              );
            })}
            {hits.length === 0 && (
              <li className="source-no-results">
                <SearchX aria-hidden="true" className="size-5" />
                <span>No files match. Try a shorter name.</span>
              </li>
            )}
          </ul>
          <div className="source-results-footer">Enter opens the first file · Esc closes</div>
        </div>
      )}
    </div>
  );
}
