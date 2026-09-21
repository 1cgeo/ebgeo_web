// Path: tests/integration/cursor-do-slide-saneado-no-sync.repro.test.js
//
// O DEFEITO: a porta INCREMENTAL de `slides.temporal_cursor` nao tinha regra de dominio nenhuma. O
// clone e o import ganharam a delas em 2026-09-21 (S3), e o caminho de sync ficou para tras: o
// statement grava `JSON.stringify(data.temporal_cursor)` para tudo o que nao seja nulo, entao
// `'banana'`, `{t:1}` e um numero fora do alcance de `Date` entravam na coluna JSONB e voltavam a
// todo par pelo broadcast. Do lado do cliente `transition.service.js` so aplica cursor FINITO, de
// modo que o slide simplesmente abre onde o mapa estava: nenhum erro, nenhum aviso, e o instante
// que o autor congelou some sem deixar rastro.
//
// A CAUSA e a mesma familia do S6: a regra existia (no clone e no import) e nao era consultada por
// esta porta. Hoje ha UMA definicao, `normalizeEpochMs` (`src/modules/sync/temporal-config.js`,
// folha), e as tres portas a importam de la.
//
// DUAS INVARIANTES, e a segunda e a que uma reescrita perde:
//   1. valor ilegivel vira NULL e a op continua ACEITA (recusar congela a fila de saida do cliente);
//   2. a chave AUSENTE continua ausente. O payload de um update carrega so os campos mudados, entao
//      gravar null "por seguranca" APAGARIA um cursor que a op nunca mencionou.
//
// E O QUE O PAR RECEBE tem de sair saneado tambem: o log e o broadcast ecoam o payload normalizado,
// nao a linha, e o par escreve `data` direto no proprio lado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createBriefing, loginUser,
} from '../helpers/fixtures.js';

/**
 * Um instante real, mais as duas pontas da fronteira: o TETO do alcance de `Date` (8,64e15, que
 * ainda serve) e dois valores acima dele (que nao servem). 9e15 fica logo depois do teto e ainda
 * abaixo do maior inteiro seguro, entao ele prova que a recusa e da REGRA de dominio e nao de
 * alguma peneira numerica a montante; 9e16 ja passa do inteiro seguro.
 */
const INSTANTE = 1700000000000;
const TETO_DO_ALCANCE = 8.64e15;
const LOGO_ACIMA_DO_TETO = 9e15;
const FORA_DO_ALCANCE = 9e16;

