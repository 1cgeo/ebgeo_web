// Path: eslint-rules/__fixtures__/should-flag.js
// NEGATIVE CONTROL (positive half): every construct below MUST be reported.
// Run `node eslint-rules/probe.js` — it fails loudly if any of these stops
// being flagged. Excluded from `npm run lint` via eslint.config.js ignores.
import assert from 'node:assert/strict';
import { it } from 'node:test';

it('flags an assert guarded by an unasserted condition', async () => {
  const res = await fetch('/pull');
  assert.equal(res.status, 200);
  if (!res.body.data.isSnapshot) {
    // EXPECT: no-conditional-assert
    assert.equal(res.body.data.ops.length, 3);
  }
});

it('flags a disjunctive assert', async () => {
  const res = await fetch('/x');
  // EXPECT: no-disjunctive-assert
  assert.ok(res.status === 403 || res.status === 404);
});

it('flags a loop over a collection of unasserted size', async () => {
  const res = await fetch('/list');
  // EXPECT: no-unasserted-loop-assert
  for (const row of res.body.data.rows) {
    assert.ok(row.id);
  }
});

it('flags forEach over a collection of unasserted size', async () => {
  const res = await fetch('/list');
  // EXPECT: no-unasserted-loop-assert
  res.body.data.rows.forEach((row) => {
    assert.ok(row.id);
  });
});

it('flags a C-style loop over a collection of unasserted size', async () => {
  const res = await fetch('/list');
  // EXPECT: no-unasserted-loop-assert
  for (let i = 0; i < res.body.data.rows.length; i++) {
    assert.ok(res.body.data.rows[i].id);
  }
});
