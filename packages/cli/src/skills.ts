import { listIntentSkills, loadIntentSkill } from "@tanstack/intent/core";

export declare namespace Skills {
  /**
   * One "Common mistakes" section of a skill: `### HIGH: <title> [tinker/<id>]`. `right` is
   * its `Right:` part, line by line, and `skill` the skill that holds it, as Intent names it.
   */
  type Section = { rule: string; title: string; skill: string; right: string[] };
  /** The fix a finding prints, and the skill to load for more. */
  type Fix = { right: string[]; skill: string };
}

const heading = /^###\s+[A-Z]+:\s+(.*?)\s*\[(tinker\/[\w-]+)\]\s*$/;

/** A fenced block goes with the `Right:` text that leads into it. */
const fence = /^\s*```/;

/** The block after line `from`: up to a blank line, or to the end of a fence. */
function blockAt(lines: readonly string[], from: number) {
  const block: string[] = [];
  let open = false;

  for (const line of lines.slice(from)) {
    if (fence.test(line)) open = !open;
    if (!open && !line.trim() && block.length) break;
    if (line.trim() || open) block.push(line);
  }
  return block;
}

/** The `Right:` part: its paragraph, and the block after it when the paragraph ends in `:`. */
function rightOf(lines: readonly string[]) {
  const start = lines.findIndex((line) => line.startsWith("Right:"));
  if (start < 0) return [];

  const right = blockAt(lines, start);
  if (!right.at(-1)?.trimEnd().endsWith(":")) return right;
  return [...right, ...blockAt(lines, start + right.length + 1)];
}

/** Each section of one skill's text that carries a rule id in its heading. */
export function sectionsIn(text: string, skill: string): Skills.Section[] {
  const lines = text.split("\n");
  let open = false;
  const heads = lines.flatMap((line, index) => {
    if (fence.test(line)) open = !open;
    return !open && /^#{1,6} /.test(line) ? [index] : [];
  });

  return heads.flatMap((at, index) => {
    const match = heading.exec(lines[at] ?? "");
    if (!match) return [];
    const [, title = "", rule = ""] = match;
    const body = lines.slice(at + 1, heads[index + 1] ?? lines.length);
    return [{ rule, title, skill, right: rightOf(body) }];
  });
}

/** Every rule section of the skills the app at `root` has installed, through Intent. */
export function sectionsOf(root: string): Skills.Section[] {
  return listIntentSkills({ cwd: root }).skills.flatMap(({ use }) =>
    sectionsIn(loadIntentSkill(use, { cwd: root }).content, use),
  );
}

/**
 * The fix for a finding of `rule`: the `Right:` part of its section. Where a rule has more
 * than one section, the one whose heading names the code that `what` names wins.
 */
export function fixOf(
  sections: readonly Skills.Section[],
  rule: string,
  what: string,
): Skills.Fix | undefined {
  const own = sections.filter((section) => section.rule === rule && section.right.length);
  const named = own.find(({ title }) =>
    [...title.matchAll(/`([^`]+)`/g)].some(([, code = ""]) => what.includes(`\`${code}\``)),
  );
  const section = named ?? own[0];
  return section && { right: section.right, skill: section.skill };
}

/** `tinker skill list`: each skill the app has, with the line that says when to load it. */
export function listSkills(root: string) {
  const { skills } = listIntentSkills({ cwd: root, audience: "agent" });
  if (!skills.length) return "no skills found: add a package that ships skills\n";

  const rows = skills.map(({ use, description }) => `${use}\n  ${description}`);
  return `${rows.join("\n")}\n\nLoad one: tinker skill load <skill>\n`;
}

/** `tinker skill load <skill>`: the skill's text, as its package ships it. */
export function loadSkill(root: string, use: string) {
  return loadIntentSkill(use, { cwd: root, audience: "agent" }).content;
}
