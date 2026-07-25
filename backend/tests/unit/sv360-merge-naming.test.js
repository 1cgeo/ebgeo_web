// Path: tests/unit/sv360-merge-naming.test.js
// sanitizeSlug / deriveDbFilename — the two PURE functions that carry the sv360
// tenant-isolation invariant into the filesystem. sv360.merge.js had no test of its
// own: it was only ever exercised indirectly, through happy-path ingestions that
// compare against a filename the test itself assembled by hand (so the test and the
// production code would drift together, agreeing on a wrong name).
//
// The two properties that must hold for EVERY input, including the ETL backfill slug
// that never passes through Joi:
//   1. the derived name is a BASENAME — no path separator, no '..' segment, so no
//      input can walk out of SV360_DB_DIR (defense in depth behind the schema);
//   2. two organizations sharing a slug NEVER map to the same {slug}.db (FIX-1, the
//      cross-OM BLOB-overwrite guard). Drop the orgId prefix and org B's upload
//      overwrites org A's photo blobs with the suite green.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sanitizeSlug, deriveDbFilename } from '../../src/modules/streetview360/sv360.merge.js';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = '11111111-1111-1111-1111-111111111111';

// The adversarial + degenerate inputs reused across the property assertions below.
const SLUGS = [
  '../../etc/passwd',
  '..',
  'a/../../b',
  'C:\\windows\\system32',
  '',
  '---',
  '///',
  'Projeto Sao Paulo 2024',
  'já-com-acento',
  'ok_slug-123',
];

describe('sv360 merge naming — sanitizeSlug', () => {
  it('strips path traversal: no separator and no `..` segment survives', () => {
    for (const raw of ['../../etc/passwd', '..', 'a/../../b', 'C:\\windows\\system32']) {
      const out = sanitizeSlug(raw);
      assert.ok(!out.includes('/'), `forward slash survived in ${JSON.stringify(out)}`);
      assert.ok(!out.includes('\\'), `backslash survived in ${JSON.stringify(out)}`);
      assert.ok(
        !out.split('-').includes('..'),
        `a '..' segment survived in ${JSON.stringify(out)}`
      );
      assert.ok(!out.includes('.'), `a dot survived in ${JSON.stringify(out)} (would break the .db suffix)`);
    }
  });

  it('never returns the empty string — the fallback is the literal `project`', () => {
    // An empty basename would make deriveDbFilename produce `${orgId}__.db`, a name
    // every org would share for any degenerate slug: a collision, not just ugliness.
    for (const empty of ['', null, undefined, '---', '///', '   ']) {
      assert.equal(sanitizeSlug(empty), 'project', `empty-ish input ${JSON.stringify(empty)}`);
    }
  });

  it('normalizes to the [a-z0-9_-] alphabet with no edge hyphens (exact values pinned)', () => {
    assert.equal(sanitizeSlug('Projeto Sao Paulo 2024'), 'projeto-sao-paulo-2024');
    // Exact, not approximate: only a RUN of illegal chars collapses, and a legal
    // hyphen next to it is preserved — hence the double hyphen, which is the real
    // output and would otherwise be "fixed" by someone trusting the docstring.
    assert.equal(sanitizeSlug('já-com-acento'), 'j--com-acento');
    assert.equal(sanitizeSlug('ok_slug-123'), 'ok_slug-123', 'an already-safe slug is untouched');
    assert.equal(sanitizeSlug('-lead-and-trail-'), 'lead-and-trail');
    assert.equal(sanitizeSlug('a...b'), 'a-b', 'a run of illegal chars collapses to ONE hyphen');
  });

  it('is idempotent — sanitizing an already-sanitized slug changes nothing', () => {
    for (const raw of SLUGS) {
      const once = sanitizeSlug(raw);
      assert.equal(sanitizeSlug(once), once, `not idempotent for ${JSON.stringify(raw)}`);
    }
  });
});

describe('sv360 merge naming — deriveDbFilename', () => {
  it('two organizations with the SAME slug never share a file (FIX-1)', () => {
    const a = deriveDbFilename(ORG_A, 'centro');
    const b = deriveDbFilename(ORG_B, 'centro');
    assert.notEqual(a, b, 'the orgId prefix is the whole cross-OM overwrite guard');
    assert.ok(a.startsWith(`${ORG_A}__`), 'the org prefix must be the leading token');
    assert.ok(b.startsWith(`${ORG_B}__`));
  });

  it('is deterministic and stable across repeated calls for the same (org, slug)', () => {
    // Postgres stores db_filename; the serve path re-derives nothing. A name that
    // varied per call would make the row point at a file that no longer exists.
    const first = deriveDbFilename(ORG_A, 'Projeto Sao Paulo 2024');
    assert.equal(deriveDbFilename(ORG_A, 'Projeto Sao Paulo 2024'), first);
    assert.equal(first, `${ORG_A}__projeto-sao-paulo-2024.db`);
  });

  it('the derived name is ALREADY a basename for every adversarial slug', () => {
    // resolveDbPath() applies path.basename as a second line of defense; this
    // asserts the FIRST one, so a refactor that drops the basename() call cannot
    // silently turn a slug into a traversal.
    for (const raw of SLUGS) {
      const name = deriveDbFilename(ORG_A, raw);
      assert.equal(path.basename(name), name, `not a basename for ${JSON.stringify(raw)}`);
      // Resolving the name against SV360_DB_DIR must land INSIDE that directory:
      // the parent of the resolved path is the directory itself, never above it.
      const base = path.resolve('base-dir');
      assert.equal(
        path.dirname(path.resolve(base, name)),
        base,
        `escapes its directory for ${JSON.stringify(raw)}`
      );
    }
  });

  it('always ends in .db, and the thumbnail rewrite yields exactly ONE 1:1 .webp pair', () => {
    // sv360.service.js / sv360.admin.service.js derive the per-project thumbnail as
    // db_filename.replace(/\.db$/i, '.webp'). If a slug could smuggle an inner '.db'
    // the rewrite would still hit only the suffix — asserted here rather than assumed.
    const names = SLUGS.map((s) => deriveDbFilename(ORG_A, s));
    assert.equal(names.length, SLUGS.length, 'guard: every slug produced a name');
    for (const name of names) {
      assert.ok(name.endsWith('.db'), `${name} must end in .db`);
      const webp = name.replace(/\.db$/i, '.webp');
      assert.ok(webp.endsWith('.webp'));
      assert.equal(
        webp.slice(0, -'.webp'.length),
        name.slice(0, -'.db'.length),
        'only the suffix may change — the tenant prefix and slug must be identical'
      );
      assert.equal((webp.match(/\.webp/g) || []).length, 1, 'exactly one .webp token');
    }
  });

  it('a slug that sanitizes to the fallback still isolates by org', () => {
    // Degenerate slugs all collapse to 'project'; the org prefix is then the ONLY
    // thing keeping two tenants apart, which is precisely when it matters most.
    assert.notEqual(deriveDbFilename(ORG_A, '///'), deriveDbFilename(ORG_B, '///'));
    assert.equal(deriveDbFilename(ORG_A, '///'), `${ORG_A}__project.db`);
  });
});
