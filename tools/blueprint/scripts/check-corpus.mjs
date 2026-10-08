import { accessSync } from "node:fs";

for (const path of ["../corpus/unitFits.yaml", "../evals/golden.yaml"])
  accessSync(new URL(path, import.meta.url));

console.log("blueprint source retains its corpus and evals");
