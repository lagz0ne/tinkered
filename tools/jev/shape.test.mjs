// Focused checks for the Jev extractor and the shape helper (`shape.mjs`).
// Run: node --test tools/jev/shape.test.mjs (no network; oxc-parser is local).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { units } from "./extract.mjs";
import { inspectShape } from "./shape.mjs";

const kindOf = (src, file = "a.tsx") => units(src, file).map((u) => [u.kind, u.name]);

describe("component extraction", () => {
  it("marks a named function returning JSX a component", () => {
    assert.deepEqual(kindOf("function Card() { return <h1>x</h1>; }"), [["component", "Card"]]);
  });

  it("marks an exported and a default-exported component a component", () => {
    assert.deepEqual(kindOf("export function Card() { return <h1>x</h1>; }"), [
      ["component", "Card"],
    ]);
    assert.deepEqual(kindOf("export default function DraftView() { return <main />; }"), [
      ["component", "DraftView"],
    ]);
  });

  it("marks arrow and function-expression consts returning JSX a component", () => {
    assert.deepEqual(kindOf("const Card = () => <h1>x</h1>;"), [["component", "Card"]]);
    assert.deepEqual(kindOf("const Card = function () { return <h1>x</h1>; };"), [
      ["component", "Card"],
    ]);
  });

  it("counts a fragment and nested JSX as a component", () => {
    assert.deepEqual(kindOf("function Live() { return <>{<p>x</p>}</>; }"), [
      ["component", "Live"],
    ]);
  });

  it("marks a component with if/switch/try returns a component", () => {
    assert.deepEqual(kindOf("function C({ok}) { if (ok) return <p/>; return null; }"), [
      ["component", "C"],
    ]);
    assert.deepEqual(
      kindOf("function C({m}) { switch (m) { case 1: return <a/>; default: return <b/>; } }"),
      [["component", "C"]],
    );
    assert.deepEqual(kindOf("function C() { try { return <a/>; } catch { return <b/>; } }"), [
      ["component", "C"],
    ]);
  });

  it("keeps a helper holding an inner arrow returning JSX a function", () => {
    assert.deepEqual(kindOf("function Helper() { const render = () => <p/>; return 1; }"), [
      ["function", "Helper"],
    ]);
  });

  it("reads every function declarator of one const statement", () => {
    assert.deepEqual(kindOf("const A = () => <a/>, B = () => <b/>;"), [
      ["component", "A"],
      ["component", "B"],
    ]);
    assert.deepEqual(kindOf("const h = (x) => x + 1, C = () => <p/>;"), [
      ["function", "h"],
      ["component", "C"],
    ]);
  });

  it("keeps a capital-named helper with no JSX a function", () => {
    assert.deepEqual(kindOf("function Helper(title) { return title.trim(); }"), [
      ["function", "Helper"],
    ]);
  });

  it("keeps a root that only passes JSX to a call a function", () => {
    assert.deepEqual(kindOf("function start(el) { el.render(<App />); return true; }"), [
      ["function", "start"],
    ]);
  });
});

describe("shape findings", () => {
  it("flags an aliased useState and a namespaced useEffect with rule 9 and 8", () => {
    const rows = inspectShape(
      `import { useState as u } from "react";\nimport * as R from "react";\nfunction C() {\n  const [d] = u("");\n  R.useEffect(() => {}, []);\n  return <p>{d}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [
        ["no-react-state", 4],
        ["no-effect", 5],
      ],
    );
    assert.match(rows[0].message, /rule 9/);
    assert.match(rows[1].message, /rule 8/);
  });

  it("lets useId through and flags useRef", () => {
    const rows = inspectShape(
      `import { useId, useRef } from "react";\nfunction C() {\n  const id = useId();\n  const ref = useRef(null);\n  return <label htmlFor={id}>{ref.current}</label>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-react-state", 4]],
    );
  });

  it("flags useScope in a view and a scope prop, not the ScopeProvider root", () => {
    const rows = inspectShape(
      `import { useScope } from "@tinker/react";\nfunction C() {\n  const s = useScope();\n  return <p>{String(!!s)}</p>;\n}\nfunction D({ scope }) {\n  return <p>{scope}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [
        ["no-scope-in-view", 3],
        ["no-scope-prop", 6],
      ],
    );
    const aliased = inspectShape(
      `import { ScopeProvider as SP } from "@tinker/react";\nexport function Root(props) {\n  return <SP scope={props.scope}><App /></SP>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(aliased, []);
    const namespaced = inspectShape(
      `import * as R from "@tinker/react";\nexport function Root(props) {\n  return <R.ScopeProvider scope={props.scope}><App /></R.ScopeProvider>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(namespaced, []);
  });

  it("flags a scope prop through a ThemeProvider, not only ScopeProvider", () => {
    const rows = inspectShape(
      `function V(props: { scope: Scope.Handle }) {\n  return <ThemeProvider><p>{String(!!props.scope)}</p></ThemeProvider>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-scope-prop", 1]],
    );
  });

  it("flags a scope prop through a named Props alias and a typed scope param", () => {
    const aliased = inspectShape(
      `type Props = { scope: Scope.Handle };\nfunction D(p: Props) {\n  return <p>{String(!!p.scope)}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      aliased.map((r) => [r.id, r.line]),
      [["no-scope-prop", 2]],
    );
    const typed = inspectShape(
      `function D(scope: Scope.Handle) {\n  return <p>{String(!!scope)}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      typed.map((r) => [r.id, r.line]),
      [["no-scope-prop", 1]],
    );
  });

  it("flags a scope prop on the second declarator of one const statement", () => {
    const rows = inspectShape(
      `const A = () => <a/>, B = (props: { scope: Scope.Handle }) => <b>{String(!!props.scope)}</b>;`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-scope-prop", 1]],
    );
  });

  it("leaves plain helpers and typed non-scope props alone", () => {
    assert.deepEqual(inspectShape("function Helper(title) { return title.trim(); }", "a.tsx"), []);
    assert.deepEqual(
      inspectShape(
        "function C(props: { readonly issueId: string }) { return <p>{props.issueId}</p>; }",
        "a.tsx",
      ),
      [],
    );
  });

  it("returns stable rows in source order", () => {
    const rows = inspectShape(
      `import { useState } from "react";\nfunction C() {\n  const [d] = useState("");\n  return <p>{d}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(Object.keys(rows[0]).sort(), ["id", "line", "message"]);
    assert.equal(rows[0].line, 3);
  });
});
