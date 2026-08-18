// Path: tests/integration/auditoria-acoes-novas.test.js
//
// AS ESCRITAS QUE NÃO DEIXAVAM RASTRO (migração 020).
//
// A trilha tinha dois buracos de naturezas diferentes, e o segundo é o que
// envergonha:
//
//   (a) ESCRITAS SEM AÇÃO NENHUMA. CRUD de catálogo, `config_settings`, criação de
//       atlas, purga de concessões, mudança de escopo de produção, 360 no nível do
//       projeto. Nada a filtrar porque nada era escrito.
//   (b) AÇÕES DECLARADAS SEM EMISSOR. `LOGIN`, `LOGOUT` e `ATLAS_DELETE` estão no
//       CHECK desde a 001_core.sql e a contagem de emissores em `src/` era ZERO
//       para as três. Este é o pior dos dois: quem filtrasse a trilha por
//       `ATLAS_DELETE` recebia lista vazia e concluía que ninguém apaga atlas. Um
//       verde que não verifica nada, com cara de resposta.
//
// CADA CASO MEDE O DELTA, NUNCA O ESTADO FINAL. Contar as linhas ANTES da ação e
// depois é o que separa "esta ação audita" de "o banco já tinha uma linha parecida
// de outro arquivo da suíte". Onde o alvo é único (um slug com sufixo aleatório, um
// UUID recém-criado), a unicidade faz o mesmo trabalho e o zero inicial é afirmado.
//
// E O ALVO É COLUNA DE PRIMEIRA CLASSE. Até a 020, `target_type` não tinha valor
// para recurso de catálogo e `target_id` era UUID enquanto o id de catálogo é um
// SLUG — gravá-lo ali levantava 22P02, que a borda devolvia como HTTP 400 numa rota
// sem relação aparente com auditoria. Por isso vários casos abaixo afirmam a
// CONSULTA por (target_type, target_id), que é a pergunta que o schema antigo não
// sabia responder, e não só a existência da linha.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';
import { tx } from '../../src/database/index.js';
import { purgeResourceLinks } from '../../src/modules/resource-access/resource-access.service.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** As cinco tabelas de catálogo e o alvo de auditoria de cada uma (migração 020). */
const CATALOGO = [
  ['basemaps', 'BASEMAP'],
  ['data-layers', 'DATA_LAYER'],
  ['analysis-layers', 'ANALYSIS_LAYER'],
  ['tilesets', 'TILESET'],
  ['streetview-markers', 'STREETVIEW_MARKER'],
];

