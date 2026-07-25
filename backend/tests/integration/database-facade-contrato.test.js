// Path: tests/integration/database-facade-contrato.test.js
// Item 163 — contrato de retorno do facade de src/database/index.js.
//
// `query()` devolve `{rows, rowCount}` com `rowCount = result.length` calculado a
// partir de `db.any`. Consequência NÃO óbvia: para UPDATE/DELETE **sem RETURNING**
// o rowCount é SEMPRE 0, mesmo tendo afetado N linhas — e há ~120 chamadas de
// `await query(` no src, várias decidindo 404 por `rows.length`. Hoje funciona
// porque cada uma dessas queries tem RETURNING, mas nada prendia isso: basta uma
// query de escrita nova sem RETURNING para o serviço devolver 404 num update
// bem-sucedido, sem erro nenhum.
//
// Os quatro irmãos (`one`/`oneOrNone`/`none`/`any`) devolvem DIRETO, sem `.rows`:
// misturar as duas convenções é o erro clássico que o CLAUDE.md nomeia.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas } from '../helpers/fixtures.js';
import { query, one, oneOrNone, none, any, tx } from '../../src/database/index.js';

describe('Contrato do facade de banco (item 163)', () => {
  let db, user, atlas;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    user = await createUser(db, { username: `fac_${randomUUID().slice(0, 8)}` });
    atlas = await createAtlas(db, user.id, { name: `Facade ${randomUUID().slice(0, 6)}` });
  });

  after(async () => {
    await db.query('DELETE FROM atlas WHERE id = $1', [atlas.id]);
    await teardownTestEnv(db);
  });

  it('UPDATE SEM RETURNING devolve rowCount 0 apesar de afetar 1 linha (footgun pinado)', async () => {
    const semReturning = await query('UPDATE atlas SET name = name WHERE id = $1', [atlas.id]);
    assert.deepEqual(semReturning.rows, [], 'db.any de um UPDATE sem RETURNING não traz linha');
    assert.equal(semReturning.rowCount, 0, 'rowCount espelha rows.length, NÃO linhas afetadas');

    // Guarda de não-vacuidade: a linha existe e o UPDATE de fato a alcançaria.
    const alcance = await query('SELECT 1 AS x FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(alcance.rowCount, 1, 'a linha alvo existe (senão o zero acima seria trivial)');

    const comReturning = await query('UPDATE atlas SET name = name WHERE id = $1 RETURNING id', [atlas.id]);
    assert.equal(comReturning.rowCount, 1, 'com RETURNING o mesmo UPDATE conta 1');
    assert.equal(comReturning.rows.length, 1);
    assert.equal(comReturning.rows[0].id, atlas.id);
  });

  it('SELECT sem linhas devolve {rows: [], rowCount: 0}', async () => {
    const vazio = await query('SELECT 1 AS x WHERE false');
    assert.deepEqual(vazio.rows, []);
    assert.equal(vazio.rowCount, 0);
  });

  it('one() exige exatamente uma linha e devolve DIRETO (sem .rows)', async () => {
    const linha = await one('SELECT id, name FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(linha.id, atlas.id, 'o retorno é a linha, não { rows: [...] }');
    assert.equal(linha.rows, undefined);

    await assert.rejects(() => one('SELECT 1 AS x WHERE false'), /No data returned/i);
    await assert.rejects(
      () => one('SELECT 1 AS x UNION ALL SELECT 2'),
      /Multiple rows|returned/i
    );
  });

  it('oneOrNone() devolve null em zero linhas e a linha em uma', async () => {
    assert.equal(await oneOrNone('SELECT 1 AS x WHERE false'), null);
    const linha = await oneOrNone('SELECT id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(linha.id, atlas.id);
  });

  it('none() rejeita quando a query devolve linha; any() devolve o array DIRETO', async () => {
    assert.equal(await none('SELECT 1 AS x WHERE false'), null);
    await assert.rejects(() => none('SELECT 1 AS x'), /No return data was expected/i);

    const linhas = await any('SELECT id FROM atlas WHERE id = $1', [atlas.id]);
    assert.ok(Array.isArray(linhas), 'any() devolve array, não { rows }');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].id, atlas.id);
  });

  it('tx() propaga rollback: um throw depois do INSERT não deixa a linha', async () => {
    const nome = `Rollback ${randomUUID()}`;
    await assert.rejects(
      () =>
        tx(async (t) => {
          await t.none('INSERT INTO atlas (name, owner_id) VALUES ($1, $2)', [nome, user.id]);
          const dentro = await t.one('SELECT COUNT(*)::int AS n FROM atlas WHERE name = $1', [nome]);
          assert.equal(dentro.n, 1, 'dentro da transação a linha existe');
          throw new Error('falha deliberada');
        }),
      /falha deliberada/
    );

    const depois = await query('SELECT COUNT(*)::int AS n FROM atlas WHERE name = $1', [nome]);
    assert.equal(depois.rows.length, 1);
    assert.equal(depois.rows[0].n, 0, 'após o rollback a linha não existe');
  });
});
