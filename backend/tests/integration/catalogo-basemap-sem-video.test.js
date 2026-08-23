// Path: tests/integration/catalogo-basemap-sem-video.test.js
// O MAPA BASE NÃO TEM VÍDEO DE PRÉVIA, e desde 2026-08-23 quem diz isso é o SERVIDOR.
//
// A cláusula 2.4 da constituição é explícita ("o vídeo de prévia vale para quatro dos cinco
// tipos... o mapa base fica de fora, e não por esquecimento"), e até esta data a regra não
// existia no servidor: o `configSchema` era UM SÓ para as quatro tabelas de catálogo, o
// `config` é JSONB livre em todas elas, e nenhuma migração restringe a chave. `POST
// /api/v1/basemaps` com `config.previewVideo` era aceito e gravado. O que segurava a norma
// era o formulário do painel, que não oferece o campo — ou seja, uma regra de autorização
// de conteúdo vivendo na tela.
//
// O PAR É O QUE DÁ SENTIDO A CADA METADE: a recusa no mapa base só significa alguma coisa
// ao lado da aceitação nos outros três, com o MESMO corpo de requisição. Sem isso, um
// schema que recusasse o campo em todo lugar passaria neste arquivo.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';

const SUFIXO = randomUUID().slice(0, 8);
const VIDEO = 'https://exemplo.mil.br/previas/x.webm';

/** As três que TÊM vídeo de prévia; o 360 o tem em coluna, e não passa por estas rotas. */
const COM_VIDEO = ['tilesets', 'data-layers', 'analysis-layers'];

describe('catálogo: o vídeo de prévia vale para quatro tipos, e o mapa base fica de fora', () => {
  let app, db, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db);
    token = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query("DELETE FROM basemaps WHERE id LIKE $1", [`vp-%${SUFIXO}`]);
    for (const t of ['tilesets', 'data_layers', 'analysis_layers']) {
      await db.query(`DELETE FROM ${t} WHERE id LIKE $1`, [`vp-%${SUFIXO}`]);
    }
    invalidateAppConfigCache();
    await teardownTestEnv(db);
  });

  it('as OUTRAS TRÊS tabelas aceitam o vídeo de prévia, com o mesmo corpo', async () => {
    // Metade positiva do par. Sem ela, um schema que recusasse o campo em toda tabela
    // passaria no caso de baixo e a regra estaria errada na direção oposta.
    assert.equal(COM_VIDEO.length, 3);
    for (const rota of COM_VIDEO) {
      const id = `vp-${rota}-${SUFIXO}`.replace(/-/g, '_').slice(0, 60);
      const res = await supertest(app)
        .post(`/api/v1/${rota}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ id, name: `Prévia ${rota}`, config: { previewVideo: VIDEO } });
      assert.equal(res.status, 201, `${rota} devia aceitar: ${res.status} ${res.text}`);
    }
  });

  it('o mapa base RECUSA o vídeo de prévia, com 422 nomeando o campo', async () => {
    const res = await supertest(app)
      .post('/api/v1/basemaps')
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: `vp-basemap-${SUFIXO}`,
        name: 'Base com vídeo',
        config: { previewVideo: VIDEO },
      });

    assert.equal(res.status, 422, `esperava recusa nomeada, veio ${res.status} ${res.text}`);
    // A mensagem é a genérica do edge por decisão da casa (a tradução é por TIPO de erro,
    // em `utils/validation-messages.js`, e mensagem escrita no schema é descartada lá). O
    // que o 422 tem de carregar, e carrega, é QUAL campo foi recusado.
    assert.match(
      JSON.stringify(res.body),
      /previewVideo/,
      'o 422 tem de nomear o campo recusado',
    );

    const { rows } = await db.query('SELECT id FROM basemaps WHERE id = $1', [
      `vp-basemap-${SUFIXO}`,
    ]);
    assert.equal(rows.length, 0, 'a linha não pode ter sido criada');
  });

  it('o mapa base recusa também na EDIÇÃO, e não só na criação', async () => {
    // O caminho que passava despercebido: a criação sem o campo e o PUT com ele.
    const id = `vp-base2-${SUFIXO}`;
    const criado = await supertest(app)
      .post('/api/v1/basemaps')
      .set('Authorization', `Bearer ${token}`)
      .send({ id, name: 'Base sem vídeo', config: { tipo: 'raster' } });
    assert.equal(criado.status, 201, criado.text);

    const editado = await supertest(app)
      .put(`/api/v1/basemaps/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { previewVideo: VIDEO } });
    assert.equal(editado.status, 422, editado.text);

    const { rows } = await db.query('SELECT config FROM basemaps WHERE id = $1', [id]);
    assert.equal(rows[0].config.previewVideo, undefined, 'nada pode ter sido gravado');
    await db.query('DELETE FROM basemaps WHERE id = $1', [id]);
  });

  it('o mapa base continua aceitando o RESTO do config, que é livre', async () => {
    // Discriminação: a recusa é da CHAVE, não do objeto. Sem este caso, um schema que
    // fechasse o `config` inteiro passaria nos dois de cima.
    const id = `vp-base3-${SUFIXO}`;
    const res = await supertest(app)
      .post('/api/v1/basemaps')
      .set('Authorization', `Bearer ${token}`)
      .send({ id, name: 'Base normal', config: { tipo: 'raster', url: 'https://x/{z}/{x}/{y}.png' } });
    assert.equal(res.status, 201, res.text);
    await db.query('DELETE FROM basemaps WHERE id = $1', [id]);
  });
});
