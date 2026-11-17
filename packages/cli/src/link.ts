import ts from "typescript-api";

import type { Check } from "./check";

/** A scheme, as in `https:`, `mailto:` or `tel:`: the link leaves the app. */
const scheme = /^[a-z][\w+.-]*:/i;

/** The text a value starts with, when it is written out: `"/a"`, `{"/a"}`, `` {`/a/${id}`} ``. */
function textOf(value: ts.JsxAttributeValue | undefined) {
  const written = value && ts.isJsxExpression(value) ? value.expression : value;
  if (!written) return;

  if (ts.isStringLiteral(written) || ts.isNoSubstitutionTemplateLiteral(written)) {
    return written.text;
  }
  return ts.isTemplateExpression(written) ? written.head.text : undefined;
}

/**
 * A path inside the app: `/issues`, `./next`, `?page=2`. Not `//host`, `#top`, or a scheme. An
 * empty start, as in `` `${base}/a` ``, cannot be read, so it is no finding.
 */
function isInApp(href: string) {
  return href !== "" && !href.startsWith("//") && !href.startsWith("#") && !scheme.test(href);
}

/** `download`, `target="_blank"` or `rel="external"`: the link means to leave the page. */
function leaves(attributes: ReadonlyMap<string, ts.JsxAttributeValue | undefined>) {
  const rel = textOf(attributes.get("rel")) ?? "";

  return (
    attributes.has("download") ||
    textOf(attributes.get("target")) === "_blank" ||
    rel.split(/\s+/).includes("external")
  );
}

/** An `<a>` whose `href` is written out as a path inside the app, and that does not leave it. */
function isInAppLink(node: ts.Node): node is ts.JsxOpeningLikeElement {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return false;
  if (node.tagName.getText() !== "a") return false;

  const attributes = new Map<string, ts.JsxAttributeValue | undefined>();
  for (const attribute of node.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    attributes.set(attribute.name.getText(), attribute.initializer);
  }
  const href = textOf(attributes.get("href"));
  return href !== undefined && isInApp(href) && !leaves(attributes);
}

/**
 * `tinker/link`: a plain `<a href>` to a path inside the app does a full page load, so app state
 * is lost (CUJ eval run 5: 3 of 10 writers). The router's `Link` moves without one. It borrows
 * the scope of Next.js `no-html-link-for-pages`: only a link to a path inside the app. An `href`
 * the rule cannot read, as `{url}`, is no finding: the rule does not guess.
 */
export function findLink({ path, text }: Check.Source): Check.Finding[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const links: ts.JsxOpeningLikeElement[] = [];
  const visit = (node: ts.Node) => {
    if (isInAppLink(node)) links.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);

  return links.map((link): Check.Finding => ({
    path,
    line: source.getLineAndCharacterOfPosition(link.getStart()).line + 1,
    rule: "tinker/link",
    what: "a plain <a href> to an in-app path reloads the page",
  }));
}
