import { parseSource, specifiers } from "../../../../packages/start/lib/source.mjs";

for (const file of process.argv.slice(2)) {
  for (const { name, line } of specifiers(parseSource(file))) {
    if (/\.(ts|tsx|mts)$/.test(name)) console.log(`${file}:${line}:${name}`);
  }
}
