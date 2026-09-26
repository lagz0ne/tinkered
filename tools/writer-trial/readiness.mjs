import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createBroker } from "./broker.mjs";
const root = join(
  homedir(),
  ".local/share/tinker-writer-trial",
  process.env.TRIAL_NAME ?? "readiness",
);
const manifest = JSON.parse(readFileSync(join(root, "manifest.json")));
const results = [];
for (const w of manifest.workers) {
  const config = JSON.parse(readFileSync(join(w.dir, ".pi/extensions/trial/worker.json")));
  const broker = createBroker({ ...config, events: join(root, "teacher-readiness.jsonl") });
  const checks = [
    [
      "host and examples absent",
      "test ! -e /home/paseo && test ! -e /var/run/docker.sock && test ! -e /work/examples && test ! -e /work/apps && test ! -e /work/teacher && echo PASS",
    ],
    [
      "packages and types",
      'node --input-type=module -e \'import {createScope} from "@tinker/core"; import {useData} from "@tinker/react"; import fs from "node:fs"; if(typeof createScope!=="function"||typeof useData!=="function")process.exit(1); for(const p of ["core","react"]) {const dir="node_modules/@tinker/"+p+"/dist";if(!fs.existsSync(dir+"/index.d.mts")||fs.existsSync(dir+"/index.mjs.map"))process.exit(2);} console.log("PASS")\'',
    ],
    [
      "no gateway key in worker",
      "node -e 'if(Object.keys(process.env).some(k=>/TOKEN|API_KEY|SECRET/.test(k)))process.exit(1);console.log(\"PASS\")'",
    ],
    [
      "network blocked",
      'node -e \'const s=require("node:net").connect({host:"1.1.1.1",port:443});s.on("connect",()=>process.exit(1));s.on("error",()=>{console.log("PASS");process.exit(0)});setTimeout(()=>{console.log("PASS");s.destroy()},1000)\'',
    ],
    [
      "browser clicks",
      'node --input-type=module -e \'import {chromium} from "playwright";const b=await chromium.launch({headless:true});try{const p=await b.newPage();await p.setContent("<button>Ready</button>");await p.getByRole("button",{name:"Ready"}).click();console.log("PASS")}finally{await b.close()}\'',
    ],
    [
      "compiler and test runner",
      "./node_modules/.bin/tsc --version && ./node_modules/.bin/vitest --version && ./node_modules/.bin/vite --version && echo PASS",
    ],
    [
      // `vite` dev and a vite.config.ts write here; node_modules itself is read-only.
      "vite cache folders writable",
      "for d in node_modules/.vite node_modules/.vite-temp; do mkdir -p $d/ready-$$ && rmdir $d/ready-$$ || exit 1; done && echo PASS",
    ],
  ];
  for (const [name, command] of checks) {
    const result = await broker.shell(command, undefined, 30);
    assert.equal(result.code, 0, `${w.model}: ${name}: ${result.output}`);
    assert.match(result.output, /PASS/);
    results.push({ model: w.model, check: name, passed: true });
  }
  const timeout = await broker.shell("sleep 5", undefined, 1);
  assert.equal(timeout.code, 124);
  results.push({ model: w.model, check: "command timeout", passed: true });
  await assert.rejects(() => broker.jev("../apps/issue-tracker/src/index.ts"), /Choose a/);
  results.push({ model: w.model, check: "Jev path boundary", passed: true });
}
writeFileSync(
  join(root, "readiness-checks.json"),
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
);
console.log(
  `${results.length} readiness checks passed across ${manifest.workers.length} worker(s)`,
);