describe('F7 — as ações novas de auditoria têm emissor, ator, alvo e detalhe', () => {
  let app, db, admin, adminTok, usuario, outro, orgProducao;
  const sufixo = randomUUID().slice(0, 8);

  /** As linhas de auditoria de um alvo, mais recentes primeiro. */
  async function trilha(action, targetType, targetId) {
    const { rows } = await db.query(
      `SELECT action, actor_id, target_type, target_id, target_name, details, ip, user_agent
         FROM audit_trail
        WHERE action = $1 AND target_type = $2 AND target_id = $3
        ORDER BY created_at DESC`,
      [action, targetType, targetId]
    );
    return rows;
  }

  /** Quantas linhas existem hoje para (ação, alvo). O "antes" de todo par. */
  async function quantas(action, targetType, targetId) {
    return (await trilha(action, targetType, targetId)).length;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `aud_adm_${sufixo}` });
    adminTok = await loginUser(app, admin.username, admin.password);
    usuario = await createUser(db, { username: `aud_usr_${sufixo}` });
    outro = await createUser(db, { username: `aud_out_${sufixo}` });

    const { rows } = await db.query(
      `INSERT INTO organizations (nome, sigla, slug) VALUES ($1, $2, $3) RETURNING id`,
      [`OM Auditoria ${sufixo}`, `OMA${sufixo.slice(0, 3)}`, `oma-${sufixo}`]
    );
    orgProducao = rows[0].id;
  });

  after(async () => {
    // As linhas de auditoria FICAM: elas são o produto do que este arquivo mede, o
    // banco é dropado ao fim da suíte, e todo caso daqui conta o próprio delta —
    // limpar a trilha esconderia interferência entre arquivos em vez de evitá-la.
    // O que se desfaz é o estado que outro arquivo poderia ler como pré-condição.
    await db.query('UPDATE users SET role = $1, producer_org_id = NULL WHERE id = $2', ['user', usuario.id]);
    await db.query('DELETE FROM organizations WHERE id = $1', [orgProducao]);
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // (b) as três ações declaradas desde a 001 que nunca tiveram emissor
  // ---------------------------------------------------------------------------

  it('LOGIN e LOGOUT deixam linha (as duas eram declaradas no CHECK e sem emissor nenhum)', async () => {
    const fulano = await createUser(db, { username: `aud_login_${sufixo}` });
    assert.equal(await quantas('LOGIN', 'USER', fulano.id), 0, 'piso: conta recém-criada, nada na trilha');

    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .set('User-Agent', 'EBGeoAuditProbe/1.0')
      .send({ username: fulano.username, password: fulano.password })
      .expect(200);

    const entradas = await trilha('LOGIN', 'USER', fulano.id);
    assert.equal(entradas.length, 1, 'uma linha por entrada de sessão, nem zero nem uma por requisição');
    // AUTO-ALVO: quem entra é o ator E o alvo.
    assert.equal(entradas[0].actor_id, fulano.id);
    assert.equal(entradas[0].details.username, fulano.username);
    assert.equal(entradas[0].user_agent, 'EBGeoAuditProbe/1.0', 'o user-agent vivo é capturado de req');
    // Nada de credencial na trilha, que é lida por qualquer administrador.
    assert.doesNotMatch(JSON.stringify(entradas[0].details), /Test@1234|accessToken|refreshToken/);

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      .send({ refreshToken: res.body.data.refreshToken })
      .expect(204);

    const saidas = await trilha('LOGOUT', 'USER', fulano.id);
    assert.equal(saidas.length, 1, 'e uma por saída');
    // `revoked` é o que distingue um encerramento real de um logout que não achou
    // token — a resposta é 204 nos três desfechos de propósito, então a distinção
    // só existe aqui.
    assert.equal(saidas[0].details.revoked, true);
  });

  it('o ciclo de vida do atlas inteiro audita: criar, apagar, restaurar e transferir', async () => {
    const criado = await supertest(app)
      .post('/api/v1/atlas')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Atlas auditoria ${sufixo}` })
      .expect(201);
    const atlasId = criado.body.data.id;

    const nascimento = await trilha('ATLAS_CREATE', 'ATLAS', atlasId);
    assert.equal(nascimento.length, 1);
    assert.equal(nascimento[0].actor_id, admin.id);
    assert.equal(nascimento[0].target_name, `Atlas auditoria ${sufixo}`);
    // `via` separa os TRÊS caminhos que criam atlas (criar, importar, clonar) sem
    // partir a contagem em três ações que alguém somaria errado.
    assert.equal(nascimento[0].details.via, 'create');

    assert.equal(await quantas('ATLAS_DELETE', 'ATLAS', atlasId), 0, 'piso: nada apagado ainda');
    await supertest(app)
      .delete(`/api/v1/atlas/${atlasId}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(204);
    const exclusao = await trilha('ATLAS_DELETE', 'ATLAS', atlasId);
    assert.equal(exclusao.length, 1, 'ATLAS_DELETE estava no CHECK desde a 001 e nunca teve emissor');
    // `soft` impede a leitura de que a exclusão foi definitiva: existe lixeira, e
    // ATLAS_RESTORE é o inverso.
    assert.equal(exclusao[0].details.soft, true);
    assert.equal(exclusao[0].details.ownerId, admin.id);

    await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/restore`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    const volta = await trilha('ATLAS_RESTORE', 'ATLAS', atlasId);
    assert.equal(volta.length, 1);
    assert.equal(volta[0].details.byAdmin, true, 'o admin global desatolando é história diferente do dono desfazendo');

    // A posse só passa para um MEMBRO ativo (regra do serviço), então o convite vem
    // antes — sem ele o 400 seria de pré-condição, não de trilha.
    await createShare(db, atlasId, usuario.id, 'manage', admin.id);
    await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/transfer`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ newOwnerId: usuario.id })
      .expect(200);
    const posse = await trilha('ATLAS_TRANSFER', 'ATLAS', atlasId);
    assert.equal(posse.length, 1);
    // De onde veio E para onde foi: mudança de titularidade só é auditável se disser
    // os dois lados.
    assert.equal(posse[0].details.from, admin.id);
    assert.equal(posse[0].details.to, usuario.id);

    await db.query('DELETE FROM atlas WHERE id = $1', [atlasId]);
  });

  // ---------------------------------------------------------------------------
  // (a) o CRUD de catálogo, nas CINCO tabelas
  // ---------------------------------------------------------------------------

  it('o CRUD de catálogo audita nas CINCO tabelas, com o SLUG na coluna de alvo', async () => {
    // AS CINCO E NÃO UMA: o router é fabricado por tabela (`makeCatalogRouter`), e
    // testar `tilesets` só reproduz o buraco que `catalog-tables.test.js` já teve de
    // fechar uma vez. Cada tabela tem seu próprio `target_type` no CHECK da 020, e
    // um mapa incompleto levanta 23514 dentro da escrita.
    for (const [rota, alvo] of CATALOGO) {
      const id = `aud-${rota}-${sufixo}`;
      assert.equal(await quantas('CATALOG_CREATE', alvo, id), 0, `piso: ${rota} sem trilha antes`);

      await supertest(app)
        .post(`/api/v1/${rota}`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ id, name: `Recurso ${rota}`, config: { url: '/x' } })
        .expect(201);

      const criacao = await trilha('CATALOG_CREATE', alvo, id);
      assert.equal(criacao.length, 1, `${rota}: uma linha de criação`);
      assert.equal(criacao[0].actor_id, admin.id);
      assert.equal(criacao[0].target_name, `Recurso ${rota}`);
      assert.equal(criacao[0].details.resurrected, false, 'INSERT, e não overwrite de id soft-deletado');
      // O ADMIN NÃO CARIMBA OM: `owner_org_id` só é forçado para o produtor, e uma
      // linha institucional (NULL) é estado terminal legítimo.
      assert.equal(criacao[0].details.ownerOrgId, null);
      // O ALVO É UM SLUG. Enquanto `target_id` foi UUID, esta gravação levantava
      // 22P02 e a rota respondia 400 sem dizer por quê.
      assert.doesNotMatch(criacao[0].target_id, /^[0-9a-f]{8}-[0-9a-f]{4}-/i);

      await supertest(app)
        .put(`/api/v1/${rota}/${id}`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ name: `Recurso ${rota} v2` })
        .expect(200);
      const edicao = await trilha('CATALOG_UPDATE', alvo, id);
      assert.equal(edicao.length, 1, `${rota}: uma linha de edição`);
      // SÓ OS NOMES DOS CAMPOS: `config` guarda URL de serviço e a trilha é lida por
      // qualquer administrador.
      assert.deepEqual(edicao[0].details.fields, ['name']);

      await supertest(app)
        .delete(`/api/v1/${rota}/${id}`)
        .set('Authorization', `Bearer ${adminTok}`)
        .expect(204);
      const exclusao = await trilha('CATALOG_DELETE', alvo, id);
      assert.equal(exclusao.length, 1, `${rota}: uma linha de exclusão`);
      assert.equal(exclusao[0].details.soft, true, 'a rota de criação ressuscita o id: dizer `soft` evita a leitura errada');
    }
  });

  it('a trilha do catálogo é interrogável pelo ALVO na rota de auditoria (o slug sobrevive ao envelope)', async () => {
    const id = `aud-envelope-${sufixo}`;
    await supertest(app)
      .post('/api/v1/tilesets')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ id, name: 'Envelope', config: { url: '/x' } })
      .expect(201);

    // ESTE É O CASO QUE PROVA QUE O `ALTER COLUMN target_id TYPE TEXT` CHEGOU ATÉ A
    // ROTA, e não só ao schema: o filtro por `targetId` é `Joi.string()` (nunca
    // `.uuid()`), senão ele recusaria justamente os alvos que a 020 destravou.
    const res = await supertest(app)
      .get('/api/v1/audit')
      .query({ targetType: 'TILESET', targetId: id, limit: 50 })
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);

    assert.ok(res.body.data.total >= 1, 'a linha recém-escrita precisa ser contada pelo filtro');
    const linhas = res.body.data.data;
    assert.ok(linhas.length >= 1, 'e devolvida');
    const forasteiras = linhas.filter((r) => r.target_id !== id || r.target_type !== 'TILESET');
    assert.deepEqual(forasteiras, [], 'um filtro que não filtra devolveria a trilha inteira');
    assert.ok(linhas.some((r) => r.action === 'CATALOG_CREATE'), 'e a ação certa está entre elas');

    await supertest(app)
      .delete(`/api/v1/tilesets/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(204);
  });

  // ---------------------------------------------------------------------------
  // config_settings: o documento de boot
  // ---------------------------------------------------------------------------

  it('CONFIG_UPDATE e CONFIG_CLEAR são ações distintas, com a chave textual no alvo', async () => {
    const antesUpdate = await quantas('CONFIG_UPDATE', 'CONFIG', 'app_config');
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ app: { title: `EBGeo ${sufixo}` } })
      .expect(200);
    const update = await trilha('CONFIG_UPDATE', 'CONFIG', 'app_config');
    assert.equal(update.length, antesUpdate + 1, 'o override do documento de boot deixa UMA linha');
    assert.equal(update[0].actor_id, admin.id);
    // As SEÇÕES tocadas, não os valores: o mesmo critério de `USER_UPDATE`.
    assert.deepEqual(update[0].details.sections, ['app']);
    // `app_config` é o segundo alvo que só existe porque `target_id` virou TEXT.
    assert.equal(update[0].target_id, 'app_config');

    const antesClear = await quantas('CONFIG_CLEAR', 'CONFIG', 'app_config');
    await supertest(app)
      .delete('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    const clear = await trilha('CONFIG_CLEAR', 'CONFIG', 'app_config');
    assert.equal(clear.length, antesClear + 1, 'a válvula que zera os overrides é AÇÃO PRÓPRIA');
    assert.equal(clear[0].details.cleared, true, 'havia o que apagar');
    assert.ok(clear[0].details.sections.includes('app'), 'e a linha diz o que sumiu');

    // A SEGUNDA reversão não apaga nada, e a trilha registra isso em vez de mentir
    // que apagou: pedido atendido, efeito nenhum, são coisas diferentes.
    await supertest(app)
      .delete('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    const vazia = await trilha('CONFIG_CLEAR', 'CONFIG', 'app_config');
    assert.equal(vazia.length, antesClear + 2);
    assert.equal(vazia[0].details.cleared, false, 'reversão sem o que reverter é registro honesto, não ausência');
  });

  // ---------------------------------------------------------------------------
  // o eixo de PRODUÇÃO e a reativação de conta
  // ---------------------------------------------------------------------------

  it('PRODUCER_SCOPE_CHANGE é ação própria e pega a revogação do escopo, que não tem ROLE_CHANGE para carregar', async () => {
    assert.equal(await quantas('PRODUCER_SCOPE_CHANGE', 'USER', usuario.id), 0, 'piso: conta comum');

    await supertest(app)
      .put(`/api/v1/users/${usuario.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ role: 'producer', producer_org_id: orgProducao })
      .expect(200);

    const promocao = await trilha('PRODUCER_SCOPE_CHANGE', 'USER', usuario.id);
    assert.equal(promocao.length, 1);
    assert.equal(promocao[0].details.from, null);
    assert.equal(promocao[0].details.to, orgProducao, 'a OM de produção é o dado central do eixo');
    assert.equal(promocao[0].details.role, 'producer');
    // O PAR COM `ROLE_CHANGE`: as duas são emitidas, e são duas. Uma só não
    // responderia "para qual OM", a outra não responderia "com qual papel".
    const papel = await trilha('ROLE_CHANGE', 'USER', usuario.id);
    assert.equal(papel.length, 1);
    assert.equal(papel[0].details.to, 'producer');

    // O CASO QUE JUSTIFICA A AÇÃO SEPARADA: rebaixar limpa o escopo como EFEITO, sem
    // `producer_org_id` no corpo. A comparação é contra a LINHA GRAVADA — comparar
    // com o corpo do request perderia exatamente esta revogação.
    await supertest(app)
      .put(`/api/v1/users/${usuario.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ role: 'user' })
      .expect(200);
    const revogacao = await trilha('PRODUCER_SCOPE_CHANGE', 'USER', usuario.id);
    assert.equal(revogacao.length, 2, 'a perda do crachá também é evento do eixo de produção');
    assert.equal(revogacao[0].details.from, orgProducao);
    assert.equal(revogacao[0].details.to, null);
  });

  it('USER_REACTIVATE fecha a meia história de USER_DELETE', async () => {
    const conta = await createUser(db, { username: `aud_react_${sufixo}` });
    assert.equal(await quantas('USER_REACTIVATE', 'USER', conta.id), 0);

    await supertest(app)
      .delete(`/api/v1/users/${conta.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    const desativacao = await trilha('USER_DELETE', 'USER', conta.id);
    assert.equal(desativacao.length, 1, 'piso: a desativação já auditava desde sempre');

    await supertest(app)
      .post(`/api/v1/users/${conta.id}/reactivate`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    const reativacao = await trilha('USER_REACTIVATE', 'USER', conta.id);
    assert.equal(
      reativacao.length, 1,
      'sem esta linha, quem filtra por USER_DELETE conclui que a conta continua desativada'
    );
    assert.equal(reativacao[0].actor_id, admin.id);
    assert.equal(reativacao[0].details.role, 'user');
  });

  // ---------------------------------------------------------------------------
  // PERMISSION_PURGE: o hard-delete que destruía sem registrar nada
  // ---------------------------------------------------------------------------
  //
  // `purgeResourceLinks` é chamada de UM lugar só (o hard-delete de projeto 360, o
  // único do sistema) e é exercitada aqui DIRETO, na transação, e não por HTTP: o
  // caminho HTTP exige bundle, arquivo `.db` em disco e worker pool, que não têm
  // nada a ver com o que se quer prender. O elo entre os dois é afirmado logo abaixo,
  // por leitura da fonte.
  //
  // UMA LINHA POR VÍNCULO, e não uma linha com contagens: depois do COMMIT não
  // existe mais nada de onde reconstruir quem tinha acesso ao recurso apagado. É a
  // última fotografia possível.

  it('a purga emite UMA linha por concessão e uma por empréstimo, viva ou morta', async () => {
    const recurso = `aud-purga-${sufixo}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, access_level) VALUES ($1, $2, '{}'::jsonb, 'private')`,
      [recurso, 'Purga']
    );
    const atlas = await createAtlas(db, admin.id, { name: `Atlas purga ${sufixo}` });

    const { rows: viva } = await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('tileset', $1, $2, 'view', $3) RETURNING id`,
      [recurso, usuario.id, admin.id]
    );
    const { rows: morta } = await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by, revoked_at)
       VALUES ('tileset', $1, $2, 'view', $3, NOW()) RETURNING id`,
      [recurso, outro.id, admin.id]
    );
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, 'tileset', $2, $3)`,
      [atlas.id, recurso, admin.id]
    );

    assert.equal(await quantas('PERMISSION_PURGE', 'TILESET', recurso), 0, 'piso: nada purgado ainda');

    const resultado = await tx((t) => purgeResourceLinks(t, 'tileset', recurso, admin.id, { ip: '5.5.5.5' }));
    assert.deepEqual(resultado, { grants: 2, atlasLinks: 1 }, 'as duas concessões e o empréstimo saíram da tabela');

    const linhas = await trilha('PERMISSION_PURGE', 'TILESET', recurso);
    assert.equal(linhas.length, 3, 'uma linha por vínculo destruído: duas concessões e um empréstimo');
    const concessoes = linhas.filter((l) => l.details.kind === 'grant');
    const emprestimos = linhas.filter((l) => l.details.kind === 'atlas_link');
    assert.equal(concessoes.length, 2);
    assert.equal(emprestimos.length, 1);

    const porId = new Map(concessoes.map((l) => [l.details.grantId, l.details]));
    assert.equal(porId.size, 2, 'as duas linhas falam de concessões DIFERENTES');
    // `wasLive` separa quem perdeu acesso AGORA de quem já não tinha: sem ele, a
    // fotografia final não distingue as duas.
    assert.equal(porId.get(viva[0].id).wasLive, true);
    assert.equal(porId.get(viva[0].id).granteeId, usuario.id);
    assert.equal(porId.get(morta[0].id).wasLive, false);
    assert.equal(emprestimos[0].details.atlasId, atlas.id);
    assert.equal(linhas[0].actor_id, admin.id);

    await db.query('DELETE FROM atlas WHERE id = $1', [atlas.id]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [recurso]);
  });

  it('a trilha da purga é atômica com a destruição: o rollback não deixa linha nem apaga vínculo', async () => {
    const recurso = `aud-purga-rb-${sufixo}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, access_level) VALUES ($1, $2, '{}'::jsonb, 'private')`,
      [recurso, 'Purga rollback']
    );
    const { rows: g } = await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('tileset', $1, $2, 'view', $3) RETURNING id`,
      [recurso, usuario.id, admin.id]
    );

    const sentinela = new Error('rollback depois da purga');
    await assert.rejects(
      tx(async (t) => {
        await purgeResourceLinks(t, 'tileset', recurso, admin.id, { ip: '5.5.5.5' });
        // A INGESTÃO PODE FALHAR DEPOIS. Fora da transação do chamador, a trilha
        // afirmaria uma destruição que o rollback desfez.
        throw sentinela;
      }),
      (err) => err === sentinela
    );

    assert.equal(await quantas('PERMISSION_PURGE', 'TILESET', recurso), 0, 'a linha não sobrevive ao rollback');
    const { rows: sobrou } = await db.query('SELECT id FROM resource_grants WHERE id = $1', [g[0].id]);
    assert.equal(sobrou.length, 1, 'e o vínculo também não foi destruído (atomicidade tem dois lados)');

    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [recurso]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [recurso]);
  });

  it('o hard-delete de projeto 360 chama a purga DENTRO da transação e ANTES do DELETE', () => {
    // ESTE CASO É ESTRUTURAL PORQUE O ELO FOI O DEFEITO. `purgeResourceLinks` ficou
    // sem chamador nenhum por uma fase inteira enquanto o comentário da migração 017
    // afirmava por escrito que `deleteProject` a chamava na mesma transação — e
    // apagar um projeto deixava concessões apontando para um UUID inexistente. Os
    // dois casos acima provam que a função audita; este prova que ela é CHAMADA, que
    // é a metade que faltava.
    const fonte = fs.readFileSync(
      path.join(RAIZ, 'src/modules/streetview360/sv360.admin.service.js'), 'utf8'
    );
    const i = fonte.indexOf('export async function deleteProject');
    assert.notEqual(i, -1, 'deleteProject precisa existir em sv360.admin.service.js');
    const corpo = fonte.slice(i, i + 3000);

    const chamada = corpo.indexOf('purgeResourceLinks(');
    const remocao = corpo.indexOf('DELETE_PROJECT');
    assert.notEqual(chamada, -1, 'o hard-delete precisa purgar os vínculos de acesso do projeto');
    assert.notEqual(remocao, -1, 'guarda: o DELETE do projeto precisa estar neste trecho');
    assert.ok(
      chamada < remocao,
      'a purga vem ANTES do DELETE: depois dele, o RETURNING das concessões seria a última '
      + 'informação já perdida'
    );
    assert.match(
      corpo.slice(chamada, chamada + 80), /purgeResourceLinks\(\s*t\s*,/,
      'e recebe a transação do chamador: fora dela, a limpeza sobrevive ao rollback do projeto'
    );
  });
});
