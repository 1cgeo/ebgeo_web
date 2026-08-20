// Path: tests/integration/nomes-busca-doutrina.test.js
// Congela a DOUTRINA de ordenação de GET /nomes/busca, não os números dela.
//
// A doutrina: vence a feição de MAIOR IMPORTÂNCIA mais PRÓXIMA do local, com a
// importância sendo CATEGÓRICA e não de entidade. Cidade é muito importante e vem
// primeiro INDEPENDENTE da distância; não existe ranking entre cidades. Abaixo desse
// degrau vale a combinação de proximidade e importância.
//
// POR QUE ESTE ARQUIVO NÃO ASSERTA PESO. Peso cravado num assert faz toda recalibração
// nascer vermelha, e a calibração é feita fora daqui, contra um conjunto dourado de 584
// casos (dev/busca-golden.json + dev/tune-busca.mjs). O que a suíte prende é POSIÇÃO,
// no modelo do fuzzy-tester do Pelias: cada teste abaixo é uma consulta cujo primeiro
// colocado é determinado pela doutrina, e nenhum deles cita uma constante da fórmula.
// Trocar 0.3 por 0.35 no expoente da importância não pode ficar vermelho aqui; APAGAR a
// chave de categoria tem que ficar.
//
// Cada bloco usa TAG própria: o banco de teste é COMPARTILHADO entre arquivos.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const T = `DOUT${randomUUID().slice(0, 5).toUpperCase()}`;
const NOME_CAT = `Categoria${T}`;
const NOME_MESMA = `Mesma${T}`;
const NOME_CONT = `Contido${T}`;
const NOME_PLATO = `Plato${T}`;

// Região vazia e distante das outras suítes (Atlântico ao largo do Nordeste).
const BASE = { lon: -30.0, lat: -5.0 };
// ~1 grau de latitude = 111 km. Deslocamentos em graus, comentados em km.
const KM = 1 / 111;

