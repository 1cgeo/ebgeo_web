// Path: tests/integration/nomes-busca-ranking.test.js
// Itens 118, 119, 120 e 121 — o miolo de GET /nomes/busca.
//
// 118 — contrato congelado: array NU de no máximo 5 resultados. O array-nu já
//       estava testado; o TETO não (nenhum teste semeava mais de 5 casáveis), então
//       trocar LIMIT 5 por LIMIT 50 passava verde e inundava o dropdown.
// 119 — o score de 7 critérios é a feature-título da fatia e estava sem amarra:
//       `nomes.test.js` se chama "ranks the exact/closest match first" mas o único
//       resultado semeado que passa o limiar é UM, então a posição 0 é trivial.
//       Trocar a expressão inteira por `d.sim`, ou parar de repassar `zoom`,
//       deixava tudo verde.
// 120 — insensibilidade a acento/caixa: todo termo pesquisado nos testes existentes
//       é ASCII e idêntico ao nome semeado. Se `ng.f_unaccent` sumisse de um dos
//       lados do similarity(), a busca acentuada de um gazetteer brasileiro
//       quebraria sem nenhum teste acusar.
// 121 — DISTINCT ON escolhe o representante MAIS PRÓXIMO. O teste existente conta 1
//       resultado e nunca compara coordenadas: perder o `dist ASC` mandaria o mapa
//       para o ponto errado, a 1,5 km, com o teste verde.
//
// Cada bloco usa um TAG próprio: o banco de teste é COMPARTILHADO entre arquivos.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const T118 = `TETO${randomUUID().slice(0, 5).toUpperCase()}`;
const T119 = `DIST${randomUUID().slice(0, 5).toUpperCase()}`;
const T119B = `PESO${randomUUID().slice(0, 5).toUpperCase()}`;
const T120 = `ACEN${randomUUID().slice(0, 5).toUpperCase()}`;
const T121 = `CLUS${randomUUID().slice(0, 5).toUpperCase()}`;

// Regiões distintas e distantes das usadas pelas outras suítes.
const P118 = { lon: -55.0, lat: -8.0 };
const P119 = { lon: -56.0, lat: -9.0 };
const P119B = { lon: -57.0, lat: -10.0 };
const P120 = { lon: -59.0, lat: -11.0 };
const P121A = { lon: -60.0, lat: -6.0 };
const P121B = { lon: -60.0135, lat: -6.0 }; // ~1,5 km a oeste (mesmo cluster, eps 0.045°)

