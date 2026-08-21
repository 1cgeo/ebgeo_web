// Path: tests/integration/auditoria-permissoes-tem-om.test.js
//
// O CARIMBO DE OM DOS EMISSORES DE PERMISSÃO, MEDIDO POR VALOR.
//
// A revisão adversarial mediu o buraco que este arquivo fecha, e ele era exatamente do
// tipo que a casa mais paga: anular o `targetOrgId` de `PERMISSION_GRANT` e de
// `PERMISSION_PURGE` (trocar por `null` nos três sítios) deixava a suíte INTEIRA verde.
// O censo estrutural (`tests/unit/auditoria-om-do-alvo-censo.test.js`) segue passando
// porque ele cobra a PRESENÇA da string `targetOrgId`, e `targetOrgId: null` a contém —
// ele mesmo declara que não prende o valor. Os três testes de comportamento que existiam
// mediam CATALOG_* e SV360_*, nenhum tocava ação de permissão.
//
// O QUE ESTE VERDE ESTARIA PROVANDO SE O CÓDIGO ESTIVESSE ERRADO: nada, e o cenário
// concreto é este. `grantResource` passa a gravar `null` (ou o `producer_org_id` do ATOR
// em vez do `owner_org_id` do RECURSO — a coluna não tem FK, qualquer UUID entra). O
// produtor abre a aba Auditoria e nunca vê quem recebeu acesso ao acervo que ele mantém,
// que é a pergunta mais provável de quem investiga um vazamento.
//
// A FORMA DE CADA CASO É A DA CASA: piso (a linha existe e traz a OM certa), e só depois
// a discriminação (o produtor da OM vizinha NÃO recebe a linha). A asserção de ausência
// sozinha passaria igual com a trilha vazia, com a rota quebrada e com o filtro negando
// tudo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

