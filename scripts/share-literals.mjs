import ts from 'typescript-api';

// Share only primitive strings and ordinary object property names, including
// frequent member-access names rewritten to computed access through the same
// bindings (obj.longName -> obj[binding]). No code is encoded or evaluated;
// the resulting module retains its ordinary JS operations.
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
    // A destructured name ({ name: binding } = value) reads through the same binding as a computed key.
    const key = parent && (ts.isPropertyAssignment(parent) && parent.name === node ||
      ts.isBindingElement(parent) && parent.propertyName === node && ts.isIdentifier(node));
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
    // A member access (obj.name, obj?.name) can read through a shared binding
    // as computed access with identical semantics. Private names are a
    // different node kind and never reach here; __proto__ stays excluded.
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) &&
        node.name.text !== '__proto__') {
      const start = node.questionDotToken ? node.questionDotToken.getStart(ast) : node.name.getStart(ast) - 1;
      if (code[start] === '.' || code[start] === '?') {
        const entry = literals.get(node.name.text) ?? [];
        entry.push({ start, end: node.name.end, key: false, member: true, optional: !!node.questionDotToken });
        literals.set(node.name.text, entry);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const strings = [...literals].filter(([value, uses]) => uses.length > 1 &&
    uses.reduce((sum, use) => sum + use.end - use.start - (use.key || use.member ? 4 : 2), 0) > JSON.stringify(value).length + 4).map(([value]) => value);
  if (!strings.length) return code;
  const edits = strings.flatMap((value, index) => literals.get(value).map(use => ({
    ...use, text: use.member
      ? `${use.optional ? '?.' : ''}[${prefix}${index}]`
      : use.key ? `[${prefix}${index}]` : `(${prefix}${index})`,
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

// Standard JavaScript and Workers globals the bundle names often. Each is read once into a module
// binding at start-up, so every use still reaches the same object or function; nothing is replaced
// later at runtime in a Worker. Names the bundle itself declares anywhere are left alone.
const GLOBALS = ['Object', 'Error', 'TypeError', 'Number', 'Array', 'String', 'Boolean', 'JSON', 'Date', 'BigInt', 'Set', 'Map',
  'Promise', 'Math', 'Reflect', 'URL', 'Uint8Array', 'Uint32Array', 'TextEncoder', 'TextDecoder', 'encodeURIComponent',
  'decodeURIComponent', 'structuredClone', 'crypto'];

/**
 * Reads frequent globals and `void 0` through short module bindings (Object.keys -> G0.keys,
 * void 0 -> an unassigned binding, which is undefined). A shorthand property keeps its key.
 */
export function shareGlobals(code) {
  const ast = ts.createSourceFile('runtime.mjs', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) throw new Error('Cannot share globals in invalid JavaScript');
  let prefix = '__commerceGlobal';
  while (code.includes(prefix)) prefix += '_';
  const declared = new Set(), uses = new Map();
  const use = (name, edit) => uses.set(name, [...uses.get(name) ?? [], edit]);
  function visit(node) {
    const parent = node.parent;
    if (ts.isIdentifier(node) && parent) {
      const declaration = 'name' in parent && parent.name === node && !ts.isPropertyAccessExpression(parent) &&
        !ts.isPropertyAssignment(parent) && !ts.isMethodDeclaration(parent) && !ts.isPropertyDeclaration(parent) &&
        !ts.isGetAccessorDeclaration(parent) && !ts.isSetAccessorDeclaration(parent) && !ts.isShorthandPropertyAssignment(parent) &&
        !ts.isExportSpecifier(parent) && !ts.isLabeledStatement(parent) && !ts.isPropertySignature(parent) && !ts.isJsxAttribute?.(parent);
      // typeof tolerates a missing global and a start-up read would not, so such a name is left alone too.
      if (declaration || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) ||
          ts.isTypeOfExpression(parent)) declared.add(node.text);
      const reference = GLOBALS.includes(node.text) && !declaration &&
        !(ts.isPropertyAccessExpression(parent) && parent.name === node) && !(ts.isQualifiedName(parent) && parent.right === node) &&
        !(ts.isBindingElement(parent) && parent.propertyName === node) && !(ts.isPropertyAssignment(parent) && parent.name === node) &&
        !ts.isMethodDeclaration(parent) && !ts.isPropertyDeclaration(parent) && !ts.isGetAccessorDeclaration(parent) &&
        !ts.isSetAccessorDeclaration(parent) && !ts.isExportSpecifier(parent) && !ts.isImportSpecifier(parent) &&
        !ts.isLabeledStatement(parent) && !ts.isBreakOrContinueStatement(parent);
      if (reference) use(node.text, { start: node.getStart(ast), end: node.end, shorthand: ts.isShorthandPropertyAssignment(parent) });
    }
    if (ts.isVoidExpression(node) && ts.isNumericLiteral(node.expression) && node.expression.text === '0') {
      use('void 0', { start: node.getStart(ast), end: node.end, wrap: true });
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  // A binding pays for itself once its uses outweigh its declaration (the final minifier gives it a short name).
  const names = [...uses].filter(([name, list]) => !declared.has(name) && list.length * (name.length - 2) > name.length + 4).map(([name]) => name);
  if (!names.length) return code;
  const edits = names.flatMap((name, index) => uses.get(name).map(edit => ({
    ...edit, text: edit.shorthand ? `${name}:${prefix}${index}` : edit.wrap ? `(${prefix}${index})` : `${prefix}${index}`,
  }))).sort((a, b) => b.start - a.start);
  let output = code;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  let insertion = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    insertion = statement.end;
  }
  // undefined is read from the global object (a read-only undefined) so the final minifier keeps the binding.
  const bindings = 'let ' + names.map((name, index) => `${prefix}${index}=${name === 'void 0' ? 'globalThis.undefined' : name}`).join(',') + ';';
  return output.slice(0, insertion) + (insertion ? ';' : '') + bindings + output.slice(insertion);
}
