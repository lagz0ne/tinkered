import { useData, useRun } from "@tinker/react";
import { BarChart3, Code2, RotateCcw } from "lucide-react";
import { lazy, Suspense, useRef, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import {
  addFile,
  closeFile,
  editFile,
  renameFile,
  reset,
  selectFile,
  setTheme,
  setView,
} from "@/actions.ts";
import { Editor } from "@/components/Editor.tsx";
import { FileTabs } from "@/components/FileTabs.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { previewDocument } from "@/lib/preview.ts";
import { THEMES } from "@/lib/themes.ts";
import {
  activeCell,
  bundleCell,
  filesCell,
  statusCell,
  themeCell,
  type View,
  viewCell,
} from "@/state.ts";

/** The benchmark pulls in Zustand/Jotai/Legend/Preact — lazy-loaded so it costs nothing until
 * opened. (The view as a whole: every component reads exactly the cells it renders — a selector where
 * it wants a slice, an isEqual where "changed" is a policy — and runs operations for what the user
 * does. There is no useEffect here: the effects are resources, started once at the composition
 * root.) */
const BenchPage = lazy(() =>
  import("@/bench/BenchPage.tsx").then((m) => ({ default: m.BenchPage })),
);

function ViewToggle(): ReactElement {
  const view = useData(viewCell);
  const select = useRun(setView);
  const item = (v: View, label: string, Icon: typeof Code2) => (
    <button
      type="button"
      onClick={() => select.run({ input: v })}
      aria-label={label}
      title={label}
      className={
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
        (view === v
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      <Icon className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {item("editor", "Editor", Code2)}
      {item("bench", "Benchmark", BarChart3)}
    </div>
  );
}

const MOBILE = "(max-width: 767px)";
/** Phones stack editor over preview; wider screens sit them side by side. */
function useLayoutDirection(): "horizontal" | "vertical" {
  const mobile = useSyncExternalStore(
    (onChange) => {
      const m = matchMedia(MOBILE);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => matchMedia(MOBILE).matches,
  );
  return mobile ? "vertical" : "horizontal";
}

/** Reads the active file's content and the theme. Its own keystrokes do NOT re-render it: the
 * content it just emitted comes back through the cell, and the isEqual policy treats "the value I
 * last emitted" as unchanged. A tab switch, a reset, or any other writer still swaps the doc. */
function EditorPane(): ReactElement {
  const active = useData(activeCell);
  const theme = useData(themeCell);
  const emitted = useRef<string | undefined>(undefined);
  const content = useData(
    filesCell,
    (files) => files.find((f) => f.name === active)?.content ?? "",
    (prev, next) => prev === next || next === emitted.current,
  );
  const edit = useRun(editFile);
  const onChange = (next: string) => {
    emitted.current = next;
    edit.run({ input: { name: active, content: next } });
  };
  return <Editor value={content} onChange={onChange} theme={theme} />;
}

/** The last bundle, as a document. Subscribes to the bundle only: a tab or theme switch never
 * touches a running preview; a new bundle is a new document. */
function Preview(): ReactElement {
  const bundle = useData(bundleCell);
  return (
    <iframe
      title="Live preview"
      sandbox="allow-scripts allow-same-origin"
      className="h-full w-full border-0 bg-white"
      srcDoc={bundle === undefined ? "" : previewDocument(bundle)}
    />
  );
}

const sameNames = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((name, i) => name === b[i]);

/** Subscribes to the file NAMES: a keystroke changes a file's content, not its name, so typing
 * never re-renders the tab strip. */
function Tabs(): ReactElement {
  const names = useData(filesCell, (files) => files.map((f) => f.name), sameNames);
  const [first] = names;
  const active = useData(activeCell);
  const select = useRun(selectFile);
  const add = useRun(addFile);
  const close = useRun(closeFile);
  const rename = useRun(renameFile);
  return (
    <FileTabs
      files={names}
      active={names.includes(active) ? active : first}
      onSelect={(name) => select.run({ input: name })}
      onAdd={() => add.run()}
      onClose={(name) => close.run({ input: name })}
      onRename={(from, to) => rename.run({ input: { from, to } })}
    />
  );
}

function StatusDot(): ReactElement {
  const status = useData(statusCell);
  const dotColor =
    status.kind === "error"
      ? "bg-destructive"
      : status.kind === "ok"
        ? "bg-emerald-500"
        : "bg-amber-400";
  const text = status.ms === undefined ? status.text : `${status.text} · ${status.ms} ms`;
  return (
    <div className="flex items-center gap-1.5 pr-1 text-xs text-muted-foreground">
      <span className={`size-2 rounded-full ${dotColor} transition-colors`} />
      <span className="hidden max-w-[32ch] truncate md:inline" title={status.text}>
        {text}
      </span>
    </div>
  );
}

function ThemeSelect(): ReactElement {
  const theme = useData(themeCell);
  const choose = useRun(setTheme);
  return (
    <Select value={theme} onValueChange={(v) => choose.run({ rawInput: v })}>
      <SelectTrigger size="sm" className="h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Reads nothing, so it never re-renders. */
function ResetButton(): ReactElement {
  const run = useRun(reset);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={() => run.run()} aria-label="Reset">
          <RotateCcw />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Reset to the starter project</TooltipContent>
    </Tooltip>
  );
}

function BottomBar(): ReactElement {
  const view = useData(viewCell);
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-t bg-background/80 px-3 backdrop-blur">
      <span className="hidden text-xs font-semibold tracking-tight text-muted-foreground sm:inline">
        tinkered
      </span>
      {view === "editor" && (
        <div className="min-w-0 flex-1">
          <Tabs />
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        <ViewToggle />
        {view === "editor" && (
          <>
            <StatusDot />
            <ThemeSelect />
            <ResetButton />
          </>
        )}
      </div>
    </div>
  );
}

function BenchOverlay(): ReactElement | null {
  const view = useData(viewCell);
  if (view !== "bench") return null;
  return (
    <div className="absolute inset-0 bg-background">
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            loading benchmark…
          </div>
        }
      >
        <BenchPage />
      </Suspense>
    </div>
  );
}

/** The layout reads no cell at all. */
export function App(): ReactElement {
  const direction = useLayoutDirection();
  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup key={direction} direction={direction} className="h-full">
          <ResizablePanel defaultSize={50} minSize={25}>
            <EditorPane />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={50} minSize={25}>
            <Preview />
          </ResizablePanel>
        </ResizablePanelGroup>
        <BenchOverlay />
      </div>
      <BottomBar />
    </div>
  );
}
