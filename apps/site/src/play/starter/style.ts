// The ocean's look, as one stylesheet App puts in a <style>. Swiss compact: one sans, ink on
// paper, one red, hard rules. It fits a phone, a frame, or a full screen.

/** The scene holds one canvas that fills it; the engine draws the board there. */
export const css = `
  * { box-sizing: border-box; }
  :root { color-scheme: light; --paper: #fafaf8; --ink: #111; --mute: #63656b; --line: #dddcd7;
    --red: #d0261b; --sans: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif; }
  body { margin: 0; background: var(--paper); }
  button, input { font: inherit; color: inherit; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
  .wrap { min-height: 100dvh; display: flex; flex-direction: column; padding: 0 16px;
    color: var(--ink); font: 13px/1.4 var(--sans); container-type: inline-size; }
  .head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between;
    gap: 4px 16px; padding: 12px 0 8px; border-bottom: 2px solid var(--ink); }
  h1 { margin: 0; font-size: clamp(22px, 6cqw, 40px); line-height: 1; letter-spacing: -.025em; font-weight: 700; }
  .live { display: flex; gap: 12px; margin: 0; color: var(--mute); font-size: 12px; }
  .live .on { color: var(--red); font-weight: 700; }
  .live b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .scene { position: relative; flex: 1; min-width: 0; min-height: clamp(240px, 66cqw, 640px);
    max-height: calc(70cqw + 48px); }
  /* A vertical swipe scrolls the page; any other drag draws on the water. */
  .sea { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: pointer;
    touch-action: pan-y; outline: none; -webkit-tap-highlight-color: transparent; }
  .sea:focus-visible { outline: 2px solid var(--red); outline-offset: -2px; }
  .caption { position: absolute; bottom: 6px; left: 0; margin: 0; color: var(--mute); font-size: 12px; pointer-events: none; }
  .panel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px;
    padding: 8px 0 12px; border-top: 2px solid var(--ink); }
  .group { min-width: 0; }
  .group.wide { grid-column: 1 / -1; }
  h2 { margin: 0 0 6px; font-size: 12px; font-weight: 700; }
  h2 > span { color: var(--red); }
  .row { display: flex; }
  .row button { flex: 1; min-height: 36px; padding: 0 10px; border: 1px solid var(--ink);
    background: #fff; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .row button + button { border-left: 0; }
  .row button:hover { color: var(--red); }
  .row .main { background: var(--ink); color: var(--paper); }
  .row .main:hover { color: var(--paper); background: var(--red); border-color: var(--red); }
  .row .main[aria-pressed="true"] { background: var(--red); border-color: var(--red); }
  .sliders { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .ctl { display: grid; min-width: 0; color: var(--mute); font-size: 12px; }
  .ctl > span { display: flex; justify-content: space-between; gap: 6px; }
  .ctl b { color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ctl input { width: 100%; height: 28px; margin: 0; accent-color: var(--ink); cursor: pointer; }
  @container (min-width: 760px) {
    .panel { grid-template-columns: 1fr 1fr 2fr; }
    .group.wide { grid-column: auto; }
  }
  @container (max-width: 420px) {
    .sliders { grid-template-columns: 1fr; gap: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
  }
`;
