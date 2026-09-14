// Path: tests/integration/cota-de-atlas-por-conta.test.js
//
// A15 / decisao D12 de 14/09/2026. Ate aqui criar atlas era o unico consumo de recurso
// autenticado e atribuivel SEM teto nenhum: `POST /atlas`, `POST /atlas/import` e
// `POST /atlas/:id/clone` criavam quantos a conta pedisse, e a importacao aceitava quantos mapas
// o corpo coubesse.
//
// O QUE ESTE ARQUIVO PRENDE:
//
//   1. os TRES caminhos de criacao recusam com 429 e com a frase que NOMEIA o teto (uma recusa
//      sem numero manda a pessoa adivinhar quantos ela tem);
//   2. o `code` e `QUOTA_EXCEEDED` e nao o 429 do limitador de taxa, que e outra conversa
//      ("espere" nao resolve um teto);
//   3. o ADMINISTRADOR GLOBAL NAO fica isento: a cota e por CONTA, nao por papel. No eixo de
//      consumo de disco ele e uma conta como as outras, e isentar por papel misturaria o eixo
//      global (que nao e uma escada) com o de consumo;
//   4. a LIXEIRA nao ocupa vaga, e este e o CONTROLE NEGATIVO do recorte: mover UM para a lixeira
//      faz a mesma chamada que acabou de dar 429 passar. Sem ele, `deleted_at IS NULL` na consulta
//      seria indistinguivel de um filtro que ninguem exercita;
//   5. atlas de que a conta e apenas MEMBRO nao conta, pelo mesmo motivo do item anterior e com o
//      mesmo tipo de controle: quem responde pelo espaco de um atlas compartilhado e o dono dele;
//   6. o teto de MAPAS por importacao recusa com 400 (nao 429: o pedido e grande demais em si
//      mesmo, e nada que a pessoa apague no servidor o faz caber) e a frase nomeia os dois
//      numeros; um arquivo pequeno continua entrando, que e o controle negativo dele.
//
// A MONTAGEM ENCHE A COTA POR INSERT DIRETO, e nao por cem chamadas de rota, porque o sujeito
// aqui e o GATE e nao o caminho de criacao: cem POSTs mediriam o mesmo e custariam cem
// transacoes. O `guarda:` antes de cada bloco confere que a contagem de partida e a esperada,
// senao um INSERT que falhasse em silencio deixaria o 429 vindo de outra coisa.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { atlasQuotaNotice, importMapsNotice } from '../../src/modules/atlas/atlas-quota.js';

const U = () => `cota_${randomUUID().slice(0, 8)}`;
const MAX = config.atlas.maxPerAccount;
const MAX_MAPAS = config.atlas.importMaxMaps;