describe('Auditoria — conceder e revogar carimbam a OM DONA do recurso', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgA, orgB;
  let grantId;

  const DA_A = `perm-om-a-${sufixo}`;
  const DA_B = `perm-om-b-${sufixo}`;

  /** As linhas de `audit_trail` de uma ação sobre um alvo, lidas direto do banco. */
  const linhasDe = async (acao, alvo) => (await db.query(
    `SELECT action, target_type, target_id, target_org_id, details
       FROM audit_trail WHERE action = $1 AND target_id = $2 ORDER BY created_at`,
    [acao, alvo],
  )).rows;

  /** A trilha pela ROTA, como `quem`. */
  const trilha = (quem, qs = '') => supertest(app)
    .get(`/api/v1/audit${qs}`)
    .set('Authorization', `Bearer ${tokens[quem]}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM perm ${rotulo} ${sufixo}`, `om-perm-${rotulo}-${sufixo}`, `P${rotulo}${sufixo.slice(0, 2)}`],
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    atores.admin = await createAdminUser(db, { username: `perm_admin_${sufixo}` });
    atores.produtorA = await createProducerUser(db, orgA, {
      username: `perm_prod_a_${sufixo}`, organization_id: orgA,
    });
    atores.produtorB = await createProducerUser(db, orgB, {
      username: `perm_prod_b_${sufixo}`, organization_id: orgB,
    });
    atores.beneficiario = await createUser(db, { username: `perm_benef_${sufixo}` });
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    // DOIS TILESETS PRIVADOS, um por OM. Privados de propósito: é sobre recurso privado
    // que a concessão significa alguma coisa, e é dele que o produtor cuida.
    for (const [id, org] of [[DA_A, orgA], [DA_B, orgB]]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid, 'private')`,
        [id, `Tileset ${id}`, org],
      );
    }
  });

  after(async () => {
    // AS TABELAS DE CATALOGO SAO COMPARTILHADAS pela suite inteira, e ha casos que comparam
    // a lista INTEIRA de tilesets entre um admin e um usuario comum: as duas linhas
    // PRIVADAS deste `before`, deixadas para tras, reprovavam
    // `resource-access-listagem-crua.test.js` — longe da causa, e com uma mensagem que nao
    // tem relacao nenhuma com auditoria. E a mesma convencao de limpeza que os arquivos
    // irmaos de catalogo ja seguem.
    const ids = [DA_A, DA_B];
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [ids]);
    await teardownTestEnv(db);
  });

  it('piso: `PERMISSION_GRANT` nasce com a OM DONA do recurso, não com a do ator', async () => {
    // QUEM CONCEDE É O ADMINISTRADOR, e essa escolha é o controle mais importante do
    // arquivo: ele não tem `producer_org_id` nenhum. Se o emissor estivesse carimbando a
    // OM de quem CONCEDE (o erro barato de cometer), a coluna sairia NULA e este caso
    // ficaria vermelho nomeando o defeito. Com o produtor da própria OM concedendo, as
    // duas leituras dariam o mesmo número e o caso não discriminaria nada.
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${DA_A}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.beneficiario.id, grantLevel: 'view_share' })
      .expect(201);
    grantId = res.body.data.id;
    assert.ok(grantId, 'piso: a concessão precisa ter sido criada');

    const linhas = await linhasDe('PERMISSION_GRANT', DA_A);
    assert.equal(linhas.length, 1, 'conceder deixa exatamente uma linha');
    assert.equal(
      linhas[0].target_org_id, orgA,
      'a OM da linha é a do RECURSO; o administrador que concedeu não tem OM produtora',
    );
    assert.equal(linhas[0].target_type, 'TILESET');
  });

  it('e o PRODUTOR da OM lê essa concessão; o da OM vizinha NÃO', async () => {
    // A consequência de produto, e o motivo do carimbo existir: sem ele, quem mantém o
    // acervo não vê quem deu acesso a ele.
    const meu = await trilha('produtorA', '?action=PERMISSION_GRANT').expect(200);
    const minhas = meu.body.data.data.filter((l) => l.target_id === DA_A);
    assert.equal(minhas.length, 1, 'o produtor da OM-A precisa ver a concessão do acervo dele');
    assert.equal(minhas[0].target_org_id, orgA);

    const vizinho = await trilha('produtorB', '?action=PERMISSION_GRANT').expect(200);
    assert.deepEqual(
      vizinho.body.data.data.filter((l) => l.target_id === DA_A), [],
      'a concessão sobre o acervo da OM-A não pode aparecer para o produtor da OM-B',
    );
    // A DISCRIMINAÇÃO da discriminação: a lista do produtor B estar vazia não pode ser
    // "a rota devolve vazio para ele". O administrador vê a mesma linha no mesmo instante.
    const doAdmin = await trilha('admin', '?action=PERMISSION_GRANT').expect(200);
    assert.ok(doAdmin.body.data.data.some((l) => l.target_id === DA_A));
  });

  it('`PERMISSION_REVOKE` carimba a mesma OM: a história do acesso não se parte', async () => {
    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantId}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    const linhas = await linhasDe('PERMISSION_REVOKE', DA_A);
    assert.equal(linhas.length, 1, 'revogar deixa exatamente uma linha');
    assert.equal(
      linhas[0].target_org_id, orgA,
      'sem esta metade, conceder apareceria na trilha da OM e revogar não — e a leitura '
      + 'de "quem ainda tem acesso" ficaria com metade da história',
    );

    const meu = await trilha('produtorA', '?action=PERMISSION_REVOKE').expect(200);
    assert.ok(meu.body.data.data.some((l) => l.target_id === DA_A));
  });

  it('o carimbo NÃO é a OM do ator: o produtor da OM-A concede no acervo da OM-A', async () => {
    // O par que fecha a leitura errada do primeiro caso. Ali o ator não tinha OM
    // produtora; aqui ele tem, e a OM que sai na linha continua sendo a do RECURSO. Se
    // alguém trocar `fatos.ownerOrgId` por `actor.producer_org_id`, este caso passa e o
    // primeiro reprova — os dois juntos é que prendem o valor.
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${DA_A}/grants`)
      .set('Authorization', `Bearer ${tokens.produtorA}`)
      .send({ granteeId: atores.beneficiario.id, grantLevel: 'view' })
      .expect(201);
    assert.ok(res.body.data.id);

    const linhas = await linhasDe('PERMISSION_GRANT', DA_A);
    assert.equal(linhas.length, 2, 'piso: a segunda concessão também deixou linha');
    assert.deepEqual(
      [...new Set(linhas.map((l) => l.target_org_id))], [orgA],
      'as duas linhas carregam a OM do recurso, com atores de OM diferentes',
    );
  });
});
