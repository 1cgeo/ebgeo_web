// Path: tests/integration/catalog-layer-definicao-obsoleta.repro.test.js
//
// REGRESSÃO (F11, o segundo sintoma) — A CÓPIA DA LINHA DE CATÁLOGO NUNCA ENVELHECIA JUNTO COM
// O CATÁLOGO, E ISSO NÃO TEM NADA A VER COM PERMISSÃO.
//
// CAUSA RAIZ. `catalog_layers.id` JÁ É o id do recurso de catálogo: o cliente monta
// `analysis-${id}` / `data-${id}` e a string viaja verbatim como `entityId` da op e como chave da
// linha (o comentário do INSERT em `sync.service.js` diz isso ao explicar a chave de conflito
// `(map_id, id)`). Ou seja, a referência sempre esteve gravada. Mesmo assim `data` guardava
// TAMBÉM uma cópia da linha inteira — `name` e o `config` com `source.url`, `bounds` e `legend` —
// carimbada pelo cliente no instante da adição (`config: item.originalData`), e o snapshot
// espalhava aquele JSONB verbatim.
//
// O DEFEITO, e ele existia para camada PÚBLICA como para privada: nada nunca reescrevia a cópia.
// Um administrador que corrigisse a URL de uma camada de dados (servidor de tiles trocado,
// caminho renomeado, um `{y}` invertido) deixava a URL velha viva em TODO atlas que já a tivesse
// acrescentado, para sempre. O usuário via a camada quebrada e não tinha gesto nenhum para
// consertá-la: remover e re-acrescentar era o único caminho, mapa por mapa, e ninguém sabia
// disso. Ninguém reportou porque não dói de imediato, e é o mesmo defeito que o vazamento: uma
// desnormalização. Por isso a correção é estrutural (a linha guarda REFERÊNCIA, a definição vem
// do catálogo NA LEITURA) e não um filtro de saída.
//
// CONTRA O CÓDIGO ANTIGO ESTE ARQUIVO FICA VERMELHO: lá o snapshot devolvia a cópia gravada, que
// é literalmente a URL de ontem. É a metade da F11 que não é sobre segurança, e é ela que impede
// que a correção seja lida como "um filtro para o anônimo": um filtro fecharia o vazamento e
// deixaria a obsolescência de pé.
//
// A DISCRIMINAÇÃO OBRIGATÓRIA está no fim do arquivo: o HILLSHADE não é recurso de catálogo (não
// tem linha em tabela nenhuma; a definição é estática), então a cópia dele É a definição dele e
// precisa continuar saindo intacta, para todo mundo, anônimo inclusive. Um "frescor" que
// alcançasse o relevo sombreado tiraria o relevo do mapa de todo mundo — a armadilha (i) da fase.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

const sufixo = randomUUID().slice(0, 8);
const RECURSO = `f11obs-${sufixo}`;
const CAMADA = `analysis-${RECURSO}`;

// A URL de ontem (o que o cliente copiou) e a de hoje (o que o administrador corrigiu).
const URL_DE_ONTEM = `/tiles/${sufixo}/servidor-velho/{z}/{x}/{y}.png`;
const URL_DE_HOJE = `/tiles/${sufixo}/servidor-novo/{z}/{x}/{y}.png`;
const URL_DO_RELEVO = `/tiles/${sufixo}/relevo-estatico/{z}/{x}/{y}.png`;

