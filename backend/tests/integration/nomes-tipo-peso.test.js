// Path: tests/integration/nomes-tipo-peso.test.js
// Regressão de `ng.calcular_tipo_peso`: `tipo_peso` casa PALAVRA, não substring.
//
// O CASE ANTERIOR usava `LIKE '%rio%'`, que casa dentro de cemite[rio], avia[rio],
// aterro sanita[rio], supe[rio]r, veterina[rio], reservato[rio] e ferrovia[rio] —
// 658 linhas do acervo real de 2026-07-23 ranqueadas como HIDROGRAFIA (0.85, o
// terceiro maior peso) sem ser.
//
// Os tipos abaixo são copiados VERBATIM do acervo, com os acentos e o travessão `–`
// que ele usa. Isso não é preciosismo: metade dos defeitos desta função nasceu de
// padrões escritos sem acento contra dados acentuados, e um teste que semeasse
// 'Cemiterio' ASCII passaria verde com a função errada.
//
// O banco de teste é COMPARTILHADO entre arquivos, daí o TAG por execução.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const TAG = `PESO${randomUUID().slice(0, 6).toUpperCase()}`;
const P = { lon: -54.0, lat: -12.0 }; // longe das regiões usadas pelas outras suítes

/**
 * Cada caso é [tipo, peso esperado, por que importa].
 * Os quatro primeiros são exatamente os falsos positivos que o casamento por palavra
 * corrige.
 */
const CASOS = [
  ['Cemitério Comum - Cristã', 0.15, 'cemite(rio) casava hidrografia'],
  ['Agro - Aviário', 0.5, 'avia(rio) casava hidrografia, e ANTES do ramo agro'],
  ['San - Aterro sanitário', 0.2, 'sanita(rio) casava hidrografia'],
  ['Ens - Edificação de educação superior – Graduação', 0.35, 'supe(rio)r casava hidrografia'],

  // Guarda da correção que quase entrou errada: `com` como abreviação de comércio
  // casaria a preposição de "(com fluxo)", que o vocabulário usa às pencas.
  ['Laguna (com fluxo)', 0.1, 'a preposição "com" não pode virar comércio'],

  // Hidrografia de verdade continua hidrografia.
  ['Rio', 0.85, ''],
  ['Rio (com fluxo)', 0.85, ''],
  ['Lago ou Lagoa (sem fluxo)', 0.85, ''],
  ['Represa/açude com fluxo', 0.85, ''],

  // Formas do acervo real que o LIKE anterior nunca alcançou (caíam no piso 0.1).
  ['Aglomerado rural isolado – Povoado', 0.9, 'travessão + acento'],
  ['Outros aglomerados rurais – Lugarejo', 0.9, 'lugarejo não estava no CASE'],
  ['Aglomerado rural isolado – Núcleo', 0.9, 'núcleo acentuado'],
  ['Subestação de distribuição de energia elétrica', 0.3, 'elétrica acentuada'],
  ['Terra indígena', 0.55, 'indígena acentuada'],
  ['Linha de transmissão de energia', 0.3, 'transmissão acentuada'],

  // Faixas que já funcionavam: amarradas para o casamento por palavra não regredir o
  // que herdou.
  ['Cidade', 1.0, ''],
  ['Morro', 0.8, ''],
  ['Nome local', 0.75, ''],
  ['Estrada/Rodovia', 0.7, ''],
  ['Comerc - Outros', 0.25, ''],
  ['Rel - Igreja cristã', 0.15, ''],
];

describe('ng.calcular_tipo_peso — casamento por palavra', () => {
  let db;

  const nomeDe = (i) => `${TAG}${String(i).padStart(2, '0')}`;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    for (const [i, [tipo]] of CASOS.entries()) {
      await db.query(
        `INSERT INTO ng.nomes_geograficos (nome, tipo, municipio, estado, geom)
         VALUES ($1, $2, 'M', 'RS', ST_SetSRID(ST_MakePoint($3, $4), 4674))`,
        [nomeDe(i), tipo, P.lon, P.lat]
      );
    }
    // Sem tipo: o piso tem de valer para NULL sem quebrar (COALESCE no trigger).
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, municipio, estado, geom)
       VALUES ($1, 'M', 'RS', ST_SetSRID(ST_MakePoint($2, $3), 4674))`,
      [`${TAG}NULO`, P.lon, P.lat]
    );
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('classifica cada tipo do acervo real no peso certo', async () => {
    const { rows } = await db.query(
      `SELECT nome, tipo, tipo_peso FROM ng.nomes_geograficos
        WHERE nome LIKE $1 ORDER BY nome`,
      [`${TAG}%`]
    );
    // Guarda de não-vacuidade: sem isto, um WHERE que não casa nada passaria verde.
    assert.equal(rows.length, CASOS.length + 1, 'todas as linhas semeadas precisam existir');

    const pesoDe = new Map(rows.map((r) => [r.nome, Number(r.tipo_peso)]));
    const erros = [];
    for (const [i, [tipo, esperado, porque]] of CASOS.entries()) {
      const obtido = pesoDe.get(nomeDe(i));
      if (obtido !== esperado) {
        erros.push(`"${tipo}" → ${obtido}, esperado ${esperado}${porque ? ` (${porque})` : ''}`);
      }
    }
    assert.deepEqual(erros, []);
  });

  it('tipo NULL cai no piso 0.1 sem quebrar o trigger', async () => {
    const { rows } = await db.query(
      'SELECT tipo, tipo_peso FROM ng.nomes_geograficos WHERE nome = $1',
      [`${TAG}NULO`]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tipo, null);
    assert.equal(Number(rows[0].tipo_peso), 0.1);
  });

  it('nenhum tipo NÃO-hidrográfico do acervo recebe o peso de hidrografia', async () => {
    // O defeito do CASE anterior em uma asserção só: qualquer linha semeada cujo tipo não é
    // rio/lago/represa/açude e que ainda assim valha 0.85.
    const { rows } = await db.query(
      `SELECT nome, tipo, tipo_peso FROM ng.nomes_geograficos
        WHERE nome LIKE $1 AND tipo_peso = 0.85
          AND ng.f_unaccent(lower(tipo)) !~ '\\m(rios?|lagos?|lagoas?|represas?|acudes?)\\M'`,
      [`${TAG}%`]
    );
    assert.deepEqual(rows, [], 'substring de "rio" dentro de outra palavra não é hidrografia');
  });

  it('o trigger também reclassifica no UPDATE de tipo', async () => {
    // `BEFORE INSERT OR UPDATE OF tipo`: sem o ramo de UPDATE, o refresh_busca()
    // (que é um `UPDATE tipo = tipo`) não reclassificaria nada, e a correção do trigger
    // teria aplicado sem efeito sobre o acervo já gravado.
    const alvo = `${TAG}00`; // semeado como Cemitério (0.15)
    await db.query('UPDATE ng.nomes_geograficos SET tipo = $2 WHERE nome = $1', [alvo, 'Cidade']);
    const depois = await db.query('SELECT tipo_peso FROM ng.nomes_geograficos WHERE nome = $1', [alvo]);
    assert.equal(depois.rows.length, 1);
    assert.equal(Number(depois.rows[0].tipo_peso), 1.0);

    await db.query('UPDATE ng.nomes_geograficos SET tipo = $2 WHERE nome = $1', [alvo, CASOS[0][0]]);
    const voltou = await db.query('SELECT tipo_peso FROM ng.nomes_geograficos WHERE nome = $1', [alvo]);
    assert.equal(voltou.rows.length, 1);
    assert.equal(Number(voltou.rows[0].tipo_peso), 0.15);
  });
});
