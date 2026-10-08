import ts from 'typescript';

// Share only primitive strings and ordinary object property names. No code is
// encoded or evaluated; the resulting module retains its ordinary JS operations.
export function shareLiterals(code) {
  const ast = ts.createSourceFile('runtime.mjs', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) throw new Error('Cannot share literals in invalid JavaScript');
  let prefix = '__commerceLiteral';
  while (code.includes(prefix)) prefix += '_';
  const literals = new Map();
  function visit(node) {
    // Module specifiers, export aliases and import attributes have grammar-only
    // strings. Preserve their complete declarations and dynamic import calls.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ||
        ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    const parent = node.parent;
    const key = parent && ts.isPropertyAssignment(parent) && parent.name === node;
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    const unsupportedName = parent && 'name' in parent && parent.name === node && !key;
    const dynamicImport = parent && ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword;
    if ((literal || key && ts.isIdentifier(node)) && !unsupportedName && !dynamicImport &&
        !(key && node.text === '__proto__') && !ts.isImportDeclaration(parent ?? ast) &&
        !ts.isExportDeclaration(parent ?? ast) && !ts.isExpressionStatement(parent ?? ast) &&
        !ts.isTaggedTemplateExpression(parent ?? ast)) {
      const entry = literals.get(node.text) ?? [];
      entry.push({ start: node.getStart(ast), end: node.end, key });
      literals.set(node.text, entry);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const strings = [...literals].filter(([value, uses]) => uses.length > 1 &&
    uses.reduce((sum, use) => sum + use.end - use.start - (use.key ? 4 : 2), 0) > JSON.stringify(value).length + 4).map(([value]) => value);
  if (!strings.length) return code;
  const edits = strings.flatMap((value, index) => literals.get(value).map(use => ({
    ...use, text: use.key ? `[${prefix}${index}]` : `(${prefix}${index})`,
  }))).sort((a, b) => b.start - a.start);
  let output = code;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  let insertion = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    insertion = statement.end;
  }
  const bindings = 'let ' + strings.map((value, index) => `${prefix}${index}=${JSON.stringify(value)}`).join(',') + ';';
  return output.slice(0, insertion) + (insertion ? ';' : '') + bindings + output.slice(insertion);
}
