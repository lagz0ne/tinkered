import ts from "typescript-api";

import type { Check } from "./check";

/** What one `<a>` says, by attribute name: the value as written, or none for a bare name. */
type Attributes = ReadonlyMap<string, ts.JsxAttributeValue | undefined>;

/** A scheme, as in `https:`, `mailto:` or `tel:`: the link leaves the app. */
const scheme = /^[a-z][\w+.-]*:/i;

/**
 * A path that ends in a file name, as `/llms.txt` or `/sea.html?room=1`: the server sends a file,
 * and no route of the router answers it. A route with a dot, as `/v1.2`, passes too: the price of
 * a rule that reads no route list.
 */
const file = /^[^?#]*\.\w+(?:[?#]|$)/;

/**
 * The text of a value written out: a string, in braces or not, or a template literal with `…` for
 * each substitution. A template that starts with a substitution cannot be read: no text.
 */
function textOf(value: ts.JsxAttributeValue | undefined) {
  const written = value && ts.isJsxExpression(value) ? value.expression : value;
  if (!written) return;

  if (ts.isStringLiteral(written) || ts.isNoSubstitutionTemplateLiteral(written)) {
    return written.text;
  }
  if (!ts.isTemplateExpression(written) || !written.head.text) return;
  return (
    written.head.text + written.templateSpans.map(({ literal }) => `…${literal.text}`).join("")
  );
}

/**
 * A page inside the app: `/issues`, `./next`, `?page=2`. Not `//host`, `#top`, a scheme, or a
 * file. An empty `href` cannot be read, so it is no finding.
 */
function isPage(href: string) {
  if (href === "" || href.startsWith("//") || href.startsWith("#")) return false;
  return !scheme.test(href) && !file.test(href);
}

/**
 * An attribute the `<a>` has whose text passes `says`, or whose text the rule cannot read. A
 * target or rel that is partly read (a template with a gap) counts as read.
 */
function saysOrUnread(attributes: Attributes, name: string, says: (text: string) => boolean) {
  if (!attributes.has(name)) return false;

  const text = textOf(attributes.get(name));
  return text === undefined || says(text);
}

/**
 * `download`, `target="_blank"` or `rel="external"`: the link means to leave the page. A
 * `target` or `rel` the rule cannot read passes, as an `href` it cannot read does.
 */
function leaves(attributes: Attributes) {
  return (
    attributes.has("download") ||
    saysOrUnread(attributes, "target", (target) => target === "_blank") ||
    saysOrUnread(attributes, "rel", (rel) => rel.split(/\s+/).includes("external"))
  );
}

/**
 * The attributes of one `<a>`, or none when it has a spread: the spread may hold a `target` or
 * `rel` the rule cannot read.
 */
function attributesOf(link: ts.JsxOpeningLikeElement) {
  const attributes = new Map<string, ts.JsxAttributeValue | undefined>();
  for (const attribute of link.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) return;
    attributes.set(attribute.name.getText(), attribute.initializer);
  }
  return attributes;
}

/** The `href` of an `<a>` that is a finding: written out, a page inside the app, and it stays. */
function inAppHref(node: ts.Node) {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
  if (node.tagName.getText() !== "a") return;

  const attributes = attributesOf(node);
  if (!attributes) return;
  const href = textOf(attributes.get("href"));
  return href !== undefined && isPage(href) && !leaves(attributes) ? href : undefined;
}

/**
 * `tinker/link`: a plain `<a href>` to a path inside the app does a full page load, so app state
 * is lost (CUJ eval run 5: 3 of 10 writers). The router's `Link` moves without one. It borrows
 * the scope of Next.js `no-html-link-for-pages`: only a link to a page of the app, so a link to a
 * file passes. What the rule cannot read is no finding: the rule does not guess.
 */
export function findLink({ path, text }: Check.Source): Check.Finding[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Check.Finding[] = [];
  const visit = (node: ts.Node) => {
    const href = inAppHref(node);
    if (href !== undefined) {
      findings.push({
        path,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        rule: "tinker/link",
        what: `\`${href}\`: a plain <a href> to an in-app path reloads the page`,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return findings;
}
