import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {arrowFunctions} from '../scripts/arrow-functions.mjs';
const result = code => runInNewContext(code);
const wrap = body => `'use strict';${body}`;

test('functions become arrows declared first, so start-up calls before the declaration still work', async () => {
  const source = wrap(`const early = twice(4);
    function twice(n) { return add(n, n); }
    function add(a, b = 1) { return a + b; }
    async function later(x) { return await Promise.resolve(twice(x)); }
    const limit = 7;
    function capped(n) { return Math.min(n, limit); }
    JSON.stringify([early, add(2), twice.name, add.length, capped(9), typeof later]);`);
  const rewritten = arrowFunctions(source);
  assert.notEqual(rewritten, source);
  assert.match(rewritten, /^'use strict';;var twice=/);
  assert.doesNotMatch(rewritten, /function (twice|add|later|capped)\(/);
  assert.equal(result(rewritten), result(source));
  assert.equal(await runInNewContext(arrowFunctions(`async function f(x){return x+1} f(1)`)), 2);
});

test('a function that could tell the difference stays a function', () => {
  const source = `function usesThis() { return this; }
    function usesArguments() { return arguments.length; }
    function usesNewTarget() { return new.target; }
    function* counts() { yield 1; }
    function Built() { }
    const made = new Built();
    function proto() { }
    proto.prototype.x = 1;
    function checked() { }
    const is = made instanceof checked;
    function twice() { } function twice() { }
    function shadowed() { }
    { const shadowed = 1; }
    function innerOwnThis() { return function () { return this; }; }
    function arrowThis() { return () => this; }
    export default function exported() { }`;
  const rewritten = arrowFunctions(source);
  for (const name of ['usesThis', 'usesArguments', 'usesNewTarget', 'counts', 'Built', 'proto', 'checked', 'shadowed', 'arrowThis', 'exported'])
    assert.match(rewritten, new RegExp(`function\\*? ?${name}\\(`), name);
  assert.match(rewritten, /function twice\(\) \{ \} function twice\(\) \{ \}/);
  assert.match(rewritten, /^var innerOwnThis=\(\)=>/, 'a this in an inner ordinary function is that function\'s own');
});

test('source with nothing to rewrite is returned as it was, and invalid source is refused', () => {
  assert.equal(arrowFunctions('const x = () => 1;'), 'const x = () => 1;');
  assert.throws(() => arrowFunctions('function {'), /invalid JavaScript/);
});
