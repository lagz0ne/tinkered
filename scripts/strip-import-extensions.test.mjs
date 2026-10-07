import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  stripDocument,
  stripHtml,
  stripJsonLines,
  stripSource,
} from "./strip-import-extensions.mjs";

const ts = "." + "ts";
const tsx = "." + "tsx";
const mts = "." + "mts";

await test("rewrites module paths, preserves assets and plain strings, and is safe to repeat", () => {
  const input = `import a from './a${ts}';
export * from "./dir/index${mts}";
import("./view${tsx}");
type T = import("./types${ts}").T;
import y = require("./other${ts}");
import "./plain.mjs"; import "./data.json"; import "./style.css";
import "./asset${ts}?url";
const path = "./a${ts}";
const text = "雪"; import "./snow${ts}";`;
  const result = stripSource(input);
  assert.equal(result.count, 6);
  assert.equal(
    result.text,
    input
      .replaceAll(ts + "'", "'")
      .replace(`index${mts}"`, 'index"')
      .replace(`view${tsx}"`, 'view"')
      .replace(`types${ts}"`, 'types"')
      .replace(`other${ts}"`, 'other"')
      .replace(`snow${ts}"`, 'snow"'),
  );
  assert.deepEqual(stripSource(result.text), { text: result.text, count: 0 });
});

await test("rewrites Markdown samples and source held in fixture strings and templates", () => {
  const sample = `import a from "./a${ts}";`;
  const markdown = "Text.\n```ts\n" + sample + "\n```\n";
  assert.equal(stripDocument(markdown).text, markdown.replace(`a${ts}`, "a"));
  const fixture = `const fixture = ${JSON.stringify(sample)};`;
  assert.equal(
    stripSource(fixture, "fixture.mjs").text,
    `const fixture = ${JSON.stringify('import a from "./a";')};`,
  );
  const template = "const fixture = `" + sample + "`;";
  assert.equal(stripSource(template, "fixture.mjs").text, template.replace(`a${ts}`, "a"));
});

await test("rewrites highlighted HTML samples and keeps entry file paths and color spans", () => {
  const input =
    `<script type="module" src="/main${tsx}"></script><pre><code>` +
    `<span class="keyword">import</span> x from <span class="string">&quot;./x${ts}&quot;</span>;` +
    "</code></pre>";
  assert.deepEqual(stripHtml(input), { text: input.replace(`./x${ts}`, "./x"), count: 1 });
});

await test("rewrites saved judge code and keeps its ID tied to its state", () => {
  const row = {
    id: "old",
    judge: "leakedInternal",
    label: false,
    state: { code: `import x from "./x${ts}";`, file: "x.ts" },
    why: "a private module",
  };
  const result = stripJsonLines(JSON.stringify(row) + "\n");
  const changed = JSON.parse(result.text);
  assert.equal(result.count, 1);
  assert.deepEqual(changed.state, { code: 'import x from "./x";', file: "x.ts" });
  assert.equal(
    changed.id,
    createHash("sha1")
      .update(row.judge + "false" + JSON.stringify(changed.state))
      .digest("hex")
      .slice(0, 12),
  );
  assert.equal(changed.why, row.why);
  assert.deepEqual(stripJsonLines(result.text), { text: result.text, count: 0 });
});