describe('F11 · a definição de camada de catálogo não envelhece mais dentro do atlas', () => {
  let app, db, dono, token, tokenVisitante;
  let atlasA, mapaA, atlasB, mapaB;

  const snapshot = async (atlasId, comToken = token) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${comToken}`)
      .expect(200);
    return res.body.data.snapshot;
  };

  const camada = (snap, mapId, id = CAMADA) => snap.maps
    .find((m) => m.id === mapId).catalogLayers
    .find((c) => c.id === id);

  /** Grava a linha como o cliente PRÉ-F11 gravava: referência + estado + a cópia da definição. */
  const gravarComCopia = (mapId, id, copia) => db.query(
    `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`,
    [id, mapId, JSON.stringify(copia)],
  );

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `f11obs_dono_${sufixo}` });
    token = await loginUser(app, dono.username, dono.password);

    // O recurso é PÚBLICO de propósito: a obsolescência nunca precisou de recurso privado, e
    // medi-la num público é o que separa este arquivo do eixo de permissão.
    await db.query(
      `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, $3::jsonb, 0, 'public')`,
      [RECURSO, 'Declividade (nome de hoje)', JSON.stringify({
        source: { type: 'raster', url: URL_DE_HOJE },
        bounds: [-50, -25, -40, -15],
        legend: { items: [{ label: 'hoje' }] },
      })],
    );

    // DOIS atlas que já tinham a camada. "Para sempre, em todo atlas" é a parte do defeito que
    // um atlas só não mede: com a cópia, corrigir alcançaria zero deles.
    atlasA = await createAtlas(db, dono.id, { name: `F11 obsoleta A ${sufixo}` });
    mapaA = await createMap(db, atlasA.id, { name: 'Mapa A' });
    atlasB = await createAtlas(db, dono.id, { name: `F11 obsoleta B ${sufixo}` });
    mapaB = await createMap(db, atlasB.id, { name: 'Mapa B' });

    const copiaDeOntem = {
      id: CAMADA,
      type: 'analysis_layer',
      name: 'Declividade (nome de ontem)',
      visible: true,
      opacity: 0.9,
      config: {
        id: RECURSO,
        source: { type: 'raster', url: URL_DE_ONTEM },
        bounds: [0, 0, 1, 1],
        legend: { items: [{ label: 'ontem' }] },
      },
    };
    for (const mapId of [mapaA.id, mapaB.id]) {
      await gravarComCopia(mapId, CAMADA, copiaDeOntem);
    }

    // E o relevo sombreado, no mapa A, com a cópia dele — que para ele NÃO é cópia de nada.
    await gravarComCopia(mapaA.id, 'hillshade', {
      id: 'hillshade',
      type: 'hillshade',
      name: 'Sombreamento do Relevo',
      visible: true,
      config: { source: { type: 'raster-dem', url: URL_DO_RELEVO } },
    });

    tokenVisitante = await getPublicToken(app, await makeAtlasPublic(db, atlasB.id));
  });

  after(async () => {
    await db.query('DELETE FROM analysis_layers WHERE id = $1', [RECURSO]);
    await teardownTestEnv(db);
  });

  // ==========================================================================

  it('piso: os dois atlas guardam a cópia de ONTEM, e o catálogo já mudou', async () => {
    // Sem esta linha o arquivo inteiro seria vacuoso: "a URL de ontem não sai" é trivialmente
    // verdade num banco onde ela nunca foi gravada.
    const { rows } = await db.query(
      `SELECT map_id, data FROM catalog_layers WHERE id = $1 ORDER BY map_id`, [CAMADA],
    );
    assert.equal(rows.length, 2, 'as duas linhas precisam existir');
    for (const r of rows) {
      assert.equal(r.data.config.source.url, URL_DE_ONTEM, 'gravada com a URL velha');
      assert.equal(r.data.name, 'Declividade (nome de ontem)');
    }
    const { rows: catalogo } = await db.query(
      `SELECT name, config FROM analysis_layers WHERE id = $1`, [RECURSO],
    );
    assert.equal(catalogo[0].config.source.url, URL_DE_HOJE, 'e o catálogo já está corrigido');
  });

  it('a correção do administrador alcança TODO atlas que já tinha a camada, sem tocar em nenhum', async () => {
    // O caso do defeito. Nenhuma escrita no atlas aconteceu entre a correção e esta leitura.
    for (const [atlasId, mapId] of [[atlasA.id, mapaA.id], [atlasB.id, mapaB.id]]) {
      const c = camada(await snapshot(atlasId), mapId);
      assert.equal(c.config.source.url, URL_DE_HOJE, `o atlas ${atlasId} precisa receber a URL de hoje`);
      assert.equal(c.name, 'Declividade (nome de hoje)', 'e o nome também é o de hoje');
      assert.equal(c.config.name, 'Declividade (nome de hoje)', 'inclusive dentro do config, como /api/config faz');
    }
  });

  it('e a definição entregue é a linha VIVA INTEIRA, não uma fusão com a cópia', async () => {
    // A asserção que discrimina entre "veio do catálogo" e "veio de um merge por cima da cópia".
    // Um merge deixaria o `bounds` de ontem sobreviver onde a linha viva tem outro, e deixaria
    // vivo um campo que o administrador REMOVEU. Os dois são erro de dado silencioso.
    const c = camada(await snapshot(atlasA.id), mapaA.id);
    assert.deepEqual(c.config.bounds, [-50, -25, -40, -15], 'o bounds é o do catálogo');
    assert.deepEqual(c.config.legend, { items: [{ label: 'hoje' }] }, 'a legenda é a do catálogo');
    assert.ok(!JSON.stringify(c).includes('ontem'), 'nada de ontem sobrevive no item entregue');

    // Agora o administrador REMOVE a legenda da linha de catálogo. Ela precisa sumir do atlas.
    await db.query(
      `UPDATE analysis_layers SET config = config - 'legend' WHERE id = $1`, [RECURSO],
    );
    try {
      const depois = camada(await snapshot(atlasA.id), mapaA.id);
      assert.equal(depois.config.legend, undefined, 'o campo removido do catálogo some do atlas');
      assert.equal(depois.config.source.url, URL_DE_HOJE, 'e o resto continua vindo');
    } finally {
      await db.query(
        `UPDATE analysis_layers SET config = jsonb_set(config, '{legend}', $2::jsonb) WHERE id = $1`,
        [RECURSO, JSON.stringify({ items: [{ label: 'hoje' }] })],
      );
    }
  });

  it('o estado POR ATLAS não é tocado pelo frescor: ele continua sendo do mapa', async () => {
    // O par do caso acima. Se a reidratação substituísse o item inteiro em vez de só a
    // definição, a camada voltaria a ficar visível e com opacidade 1 no primeiro snapshot,
    // desfazendo o ajuste do usuário sem nenhum gesto dele.
    await db.query(
      `UPDATE catalog_layers SET data = jsonb_set(data, '{visible}', 'false') WHERE id = $1 AND map_id = $2`,
      [CAMADA, mapaA.id],
    );
    const c = camada(await snapshot(atlasA.id), mapaA.id);
    assert.equal(c.visible, false, 'a visibilidade é do atlas e sobrevive à reidratação');
    assert.equal(c.opacity, 0.9, 'a opacidade também');
    assert.equal(c.config.source.url, URL_DE_HOJE, 'e a definição continua fresca ao lado dela');
  });

  it('o catálogo manda também na REMOÇÃO: desativar a linha tira a definição de todo atlas', async () => {
    // O outro sentido do frescor, e o que prova que a fonte é mesmo o catálogo: a camada
    // aposentada (`active = false`, o soft-delete da casa) deixa de ter definição em toda parte,
    // e o que resta é a referência — o estado que o cliente já desenha como "indisponível".
    await db.query(`UPDATE analysis_layers SET active = false WHERE id = $1`, [RECURSO]);
    try {
      const c = camada(await snapshot(atlasB.id), mapaB.id);
      assert.ok(c, 'a linha do mapa continua lá');
      assert.equal(c.config, undefined, 'sem definição');
      assert.equal(c.name, undefined);
      assert.ok(
        !JSON.stringify(await snapshot(atlasB.id)).includes(URL_DE_ONTEM),
        'e a cópia de ontem tampouco reaparece como último recurso',
      );
    } finally {
      await db.query(`UPDATE analysis_layers SET active = true WHERE id = $1`, [RECURSO]);
    }

    const voltou = camada(await snapshot(atlasB.id), mapaB.id);
    assert.equal(voltou.config.source.url, URL_DE_HOJE, 'reativada, a definição volta sozinha');
  });

  // ==========================================================================
  // A DISCRIMINAÇÃO: o hillshade não é recurso de catálogo e não participa de nada disto
  // ==========================================================================

  it('DISCRIMINAÇÃO — o HILLSHADE conserva a cópia dele, que é a definição dele', async () => {
    // A ARMADILHA (i) DA FASE. Ele não tem linha em tabela de catálogo nenhuma: a definição é
    // estática (`config.static.js` + HILLSHADE_URL). Se o frescor o alcançasse, ele resolveria
    // contra nada — ou, pior, contra a linha `analysis_layers` de id literal 'hillshade' que a
    // migração 003 semeou com `config = {}` — e o relevo sombreado sumiria do mapa de todo mundo.
    const c = camada(await snapshot(atlasA.id), mapaA.id, 'hillshade');
    assert.ok(c, 'o relevo precisa continuar no snapshot');
    assert.equal(c.config.source.url, URL_DO_RELEVO, 'com a fonte dele intacta');
    assert.equal(c.name, 'Sombreamento do Relevo', 'e com o nome dele');
  });

  it('DISCRIMINAÇÃO — e ele chega inteiro ao visitante ANÔNIMO do link público', async () => {
    // O teto: quem não tem conta também precisa do relevo. Este é o caso que fica vermelho se
    // alguém decidir gatear a camada de catálogo por presença de sessão em vez de por recurso.
    await gravarComCopia(mapaB.id, 'hillshade', {
      id: 'hillshade',
      type: 'hillshade',
      name: 'Sombreamento do Relevo',
      visible: true,
      config: { source: { type: 'raster-dem', url: URL_DO_RELEVO } },
    });

    const c = camada(await snapshot(atlasB.id, tokenVisitante), mapaB.id, 'hillshade');
    assert.ok(c, 'o relevo sai para o anônimo');
    assert.equal(c.config.source.url, URL_DO_RELEVO);

    // E o par que impede a leitura preguiçosa deste verde: no MESMO snapshot, a camada de
    // catálogo pública ao lado dele vem do catálogo, fresca.
    const publica = camada(await snapshot(atlasB.id, tokenVisitante), mapaB.id);
    assert.equal(publica.config.source.url, URL_DE_HOJE, 'a camada pública chega fresca ao anônimo');
  });
});
