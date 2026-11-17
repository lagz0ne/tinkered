import ts from "typescript-api";

import type { Check } from "./check";

/** A scheme, as in `https:`, `mailto:` or `tel:`: the link leaves the app. */
const scheme = /^[a-z][\w+.-]*:/i;

/**
 * A path that ends in a file name, as `/llms.txt` or `/sea.html?room=1`: the server sends a file,
 * and no route of the router answers it.
 */
const file = /^[^?#]*\.\w+(?:[?#]|$)/;

/**
 * The text of a value written out: a string, in braces or not, or a template literal with each
 * substitution left out. A template that starts with a substitution cannot be read: no text.
 */
function textOf(value: ts.JsxAttributeValue | undefined) {
  const written = value && ts.isJsxExpression(value) ? value.expression : value;
  if (!written) return;

  if (ts.isStringLiteral(written) || ts.isNoSubstitutionTemplateLiteral(written)) {
    return written.text;
  }
  if (!ts.isTemplateExpression(written) || !written.head.text) return;
  return written.head.text + written.templateSpans.map(({ literal }) => literal.text).join("");
}

/**
 * A page inside the app: `/issues`, `./next`, `?page=2`. Not `//host`, `#top`, a scheme, or a
 * file. An empty `href` cannot be read, so it is no finding.
 */
function isPage(href: string) {
  if (href === "" || href.startsWith("//") || href.startsWith("#")) return false;
  return !scheme.test(href) && !file.test(href);
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
  return href !== undefined && isPage(href) && !leaves(attributes);
}

/**
 * `tinker/link`: a plain `<a href>` to a path inside the app does a full page load, so app state
 * is lost (CUJ eval run 5: 3 of 10 writers). The router's `Link` moves without one. It borrows
 * the scope of Next.js `no-html-link-for-pages`: only a link to a page of the app, so a link to a
 * file passes. An `href` the rule cannot read, as `{url}`, is no finding: the rule does not guess.
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
