import { resolve } from "node:path";

import { check } from "./check";
import type { Check } from "./check";
import { isError } from "./errors";
import { rules } from "./rules";

export declare namespace Main {
  /** What the command would print and exit with. Nothing is printed here. */
  type Result = { code: number; out: string; err: string };
}

const usage = `usage: tinker-analyze check [root]

Reads the app at root (default: this folder) and prints each broken rule:
  <file>:<line> <rule id> <what is there>
then, per rule, the next step and the skill to read.
`;

/** One line per finding, then one block per rule that has a finding. */
function report({ files, findings }: Check.Report): Main.Result {
  if (!findings.length) return { code: 0, out: `no findings in ${files} files\n`, err: "" };

  const lines = findings.map(({ path, line, rule, what }) => `${path}:${line} ${rule} ${what}`);
  const broken = [...new Set(findings.map((finding) => finding.rule))].sort();
  const steps = broken.flatMap((rule) => [
    `${rule}: ${rules[rule].fix}`,
    `  read: ${rules[rule].skill}`,
  ]);

  const count = `${findings.length} findings in ${files} files`;
  return { code: 1, out: "", err: [...lines, "", ...steps, "", count, ""].join("\n") };
}

/**
 * The command, without the process: `argv` is what follows the program name, and `cwd` is
 * the folder a relative root starts from. Exit 0 is a clean app, 1 is a finding, 2 is a
 * call or a config the command cannot read.
 */
export function main(argv: readonly string[], cwd: string): Main.Result {
  const [command, root = ".", ...rest] = argv;
  if (command !== "check" || rest.length) return { code: 2, out: "", err: usage };

  try {
    return report(check(resolve(cwd, root)));
  } catch (error) {
    if (!isError(error, "BadConfig")) throw error;
    const { path, reason } = error.payload;
    return { code: 2, out: "", err: `${path}: ${reason}\n` };
  }
}
