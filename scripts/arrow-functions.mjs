import ts from 'typescript-api';

/**
 * Rewrites top-level function declarations as arrow functions declared first in the module
 * (function a(e){return e} -> var a=e=>e), which the final minifier writes shorter. A function is
 * left alone when it could tell the difference: one that reads this, arguments, super or
 * new.target, a generator, one declared twice, and one the module constructs or reads a
 * prototype of. Declaring them all before any other statement keeps the hoisting a declaration had:
 * every one exists before start-up code can call it, and a body still reads other bindings only
 * when it runs.
 */
export function arrowFunctions(code) {
  const ast = ts.createSourceFile('runtime.mjs', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) throw new Error('Cannot rewrite functions in invalid JavaScript');
  const counts = new Map(), constructed = new Set();
  ast.statements.forEach(s => ts.isFunctionDeclaration(s) && s.name && counts.set(s.name.text, (counts.get(s.name.text) ?? 0) + 1));
  (function visit(node) {
    // new f, f.prototype and x instanceof f need a real function, as does any other declaration of the name.
    const name = ts.isNewExpression(node) ? node.expression : ts.isPropertyAccessExpression(node) && node.name.text === 'prototype' ? node.expression
      : ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword ? node.right : undefined;
    if (name && ts.isIdentifier(name)) constructed.add(name.text);
    if (ts.isIdentifier(node) && node.parent && 'name' in node.parent && node.parent.name === node &&
      !(ts.isFunctionDeclaration(node.parent) && node.parent.parent === ast) && !ts.isPropertyAccessExpression(node.parent) &&
      !ts.isPropertyAssignment(node.parent) && !ts.isMethodDeclaration(node.parent) && !ts.isBindingElement(node.parent)) constructed.add(node.text);
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) constructed.add(node.name.text);
    ts.forEachChild(node, visit);
  })(ast);
  const ownThis = (fn) => {
    let found = false;
    (function visit(node) {
      if (found) return;
      if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword ||
        ts.isIdentifier(node) && node.text === 'arguments' || ts.isMetaProperty(node)) { found = true; return; }
      // An inner ordinary function or class has its own this and arguments.
      if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassLike(node))) return;
      ts.forEachChild(node, visit);
    })(fn);
    return found;
  };
  const chosen = ast.statements.filter(s => ts.isFunctionDeclaration(s) && s.name && s.body && !s.asteriskToken &&
    !s.modifiers?.some(m => m.kind !== ts.SyntaxKind.AsyncKeyword) && counts.get(s.name.text) === 1 &&
    !constructed.has(s.name.text) && !ownThis(s));
  if (!chosen.length) return code;
  const arrows = chosen.map(s => {
    const async = s.modifiers?.length ? 'async ' : '';
    const params = code.slice(s.parameters.pos, s.parameters.end);
    return `${s.name.text}=${async}(${params})=>${code.slice(s.body.getStart(ast), s.body.end)}`;
  });
  let output = code;
  for (const s of [...chosen].sort((a, b) => b.pos - a.pos)) output = output.slice(0, s.getStart(ast)) + output.slice(s.end);
  // After a shebang and any directives, which must stay first.
  let insertion = code.startsWith('#!') ? code.indexOf('\n') + 1 : 0;
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    insertion = statement.end;
  }
  return output.slice(0, insertion) + (insertion ? ';' : '') + 'var ' + arrows.join(',') + ';' + output.slice(insertion);
}