describe('GET /nomes/busca — teto, score, acento e desduplicação', () => {
  let app, db;

  const busca = async (q, ponto, extra = {}) => {
    const res = await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q, lat: ponto.lat, lon: ponto.lon, ...extra })
      .expect(200);
    assert.ok(Array.isArray(res.body), 'contrato congelado: array nu, não { data: [...] }');
    return res.body;
  };

  const scoreDe = (linhas, nome) => {
    const achado = linhas.filter((r) => r.nome === nome);
    assert.equal(achado.length, 1, `esperava exatamente 1 linha para "${nome}"`);
    return achado[0];
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // ── 118: oito nomes casáveis pelo mesmo token ────────────────────────────
    const oito = Array.from({ length: 8 }, (_, i) => `Bravo${T118} ${i + 1}`);
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, geom)
       SELECT n, 'Cidade', ST_SetSRID(ST_MakePoint($2,$3),4674) FROM unnest($1::text[]) AS n`,
      [oito, P118.lon, P118.lat]
    );

    // ── 119: MESMO nome/tipo, um no ponto da consulta e outro ~3° a leste ────
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, geom)
       VALUES ($1, 'Cidade', ST_SetSRID(ST_MakePoint($2,$3),4674)),
              ($1, 'Cidade', ST_SetSRID(ST_MakePoint($4,$3),4674))`,
      [`Alfa${T119}`, P119.lon, P119.lat, P119.lon + 3]
    );

    // ── 119b: MESMO nome, MESMO ponto, tipos de peso extremo (1.0 vs 0.15) ───
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, geom)
       VALUES ($1, 'Cidade', ST_SetSRID(ST_MakePoint($2,$3),4674)),
              ($1, 'Cemiterio', ST_SetSRID(ST_MakePoint($2,$3),4674))`,
      [`Charlie${T119B}`, P119B.lon, P119B.lat]
    );

    // ── 120: nome ACENTUADO + um vizinho apenas parcialmente similar ─────────
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, geom)
       VALUES ($1, 'Cidade', ST_SetSRID(ST_MakePoint($3,$4),4674)),
              ($2, 'Cidade', ST_SetSRID(ST_MakePoint($3,$4),4674))`,
      [`Sítio Açu${T120}`, `Sitio Acu${T120} do Norte Velho`, P120.lon, P120.lat]
    );

    // ── 120b: nome CURTO e denso em acentos ──────────────────────────────────
    // Com um nome longo, a similaridade de trigramas sobrevive à diferença de
    // acentos e o predicado `%` casa mesmo sem f_unaccent — medido. Só um nome
    // curto e muito acentuado deixa a remoção do f_unaccent do OPERADOR visível.
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, geom)
       VALUES ($1, 'Cidade', ST_SetSRID(ST_MakePoint($2,$3),4674))`,
      [`Ñuñoã Açaí`, P120.lon, P120.lat]
    );

    // ── 121: dois pontos de MESMO nome/tipo a ~1,5 km ────────────────────────
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, geom)
       VALUES ($1, 'Cidade', ST_SetSRID(ST_MakePoint($2,$4),4674)),
              ($1, 'Cidade', ST_SetSRID(ST_MakePoint($3,$4),4674))`,
      [`Delta${T121}`, P121A.lon, P121B.lon, P121A.lat]
    );

    await db.query('SELECT ng.refresh_busca()');
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── Item 118 ───────────────────────────────────────────────────────────────

  it('o teto de 5 resultados é real, mesmo com 8 nomes casáveis', async () => {
    const linhas = await busca(`Bravo${T118}`, P118);
    assert.equal(linhas.length, 5, 'LIMIT 5 é contrato congelado do frontend');

    // Guarda de não-vacuidade: os 5 têm de ser OS MEUS (senão o 5 poderia vir do
    // ruído de outras suítes e o teste não provaria nada sobre o meu seed).
    const meus = linhas.filter((r) => r.nome.startsWith(`Bravo${T118}`));
    assert.equal(meus.length, 5);

    // E o banco de fato tem os 8, ou seja: quem cortou foi o LIMIT.
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM ng.nomes_geograficos WHERE nome LIKE $1',
      [`Bravo${T118}%`]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].n, 8);
  });

  it('os resultados vêm com score monotonicamente não-crescente', async () => {
    const linhas = await busca(`Bravo${T118}`, P118);
    assert.equal(linhas.length, 5);
    const scores = linhas.map((r) => Number(r.score));
    const ordenado = [...scores].sort((a, b) => b - a);
    assert.deepEqual(scores, ordenado, 'ORDER BY score DESC precisa sobreviver à serialização');
  });

  // ── Item 119 ───────────────────────────────────────────────────────────────

  it('o decaimento por distância (peso 0.20) coloca o ponto próximo à frente', async () => {
    const linhas = await busca(`Alfa${T119}`, P119);
    const meus = linhas.filter((r) => r.nome === `Alfa${T119}`);
    assert.equal(meus.length, 2, 'os dois pontos sobrevivem ao DISTINCT ON (clusters distintos)');

    const proximo = meus.find((r) => Math.abs(Number(r.longitude) - P119.lon) < 1e-6);
    const distante = meus.find((r) => Math.abs(Number(r.longitude) - (P119.lon + 3)) < 1e-6);
    assert.ok(proximo && distante, 'os dois pontos precisam estar no resultado');
    assert.ok(Number(proximo.score) > Number(distante.score), 'mais perto, maior score');
    assert.equal(linhas[0].nome, `Alfa${T119}`);
    assert.equal(Number(linhas[0].longitude), Number(proximo.longitude), 'o mais próximo vem primeiro');
  });

  it('zoom=18 chega ao SQL: o GAP de score entre próximo e distante AUMENTA', async () => {
    const semZoom = await busca(`Alfa${T119}`, P119);
    const comZoom = await busca(`Alfa${T119}`, P119, { zoom: 18 });

    const gap = (linhas) => {
      const meus = linhas.filter((r) => r.nome === `Alfa${T119}`);
      assert.equal(meus.length, 2);
      const perto = meus.find((r) => Math.abs(Number(r.longitude) - P119.lon) < 1e-6);
      const longe = meus.find((r) => Math.abs(Number(r.longitude) - (P119.lon + 3)) < 1e-6);
      assert.ok(perto && longe);
      return Number(perto.score) - Number(longe.score);
    };

    const gapSem = gap(semZoom);
    const gapCom = gap(comZoom);
    // decay_dist cai de 50 km para ~195 m: sem o repasse de `zoom` os dois gaps
    // seriam IDÊNTICOS.
    assert.ok(gapCom > gapSem, `esperava gap maior com zoom=18 (${gapCom} vs ${gapSem})`);
  });

  it('a CATEGORIA nunca é neutralizada: o gap Cidade x Cemitério não muda com o zoom', async () => {
    // Mesmo NOME e mesmo PONTO: todos os critérios exceto o de tipo são idênticos,
    // então a diferença de score isola exatamente a contribuição da categoria.
    //
    // Este teste afirmava o CONTRÁRIO até 2026-07-26, e afirmava com razão para o
    // algoritmo de então: a soma de 7 critérios tinha um `zoom_factor` que, em zoom 18,
    // fazia todo tipo contribuir 0.5, zerando a diferença entre Cidade e Cemitério.
    //
    // A doutrina nova proíbe exatamente isso. Categoria é a segunda chave lexicográfica
    // e vem antes da distância, então nada pode apagá-la, muito menos o nível de zoom.
    // O `zoom` foi mantido, mas afia SÓ o espaço (platô e escala do decaimento).
    // Ver o cabeçalho de src/modules/nomes/nomes.queries.js.
    const semZoom = await busca(`Charlie${T119B}`, P119B);

    const porTipo = (linhas) => {
      const meus = linhas.filter((r) => r.nome === `Charlie${T119B}`);
      assert.equal(meus.length, 2);
      const cidade = meus.find((r) => r.tipo === 'Cidade');
      const cemiterio = meus.find((r) => r.tipo === 'Cemiterio');
      assert.ok(cidade && cemiterio, 'os dois tipos precisam estar no resultado');
      return { cidade: Number(cidade.score), cemiterio: Number(cemiterio.score) };
    };

    // Os pesos vêm do trigger ng.calcular_tipo_peso, não de um número chutado aqui.
    // Isto já pegou uma mudança real: até a migração 009 'Cemiterio' caía no ramo
    // '%rio%' (0.85, substring) ANTES do ramo do cemitério, e hoje vale 0.15 — um
    // valor hardcoded teria ficado vermelho na correção em vez de acompanhá-la.
    // O que este teste prende é o GAP, não o número.
    const { rows: pesos } = await db.query(
      'SELECT DISTINCT tipo, tipo_peso FROM ng.nomes_geograficos WHERE nome = $1 ORDER BY tipo',
      [`Charlie${T119B}`]
    );
    assert.equal(pesos.length, 2, 'guarda: dois tipos semeados');
    const pesoDe = new Map(pesos.map((r) => [r.tipo, Number(r.tipo_peso)]));
    const delta = pesoDe.get('Cidade') - pesoDe.get('Cemiterio');
    assert.ok(delta > 0.1, `guarda: os pesos precisam diferir de verdade (${delta})`);

    const sem = porTipo(semZoom);
    assert.ok(sem.cidade > sem.cemiterio, 'a Cidade tem de vir à frente do Cemitério');

    // O degrau de categoria vale 2 numa escala cujo teto é floor(1/0.15)*4+3 = 27, então
    // sozinho ele já separa os dois por ~0.074. Cobrar o piso do degrau (e não um valor
    // exato) deixa a terceira chave livre para ser recalibrada sem ficar vermelho, e
    // ainda assim reprova quem apagar a chave de categoria.
    const DEGRAU_CATEGORIA = 2 / 27.001;
    const gapSem = sem.cidade - sem.cemiterio;
    assert.ok(
      gapSem >= DEGRAU_CATEGORIA - 1e-9,
      `o gap (${gapSem}) tem de conter ao menos o degrau de categoria (${DEGRAU_CATEGORIA})`
    );

    // O CORAÇÃO DO TESTE: zoom não mexe na categoria. Antes, com zoom=18 este gap ia a
    // zero; agora ele é o MESMO, porque zoom só reescala o decaimento espacial e os dois
    // pontos estão na mesma coordenada.
    const com = porTipo(await busca(`Charlie${T119B}`, P119B, { zoom: 18 }));
    const gapCom = com.cidade - com.cemiterio;
    assert.ok(com.cidade > com.cemiterio, 'com zoom=18 a Cidade continua à frente');
    assert.ok(
      Math.abs(gapCom - gapSem) < 1e-9,
      `o gap não pode mudar com o zoom: sem=${gapSem}, com=${gapCom}`
    );
  });

  it('todo score está em [0,1] e é finito, inclusive com dist=0', async () => {
    const linhas = [
      ...(await busca(`Alfa${T119}`, P119)),
      ...(await busca(`Alfa${T119}`, P119, { zoom: 18 })),
      ...(await busca(`Bravo${T118}`, P118)),
      ...(await busca(`Charlie${T119B}`, P119B)),
      ...(await busca(`Sitio Acu${T120}`, P120)),
    ];
    assert.ok(linhas.length >= 12, `guarda: esperava >= 12 linhas inspecionadas, achei ${linhas.length}`);
    const ruins = linhas
      .map((r) => Number(r.score))
      .filter((s) => !Number.isFinite(s) || s < 0 || s > 1);
    assert.deepEqual(ruins, [], 'a soma dos pesos é 1.00, então todo score cabe em [0,1]');
  });

  // ── Item 120 ───────────────────────────────────────────────────────────────

  it('busca SEM acento e em minúsculas encontra o nome acentuado', async () => {
    const linhas = await busca(`sitio acu${T120}`.toLowerCase(), P120);
    assert.ok(
      linhas.some((r) => r.nome === `Sítio Açu${T120}`),
      'ng.f_unaccent precisa estar dos DOIS lados do similarity()'
    );
  });

  it('busca COM os acentos corretos também encontra (round-trip nos dois sentidos)', async () => {
    const linhas = await busca(`Sítio Açu${T120}`, P120);
    assert.ok(linhas.some((r) => r.nome === `Sítio Açu${T120}`));
  });

  it('nome CURTO e acentuado é achado sem acento (prende o f_unaccent do OPERADOR %)', async () => {
    // Este é o caso que discrimina o lado do PREDICADO. Com o nome longo do teste
    // anterior a remoção do f_unaccent do operador passa despercebida, porque a
    // similaridade de trigramas de duas strings de 15 caracteres que diferem em
    // dois acentos continua acima de 0.25.
    const linhas = await busca('Nunoa Acai', P120);
    assert.ok(linhas.some((r) => r.nome === 'Ñuñoã Açaí'), 'ng.f_unaccent precisa estar nos DOIS lados do %');
  });

  it('o critério de match exato (0.20) dispara para o termo SEM acento', async () => {
    const linhas = await busca(`Sitio Acu${T120}`, P120);
    const exato = scoreDe(linhas, `Sítio Açu${T120}`);
    const parcial = scoreDe(linhas, `Sitio Acu${T120} do Norte Velho`);
    assert.ok(
      Number(exato.score) > Number(parcial.score),
      'o nome acentuado, buscado sem acento, tem de ganhar do vizinho só parcialmente similar'
    );
  });

  it('o limiar de 0.25 realmente corta: termo dissimilar não traz o nome', async () => {
    const linhas = await busca('Xyzwvu Qponml', P120);
    assert.ok(!linhas.some((r) => r.nome === `Sítio Açu${T120}`), 'similaridade abaixo do limiar não passa');
  });

  // ── Item 121 ───────────────────────────────────────────────────────────────

  it('o representante do cluster é o ponto MAIS PRÓXIMO da consulta', async () => {
    const perto = await busca(`Delta${T121}`, { lon: P121A.lon, lat: P121A.lat });
    const meusA = perto.filter((r) => r.nome === `Delta${T121}`);
    assert.equal(meusA.length, 1, 'o DISTINCT ON precisa colapsar o cluster em UMA linha');
    assert.ok(Math.abs(Number(meusA[0].longitude) - P121A.lon) < 1e-6, `veio ${meusA[0].longitude}`);
    assert.ok(Math.abs(Number(meusA[0].latitude) - P121A.lat) < 1e-6);
  });

  it('e o representante MUDA com o ponto da consulta (é `dist ASC` que manda)', async () => {
    const perto = await busca(`Delta${T121}`, { lon: P121B.lon, lat: P121B.lat });
    const meusB = perto.filter((r) => r.nome === `Delta${T121}`);
    assert.equal(meusB.length, 1, 'continua sendo exatamente 1 linha');
    assert.ok(Math.abs(Number(meusB[0].longitude) - P121B.lon) < 1e-6, `veio ${meusB[0].longitude}`);
  });

  it('guarda: os dois pontos de Delta estão no MESMO cluster (senão o teste acima é vácuo)', async () => {
    const { rows } = await db.query(
      'SELECT DISTINCT cluster_id FROM ng.nomes_geograficos WHERE nome = $1',
      [`Delta${T121}`]
    );
    assert.equal(rows.length, 1, 'um único cluster_id para as duas linhas');
    const total = await db.query('SELECT COUNT(*)::int AS n FROM ng.nomes_geograficos WHERE nome = $1', [
      `Delta${T121}`,
    ]);
    assert.equal(total.rows.length, 1);
    assert.equal(total.rows[0].n, 2, 'e são de fato DUAS linhas colapsadas em uma');
  });
});
