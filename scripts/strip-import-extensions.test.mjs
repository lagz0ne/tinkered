import assert from "node:assert/strict";
import { test } from "node:test";
import { stripDocument, stripSource } from "./strip-import-extensions.mjs";

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
