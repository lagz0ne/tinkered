/** A text import: `import page from "./x.md" with { type: "text" }` (Bun, and the tests' plugin). */
declare module "*.md" {
  const text: string;
  export default text;
}
