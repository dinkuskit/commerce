import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {shareGlobals, shareLiterals} from '../scripts/share-literals.mjs';
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

test('destructured property names share through computed keys with identical semantics', () => {
  const source = `(() => {
    const record = {someLongPropertyName: 4, otherLongPropertyName: {someLongPropertyName: 5}};
    const {someLongPropertyName: first, otherLongPropertyName: {someLongPropertyName: second}} = record;
    const read = ({someLongPropertyName: value = 9}) => value;
    let assigned; ({someLongPropertyName: assigned} = record);
    return JSON.stringify([first, second, read({}), read(record), assigned, record.someLongPropertyName]);
  })()`;
  const shared = shareLiterals(source);
  assert.match(shared, /\{\[__commerceLiteral\d+\]: ?first/);
  assert.equal(result(shared), result(source));
});

test('top-level strict directives remain first', () => {
  const source = `'use strict'; const one='a repeated long value';const two='a repeated long value'; this.result = (function(){return this === undefined})(); JSON.stringify([this.result,one,two]);`;
  const shared = shareLiterals(source);
  assert.match(shared, /^'use strict';/);
  assert.equal(result(shared), result(source));
});

test('member accesses share through computed access with identical semantics', () => {
  const source = `(() => {
    class Counter { #secret = 7; someLongMethodName() { return this.#secret + this.someLongPropertyName; } }
    const counter = new Counter();
    counter.someLongPropertyName = 35;
    const record = {someLongPropertyName: 1, nestedLongName: {someLongPropertyName: 2}};
    record.someLongPropertyName += 10;
    record.nestedLongName.someLongPropertyName++;
    const missing = null;
    const chain = missing?.someLongPropertyName ?? record?.nestedLongName?.someLongPropertyName;
    const viaCall = counter.someLongMethodName();
    const deleted = delete record.nestedLongName.someLongPropertyName;
    return JSON.stringify([record.someLongPropertyName, chain, viaCall, deleted, 'someLongPropertyName' in record.nestedLongName, Object.keys(record)]);
  })()`;
  const shared = shareLiterals(source);
  assert.notEqual(shared, source);
  assert.equal(result(shared), result(source));
  assert.match(shared, /#secret/);
  assert.doesNotMatch(shared, /\[__commerceLiteral\d+\]\(\) \{ return this\.#secret/);
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

test('frequent globals and void 0 read through bindings with identical semantics', () => {
  const source = `(() => {
    const keys = Object.keys({a:1,b:2}), entries = Object.entries({c:3}), frozen = Object.isFrozen(Object.freeze({}));
    const short = {Object, Error}, fail = () => { try { throw new Error('x'); } catch (error) { return error instanceof Error && error.message; } };
    class Oops extends Error {}
    const none = [void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0, void 0].every(value => value === undefined);
    const labelled = () => { Error: for (;;) break Error; return Error.name; };
    const clone = JSON.parse(JSON.stringify({d:[1,2]})), stamp = String(Number('42')) + String(Array.isArray([])) + String(Number.isSafeInteger(1));
    return JSON.stringify([keys, entries, frozen, short.Object === Object, short.Error === Error, fail(), new Oops() instanceof Error,
      none, labelled(), clone, stamp, Object.keys(short), Object.getOwnPropertyNames(Object.prototype).length > 0, Array.from('ab'), Error.name]);
  })()`;
  const shared = shareGlobals(source);
  assert.notEqual(shared, source);
  assert.equal(result(shared), result(source));
  assert.match(shared, /\{Object:__commerceGlobal\d+, ?Error:__commerceGlobal\d+\}/, 'shorthand keys stay');
  assert.match(shared, /__commerceGlobal\d+=globalThis\.undefined/);
  assert.match(shared, /Error: for/, 'labels stay');
  assert.match(shared, /break Error/);
});

test('globals the code declares, or checks with typeof, are left alone', () => {
  const source = `(() => { const Object = {keys: () => ['own']}; const a = Object.keys(), b = Object.keys(), c = Object.keys(), d = Object.keys();
    const e = typeof Promise, f = Promise.resolve, g = Promise.all, h = Promise.race, i = Promise.any;
    return JSON.stringify([a, b, c, d, e, Error.name, Error.name, Error.name, Error.name]); })()`;
  const shared = shareGlobals(source);
  assert.equal(result(shared), result(source));
  assert.match(shared, /const Object = \{keys/);
  assert.match(shared, /Promise\.resolve/);
  assert.match(shared, /typeof Promise/);
  assert.throws(() => shareGlobals('function {'), /invalid JavaScript/);
  assert.equal(shareGlobals('const x=1;'), 'const x=1;');
});
