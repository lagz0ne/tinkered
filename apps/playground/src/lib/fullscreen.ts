import { resource } from "@tinker/core";
import { modeCell, viewCell } from "@/state.ts";

/** Is this an Escape signal posted by the preview iframe's own document? */
const isEscape = (value: unknown): value is { __pg: "escape" } =>
  typeof value === "object" && value !== null && (value as { __pg?: unknown }).__pg === "escape";

/** Full screen is DOM, so it is a RESOURCE: listeners registered once per scope and removed by
 * `defer` — nothing is stopped by hand. Three ways out, all landing on the same truth: the
 * document's own `fullscreenchange` event (native Escape, or another exit), Escape in the parent
 * document (clears the fit pin), and an Escape signal posted by the game iframe — the parent
 * never sees those keys, so the iframe's document forwards one and the resource admits it only
 * from the preview's own window. Fullscreen promises are handled, not dropped: success is
 * confirmed by the `fullscreenchange` listener (the cell reads the document, not the wish), a
 * refused entry falls back to fit mode, and a refused exit re-syncs from the document so the exit
 * control stays while the browser is still full screen. */
export const immersive = resource({
  label: "immersive",
  depends: { mode: modeCell.controller, view: viewCell.controller },
  factory: ({ mode, view }, { defer }) => {
    const synced = () => mode.set(document.fullscreenElement === null ? "window" : "native");
    const leave = () => {
      if (document.fullscreenElement === null) {
        mode.set("window");
        return;
      }
      document.exitFullscreen().catch(() => synced());
    };
    const dismiss = () => {
      if (mode.get() === "fit") {
        mode.set("window");
        return;
      }
      leave();
    };
    const escaped = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const messaged = (event: MessageEvent) => {
      const frame = document.querySelector("iframe");
      if (!isEscape(event.data) || frame === null || event.source !== frame.contentWindow) return;
      dismiss();
    };
    document.addEventListener("fullscreenchange", synced);
    document.addEventListener("keydown", escaped);
    window.addEventListener("message", messaged);
    defer(() => {
      document.removeEventListener("fullscreenchange", synced);
      document.removeEventListener("keydown", escaped);
      window.removeEventListener("message", messaged);
    });
    return {
      /** Fill the screen with `el`; when the browser refuses or cannot, pin it over the page. */
      enter: (el: HTMLElement | null): void => {
        view.set("play");
        const request = el?.requestFullscreen?.bind(el);
        if (request === undefined) {
          mode.set("fit");
          return;
        }
        request().catch(() => mode.set("fit"));
      },
      /** Leave full screen; a refused exit keeps the mode the document reports. */
      exit: leave,
    };
  },
});