describe('cota de atlas por conta e teto de mapas por importacao', () => {
  let app, db;
  let dono, donoToken, admin, adminToken, vizinho;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    assert.ok(MAX > 0, 'guarda: esta suite mede o teto ligado; com zero ele esta desligado');
    assert.ok(MAX_MAPAS > 0, 'guarda: idem para o teto de mapas');

    dono = await createUser(db, { username: U() });
    donoToken = await loginUser(app, dono.username, dono.password);
    admin = await createAdminUser(db, { username: U() });
    adminToken = await loginUser(app, admin.username, admin.password);
    vizinho = await createUser(db, { username: U() });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Enche a cota de uma conta por INSERT direto, deixando-a com exatamente `quantos` vivos. */
  async function encherCota(userId, quantos = MAX) {
    await db.query('DELETE FROM atlas WHERE owner_id = $1', [userId]);
    await db.query(
      `INSERT INTO atlas (name, owner_id)
       SELECT 'Cota ' || g::text, $1 FROM generate_series(1, $2) g`,
      [userId, quantos],
    );
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM atlas WHERE owner_id=$1 AND deleted_at IS NULL', [userId]);
    assert.equal(rows[0].n, quantos, 'guarda: a montagem precisa deixar a contagem exata');
  }

  const criar = (token, name = `Novo ${U()}`) =>
    supertest(app).post('/api/v1/atlas').set('Authorization', `Bearer ${token}`).send({ name });

  const importar = (token, maps = []) =>
    supertest(app).post('/api/v1/atlas/import').set('Authorization', `Bearer ${token}`)
      .send({ atlas: { name: `Importado ${U()}` }, maps });

  const clonar = (token, atlasId) =>
    supertest(app).post(`/api/v1/atlas/${atlasId}/clone`)
      .set('Authorization', `Bearer ${token}`).send({});

  const mapaDoPayload = (n) => ({ id: randomUUID(), name: `Mapa ${n}` });

  beforeEach(async () => {
    await db.query('DELETE FROM atlas WHERE owner_id = ANY($1::uuid[])',
      [[dono.id, admin.id, vizinho.id]]);
  });

  it('POST /atlas recusa com 429 e a frase nomeia o teto', async () => {
    await encherCota(dono.id);
    const res = await criar(donoToken).expect(429);
    assert.equal(res.body.error.code, 'QUOTA_EXCEEDED',
      'o codigo separa este 429 do limitador de taxa, onde esperar resolveria');
    assert.equal(res.body.error.message, atlasQuotaNotice(MAX, MAX));
    assert.match(res.body.error.message, new RegExp(String(MAX)),
      'a frase precisa carregar o numero, senao manda a pessoa adivinhar');
  });

  it('POST /atlas/import recusa com o mesmo 429', async () => {
    await encherCota(dono.id);
    const res = await importar(donoToken, [mapaDoPayload(1)]).expect(429);
    assert.equal(res.body.error.code, 'QUOTA_EXCEEDED');
    assert.equal(res.body.error.message, atlasQuotaNotice(MAX, MAX));
  });

  it('POST /atlas/:id/clone recusa com o mesmo 429, e a origem e de OUTRA conta', async () => {
    // A origem pertence ao vizinho e e compartilhada em leitura: o clone gateia `read` na ORIGEM
    // e cria o destino em nome do REQUISITANTE, entao e a cota DELE que fecha.
    const origem = await createAtlas(db, vizinho.id, { name: `Origem ${U()}` });
    await createShare(db, origem.id, dono.id, 'read', vizinho.id);
    await encherCota(dono.id);

    const res = await clonar(donoToken, origem.id).expect(429);
    assert.equal(res.body.error.code, 'QUOTA_EXCEEDED');
    assert.equal(res.body.error.message, atlasQuotaNotice(MAX, MAX));
  });

  it('o ADMINISTRADOR GLOBAL nao fica isento: a cota e por conta, nao por papel', async () => {
    await encherCota(admin.id);
    const res = await criar(adminToken).expect(429);
    assert.equal(res.body.error.code, 'QUOTA_EXCEEDED');
  });

  it('CONTROLE NEGATIVO da lixeira: mover UM para a lixeira libera a vaga', async () => {
    await encherCota(dono.id);
    await criar(donoToken).expect(429);

    const { rows } = await db.query(
      'SELECT id FROM atlas WHERE owner_id=$1 AND deleted_at IS NULL LIMIT 1', [dono.id]);
    await supertest(app)
      .delete(`/api/v1/atlas/${rows[0].id}`)
      .set('Authorization', `Bearer ${donoToken}`)
      .expect(204);

    await criar(donoToken).expect(201);
  });

  it('CONTROLE NEGATIVO da posse: atlas de que a conta e so MEMBRO nao ocupa vaga', async () => {
    await encherCota(dono.id, MAX - 1);
    // Cinco atlas alheios compartilhados em gestao: o nivel mais alto que nao e posse, para que
    // o caso nao passe por acidente de o share ser fraco.
    for (let i = 0; i < 5; i++) {
      const alheio = await createAtlas(db, vizinho.id, { name: `Alheio ${U()}` });
      await createShare(db, alheio.id, dono.id, 'manage', vizinho.id);
    }
    await criar(donoToken).expect(201);
    // E agora a vaga acabou, o que prova que a chamada acima passou por caber e nao por o gate
    // estar desligado.
    await criar(donoToken).expect(429);
  });

  it('a importacao recusa acima do teto de MAPAS com 400, nomeando os dois numeros', async () => {
    const maps = Array.from({ length: MAX_MAPAS + 1 }, (_, i) => mapaDoPayload(i));
    const res = await importar(donoToken, maps).expect(400);
    assert.equal(res.body.error.message, importMapsNotice(MAX_MAPAS + 1, MAX_MAPAS));
    // Nada pode ter sido criado: a recusa acontece antes da transacao.
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM atlas WHERE owner_id=$1', [dono.id]);
    assert.equal(rows[0].n, 0, 'a recusa do arquivo grande nao pode deixar atlas nenhum atras');
  });

  it('CONTROLE NEGATIVO do teto de mapas: um arquivo pequeno continua entrando', async () => {
    const res = await importar(donoToken, [mapaDoPayload(1), mapaDoPayload(2)]).expect(201);
    assert.ok(res.body.data.id, 'o import normal precisa continuar criando o atlas');
  });
});
