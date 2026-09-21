// Path: tests/integration/cursor-do-slide-sobrevive-a-copia.repro.test.js
//
// O DEFEITO (S3, tambem achado como I7, na auditoria do sistema temporal de 2026-09-21): clonar um
// atlas e importar um atlas perdiam o INSTANTE CONGELADO de todos os slides. O interruptor viajava
// (`slides.temporal_enabled`) e o cursor nao, entao o slide chegava com a linha do tempo LIGADA e
// sem instante, abrindo num momento que o autor nunca escolheu. Pior que chegar desligado.
//
// A CAUSA: `slides.temporal_cursor` existe na tabela desde a criacao dela (`003_atlas.sql`), mas
// nao estava no `ColumnSet` de slides de `src/modules/atlas/atlas.service.js` nem nos DOIS
// construtores de linha (o do clone e o do import). O `ColumnSet` so le as colunas que declara,
// entao a perda era silenciosa: nenhum erro, nenhuma linha a menos, um campo a menos.
//
// A ASSIMETRIA QUE TORNAVA O DEFEITO CARO: o arquivo `.ebgeo` SEMPRE preservou o cursor, de modo
// que o mesmo briefing ganhava ou perdia o instante conforme a porta pela qual passasse.
//
// CONTROLE POSITIVO OBRIGATORIO em cada caso: `temporal_enabled` ja viajava, entao ele e a prova de
// que a copia de fato aconteceu e que a asercao nao esta olhando para um slide que nunca existiu.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createBriefing, createSlide, loginUser,
} from '../helpers/fixtures.js';

const CURSOR = 1700000000000;

