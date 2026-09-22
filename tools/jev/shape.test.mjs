// Focused checks for the Jev extractor and the shape helper (`shape.mjs`).
// Run: node --test tools/jev/shape.test.mjs (no network; oxc-parser is local).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { units } from "./extract.mjs";
import { inspectShape } from "./shape.mjs";

const kindOf = (src, file = "a.tsx") => units(src, file).map((u) => [u.kind, u.name]);

void describe("component extraction", () => {
  void it("marks a named function returning JSX a component", () => {
    assert.deepEqual(kindOf("function Card() { return <h1>x</h1>; }"), [["component", "Card"]]);
  });

  void it("marks an exported and a default-exported component a component", () => {
    assert.deepEqual(kindOf("export function Card() { return <h1>x</h1>; }"), [
      ["component", "Card"],
    ]);
    assert.deepEqual(kindOf("export default function DraftView() { return <main />; }"), [
      ["component", "DraftView"],
    ]);
  });

  void it("marks arrow and function-expression consts returning JSX a component", () => {
    assert.deepEqual(kindOf("const Card = () => <h1>x</h1>;"), [["component", "Card"]]);
    assert.deepEqual(kindOf("const Card = function () { return <h1>x</h1>; };"), [
      ["component", "Card"],
    ]);
  });

  void it("counts a fragment and nested JSX as a component", () => {
    assert.deepEqual(kindOf("function Live() { return <>{<p>x</p>}</>; }"), [
      ["component", "Live"],
    ]);
  });

  void it("marks a component with if/switch/try returns a component", () => {
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

  void it("keeps a helper holding an inner arrow returning JSX a function", () => {
    assert.deepEqual(kindOf("function Helper() { const render = () => <p/>; return 1; }"), [
      ["function", "Helper"],
    ]);
  });

  void it("reads every function declarator of one const statement", () => {
    assert.deepEqual(kindOf("const A = () => <a/>, B = () => <b/>;"), [
      ["component", "A"],
      ["component", "B"],
    ]);
    assert.deepEqual(kindOf("const h = (x) => x + 1, C = () => <p/>;"), [
      ["function", "h"],
      ["component", "C"],
    ]);
  });

  void it("gives each const declarator its own line and source span", () => {
    const found = units(
      "const A = () => <a/>,\n  B = (props) => <b>{String(!!props.id)}</b>;",
      "a.tsx",
    );
    assert.deepEqual(
      found.map((u) => [u.kind, u.name, u.line]),
      [
        ["component", "A", 1],
        ["component", "B", 2],
      ],
    );
    assert.match(found[0].source, /^A = /);
    assert.match(found[1].source, /^B = /);
    assert.doesNotMatch(found[1].source, /A = /);
  });

  void it("keeps a capital-named helper with no JSX a function", () => {
    assert.deepEqual(kindOf("function Helper(title) { return title.trim(); }"), [
      ["function", "Helper"],
    ]);
  });

  void it("keeps a root that only passes JSX to a call a function", () => {
    assert.deepEqual(kindOf("function start(el) { el.render(<App />); return true; }"), [
      ["function", "start"],
    ]);
  });
});

void describe("shape findings", () => {
  void it("flags an aliased useState and a namespaced useEffect with rule 9 and 8", () => {
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

  void it("lets useId through and flags useRef", () => {
    const rows = inspectShape(
      `import { useId, useRef } from "react";\nfunction C() {\n  const id = useId();\n  const ref = useRef(null);\n  return <label htmlFor={id}>{ref.current}</label>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-react-state", 4]],
    );
  });

  void it("flags useScope in a view and a scope prop, not the ScopeProvider root", () => {
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

  void it("flags a scope prop through a ThemeProvider, not only ScopeProvider", () => {
    const rows = inspectShape(
      `function V(props: { scope: Scope.Handle }) {\n  return <ThemeProvider><p>{String(!!props.scope)}</p></ThemeProvider>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-scope-prop", 1]],
    );
  });

  void it("flags a scope prop through a named Props alias and a typed scope param", () => {
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

  void it("flags a scope prop on the second declarator of one const statement", () => {
    const rows = inspectShape(
      `const A = () => <a/>,\n  B = (props: { scope: Scope.Handle }) => <b>{String(!!props.scope)}</b>;`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-scope-prop", 2]],
    );
  });

  void it("flags a scope prop through an exported Props alias", () => {
    const rows = inspectShape(
      `export type Props = { handle: Scope.Handle };\nfunction V(p: Props) {\n  return <p>{String(!!p.handle)}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-scope-prop", 2]],
    );
  });

  void it("flags writable useData in a view, plain, aliased, and namespaced", () => {
    const plain = inspectShape(
      `import { useData } from "@tinker/react";\nfunction MoveForm() {\n  const [item, setItem] = useData(formItem, { writable: true });\n  return <p>{item}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      plain.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 3]],
    );
    assert.match(plain[0].message, /rule 9/);
    const aliased = inspectShape(
      `import { useData as read } from "@tinker/react";\nfunction MoveForm() {\n  const [item, setItem] = read(formItem, { writable: true });\n  return <p>{item}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      aliased.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 3]],
    );
    const namespaced = inspectShape(
      `import * as TR from "@tinker/react";\nfunction MoveForm() {\n  const [item, setItem] = TR.useData(formItem, { writable: true });\n  return <p>{item}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(
      namespaced.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 3]],
    );
  });

  void it("leaves read-only useData, other modules, same-name functions, and useRun alone", () => {
    const readOnly = inspectShape(
      `import { useData } from "@tinker/react";\nfunction MoveForm() {\n  const item = useData(formItem);\n  return <p>{item}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(readOnly, []);
    const otherModule = inspectShape(
      `import { useData } from "./cells.ts";\nfunction MoveForm() {\n  const [item, setItem] = useData(formItem, { writable: true });\n  return <p>{item}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(otherModule, []);
    const sameName = inspectShape(
      `function useData(cell, opts) { return [cell, () => {}]; }\nfunction MoveForm() {\n  const [item, setItem] = useData(formItem, { writable: true });\n  return <p>{item}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(sameName, []);
    const runAllowed = inspectShape(
      `import { useData, useRun } from "@tinker/react";\nfunction MoveForm() {\n  const item = useData(formItem);\n  const run = useRun(submitMove);\n  return <p onClick={() => run.run()}>{item}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(runAllowed, []);
  });

  void it("flags writable useData in one scope, not a sibling's local or a param", () => {
    const sibling = inspectShape(
      `import { useData } from "@tinker/react";\nfunction helper() { const useData = () => {}; }\nfunction View() { const x = useData(cell, { writable: true }); return <div/>; }`,
      "case.tsx",
    );
    assert.deepEqual(
      sibling.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 3]],
    );
    const param = inspectShape(
      `import { useData } from "@tinker/react";\nfunction View(useData) { const x = useData(cell, { writable: true }); return <div/>; }`,
      "case.tsx",
    );
    assert.deepEqual(param, []);
    const bare = inspectShape(
      `function View() { const x = useData(cell, { writable: true }); return <div/>; }`,
      "case.tsx",
    );
    assert.deepEqual(bare, []);
  });

  void it("flags aliased and namespaced hook calls, not their shadowed names", () => {
    const aliased = inspectShape(
      `import { useData as read } from "@tinker/react";\nfunction View() { const [a, setA] = read(c, { writable: true }); return <p>{a}</p>; }`,
      "case.tsx",
    );
    assert.deepEqual(
      aliased.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 2]],
    );
    const shadowedAlias = inspectShape(
      `import { useData as read } from "@tinker/react";\nfunction View(read) { const [a, setA] = read(c, { writable: true }); return <p>{a}</p>; }`,
      "case.tsx",
    );
    assert.deepEqual(shadowedAlias, []);
    const namespaced = inspectShape(
      `import * as TR from "@tinker/react";\nfunction View() { const [a, setA] = TR.useData(c, { writable: true }); return <p>{a}</p>; }`,
      "case.tsx",
    );
    assert.deepEqual(
      namespaced.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 2]],
    );
    const shadowedNs = inspectShape(
      `import * as TR from "@tinker/react";\nfunction View(TR) { const [a, setA] = TR.useData(c, { writable: true }); return <p>{a}</p>; }`,
      "case.tsx",
    );
    assert.deepEqual(shadowedNs, []);
  });

  void it("flags one mixed file's imported call only", () => {
    const rows = inspectShape(
      `import { useData } from "@tinker/react";\nfunction helper() { const useData = () => {}; }\nfunction Shadowed(useData) { const y = useData(c, { writable: true }); return <div/>; }\nfunction View() { const [a, setA] = useData(c, { writable: true }); return <p>{a}</p>; }`,
      "case.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 4]],
    );
  });

  void it("binds a nested function local wherever the use sits", () => {
    const nested = inspectShape(
      `import { useData } from "@tinker/react"; function View() { function useData() {} const x=useData(c,{writable:true}); return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(nested, []);
    const hoisted = inspectShape(
      `import { useData } from "@tinker/react"; function View() { const x=useData(c,{writable:true}); function useData() {} return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(hoisted, []);
  });

  void it("binds late imports and late functions before resolving calls", () => {
    const lateImport = inspectShape(
      `function V(){ useData(c,{writable:true}); return <div/>; } import {useData} from "@tinker/react";`,
      "a.tsx",
    );
    assert.deepEqual(
      lateImport.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 1]],
    );
    const lateFunction = inspectShape(
      `import {useData} from "@tinker/react"; function V(){ useData(c,{writable:true}); function useData(){} return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(lateFunction, []);
  });

  void it("keeps catch params and loop heads inside their own frame", () => {
    const afterCatch = inspectShape(
      `import {useData} from "@tinker/react"; function V(){ try{}catch(useData){} useData(c,{writable:true}); return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(
      afterCatch.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 1]],
    );
    const insideCatch = inspectShape(
      `import {useData} from "@tinker/react"; function V(){ try{}catch(useData){ useData(c,{writable:true}); } return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(insideCatch, []);
    const afterLoop = inspectShape(
      `import {useData} from "@tinker/react"; function V(){ for(let useData of []){} useData(c,{writable:true}); return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(
      afterLoop.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 1]],
    );
    const insideLoop = inspectShape(
      `import {useData} from "@tinker/react"; function V(){ for(let useData of []){ useData(c,{writable:true}); } return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(insideLoop, []);
  });

  void it("keeps a block-local const inside its block", () => {
    const rows = inspectShape(
      `import { useData } from "@tinker/react"; function View() { { const useData = () => {}; } const x=useData(c,{writable:true}); return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(
      rows.map((r) => [r.id, r.line]),
      [["no-writable-in-view", 1]],
    );
    const inside = inspectShape(
      `import { useData } from "@tinker/react"; function View() { { const useData = () => {}; const y=useData(c,{writable:true}); } return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(inside, []);
  });

  void it("reads defaults and rests in params, including aliased and namespaced", () => {
    const def = inspectShape(
      `import { useData } from "@tinker/react"; function View(useData = local) { const x=useData(c,{writable:true}); return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(def, []);
    const rest = inspectShape(
      `import { useData } from "@tinker/react"; function View({a, ...useData}) { const x=useData(c,{writable:true}); return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(rest, []);
    const aliasDef = inspectShape(
      `import { useData as read } from "@tinker/react"; function View(read = local) { const x=read(c,{writable:true}); return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(aliasDef, []);
    const nsParam = inspectShape(
      `import * as TR from "@tinker/react"; function View(TR = local) { const x=TR.useData(c,{writable:true}); return <div/>; }`,
      "a.tsx",
    );
    assert.deepEqual(nsParam, []);
  });

  void it("leaves plain helpers and typed non-scope props alone", () => {
    assert.deepEqual(inspectShape("function Helper(title) { return title.trim(); }", "a.tsx"), []);
    assert.deepEqual(
      inspectShape(
        "function C(props: { readonly issueId: string }) { return <p>{props.issueId}</p>; }",
        "a.tsx",
      ),
      [],
    );
  });

  void it("returns stable rows in source order", () => {
    const rows = inspectShape(
      `import { useState } from "react";\nfunction C() {\n  const [d] = useState("");\n  return <p>{d}</p>;\n}`,
      "a.tsx",
    );
    assert.deepEqual(Object.keys(rows[0]).sort(), ["id", "line", "message"]);
    assert.equal(rows[0].line, 3);
  });
});
