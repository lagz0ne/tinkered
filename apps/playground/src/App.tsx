import { useData, useResource, useRun } from "@tinker/react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Code2,
  Crosshair,
  Gamepad2,
  Maximize,
  Minimize2,
  RotateCcw,
} from "lucide-react";
import { lazy, Suspense, useRef } from "react";
import type { ReactElement, RefObject } from "react";
import { addFile, closeFile, renameFile, reset, selectFile, setTheme, setView } from "@/actions.ts";
import { FileTabs } from "@/components/FileTabs.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { codeEditor } from "@/lib/code-editor.ts";
import { immersive } from "@/lib/fullscreen.ts";
import { previewDocument } from "@/lib/preview.ts";
import { ENTRY } from "@/lib/files.ts";
import { THEMES } from "@/lib/themes.ts";
import { Editor } from "@/components/Editor.tsx";
import { SourcePicker } from "@/components/SourcePicker.tsx";
import {
  followDefinition,
  goBack,
  goForward,
  navigationCell,
  openSource,
  trackCursor,
} from "@/navigation.ts";
import {
  activeCell,
  bundleCell,
  filesCell,
  modeCell,
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
      aria-pressed={view === v}
      title={label}
      className={
        "flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring " +
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
      {item("play", "Play", Gamepad2)}
      {item("editor", "Code", Code2)}
      {item("bench", "Benchmark", BarChart3)}
    </div>
  );
}

/** THE one preview iframe for the whole shell: mounted for every view, its `srcDoc` driven only by
 * the bundle cell — switching to Code, Benchmark, or full screen never remounts it or resets the
 * running game. Views that are not Play simply cover it with an overlay, and `inert` takes the
 * covered game out of the tab order and out of assistive tech while it cannot be seen. */
function Preview(): ReactElement {
  const bundle = useData(bundleCell);
  const view = useData(viewCell);
  const covered = view !== "play";
  return (
    <iframe
      title="Live preview"
      sandbox="allow-scripts allow-same-origin"
      className="absolute inset-0 h-full w-full border-0 bg-[#04101f]"
      srcDoc={bundle === undefined ? "" : previewDocument(bundle)}
      inert={covered}
    />
  );
}

const sameNames = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((name, i) => name === b[i]);

/** Subscribes to the file NAMES: a keystroke changes a file's content, not its name, so typing
 * never re-renders the tab strip. A tab click is also a navigation open, so Back returns to the
 * tab you came from. */
function Tabs(): ReactElement {
  const names = useData(filesCell, (files) => files.map((f) => f.name), sameNames);
  const [first] = names;
  const active = useData(activeCell);
  const shown = useData(navigationCell, (nav) => nav.place?.file ?? first, Object.is);
  const select = useRun(selectFile);
  const open = useRun(openSource);
  const add = useRun(addFile);
  const close = useRun(closeFile);
  const rename = useRun(renameFile);
  return (
    <FileTabs
      files={names}
      active={names.includes(shown) ? shown : names.includes(active) ? active : first}
      onSelect={(name) => {
        select.run({ input: name });
        open.run({ input: { file: name, offset: 0 } });
      }}
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
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => run.run()}
          aria-label="Reset"
        >
          <RotateCcw />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Reset to the starter project</TooltipContent>
    </Tooltip>
  );
}

function FullscreenButton(props: { stage: RefObject<HTMLDivElement | null> }): ReactElement {
  const handle = useResource(immersive);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => handle.enter(props.stage.current)}
          aria-label="Full screen"
        >
          <Maximize />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Full screen — the game alone, edge to edge</TooltipContent>
    </Tooltip>
  );
}

function BottomBar(props: { stage: RefObject<HTMLDivElement | null> }): ReactElement {
  const view = useData(viewCell);
  return (
    <div className="shell-chrome flex h-12 shrink-0 items-center gap-3 border-t bg-background/80 px-3 backdrop-blur">
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
        {view === "play" && <FullscreenButton stage={props.stage} />}
      </div>
    </div>
  );
}