describe('o instante congelado do slide atravessa o clone e o import', () => {
  let app, db, owner, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `slide_s3_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Le os campos da VISTA de todos os slides de um atlas, na ordem de criacao. */
  const slidesDoAtlas = async (atlasId) => {
    const { rows } = await db.query(
      `SELECT s.title, s.temporal_cursor, s.temporal_enabled
         FROM slides s JOIN briefings b ON b.id = s.briefing_id
        WHERE b.atlas_id = $1 AND s.deleted_at IS NULL
        ORDER BY s.title`,
      [atlasId],
    );
    return rows;
  };

  /** Um atlas com um briefing de DOIS slides: um com instante congelado, outro sem. */
  const semear = async () => {
    const atlas = await createAtlas(db, owner.id, { name: `S3 ${randomUUID().slice(0, 6)}` });
    await createMap(db, atlas.id, { name: 'Mapa' });
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing S3' });
    const comCursor = await createSlide(db, briefing.id, { title: 'A com cursor' });
    const semCursor = await createSlide(db, briefing.id, { title: 'B sem cursor' });
    // O fixture nao escreve as colunas da vista; a forma gravada e a MESMA que o sync escreve
    // (`sync.service.js`: `JSON.stringify(data.temporal_cursor)`), isto e, um NUMERO em JSONB.
    await db.query(
      'UPDATE slides SET temporal_cursor = $2::jsonb, temporal_enabled = true WHERE id = $1',
      [comCursor.id, JSON.stringify(CURSOR)],
    );
    await db.query('UPDATE slides SET temporal_enabled = true WHERE id = $1', [semCursor.id]);
    return { atlas, briefing };
  };

  it('um atlas CLONADO chega com o mesmo instante, e com nulo onde nao havia nenhum', async () => {
    const { atlas } = await semear();

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const copia = await slidesDoAtlas(res.body.data.id);
    assert.equal(copia.length, 2, 'os dois slides foram copiados');
    assert.equal(copia[0].temporal_cursor, CURSOR, 'o instante congelado sobreviveu ao clone');
    assert.equal(copia[1].temporal_cursor, null, 'e a AUSENCIA de instante continua sendo ausencia');
    // Controle positivo: o interruptor ja viajava antes do conserto.
    assert.deepEqual(copia.map((s) => s.temporal_enabled), [true, true]);
  });

  it('um atlas IMPORTADO chega com o mesmo instante, e com nulo onde nao havia nenhum', async () => {
    const briefingId = randomUUID();
    const res = await supertest(app)
      .post('/api/v1/atlas/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        atlas: { name: `S3 import ${randomUUID().slice(0, 6)}` },
        maps: [{ id: randomUUID(), name: 'Mapa' }],
        briefings: [{
          id: briefingId,
          name: 'Briefing importado',
          slides: [
            { id: randomUUID(), title: 'A com cursor', temporal_enabled: true, temporal_cursor: CURSOR },
            { id: randomUUID(), title: 'B sem cursor', temporal_enabled: true },
          ],
        }],
      })
      .expect(201);

    const importado = await slidesDoAtlas(res.body.data.id);
    assert.equal(importado.length, 2, 'os dois slides foram importados');
    assert.equal(importado[0].temporal_cursor, CURSOR, 'o instante congelado atravessou o import');
    assert.equal(importado[1].temporal_cursor, null);
    assert.deepEqual(importado.map((s) => s.temporal_enabled), [true, true]);
  });

  it('BORDA: uma linha LEGADA com cursor ilegivel e normalizada ao ser clonada', async () => {
    // A porta incremental so ganhou regra de dominio em 2026-09-21, entao uma linha gravada antes
    // disso pode guardar `"banana"` ou um numero fora do alcance de `Date`. O clone le a linha CRUA
    // (`SELECT *`), e sem a regra compartilhada (`normalizeEpochMs`) ele propagaria o lixo para a
    // copia, onde `transition.service.js` o ignora em silencio. Este caso e o unico ponto em que
    // aquela regra decide alguma coisa no caminho do clone, porque o import ja e peneirado pelo Joi.
    const atlas = await createAtlas(db, owner.id, { name: `S3 legado ${randomUUID().slice(0, 6)}` });
    await createMap(db, atlas.id, { name: 'Mapa' });
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing legado' });
    const texto = await createSlide(db, briefing.id, { title: 'A texto' });
    const enorme = await createSlide(db, briefing.id, { title: 'B fora do alcance' });
    await db.query('UPDATE slides SET temporal_cursor = $2::jsonb WHERE id = $1', [texto.id, JSON.stringify('banana')]);
    await db.query('UPDATE slides SET temporal_cursor = $2::jsonb WHERE id = $1', [enorme.id, JSON.stringify(9e15)]);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const copia = await slidesDoAtlas(res.body.data.id);
    assert.equal(copia.length, 2, 'os dois slides foram copiados');
    assert.deepEqual(copia.map((s) => s.temporal_cursor), [null, null], 'o lixo nao atravessa a copia');
  });

  it('BORDA: um cursor ilegivel entra como nulo e NAO recusa o import inteiro', async () => {
    // `transition.service.js` so aplica cursor finito, entao valor de outra forma e ruido e nao
    // conteudo. Recusar o arquivo por causa dele custaria o atlas inteiro a quem o subisse.
    const res = await supertest(app)
      .post('/api/v1/atlas/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        atlas: { name: `S3 borda ${randomUUID().slice(0, 6)}` },
        maps: [{ id: randomUUID(), name: 'Mapa' }],
        briefings: [{
          id: randomUUID(),
          name: 'Briefing torto',
          slides: [
            { id: randomUUID(), title: 'A texto', temporal_cursor: '2026-01-01' },
            { id: randomUUID(), title: 'B objeto', temporal_cursor: { t: 1 } },
            { id: randomUUID(), title: 'C nulo', temporal_cursor: null },
          ],
        }],
      })
      .expect(201);

    const tortos = await slidesDoAtlas(res.body.data.id);
    assert.equal(tortos.length, 3, 'nenhum slide foi perdido por causa do campo');
    assert.deepEqual(tortos.map((s) => s.temporal_cursor), [null, null, null]);
  });

  it('e o clone de um atlas IMPORTADO com cursor mantem o instante na segunda copia', async () => {
    // A cadeia inteira: arquivo → servidor → clone. Foi a combinacao que a auditoria descreveu
    // como "a mesma acao ganha ou perde conforme a porta".
    const importado = await supertest(app)
      .post('/api/v1/atlas/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        atlas: { name: `S3 cadeia ${randomUUID().slice(0, 6)}` },
        maps: [{ id: randomUUID(), name: 'Mapa' }],
        briefings: [{
          id: randomUUID(),
          name: 'Briefing',
          slides: [{ id: randomUUID(), title: 'A com cursor', temporal_enabled: true, temporal_cursor: CURSOR }],
        }],
      })
      .expect(201);

    const clonado = await supertest(app)
      .post(`/api/v1/atlas/${importado.body.data.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const copia = await slidesDoAtlas(clonado.body.data.id);
    assert.equal(copia.length, 1);
    assert.equal(copia[0].temporal_cursor, CURSOR);
  });
});
