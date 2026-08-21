// Path: tests/integration/auditoria-backfill-de-om.test.js
//
// O BACKFILL DO EIXO DE OM: A ÚNICA APROXIMAÇÃO DECLARADA DO DESENHO, MEDIDA.
//
// O BLOCO D de `011_grupo_com_dono_e_producao.sql` retroage `audit_trail.target_org_id`
// para a história anterior ao eixo, atribuindo-a à OM ATUAL do recurso. É a aproximação
// que a própria migração recusa daqui para a frente, aceita por uma razão só: sem ela o
// produtor abre a aba nova e vê lista vazia, indistinguível de "nada aconteceu". A tela
// declara a ressalva ao usuário (`audit-tab.js`).
//
// O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR: que a única coisa verificada do backfill seja a
// SINTAXE. As migrações rodam sempre em banco recém-criado, então o `UPDATE` alcança
// SEMPRE zero linhas na suíte — ele compila, roda e não faz nada, e um `f.rid` que casasse
// errado (um tipo novo que gravasse `target_id` com prefixo, um `::text` que divergisse do
// que o emissor grava) produziria exatamente o defeito que o backfill existe para evitar:
// lista vazia para o produtor.
//
// COMO ELE MEDE, e por que não é uma cópia do SQL: o `UPDATE` é EXTRAÍDO DO ARQUIVO DA
// MIGRAÇÃO, por `UPDATE audit_trail` até o `;` que o fecha. Uma cópia no teste divergiria
// do original no primeiro edit e passaria verde medindo a si mesma. A extração tem guarda
// própria (exatamente UMA ocorrência, e o texto precisa conter o UNION das cinco tabelas):
// um extrator que devolvesse a string errada é um verificador quebrando calado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'node:url';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser } from '../helpers/fixtures.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRACAO = path.join(RAIZ, 'src/database/migrations/011_grupo_com_dono_e_producao.sql');

/**
 * O `UPDATE` do BLOCO D, tirado do arquivo que o banco de produção vai rodar.
 * @returns {string}
 */
function backfillDaMigracao() {
  const sql = fs.readFileSync(MIGRACAO, 'utf8');
  const inicios = [...sql.matchAll(/UPDATE audit_trail a\b/g)];
  assert.equal(
    inicios.length, 1,
    'guarda do extrator: esperava UM `UPDATE audit_trail a` na 011. Se nasceu um segundo, '
    + 'este teste passou a medir o outro — nomeie qual antes de seguir',
  );
  const de = inicios[0].index;
  const ate = sql.indexOf(';', de);
  assert.ok(ate > de, 'o `UPDATE` extraído precisa terminar em `;`');
  const trecho = sql.slice(de, ate + 1);
  for (const tabela of ['basemaps', 'data_layers', 'analysis_layers', 'tilesets', 'sv360.projects']) {
    assert.ok(
      trecho.includes(tabela),
      `o trecho extraído não menciona \`${tabela}\`: a extração pegou o SQL errado`,
    );
  }
  return trecho;
}

