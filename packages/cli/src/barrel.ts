import ts from "typescript-api";

import type { Check } from "./check";

/** The names one import binds: its default, its namespace, and each named one. */
function boundBy({ name, namedBindings }: ts.ImportClause) {
  const names = name ? [name.text] : [];
  if (!namedBindings) return names;
  if (ts.isNamespaceImport(namedBindings)) return [...names, namedBindings.name.text];
  return [...names, ...namedBindings.elements.map((element) => element.name.text)];
}

function importedNames(source: ts.SourceFile) {
  return new Set(
    source.statements.flatMap((statement) =>
      ts.isImportDeclaration(statement) && statement.importClause
        ? boundBy(statement.importClause)
        : [],
    ),
  );
}

/** `export { a, b as c }` with no `from`: it passes on an import when one local name is one. */
function passesOn(imported: Set<string>, statement: ts.ExportDeclaration) {
  const list = statement.exportClause;
  if (!list || !ts.isNamedExports(list)) return false;

  return list.elements.some(({ propertyName, name }) => imported.has((propertyName ?? name).text));
}

/** A statement that exports what another module declares. */
function isBarrel(imported: Set<string>, statement: ts.Statement) {
  if (!ts.isExportDeclaration(statement)) return false;

  return Boolean(statement.moduleSpecifier) || passesOn(imported, statement);
}

/**
 * `tinker/barrel` (ADR 0160): app code has no barrel. A barrel hides which file an import
 * reaches, so a page can take server code by accident. A finding is `export … from "…"` of
 * values or of types, and `export { name }` of an imported name. A file that exports what it
 * declares passes, as `export const plus = add` does. Only top-level statements can export.
 */
export function findBarrel({ path, text }: Check.Source): Check.Finding[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imported = importedNames(source);

  return source.statements
    .filter((statement) => isBarrel(imported, statement))
    .map((statement): Check.Finding => ({
      path,
      line: source.getLineAndCharacterOfPosition(statement.getStart()).line + 1,
      rule: "tinker/barrel",
      what: `\`${statement.getText(source).replace(/\s+/g, " ").replace(/;$/, "")}\`: a re-export`,
    }));
}
