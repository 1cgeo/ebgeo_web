// Path: tests/unit/sv360-merge-naming.test.js
// sanitizeSlug / deriveDbFilename — the two PURE functions that carry the sv360
// tenant-isolation invariant into the filesystem. sv360.merge.js had no test of its
// own: it was only ever exercised indirectly, through happy-path ingestions that
// compare against a filename the test itself assembled by hand (so the test and the
// production code would drift together, agreeing on a wrong name).
//
// Desde 2026-08-29 o nome é por SLUG, SEM prefixo de OM, como no ebgeo_360 fonte-da-verdade. O
// isolamento entre OMs que o prefixo garantia mudou de camada: agora é o `UNIQUE(slug)` do banco
// que impede dois projetos (de qualquer OM) com o mesmo slug, então NÃO HÁ dois arquivos com o
// mesmo slug para colidir. A propriedade que resta aqui é uma só:
//   - the derived name is a BASENAME — no path separator, no '..' segment, so no
//     input can walk out of SV360_DB_DIR (defense in depth behind the schema).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sanitizeSlug, deriveDbFilename } from '../../src/modules/streetview360/sv360.merge.js';

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
  it('o nome é por SLUG, sem prefixo de OM (paralelo do ebgeo_360)', () => {
    // O mesmo slug produz o MESMO nome, independente de OM: o isolamento entre OMs
    // saiu do nome do arquivo e virou o `UNIQUE(slug)` do banco (que impede dois
    // projetos com o mesmo slug em qualquer OM). Aqui só se prova a forma do nome.
    assert.equal(deriveDbFilename('centro'), 'centro.db');
    assert.ok(!deriveDbFilename('centro').includes('__'), 'sem prefixo de OM');
  });

  it('is deterministic and stable across repeated calls for the same slug', () => {
    // Postgres stores db_filename; the serve path re-derives nothing. A name that
    // varied per call would make the row point at a file that no longer exists.
    const first = deriveDbFilename('Projeto Sao Paulo 2024');
    assert.equal(deriveDbFilename('Projeto Sao Paulo 2024'), first);
    assert.equal(first, 'projeto-sao-paulo-2024.db');
  });

  it('the derived name is ALREADY a basename for every adversarial slug', () => {
    // resolveDbPath() applies path.basename as a second line of defense; this
    // asserts the FIRST one, so a refactor that drops the basename() call cannot
    // silently turn a slug into a traversal.
    for (const raw of SLUGS) {
      const name = deriveDbFilename(raw);
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
    const names = SLUGS.map((s) => deriveDbFilename(s));
    assert.equal(names.length, SLUGS.length, 'guard: every slug produced a name');
    for (const name of names) {
      assert.ok(name.endsWith('.db'), `${name} must end in .db`);
      const webp = name.replace(/\.db$/i, '.webp');
      assert.ok(webp.endsWith('.webp'));
      assert.equal(
        webp.slice(0, -'.webp'.length),
        name.slice(0, -'.db'.length),
        'only the suffix may change — the slug must be identical'
      );
      assert.equal((webp.match(/\.webp/g) || []).length, 1, 'exactly one .webp token');
    }
  });

  it('um slug degenerado cai no fallback `project.db`', () => {
    // Slugs degenerados colapsam para 'project'; sem prefixo de OM, o nome é só isso.
    // Dois projetos degenerados não coexistem: o `UNIQUE(slug)` recusaria o segundo.
    assert.equal(deriveDbFilename('///'), 'project.db');
    assert.equal(deriveDbFilename('---'), 'project.db');
  });
});
