/** A text import: `import page from "./x.md" with { type: "text" }` (Bun, and the tests' plugin). */
declare module "*.md" {
  const text: string;
  export default text;
}

/** Vite's `?raw`: the file's text. The play starter reads its files this way. */
declare module "*?raw" {
  const text: string;
  export default text;
}
