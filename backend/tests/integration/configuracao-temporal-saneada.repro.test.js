// Path: tests/integration/configuracao-temporal-saneada.repro.test.js
//
// O DEFEITO (S6 da auditoria do sistema temporal, 2026-09-21): o servidor gravava em
// `maps.temporal_config` qualquer valor que a op `mapTemporal` carregasse, e o retransmitia aos
// pares. Unidade inventada, `ativo: 'sim'`, `modo` objeto, datas em texto e janela terminando antes
// de comecar entravam inteiras na coluna, e o par conectado as adotava.
//
// A CAUSA, e ela e a "cobertura vazia" da constituicao: o contrato do modulo temporal sempre morou
// so no cliente, e a unica regra do servidor que nomeava a coluna (`GRID_AND_TEMPORAL`, em
// `src/modules/sync/free-field.schemas.js`) casa as chaves `temporal_config`/`temporalConfig` —
// que o cliente NUNCA envia. A op leva os seis campos SOLTOS e `normalizeMapChanges` os remonta
// depois, entao aquela regra nunca viu um valor temporal na vida e reportava verde sem conferir
// nada.
//
// O CONSERTO: `normalizeTemporalConfig` (`src/modules/sync/temporal-config.js`, folha espelhada do
// cliente) roda DEPOIS da remontagem, nas duas formas (solta e aninhada), e o payload SOLTO e
// saneado tambem na borda, porque o broadcast e o log ecoam o que o cliente mandou e nao a linha.
//
// A INVARIANTE QUE ESTE ARQUIVO PRENDE E DUPLA, e a segunda metade e a que se perde numa reescrita:
// o campo invalido e DESCARTADO **e a op continua sendo aceita**. Uma recusa aqui congelaria a fila
// de saida inteira daquele cliente, que e o preco que esta casa ja pagou duas vezes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('a configuracao temporal e saneada, e a op nunca e recusada', () => {
  let app, db, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `temporal_s6_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas temporal S6' });
    map = await createMap(db, atlas.id, { name: 'Mapa S6' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Empurra UMA op `mapTemporal` com os seis campos soltos, como o cliente real faz. */
  const empurrar = async (data, entityType = 'mapTemporal') => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          protocolVersion: 2,
          id: randomUUID(),
          entityType,
          operationType: 'update',
          entityId: map.id,
          mapId: map.id,
          data,
          timestamp: Date.now(),
          clientId: 'c-s6',
        }],
      })
      .expect(200);
    return res.body.data;
  };

  const coluna = async () => {
    const { rows } = await db.query('SELECT temporal_config, name FROM maps WHERE id = $1', [map.id]);
    return rows[0];
  };

  it('CONTROLE POSITIVO: o documento que o cliente de fato escreve atravessa intacto', async () => {
    // Sem esta metade, tudo abaixo passaria identico se o servidor tivesse passado a recusar ou a
    // zerar a coluna: a asercao negativa sozinha nao distingue "saneou" de "descartou tudo".
    const real = {
      ativo: true, unidade: 'DIA', inicio: 1700000000000, fim: 1700003600000,
      modo: 'relativo', origem: 1700000000000,
    };
    const dados = await empurrar(real);
    assert.equal(dados.results.every((r) => r.success === true), true, 'a op legitima foi aplicada');
    assert.deepEqual((await coluna()).temporal_config, real);
  });

  it('unidade inventada vira o padrao, e o resto do documento sobrevive', async () => {
    const dados = await empurrar({
      ativo: true, unidade: 'banana', inicio: 1000, fim: 2000, modo: 'absoluto', origem: null,
    });
    assert.deepEqual(dados.results.filter((r) => r.success !== true), [], 'a op NAO pode ser recusada');
    assert.deepEqual((await coluna()).temporal_config, {
      ativo: true, unidade: 'HORA', inicio: 1000, fim: 2000, modo: 'absoluto', origem: null,
    });
  });

  it('tipo errado em cada campo degrada para o padrao daquele campo', async () => {
    await empurrar({
      ativo: 'sim', unidade: 42, inicio: '2026-01-01', fim: '2026-12-31',
      modo: {}, origem: 'manual',
    });
    assert.deepEqual((await coluna()).temporal_config, {
      ativo: false, unidade: 'HORA', inicio: null, fim: null, modo: 'absoluto', origem: null,
    });
  });

  it('janela INVERTIDA descarta o fim e guarda o inicio', async () => {
    // A decisao: `fim: null` significa limite automatico (derivado das feicoes), que e a leitura
    // mais larga e nunca esconde feicao; guardar o par invertido produz janela VAZIA, com o mapa
    // inteiro filtrado e cara de quebrado.
    await empurrar({ ativo: true, unidade: 'HORA', inicio: 2000, fim: 1000, modo: 'absoluto', origem: null });
    const cfg = (await coluna()).temporal_config;
    assert.equal(cfg.inicio, 2000);
    assert.equal(cfg.fim, null);
  });

  it('chave fora do vocabulario nao chega a coluna, e nao renomeia o mapa', async () => {
    await empurrar({ ativo: false, bogus: 'nao-persiste', name: 'renomeado-a-forca' });
    const linha = await coluna();
    assert.deepEqual(linha.temporal_config, { ativo: false }, 'so a chave conhecida entra');
    assert.equal(linha.name, 'Mapa S6', 'o sub-tipo nao alcanca outra coluna do mapa');
  });

  it('a forma ANINHADA, de um update de mapa inteiro, passa pela MESMA regra', async () => {
    // Um `map` update carrega `temporal_config` dentro do documento (e o rename reenvia o
    // documento inteiro), e ali a op nem passa pela remontagem: se a regra morasse so na
    // montagem dos campos soltos, esta porta continuaria aberta.
    // `9e15` e o numero de propósito: esta acima do alcance de `Date` (8,64e15) e ainda abaixo do
    // maior inteiro seguro, entao chega inteiro ate a regra de dominio. Acima disso o Joi da borda
    // escalar ja o descarta como `number.unsafe`, e a chave nao existiria para comparar.
    await empurrar(
      { id: map.id, name: 'Mapa S6', temporal_config: { ativo: true, unidade: 'seculo', modo: 'cumulativo', inicio: 9e15 } },
      'map',
    );
    const linha = await coluna();
    assert.deepEqual(linha.temporal_config, { ativo: true, unidade: 'HORA', modo: 'absoluto', inicio: null });
    assert.equal(linha.name, 'Mapa S6');
  });

  it('O QUE O PAR RECEBE tambem e saneado: o broadcast e o log ecoam o payload, nao a linha', async () => {
    // O par conectado aplica `data` direto no proprio lado (`applyRemoteMapSettingOp`), sem
    // validar; se so a coluna fosse limpa, ele viveria com a unidade inventada ate um F5.
    const opId = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          protocolVersion: 2, id: opId, entityType: 'mapTemporal', operationType: 'update',
          entityId: map.id, mapId: map.id,
          data: { ativo: 'sim', unidade: 'banana', inicio: 5000, fim: 4000, modo: 'cumulativo', origem: 'manual' },
          timestamp: Date.now(), clientId: 'c-s6-peer',
        }],
      })
      .expect(200);

    const { rows } = await db.query(
      'SELECT data FROM operations WHERE atlas_id = $1 AND op_id = $2', [atlas.id, opId],
    );
    assert.equal(rows.length, 1, 'a op foi logada');
    assert.deepEqual(rows[0].data, {
      ativo: false, unidade: 'HORA', inicio: 5000, fim: null, modo: 'absoluto', origem: null,
    }, 'o que o par replica ja vem saneado');
  });

  it('BORDA: `temporal_config` explicitamente nulo vira `{}` e nao derruba o lote', async () => {
    // A coluna e `JSONB NOT NULL DEFAULT '{}'` (`003_atlas.sql`): um nulo ali levanta 23502 e
    // aborta a transacao do push inteiro, que e o envenenamento que o cliente reenviaria para
    // sempre.
    const dados = await empurrar({ id: map.id, name: 'Mapa S6', temporal_config: null }, 'map');
    assert.deepEqual(dados.results.filter((r) => r.success !== true), []);
    assert.deepEqual((await coluna()).temporal_config, {});
  });
});