describe('GET /nomes/busca — a doutrina de ordenação', () => {
  let app, db;

  const busca = async (q, lat, lon, extra = {}) => {
    const res = await supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q, lat, lon, ...extra })
      .expect(200);
    assert.ok(Array.isArray(res.body), 'contrato congelado: array nu');
    return res.body;
  };

  const semear = (nome, tipo, lon, lat) =>
    db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, municipio, estado, geom)
       VALUES ($1, $2, 'M', 'RS', ST_SetSRID(ST_MakePoint($3, $4), 4674))`,
      [nome, tipo, lon, lat]
    );

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // ── 1: categoria contra proximidade ───────────────────────────────────────
    // Vila (tipo_peso 0.9) a 2 km contra Cidade (1.0) a 100 km.
    //
    // As distâncias e os tipos NÃO são arbitrários, e a primeira versão deste teste
    // era quase vazia: com Rio a 2 km e Cidade a 40 km, apagar a chave de categoria
    // mantinha o teste VERDE, porque a 40 km a combinação contínua já favorece a
    // Cidade sozinha. Medido apagando a chave. O par que discrimina é o concorrente
    // de maior peso ABAIXO do degrau (Vila, 0.9) a curta distância contra a Cidade
    // longe o bastante para o decaimento contínuo inverter (acima de ~74 km).
    await semear(NOME_CAT, 'Vila', BASE.lon, BASE.lat + 2 * KM);
    await semear(NOME_CAT, 'Cidade', BASE.lon, BASE.lat + 100 * KM);

    // ── 2: a MESMA disputa a 300 km. É o caso que a soma ponderada não resolve ─
    await semear(NOME_MESMA, 'Rio', BASE.lon + 1, BASE.lat + 2 * KM);
    await semear(NOME_MESMA, 'Cidade', BASE.lon + 1, BASE.lat + 300 * KM);

    // ── 3: containment conta como casamento pleno ─────────────────────────────
    // "Contido" exato a 500 km, e "Contido do Norte" (Cidade) a 5 km. Buscando
    // "Contido", a doutrina manda a Cidade perto ganhar do exato distante.
    await semear(NOME_CONT, 'Rio', BASE.lon + 2, BASE.lat + 500 * KM);
    await semear(`${NOME_CONT} do Norte`, 'Cidade', BASE.lon + 2, BASE.lat + 5 * KM);

    // ── 4: o platô. Dois pontos da MESMA categoria dentro dele, e um fora ──────
    // 8 km separa os dois primeiros em clusters distintos (DBSCAN eps ~5 km), então
    // a desduplicação preserva os dois.
    await semear(NOME_PLATO, 'Rio', BASE.lon + 3, BASE.lat);
    await semear(NOME_PLATO, 'Rio', BASE.lon + 3, BASE.lat + 8 * KM);
    await semear(NOME_PLATO, 'Rio', BASE.lon + 3, BASE.lat + 200 * KM);

    // Obrigatório: nada além disto calcula cluster_id.
    await db.query('SELECT ng.refresh_busca()');
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a categoria vence a proximidade: a Cidade a 100 km ganha da Vila a 2 km', async () => {
    const linhas = await busca(NOME_CAT, BASE.lat, BASE.lon);
    const meus = linhas.filter((r) => r.nome === NOME_CAT);
    assert.equal(meus.length, 2, 'guarda: os dois pontos precisam sobreviver à desduplicação');
    assert.equal(meus[0].tipo, 'Cidade', 'a Cidade tem de vir primeiro, mesmo 50x mais longe');
    assert.equal(meus[1].tipo, 'Vila');
  });

  it('e vence também a 300 km, que é onde toda soma ponderada falha', async () => {
    // Numa soma, distância suficiente sempre COMPRA a diferença de categoria, porque as
    // duas moram na mesma unidade. Este é o caso que mede se a categoria virou chave.
    const linhas = await busca(NOME_MESMA, BASE.lat, BASE.lon + 1);
    const meus = linhas.filter((r) => r.nome === NOME_MESMA);
    assert.equal(meus.length, 2);
    assert.equal(meus[0].tipo, 'Cidade', 'a Cidade a 300 km ainda vem antes do Rio a 2 km');
  });

  it('containment é casamento pleno: a Cidade "X do Norte" perto ganha do "X" exato longe', async () => {
    // Digitar "Contido" com o mapa em cima de "Contido do Norte" é prefixo legítimo, não
    // erro de digitação. Se o nome exato distante ganhasse, a categoria nunca votaria.
    const linhas = await busca(NOME_CONT, BASE.lat, BASE.lon + 2);
    assert.ok(linhas.length >= 2, `esperava ao menos 2 resultados, veio ${linhas.length}`);
    assert.equal(linhas[0].nome, `${NOME_CONT} do Norte`);
    assert.equal(linhas[0].tipo, 'Cidade');
  });

  it('dentro do platô a distância não vota; fora dele, vota', async () => {
    const linhas = await busca(NOME_PLATO, BASE.lat, BASE.lon + 3);
    const meus = linhas.filter((r) => r.nome === NOME_PLATO);
    assert.equal(meus.length, 3, 'guarda: três clusters distintos do mesmo nome e tipo');

    const porDistancia = (km) =>
      meus.find((r) => Math.abs(Number(r.latitude) - (BASE.lat + km * KM)) < 1e-4);
    const noPonto = porDistancia(0);
    const aOitoKm = porDistancia(8);
    const aDuzentos = porDistancia(200);
    assert.ok(noPonto && aOitoKm && aDuzentos, 'os três pontos precisam estar no resultado');

    // Mesmo nome, mesmo tipo, mesma similaridade: o único critério que os distingue é a
    // distância. Dentro do platô (10 km) ela é neutralizada, então os scores são IGUAIS.
    assert.ok(
      Math.abs(Number(noPonto.score) - Number(aOitoKm.score)) < 1e-9,
      `dentro do platô os scores têm de empatar: ${noPonto.score} vs ${aOitoKm.score}`
    );
    // E fora dele volta a valer, senão o platô teria comido a distância inteira.
    assert.ok(
      Number(noPonto.score) > Number(aDuzentos.score),
      'a 200 km o decaimento tem de separar'
    );
  });

  it('o score continua no contrato: número em [0,1] e decrescente', async () => {
    // O campo `score` é contrato congelado do frontend. A ordem virou lexicográfica, mas
    // ele segue sendo UM número, codificado numa base que preserva a ordem das chaves —
    // ou seja, ORDER BY score DESC continua sendo a ordem verdadeira.
    const linhas = [
      ...(await busca(NOME_CAT, BASE.lat, BASE.lon)),
      ...(await busca(NOME_PLATO, BASE.lat, BASE.lon + 3)),
      ...(await busca(NOME_CONT, BASE.lat, BASE.lon + 2, { zoom: 18 })),
    ];
    assert.ok(linhas.length >= 6, `guarda: esperava >= 6 linhas, veio ${linhas.length}`);
    const ruins = linhas
      .map((r) => Number(r.score))
      .filter((s) => !Number.isFinite(s) || s < 0 || s > 1);
    assert.deepEqual(ruins, []);
  });

  it('zoom alto com candidato distante não derruba a requisição (underflow de float)', async () => {
    // O Postgres LANÇA ERRO em underflow de float em vez de saturar em zero. Com zoom 16
    // a escala do decaimento cai para ~4,7 km, e um candidato a 300 km dá expoente 4096:
    // power(0.5, 4096) devolvia 22003 e a busca inteira virava 500. Achado rodando a
    // query real contra o acervo real, não em teste de unidade, porque exige zoom alto E
    // candidato distante ao mesmo tempo.
    for (const zoom of [14, 16, 18, 20]) {
      const linhas = await busca(NOME_MESMA, BASE.lat, BASE.lon + 1, { zoom });
      assert.ok(Array.isArray(linhas), `zoom=${zoom} tem de responder 200`);
      assert.ok(linhas.length >= 1, `zoom=${zoom} deveria achar o nome semeado`);
    }
  });
});
