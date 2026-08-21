// Path: eslint-rules/__fixtures__/should-pass.js
// NEGATIVE CONTROL (negative half): nothing below may be reported. A rule that
// fires here is a false positive and would make the whole check untrustworthy.
import assert from 'node:assert/strict';
import { it } from 'node:test';

const CASES = [
  ['a number', 12345],
  ['an array', ['a', 'b']],
];

it('condition asserted before the branch', async () => {
  const res = await fetch('/pull');
  assert.equal(res.body.data.isSnapshot, false, 'pull must be incremental');
  if (!res.body.data.isSnapshot) {
    assert.equal(res.body.data.ops.length, 3);
  }
});

it('assert.fail inside a branch IS the assertion', async () => {
  const res = await fetch('/x');
  if (res.status !== 204) {
    assert.fail(`expected 204, got ${res.status}`);
  }
});

it('size asserted before the loop', async () => {
  const res = await fetch('/list');
  assert.ok(res.body.data.rows.length > 0, 'the listing must not be empty');
  for (const row of res.body.data.rows) {
    assert.ok(row.id);
  }
});

it('iterating a literal table of cases', () => {
  for (const [label, value] of CASES) {
    assert.ok(label);
    assert.ok(value);
  }
  for (const status of [400, 401, 403]) {
    assert.ok(status > 0);
  }
  for (const [key, expected] of Object.entries({ a: 1, b: 2 })) {
    assert.equal(typeof key, 'string');
    assert.ok(expected);
  }
});

it('Object.keys(x).length pins Object.entries(x) just as well', async () => {
  const built = {};
  for (const level of ['read', 'write']) built[level] = level;
  assert.equal(Object.keys(built).length, 2, 'both levels were seeded');
  for (const [key, value] of Object.entries(built)) {
    assert.equal(key, value);
  }
});

it('an early-exit guard proves non-emptiness just as well as an assert', async () => {
  for (let guard = 0; guard < 10; guard++) {
    const res = await fetch('/pull');
    const ops = res.body.data.operations ?? [];
    if (ops.length === 0) break;
    for (const op of ops) {
      assert.ok(op.serverVersion > 0);
    }
  }
});

it('a defaulting fallback in a comparing assert is not a disjunction', async () => {
  const res = await fetch('/x');
  assert.match(res.body.error?.message || '', /ja existe/i);
  assert.equal(res.body.count || 0, 0);
});

it('a branch with no assert at all is none of our business', async () => {
  const res = await fetch('/x');
  let extra = 0;
  if (res.body.data.flag) {
    extra = 1;
  }
  assert.equal(extra + res.status, res.status + extra);
});

it('does not flag membership in a NAMED collection, nor a one-element list', async () => {
  // A lista nomeada e dominio real (papel global, enum de status), nao hedge entre dois
  // desfechos: acusa-la seria o ruido que faz alguem desligar a regra.
  const PAPEIS = ['user', 'producer', 'credenciado', 'admin'];
  const res = await fetch('/me');
  assert.ok(PAPEIS.includes(res.role));
  assert.ok(['admin'].includes(res.role));
});