describe('o cursor do slide e saneado na porta incremental', () => {
  let app, db, owner, token, atlas, mapa, briefing;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `cursor_sync_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas do cursor' });
    mapa = await createMap(db, atlas.id, { name: 'Mapa' });
    briefing = await createBriefing(db, atlas.id, { name: 'Briefing do cursor' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /**
   * Empurra UMA op de slide na forma do cliente REAL: camelCase, com o id do briefing no slot de
   * `mapId` do envelope. Devolve `{ id, resposta }`.
   */
  const empurrarSlide = async (payload, { tipo = 'create', slideId = randomUUID() } = {}) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          protocolVersion: 2,
          id: randomUUID(),
          entityType: 'slide',
          operationType: tipo,
          entityId: slideId,
          mapId: briefing.id,
          data: { id: slideId, title: 'Slide', mode: '2d', mapId: mapa.id, ...payload },
          timestamp: Date.now(),
          clientId: 'c-cursor',
        }],
      })
      .expect(200);
    return { slideId, dados: res.body.data };
  };

  const lerCursor = async (slideId) => {
    const { rows } = await db.query('SELECT temporal_cursor FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows.length, 1, 'o slide existe');
    return rows[0].temporal_cursor;
  };

  it('CONTROLE POSITIVO: o instante que o cliente de fato manda atravessa intacto', async () => {
    // Sem esta metade, todo caso abaixo passaria identico se a porta tivesse passado a gravar
    // NULL sempre, que e o conserto errado com a mesma cara do certo.
    const { slideId, dados } = await empurrarSlide({ temporalCursor: INSTANTE, temporalEnabled: true });
    assert.deepEqual(dados.results.filter((r) => r.success !== true), []);
    assert.equal(await lerCursor(slideId), INSTANTE);
  });

  it('BORDA: o zero do epoch e instante legitimo e nao pode virar nulo', async () => {
    const { slideId } = await empurrarSlide({ temporalCursor: 0 });
    assert.equal(await lerCursor(slideId), 0);
  });

  it('BORDA: instante negativo (antes de 1970) atravessa', async () => {
    const { slideId } = await empurrarSlide({ temporalCursor: -86400000 });
    assert.equal(await lerCursor(slideId), -86400000);
  });

  it('BORDA: o TETO do alcance de `Date` ainda atravessa', async () => {
    // A fronteira prendida pelo lado de dentro, com o maior valor que ainda serve. O lado de fora
    // esta no caso seguinte, e os dois juntos sao o que impede a regra de virar "recusa tudo" ou
    // "aceita tudo" sem nenhum caso ficar vermelho.
    const { slideId } = await empurrarSlide({ temporalCursor: TETO_DO_ALCANCE });
    assert.equal(await lerCursor(slideId), TETO_DO_ALCANCE);
  });

  it('valor ilegivel vira NULL e a op continua ACEITA', async () => {
    const casos = [
      ['texto de data', '2026-01-01'],
      ['texto qualquer', 'banana'],
      ['objeto', { t: 1 }],
      ['array', [INSTANTE]],
      ['booleano', true],
      ['fora do alcance de Date', FORA_DO_ALCANCE],
      ['fora do alcance, negativo', -FORA_DO_ALCANCE],
      ['logo acima do teto, e ainda inteiro seguro', LOGO_ACIMA_DO_TETO],
    ];
    for (const [rotulo, bruto] of casos) {
      const { slideId, dados } = await empurrarSlide({ temporalCursor: bruto });
      assert.deepEqual(
        dados.results.filter((r) => r.success !== true), [],
        `${rotulo}: a op NAO pode ser recusada, senao a fila de saida do cliente congela`,
      );
      assert.equal(await lerCursor(slideId), null, `${rotulo}: a coluna guarda NULL`);
    }
  });

  it('NaN e Infinity nao sobrevivem ao JSON, e mesmo assim o resultado e NULL', async () => {
    // `JSON.stringify(NaN)` e `'null'`, entao eles chegam ao servidor ja como null. O caso existe
    // para que a afirmacao "NaN vira nulo" seja verdadeira pelo caminho INTEIRO, e nao so na
    // funcao pura (onde `frontend/tests/unit/configuracao-temporal-espelha-cliente.test.js` a mede).
    const { slideId } = await empurrarSlide({ temporalCursor: JSON.parse(JSON.stringify(Number.NaN)) });
    assert.equal(await lerCursor(slideId), null);
    const outro = await empurrarSlide({ temporalCursor: JSON.parse(JSON.stringify(Infinity)) });
    assert.equal(await lerCursor(outro.slideId), null);
  });

  it('a chave AUSENTE num UPDATE nao apaga o cursor ja gravado', async () => {
    const { slideId } = await empurrarSlide({ temporalCursor: INSTANTE, temporalEnabled: true });
    assert.equal(await lerCursor(slideId), INSTANTE);

    // Um update que so mexe no titulo: o payload nao menciona o cursor.
    await empurrarSlide({ title: 'Outro titulo' }, { tipo: 'update', slideId });
    assert.equal(await lerCursor(slideId), INSTANTE, 'update que nao cita o cursor nao pode apaga-lo');
  });

  it('um NULO EXPLICITO continua apagando o cursor, que e o gesto de "sem instante"', async () => {
    const { slideId } = await empurrarSlide({ temporalCursor: INSTANTE });
    assert.equal(await lerCursor(slideId), INSTANTE);
    await empurrarSlide({ temporalCursor: null }, { tipo: 'update', slideId });
    assert.equal(await lerCursor(slideId), null);
  });

  it('O QUE O PAR RECEBE ja vem saneado: o log ecoa o payload normalizado', async () => {
    const opId = randomUUID();
    const slideId = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          protocolVersion: 2, id: opId, entityType: 'slide', operationType: 'create',
          entityId: slideId, mapId: briefing.id,
          data: { id: slideId, title: 'Par', mode: '2d', mapId: mapa.id, temporalCursor: 'banana' },
          timestamp: Date.now(), clientId: 'c-cursor-par',
        }],
      })
      .expect(200);

    const { rows } = await db.query(
      'SELECT data FROM operations WHERE atlas_id = $1 AND op_id = $2', [atlas.id, opId],
    );
    assert.equal(rows.length, 1, 'a op foi logada');
    assert.equal(
      rows[0].data.temporal_cursor, null,
      'o par aplica `data` direto e nao valida nada: o fio tem de chegar limpo',
    );
  });

  it('`changes` e `previousData` tambem sao saneados, e eles NAO passam pela normalizacao do slide',
    async () => {
      // `normalizeSlidePayload` so toca `data`. Os outros dois carregadores sao relatados ao par,
      // e quem os alcanca e a borda de escrita livre (`free-field.schemas.js`), pela MESMA regra.
      const opId = randomUUID();
      const slideId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            protocolVersion: 2, id: opId, entityType: 'slide', operationType: 'update',
            entityId: slideId, mapId: briefing.id,
            data: { id: slideId, title: 'Com changes' },
            changes: { title: 'Com changes', temporalCursor: 'banana', temporal_cursor: { t: 1 } },
            previousData: { temporalCursor: FORA_DO_ALCANCE },
            timestamp: Date.now(), clientId: 'c-cursor-changes',
          }],
        })
        .expect(200);

      const { rows } = await db.query(
        'SELECT changes FROM operations WHERE atlas_id = $1 AND op_id = $2', [atlas.id, opId],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].changes.temporalCursor, null, 'a grafia do cliente REAL e a camelCase');
      assert.equal(rows[0].changes.temporal_cursor, null, 'e a da coluna tambem e coberta');
      assert.equal(rows[0].changes.title, 'Com changes', 'o resto do payload nao e tocado');
    });
});
