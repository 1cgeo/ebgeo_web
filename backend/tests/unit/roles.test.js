// Path: tests/unit/roles.test.js
// Item 44 — toFrontendRole traduz os CINCO níveis de permissão por atlas para o
// vocabulário de papéis do frontend. Sem cobertura direta até aqui, e é justamente
// o ponto onde os níveis DO MEIO ('manage'/'comment') somem em silêncio: se as duas
// ramificações caíssem no `return 'viewer'` final, nada no backend acusaria — foi
// assim que a presença de seleção do co-Gestor já foi silenciada uma vez.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toFrontendRole } from '../../src/utils/roles.js';
import { PERMISSION_LEVELS } from '../../src/middleware/permissions.js';

describe('toFrontendRole', () => {
  it('mapeia cada um dos cinco níveis para o seu papel', () => {
    assert.equal(toFrontendRole('owner'), 'owner');
    assert.equal(toFrontendRole('manage'), 'manager');
    assert.equal(toFrontendRole('write'), 'editor');
    assert.equal(toFrontendRole('comment'), 'commenter');
    assert.equal(toFrontendRole('read'), 'viewer');
  });

  it('ausência de permissão cai no papel mínimo, nunca em undefined', () => {
    assert.equal(toFrontendRole(null), 'viewer');
    assert.equal(toFrontendRole(undefined), 'viewer');
    assert.equal(toFrontendRole(), 'viewer');
  });

  it("globalRole 'admin' curto-circuita em TODAS as permissões, inclusive null e 'read'", () => {
    for (const p of [null, undefined, 'read', 'comment', 'write', 'manage', 'owner']) {
      assert.equal(
        toFrontendRole(p, 'admin'),
        'admin',
        `admin global deve vencer a permissão ${String(p)}`
      );
    }
  });

  it("globalRole 'user' explícito não altera o mapeamento por atlas", () => {
    assert.equal(toFrontendRole('manage', 'user'), 'manager');
    assert.equal(toFrontendRole('comment', 'user'), 'commenter');
    assert.equal(toFrontendRole('write', 'user'), 'editor');
    assert.equal(toFrontendRole('read', 'user'), 'viewer');
    assert.equal(toFrontendRole('owner', 'user'), 'owner');
  });

  // Guard de CONJUNTO, que é o que pega a colagem de dois níveis no mesmo papel —
  // a forma como o nível do meio some. Percorre a fonte de verdade da hierarquia
  // (PERMISSION_LEVELS), então um sexto nível futuro entra aqui sozinho.
  it('os cinco níveis de PERMISSION_LEVELS mapeiam para papéis DISTINTOS', () => {
    const niveis = Object.keys(PERMISSION_LEVELS);
    assert.equal(niveis.length, 5, 'a hierarquia tem cinco níveis');

    const papeis = niveis.map((n) => toFrontendRole(n));
    assert.equal(
      new Set(papeis).size,
      niveis.length,
      `dois níveis colaram no mesmo papel: ${JSON.stringify(Object.fromEntries(niveis.map((n, i) => [n, papeis[i]])))}`
    );
    // E nenhum deles pode cair no fallback por acidente: só 'read' é 'viewer'.
    assert.equal(papeis.filter((p) => p === 'viewer').length, 1);
  });
});
