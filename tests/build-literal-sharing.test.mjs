import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {shareLiterals} from '../scripts/share-literals.mjs';
const result = code => runInNewContext(code);

test('sharing preserves field names, prototype syntax, escaped text, directives and tagged templates', () => {
  const source = `(() => { 'use strict';
    const longFieldName = 'longFieldName', __commerceLiteral0 = 'collision';
    const original = {longFieldName:'same long string value', '__proto__':{ancestor:42}};
    const second = {'longFieldName':'same long string value', 'escapedText':'unicode: \\u03bb \\n quoted: \\"'};
    const third = {longFieldName:'same long string value', 'escapedText':'unicode: \\u03bb \\n quoted: \\"'};
    const tag = pieces => pieces.raw[0]; const tagged = tag\`same long string value\`;
    const method = {'same long string value'() { return 'same long string value'; }};
    return JSON.stringify([Object.keys(original), original.ancestor, Object.hasOwn(original,'__proto__'),second,third,tagged,method['same long string value'](),__commerceLiteral0]);
  })()`;
  const shared = shareLiterals(source);
  assert.notEqual(shared, source);
  assert.equal(result(shared), result(source));
  assert.match(shared, /'use strict'/);
  assert.match(shared, /tag`same long string value`/);
  assert.match(shared, /'__proto__':/);
});

test('sharing retains import specifiers and rejects invalid source', () => {
  const source = `import x from 'a long module specifier'; export {x} from 'a long module specifier'; const value='a long module specifier'; const other='a long module specifier'; import('a long module specifier');`;
  const shared = shareLiterals(source);
  assert.match(shared, /from 'a long module specifier'/);
  assert.match(shared, /import\('a long module specifier'\)/);
  assert.throws(() => shareLiterals('function {'), /invalid JavaScript/);
  assert.equal(shareLiterals('const x=1;'), 'const x=1;');
});

test('top-level strict directives remain first', () => {
  const source = `'use strict'; const one='a repeated long value';const two='a repeated long value'; this.result = (function(){return this === undefined})(); JSON.stringify([this.result,one,two]);`;
  const shared = shareLiterals(source);
  assert.match(shared, /^'use strict';/);
  assert.equal(result(shared), result(source));
});

test('import attributes and legacy assertions retain grammar-only literals', () => {
  for (const keyword of ['with', 'assert']) {
    const declaration = `import value from 'a long module specifier' ${keyword} {type:'json'};`;
    const exported = `export {default} from 'another long module specifier' ${keyword} {type:'json'};`;
    const source = declaration + exported + `const a='json', b='json', c='a long module specifier', d='a long module specifier';`;
    const shared = shareLiterals(source);
    assert.ok(shared.includes(declaration));
    assert.ok(shared.includes(exported));
  }
});
