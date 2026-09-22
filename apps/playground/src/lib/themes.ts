import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

export type ThemeId = "github-light" | "github-dark" | "one-dark";

/** Common, high-contrast editor themes; the initial selection matches the dark game shell. */
export const THEMES: readonly { id: ThemeId; label: string; extension: Extension }[] = [
  { id: "github-light", label: "GitHub Light", extension: githubLight },
  { id: "github-dark", label: "GitHub Dark", extension: githubDark },
  { id: "one-dark", label: "One Dark", extension: oneDark },
];

const [DEFAULT_THEME] = THEMES;

export function themeExtension(id: ThemeId): Extension {
  return (THEMES.find((t) => t.id === id) ?? DEFAULT_THEME).extension;
}