describe('Auditoria — o backfill do eixo de OM alcança o que deve e só o que deve', () => {
  let app, db, admin;
  const RID = randomUUID().slice(0, 8);
  let orgTile, orgProj, orgAlheia;
  let tilesetId, projectId;
  /** As linhas plantadas, por rótulo. */
  const linhas = {};

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    assert.ok(app, 'o app sobe: sem env de teste nada abaixo faz sentido');

    admin = await createAdminUser(db, { username: `bf_admin_${RID}` });

    const criaOrg = async (r) => (await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM bf ${r} ${RID}`, `om-bf-${r}-${RID}`, `B${r}${RID.slice(0, 2)}`],
    )).rows[0].id;
    orgTile = await criaOrg('t');
    orgProj = await criaOrg('p');
    orgAlheia = await criaOrg('x');

    // O ALVO DE CATÁLOGO É UM SLUG, e o de 360 é um UUID: as duas formas de `target_id`
    // que a coluna TEXT tem de carregar, e as duas que o `f.rid` do UNION precisa casar.
    tilesetId = `bf-tile-${RID}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid)`,
      [tilesetId, `Tileset bf ${RID}`, orgTile],
    );
    projectId = (await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 0) RETURNING id`,
      [orgProj, `bf-proj-${RID}`, `Projeto bf ${RID}`, `${orgProj}__bf-proj-${RID}.db`],
    )).rows[0].id;

    // A HISTÓRIA ANTIGA, plantada à mão de propósito: o backfill existe para linhas que
    // NENHUM emissor de hoje escreveria, porque todo emissor de hoje já carimba.
    const planta = async (rotulo, acao, tipo, alvo, org = null) => {
      linhas[rotulo] = (await db.query(
        `INSERT INTO audit_trail (action, actor_id, target_type, target_id, target_org_id, ip)
         VALUES ($1, $2, $3, $4, $5::uuid, 'system') RETURNING id`,
        [acao, admin.id, tipo, alvo, org],
      )).rows[0].id;
    };
    await planta('tileset', 'CATALOG_UPDATE', 'TILESET', tilesetId);
    await planta('projeto', 'SV360_STATUS_CHANGE', 'SV360_PROJECT', projectId);
    await planta('conta', 'USER_UPDATE', 'USER', admin.id);
    await planta('destruido', 'CATALOG_DELETE', 'TILESET', `bf-sumiu-${RID}`);
    await planta('jaCarimbada', 'CATALOG_UPDATE', 'TILESET', tilesetId, orgAlheia);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('o piso: antes de rodar, as quatro linhas novas estão sem OM', async () => {
    // Sem este piso, o caso seguinte não distinguiria "o backfill preencheu" de "já
    // estava preenchido" — que é como um `UPDATE` sem efeito nenhum passa verde.
    const { rows } = await db.query(
      'SELECT id, target_org_id FROM audit_trail WHERE id = ANY($1::uuid[])',
      [[linhas.tileset, linhas.projeto, linhas.conta, linhas.destruido]],
    );
    assert.equal(rows.length, 4, 'as quatro linhas precisam existir');
    assert.deepEqual(
      [...new Set(rows.map((r) => r.target_org_id))], [null],
      'as quatro nascem sem OM, como a história anterior ao eixo',
    );
  });

  it('roda o UPDATE DA MIGRAÇÃO e alcança exatamente as duas linhas de recurso vivo', async () => {
    await db.query(backfillDaMigracao());

    const porId = new Map((await db.query(
      'SELECT id, target_org_id FROM audit_trail WHERE id = ANY($1::uuid[])',
      [[linhas.tileset, linhas.projeto, linhas.conta, linhas.destruido, linhas.jaCarimbada]],
    )).rows.map((r) => [r.id, r.target_org_id]));

    // O QUE ELE ALCANÇA: as duas formas de `target_id`, cada uma casando a sua tabela.
    assert.equal(
      porId.get(linhas.tileset), orgTile,
      'o alvo de catálogo é um SLUG, e é por ele que o UNION casa `tilesets.id::text`',
    );
    assert.equal(
      porId.get(linhas.projeto), orgProj,
      'o alvo de 360 é um UUID em coluna TEXT, e casa `sv360.projects.id::text`',
    );

    // O QUE ELE NÃO ALCANÇA, e cada ausência é uma decisão escrita na migração:
    assert.equal(
      porId.get(linhas.conta), null,
      'alvo sem OM dona (USER) fica NULL: carimbá-lo poluiria o filtro por OM com atos '
      + 'que nada têm a ver com o acervo dela',
    );
    assert.equal(
      porId.get(linhas.destruido), null,
      'o recurso destruído antes da migração fica NULL para sempre: não há de onde tirar',
    );
    assert.equal(
      porId.get(linhas.jaCarimbada), orgAlheia,
      'o `AND a.target_org_id IS NULL` protege o que o EMISSOR já gravou — sem ele o '
      + 'backfill reescreveria a OM da época com a OM atual, que é a aproximação que a '
      + 'decisão recusa',
    );
  });

  it('e ele é IDEMPOTENTE: rodar duas vezes não muda mais nada', async () => {
    // O `UPDATE` é a última coisa de uma migração forward-only, mas ele também é o que
    // um operador pode reexecutar à mão num banco de desenvolvimento. Se não fosse
    // idempotente, a segunda passada reescreveria com a OM ATUAL o que a primeira já
    // tinha resolvido.
    const antes = (await db.query(
      'SELECT target_org_id FROM audit_trail WHERE id = $1', [linhas.tileset],
    )).rows[0].target_org_id;
    await db.query('UPDATE tilesets SET owner_org_id = $1 WHERE id = $2', [orgAlheia, tilesetId]);
    await db.query(backfillDaMigracao());
    const depois = (await db.query(
      'SELECT target_org_id FROM audit_trail WHERE id = $1', [linhas.tileset],
    )).rows[0].target_org_id;
    assert.equal(antes, orgTile, 'piso: a primeira passada tinha carimbado a OM da época');
    assert.equal(
      depois, orgTile,
      'o recurso TROCOU de OM entre as duas passadas e a linha antiga NÃO foi reatribuída: '
      + 'é a mesma propriedade que faz a coluna ser gravada em vez de resolvida na leitura',
    );
  });
});
