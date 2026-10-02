import { accessSync } from "node:fs";
for (const path of ["tools/blueprint/corpus/unitFits.yaml", "tools/blueprint/evals/golden.yaml"])
  accessSync(path);
console.log("blueprint source retains its corpus and evals");
