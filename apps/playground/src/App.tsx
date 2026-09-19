import { ScopeProvider, useController, useData } from "@tinker/react";
import { BarChart3, Code2, RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
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
import { compile } from "@/lib/compile.ts";
import { DEFAULT_FILES, ENTRY } from "@/lib/files.ts";
import { previewDocument } from "@/lib/preview.ts";
import { THEMES, type ThemeId } from "@/lib/themes.ts";
import {
  activeCell,
  createPlaygroundScope,
  dirtyCell,
  filesCell,
  persist,
  statusCell,
  themeCell,
  type View,
  viewCell,
} from "@/store.ts";

// The benchmark pulls in Zustand/Jotai/Legend/Preact — lazy-load so it costs nothing until opened.
const BenchPage = lazy(() =>
  import("@/bench/BenchPage.tsx").then((m) => ({ default: m.BenchPage })),
);

function ViewToggle({ view, onSelect }: { view: View; onSelect: (v: View) => void }): ReactElement {
  const item = (v: View, label: string, Icon: typeof Code2) => (
    <button
      type="button"
      onClick={() => onSelect(v)}
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

/** The playground shell — every piece of its state is a `@tinker/core` cell read through hooks. */
function Shell(): ReactElement {
  const files = useData(filesCell);
  const setFiles = useController(filesCell);
  const active = useData(activeCell);
  const setActive = useController(activeCell);
  const theme = useData(themeCell);
  const setTheme = useController(themeCell);
  const status = useData(statusCell);
  const setStatus = useController(statusCell);
  const view = useData(viewCell);
  const setView = useController(viewCell);
  const dirty = useData(dirtyCell);
  const setDirty = useController(dirtyCell);
  const direction = useLayoutDirection();
  const iframe = useRef<HTMLIFrameElement>(null);

  const activeFile = files.find((f) => f.name === active) ?? files[0];

  // Debounced compile → preview, on any file change.
  useEffect(() => {
    persist(files, active, theme, dirty);
    const timer = setTimeout(() => {
      void compile(files).then((result) => {
        if (result.ok) {
          if (iframe.current) iframe.current.srcdoc = previewDocument(result.code);
          setStatus.set({ kind: "info", text: "running…" });
        } else {
          setStatus.set({ kind: "error", text: result.error });
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [files, active, theme, dirty, setStatus]);

  // Runtime signals from the preview iframe.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { __pg?: string; text?: string };
      if (data.__pg === "error")
        setStatus.set({ kind: "error", text: data.text ?? "runtime error" });
      else if (data.__pg === "ok") setStatus.set({ kind: "ok", text: "ready" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setStatus]);

  const setActiveContent = (content: string) => {
    setDirty.set(true);
    setFiles.update((prev) => prev.map((f) => (f.name === active ? { ...f, content } : f)));
  };

  const addFile = () => {
    let n = 1;
    while (files.some((f) => f.name === `Untitled${n}.tsx`)) n++;
    const name = `Untitled${n}.tsx`;
    setDirty.set(true);
    setFiles.update((prev) => [...prev, { name, content: "" }]);
    setActive.set(name);
  };

  const closeFile = (name: string) => {
    const idx = files.findIndex((f) => f.name === name);
    const next = files.filter((f) => f.name !== name);
    setDirty.set(true);
    setFiles.set(next);
    if (active === name) setActive.set((next[idx] ?? next[idx - 1] ?? next[0]).name);
  };

  const renameFile = (from: string, to: string) => {
    if (files.some((f) => f.name === to)) return;
    setDirty.set(true);
    setFiles.update((prev) => prev.map((f) => (f.name === from ? { ...f, name: to } : f)));
    if (active === from) setActive.set(to);
  };

  const reset = () => {
    setDirty.set(false);
    setFiles.set([...DEFAULT_FILES]);
    setActive.set(ENTRY);
  };

  const dotColor =
    status.kind === "error"
      ? "bg-destructive"
      : status.kind === "ok"
        ? "bg-emerald-500"
        : "bg-amber-400";

  return (
    <div className="flex h-full flex-col">
      {/* Editor stays mounted (keeps CodeMirror + iframe state); the bench overlays when selected. */}
      <div className="relative min-h-0 flex-1">
        <ResizablePanelGroup key={direction} direction={direction} className="h-full">
          <ResizablePanel defaultSize={50} minSize={25}>
            <Editor value={activeFile.content} onChange={setActiveContent} theme={theme} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={50} minSize={25}>
            <iframe
              ref={iframe}
              title="Live preview"
              sandbox="allow-scripts allow-same-origin"
              className="h-full w-full border-0 bg-white"
            />
          </ResizablePanel>
        </ResizablePanelGroup>
        {view === "bench" && (
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
        )}
      </div>

      {/* All chrome lives in this slim bottom bar. */}
      <div className="flex h-11 shrink-0 items-center gap-3 border-t bg-background/80 px-3 backdrop-blur">
        <span className="hidden text-xs font-semibold tracking-tight text-muted-foreground sm:inline">
          tinkered
        </span>
        {view === "editor" && (
          <div className="min-w-0 flex-1">
            <FileTabs
              files={files.map((f) => f.name)}
              active={activeFile.name}
              onSelect={(name) => setActive.set(name)}
              onAdd={addFile}
              onClose={closeFile}
              onRename={renameFile}
            />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ViewToggle view={view} onSelect={(v) => setView.set(v)} />

          {view === "editor" && (
            <>
              <div className="flex items-center gap-1.5 pr-1 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${dotColor} transition-colors`} />
                <span className="hidden max-w-[32ch] truncate md:inline" title={status.text}>
                  {status.text}
                </span>
              </div>

              <Select value={theme} onValueChange={(v) => setTheme.set(v as ThemeId)}>
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

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={reset} aria-label="Reset">
                    <RotateCcw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset to the starter project</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function App(): ReactElement {
  return (
    <ScopeProvider create={createPlaygroundScope}>
      <Shell />
    </ScopeProvider>
  );
}
