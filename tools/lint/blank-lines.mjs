/**
 * A blank line after the imports and around each multi-line top-level statement. One-line
 * statements may sit together. Bodies are left alone. Oxfmt keeps blank lines but never adds
 * them, so this rule adds them through `vp lint --fix`.
 */
const blankLines = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    messages: { blank: "Add a blank line before this statement." },
  },
  create(context) {
    const code = context.sourceCode;
    const oneLine = (node) => node.loc.start.line === node.loc.end.line;
    const isImport = (node) => node.type === "ImportDeclaration";
    const mayTouch = (prev, next) =>
      (isImport(prev) && isImport(next)) || (!isImport(prev) && oneLine(prev) && oneLine(next));
    const lineEnd = (node) =>
      code
        .getCommentsAfter(node)
        .filter((comment) => comment.loc.start.line === node.loc.end.line)
        .at(-1) ?? node;
    return {
      Program(program) {
        program.body.forEach((next, index) => {
          const prev = program.body[index - 1];
          if (!prev || mayTouch(prev, next)) return;
          const top = code.getCommentsBefore(next)[0] ?? next;
          const end = lineEnd(prev);
          if (top.loc.start.line - end.loc.end.line > 1) return;
          context.report({
            node: next,
            messageId: "blank",
            fix: (fixer) => fixer.insertTextAfter(end, "\n"),
          });
        });
      },
    };
  },
};

export default { meta: { name: "tinker" }, rules: { "blank-lines": blankLines } };
