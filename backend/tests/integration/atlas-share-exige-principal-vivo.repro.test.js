// Path: tests/integration/atlas-share-exige-principal-vivo.repro.test.js
//
// O EIXO POR ATLAS PASSOU A PERGUNTAR SE QUEM PEDE AINDA EXISTE.
//
// O QUE ERA. `fn_principal_vivo` (conta ativa E OM de lotação ativa) gateia o eixo de
// RECURSO (`fn_granted_resource_ids`), o grupo de acesso (`fn_user_group_ids`) e o
// atalho global (`fn_is_global_admin`). O eixo POR ATLAS não a consultava em lugar
// nenhum: `fn_user_atlas_shares` resolve o MÁXIMO entre o share direto e os dos grupos
// e nunca pergunta pela vida do beneficiário, e `requireAtlasPermission` lia `atlas`
// mais aquela função e mais nada. Um usuário DESATIVADO, ou cuja OM de lotação foi
// desativada, mantinha o nível que um `atlas_shares` lhe deu.
//
// POR QUE O REPRO NÃO PASSA POR UMA ROTA DE `/atlas` — e esta é a metade que decide se
// este arquivo mede alguma coisa. TODAS as rotas de atlas montam o `auth` ESTRITO, que
// reconcilia contra o banco ANTES do gate: conta inativa vira 401, OM inativa vira 403.
// Medir ali daria VERDE com e sem o conserto, porque o 401 do `auth` chega primeiro e o
// gate de atlas nem roda. É exatamente a cobertura vazia que a constituição nomeia.
//
// A superfície onde o buraco era ALCANÇÁVEL é a família servida SÓ por `flexibleAuth`:
// as leituras do 360. Elas chamam este mesmo gate por `requireAtlasScopeWhenPresent`
// (`src/middleware/resource-access.js`) quando vem `?atlasId=`, e `flexibleAuth` NÃO
// reconcilia nada — o `req.user` sai do token, e a renovação deslizante só consulta o
// banco a menos de 5 min do vencimento. Um token recém-emitido de uma conta desativada
// segundos depois continuava abrindo o atlas, e com ele o empréstimo de recurso privado
// que o atlas carrega.
//
// O CENÁRIO É O DO `atlas_shares` PURO: o ator não é dono, o atlas não é público, e ele
// não tem papel global. Se qualquer um desses três valesse, o 200 viria por outro ramo
// e o caso não estaria medindo o share.
//
// A DESATIVAÇÃO É POR SQL CRU, de propósito. A rota administrativa também carimba
// `sessions_valid_from` e revoga o refresh, e o par de efeitos tornaria ambíguo QUAL
// deles produziu o 404. Aqui o único fato que muda entre o positivo e o negativo é
// `users.is_active` (ou `organizations.is_active`).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser, makeAtlasPublic,
} from '../helpers/fixtures.js';