/** The Code view: searchable file list, the one editor, and reader-first navigation. The shown
 * file is the navigation place (falling back to the entry before the first open); a package
 * source shows a read-only badge and its full path, since no example tab names it. The editor
 * resource is resolved first so its seed place exists before the navigation is read. Follow
 * records the caret through `trackCursor` and then jumps — the caret itself is already tracked
 * on every cursor move, so Back lands on the exact spot. */
function CodeOverlay(): ReactElement {
  useResource(codeEditor);
  const names = useData(filesCell, (files) => files.map((f) => f.name), sameNames);
  const nav = useData(navigationCell);
  const shown = nav.place?.file ?? ENTRY;
  const editable = names.includes(shown);
  const record = useRun(trackCursor);
  const hop = useRun(followDefinition);
  const back = useRun(goBack);
  const forward = useRun(goForward);
  const follow = () => {
    const place = nav.place ?? { file: shown, offset: 0 };
    record.run({ input: place });
    hop.run({ input: place });
  };
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <SourcePicker active={shown} />
        <span
          title={shown}
          className="min-w-0 max-w-[36vw] shrink truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground"
        >
          {shown}
        </span>
        {!editable && (
          <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            read-only
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <Editor />
      </div>
      <div className="flex items-center gap-2 border-t px-2 py-1.5">
        <NavButton label="Follow symbol" hint="F12 or Ctrl-click a name" onClick={follow}>
          <Crosshair className="size-4" />
          <span>Follow symbol</span>
        </NavButton>
        <NavButton
          label="Back"
          hint="Alt+Left"
          disabled={nav.back.length === 0}
          onClick={() => back.run()}
        >
          <ArrowLeft className="size-4" />
        </NavButton>
        <NavButton
          label="Forward"
          hint="Alt+Right"
          disabled={nav.forward.length === 0}
          onClick={() => forward.run()}
        >
          <ArrowRight className="size-4" />
        </NavButton>
        <span className="ml-auto hidden pr-1 text-[11px] text-muted-foreground sm:inline">
          F12 or Ctrl-click follows a symbol
        </span>
      </div>
    </div>
  );
}

function NavButton(props: {
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.hint}
      aria-label={props.label}
      className="flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors enabled:hover:bg-accent disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {props.children}
    </button>
  );
}

function BenchOverlay(): ReactElement {
  return (
    <div className="absolute inset-0 z-10 bg-background">
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

/** The visible way out of full screen: floats over the stage in both the native and the fit
 * fallback mode; Escape also clears the fit pin (the browser handles native Escape itself). */
function ExitImmersive(props: { onExit: () => void }): ReactElement | null {
  const mode = useData(modeCell);
  if (mode === "window") return null;
  return (
    <button
      type="button"
      onClick={props.onExit}
      aria-label="Exit full screen"
      title="Exit full screen (Esc)"
      className="absolute right-3 top-3 z-20 flex size-11 items-center justify-center rounded-full border bg-background/80 text-foreground shadow-md backdrop-blur transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Minimize2 className="size-4" />
    </button>
  );
}

/** The stage holds the mounted iframe plus, per view, one overlay. In native full screen THIS is
 * the element the browser fills; in fit mode the stylesheet pins it over the shell. */
function Stage(props: {
  stage: RefObject<HTMLDivElement | null>;
  onExit: () => void;
}): ReactElement {
  const view = useData(viewCell);
  return (
    <div ref={props.stage} data-stage className="relative min-h-0 flex-1">
      <Preview />
      {view === "editor" && <CodeOverlay />}
      {view === "bench" && <BenchOverlay />}
      <ExitImmersive onExit={props.onExit} />
    </div>
  );
}

/** Reads the mode only to label the shell for the stylesheet: fit mode hides the chrome and pins
 * the stage; native mode is the browser's to draw. */
export function App(): ReactElement {
  const mode = useData(modeCell);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const handle = useResource(immersive);
  return (
    <div className="flex h-full flex-col" data-mode={mode}>
      <BottomBar stage={stageRef} />
      <Stage stage={stageRef} onExit={() => handle.exit()} />
    </div>
  );
}