describe('atlas_shares exige principal VIVO (eixo por atlas)', () => {
  let app, db;
  let dono, vivo, desativado, semOm, adminVivo, adminMorto;
  let tokenVivo, tokenDesativado, tokenSemOm, tokenAdminVivo, tokenAdminMorto;
  let atlasPrivado, atlasPublico;
  let orgEstavel, orgQueMorre;

  const sufixo = crypto.randomUUID().slice(0, 8);

  /** A rota SÓ-`flexibleAuth` do 360, com e sem atlas em foco. */
  const lista = (token, atlasId) => {
    const req = supertest(app).get('/api/v1/sv360/projects');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (atlasId) req.query({ atlasId });
    return req;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const novaOrg = async (rotulo) => {
      const { rows } = await db.query(
        `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
        [`OM ${rotulo} ${sufixo}`, `${rotulo}-${sufixo}`, `${rotulo.slice(0, 2).toUpperCase()}${sufixo.slice(0, 3)}`]
      );
      return rows[0].id;
    };
    orgEstavel = await novaOrg('viva');
    orgQueMorre = await novaOrg('morre');

    dono = await createUser(db, { username: `pv_dono_${sufixo}` });
    vivo = await createUser(db, { username: `pv_vivo_${sufixo}`, organization_id: orgEstavel });
    desativado = await createUser(db, { username: `pv_off_${sufixo}`, organization_id: orgEstavel });
    semOm = await createUser(db, { username: `pv_semom_${sufixo}`, organization_id: orgQueMorre });
    adminVivo = await createAdminUser(db, { username: `pv_adm_ok_${sufixo}`, organization_id: orgEstavel });
    adminMorto = await createAdminUser(db, { username: `pv_adm_off_${sufixo}`, organization_id: orgEstavel });

    // Os tokens nascem ANTES da desativação, que é o cenário real: o crachá é válido,
    // tem até 15 min de vida, e `flexibleAuth` não pergunta nada ao banco.
    tokenVivo = await loginUser(app, vivo.username, vivo.password);
    tokenDesativado = await loginUser(app, desativado.username, desativado.password);
    tokenSemOm = await loginUser(app, semOm.username, semOm.password);
    tokenAdminVivo = await loginUser(app, adminVivo.username, adminVivo.password);
    tokenAdminMorto = await loginUser(app, adminMorto.username, adminMorto.password);

    atlasPrivado = await createAtlas(db, dono.id, { name: `Privado pv ${sufixo}` });
    atlasPublico = await createAtlas(db, dono.id, { name: `Publico pv ${sufixo}` });
    await makeAtlasPublic(db, atlasPublico.id);

    // A ÚNICA fonte de permissão dos três: o share direto. Nem posse, nem público,
    // nem papel global.
    await createShare(db, atlasPrivado.id, vivo.id, 'read', dono.id);
    await createShare(db, atlasPrivado.id, desativado.id, 'read', dono.id);
    await createShare(db, atlasPrivado.id, semOm.id, 'read', dono.id);

    await db.query('UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])',
      [[desativado.id, adminMorto.id]]);
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgQueMorre]);
  });

  after(async () => {
    const ids = [dono.id, vivo.id, desativado.id, semOm.id, adminVivo.id, adminMorto.id];
    await db.query('DELETE FROM atlas_shares WHERE atlas_id = ANY($1::uuid[])',
      [[atlasPrivado.id, atlasPublico.id]]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlasPrivado.id, atlasPublico.id]]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgEstavel, orgQueMorre]]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // O PISO: o cenário é mesmo o do `atlas_shares` puro
  // ==========================================================================

  it('piso: os três alcançam o atlas SÓ pelo share, e a função SQL continua devolvendo-o', async () => {
    // Sem este caso, um 404 nos casos negativos seria indistinguível de "o atlas nunca
    // deu permissão a ninguém".
    const { rows: a } = await db.query(
      'SELECT owner_id, is_public FROM atlas WHERE id = $1', [atlasPrivado.id]
    );
    assert.equal(a.length, 1);
    assert.equal(a[0].is_public, false, 'o atlas não pode ser público, senão o 200 vem do ramo público');
    assert.notEqual(a[0].owner_id, desativado.id);
    assert.notEqual(a[0].owner_id, semOm.id);
    assert.notEqual(a[0].owner_id, vivo.id);
    assert.equal(desativado.role, 'user', 'nenhum papel global no ator do repro');
    assert.equal(semOm.role, 'user');

    // E o SQL do share continua INTACTO: `fn_user_atlas_shares` devolve `read` para os
    // três, mortos inclusive. É o que prova que o conserto está no GATE e que o repro
    // não está medindo uma mudança de fixture.
    const nivel = async (userId) => {
      const { rows } = await db.query(
        'SELECT permission FROM fn_user_atlas_shares($1::uuid, $2::uuid)', [userId, atlasPrivado.id]
      );
      assert.equal(rows.length, 1, 'o share continua na tabela e continua resolvendo');
      return rows[0].permission;
    };
    assert.equal(await nivel(vivo.id), 'read');
    assert.equal(await nivel(desativado.id), 'read');
    assert.equal(await nivel(semOm.id), 'read');
  });

  // ==========================================================================
  // O CONTROLE POSITIVO e os dois negativos
  // ==========================================================================

  it('CONTROLE POSITIVO: conta viva, OM viva, share vivo — continua entrando', async () => {
    await lista(tokenVivo, atlasPrivado.id).expect(200);
  });

  it('conta DESATIVADA com share vivo NÃO alcança mais o atlas', async () => {
    await lista(tokenDesativado, atlasPrivado.id).expect(404);

    // DISCRIMINAÇÃO, e ela é o que separa "o gate recusou" de "a rota morreu" ou "o
    // token deixou de ser lido": o MESMO token, na MESMA rota, SEM `?atlasId=`,
    // continua respondendo 200. O 404 acima vem do eixo por atlas e de nada mais.
    await lista(tokenDesativado, null).expect(200);
  });

  it('OM de LOTAÇÃO desativada, com a conta ativa e o share vivo, também não alcança', async () => {
    // O segundo termo de `fn_principal_vivo`, e ele é o que se esquece: a conta desta
    // pessoa continua `is_active = true`.
    const { rows } = await db.query('SELECT is_active FROM users WHERE id = $1', [semOm.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_active, true, 'piso: quem morreu foi a OM, não a conta');

    await lista(tokenSemOm, atlasPrivado.id).expect(404);
    await lista(tokenSemOm, null).expect(200);
  });

  // ==========================================================================
  // O ATALHO DO ADMIN GLOBAL
  // ==========================================================================

  it('o admin global DESATIVADO deixa de fazer o curto-circuito para o topo da escada', async () => {
    // O par completo, no mesmo instante: os dois são `admin`, nenhum dos dois tem share
    // ou posse neste atlas, e a única diferença entre eles é `is_active`.
    await lista(tokenAdminVivo, atlasPrivado.id).expect(200);
    await lista(tokenAdminMorto, atlasPrivado.id).expect(404);
  });

  // ==========================================================================
  // O QUE O CONSERTO NÃO PODE TER QUEBRADO
  // ==========================================================================

  it('público continua público: o anônimo entra, e a conta morta degrada para o mesmo lugar', async () => {
    // O risco simétrico do conserto: um "principal morto → 404" escrito grosso demais
    // fecharia o atlas PÚBLICO para todo mundo, porque o anônimo também não é um
    // principal vivo. Ele degrada para `read` pelo ramo `is_public`, como sempre.
    await lista(null, atlasPublico.id).expect(200);
    await lista(tokenDesativado, atlasPublico.id).expect(200);
    await lista(tokenSemOm, atlasPublico.id).expect(200);
  });

  // ==========================================================================
  // O QUE JÁ ESTAVA COBERTO — declarado, não medido como repro
  // ==========================================================================

  it('DOCUMENTAÇÃO: no caminho ESTRITO o `auth` já barrava, e por isso ele não serve de repro', async () => {
    // Este caso é VERDE com e sem o conserto, e está aqui dito por extenso para que
    // ninguém "melhore" o repro movendo-o para uma rota de `/atlas`: ali o 401/403 do
    // `auth` chega antes, o gate de atlas nem roda, e a medição vira vazia.
    const atlasUrl = `/api/v1/atlas/${atlasPrivado.id}`;
    await supertest(app).get(atlasUrl).set('Authorization', `Bearer ${tokenVivo}`).expect(200);
    await supertest(app).get(atlasUrl).set('Authorization', `Bearer ${tokenDesativado}`).expect(401);
    await supertest(app).get(atlasUrl).set('Authorization', `Bearer ${tokenSemOm}`).expect(403);
  });
});
