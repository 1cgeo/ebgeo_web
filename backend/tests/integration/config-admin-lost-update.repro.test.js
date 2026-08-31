// Path: tests/integration/config-admin-lost-update.repro.test.js
// Item 77 — `PUT /config/admin` era um read-modify-write sem transação, e por isso
// perdia atualização em silêncio.
//
// A sequência era três awaits soltos: `getConfigOverrides()` → `deepMerge()` →
// `UPSERT_CONFIG_OVERRIDES`. Dois admins salvando SEÇÕES DIFERENTES dentro da mesma
// janela liam a MESMA base, mesclavam cada um a sua seção nela e escreviam por cima:
// o segundo UPSERT substitui o documento inteiro do primeiro. Nada lança, nada loga,
// e os dois recebem 200 com o eco do próprio merge — a seção do perdedor some, e ele
// vê o painel confirmando que salvou. Só se descobre quando alguém repara que a
// configuração "voltou sozinha".
//
// INVARIANTE: um save parcial só pode ADICIONAR/SOBRESCREVER a sua própria seção;
// nenhuma seção alheia já commitada pode desaparecer por causa dele.
//
// POR QUE NÃO POR HTTP: `supertest` abre um socket TCP frio por requisição, então
// duas requisições "concorrentes" quase sempre se serializam e um read-modify-write
// quebrado passa verde. O arquivo `tests/helpers/concurrency.js` documenta esse
// falso-verde medido duas vezes neste repositório. A afirmação vive, portanto, em
// dois níveis: no SQL (raceOnConnections, determinístico, com rendezvous explícito)
// e no SERVIÇO (repeatRace sobre `updateConfigOverrides`, estatístico e repetido).
//
// CONTROLE NEGATIVO (executado): restaurando o corpo antigo de `updateConfigOverrides`
// (get → merge → upsert, sem `tx`), o caso de serviço cai em 20/20 execuções
// (`runs with 0 winners: 20`) e o caso de SQL cai com a chave do primeiro ausente.
// Registrado por cópia/restauração de backup, nunca por `git checkout`.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { raceOnConnections, repeatRace } from '../helpers/concurrency.js';
import { updateConfigOverrides, getConfigOverrides } from '../../src/modules/config/config.service.js';
import * as Q from '../../src/modules/config/config.queries.js';

const CHAVE = 'app_config';

describe('PUT /config/admin: save parcial concorrente não perde seção (item 77)', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    // Não deixa override para as outras suítes: `/api/config` é global.
    await db.query('DELETE FROM config_settings WHERE key = $1', [CHAVE]);
    await teardownTestEnv(db);
  });

  beforeEach(async () => {
    await db.query('DELETE FROM config_settings WHERE key = $1', [CHAVE]);
  });

  // ── nível SQL: determinístico ────────────────────────────────────────────
  it('SQL: dois read-modify-write simultâneos, com o lock, produzem as DUAS seções', async () => {
    // Cada participante abre transação própria, chega ao rendezvous e só então age.
    // Com `LOCK_CONFIG_OVERRIDES` o segundo BLOQUEIA no lock de linha e relê o
    // documento já commitado pelo primeiro, então o merge dele cai por cima.
    const resultados = await raceOnConnections({
      participants: 2,
      async work(client, i) {
        const { rows } = await client.query(Q.LOCK_CONFIG_OVERRIDES, [CHAVE]);
        const atual = rows[0].value ?? {};
        const merged = { ...atual, [`secao${i}`]: { v: i } };
        await client.query(Q.UPSERT_CONFIG_OVERRIDES, [CHAVE, JSON.stringify(merged), null]);
        return Object.keys(merged).length;
      },
    });

    const falhas = resultados.filter((r) => !r.ok).map((r) => r.error?.message);
    assert.deepEqual(falhas, [], 'nenhum participante pode falhar');

    const { rows } = await db.query('SELECT value FROM config_settings WHERE key = $1', [CHAVE]);
    assert.equal(rows.length, 1, 'guarda: a linha única existe ao fim da corrida');
    const doc = rows[0].value;
    assert.deepEqual(
      Object.keys(doc).sort(),
      ['secao0', 'secao1'],
      `documento final perdeu seção: ${JSON.stringify(doc)}`
    );

    // Guarda de discriminação: o teste só prova algo se os dois de fato mesclaram em
    // ordem — um viu 1 chave, o outro viu 2.
    const tamanhos = resultados.map((r) => r.value).sort();
    assert.deepEqual(tamanhos, [1, 2], `os merges não se encadearam: ${JSON.stringify(tamanhos)}`);
  });

  it('SQL (contraprova do mecanismo): o mesmo par SEM o lock perde uma seção', async () => {
    // Este caso não testa o produto — testa que a corrida montada acima é REAL. Se
    // `SELECT` puro passasse, o caso verde acima não estaria provando o lock, e sim a
    // ausência de concorrência (o falso-verde que este arquivo existe para evitar).
    const resultados = await raceOnConnections({
      participants: 2,
      async work(client, i) {
        const { rows } = await client.query('SELECT value FROM config_settings WHERE key = $1', [CHAVE]);
        const atual = rows[0]?.value ?? {};
        const merged = { ...atual, [`secao${i}`]: { v: i } };
        await client.query(Q.UPSERT_CONFIG_OVERRIDES, [CHAVE, JSON.stringify(merged), null]);
      },
    });

    // Sem lock, os dois inserem: um vence o índice único e o outro pode até falhar por
    // deadlock/conflito. Em qualquer desfecho, o documento final NÃO tem as duas.
    const { rows } = await db.query('SELECT value FROM config_settings WHERE key = $1', [CHAVE]);
    const chaves = Object.keys(rows[0]?.value ?? {});
    assert.ok(
      chaves.length < 2,
      `sem lock o documento deveria perder seção, mas veio completo: ${JSON.stringify(chaves)} `
        + `(participantes ok: ${resultados.filter((r) => r.ok).length}/2)`
    );
  });

  // ── nível SERVIÇO: estatístico e repetido ────────────────────────────────
  it('serviço: 20 corridas de 4 saves concorrentes, nenhuma perde seção', async () => {
    const PARTICIPANTES = 4;

    // "Vencedor" = o participante cujo documento RETORNADO já contém a seção de todos
    // os quatro, isto é, o último da fila serializada. Com o lock existe exatamente
    // um por corrida; sem ele, tipicamente NENHUM (todos leem a mesma base vazia), e
    // é `zeroWinnerRuns` que denuncia a perda.
    const resultado = await repeatRace({
      runs: 20,
      participants: PARTICIPANTES,
      setup: async () => {
        await db.query('DELETE FROM config_settings WHERE key = $1', [CHAVE]);
        return {};
      },
      attempt: (_ctx, i) => updateConfigOverrides({ [`secao${i}`]: { v: i } }, null),
      isWinner: (outcome) => {
        if (!outcome.ok) return false;
        const chaves = Object.keys(outcome.value ?? {});
        return Array.from({ length: PARTICIPANTES }, (_, i) => `secao${i}`)
          .every((k) => chaves.includes(k));
      },
      teardown: async () => {
        // A cada corrida, o documento PERSISTIDO tem de estar completo — a checagem que
        // não depende de quem "venceu".
        const doc = await getConfigOverrides();
        const faltando = Array.from({ length: PARTICIPANTES }, (_, i) => `secao${i}`)
          .filter((k) => !(k in doc));
        assert.deepEqual(faltando, [], `seção perdida no documento persistido: ${JSON.stringify(doc)}`);
      },
    });

    assert.equal(resultado.zeroWinnerRuns, 0, `corrida sem documento completo | ${resultado.report()}`);
    assert.equal(
      resultado.multiWinnerRuns,
      0,
      `mais de um participante viu o documento completo, logo não houve serialização | ${resultado.report()}`
    );
  });

  it('payload inválido faz rollback: não sobra documento vazio onde não havia nenhum', async () => {
    // O `INSERT ... ON CONFLICT DO UPDATE` que toma o lock também CRIA a linha quando
    // ela não existe. Fora de transação isso deixaria um `{}` para trás sempre que o
    // save falhasse depois do lock.
    //
    // O INSUMO ERA `{map2d:{minZoom:20}}`, recusado por uma invariante calculada sobre o
    // documento efetivo. Ela saiu em 2026-08-31 com a faixa fixa de zoom: as duas chaves
    // não entram mais, então a recusa mudou de camada e passou a ser 422 na BORDA, antes de
    // qualquer transação. O caso teria virado verde por falta de falha, medindo nada.
    //
    // O INSUMO NOVO FALHA DEPOIS DO LOCK, que é a única posição que exerce este rollback: um
    // NUL (`\u0000`) dentro de uma string. Ele atravessa `JSON.stringify` como texto válido e
    // morre no cast `::jsonb` do UPSERT, que é a linha seguinte ao lock. É alcançável de
    // verdade por HTTP, ao contrário de um objeto que só existe em memória.
    await assert.rejects(
      () => updateConfigOverrides({ app: { title: 'antes\u0000depois' } }, null),
      'um payload que o Postgres recusa precisa derrubar a transação inteira'
    );

    const { rows } = await db.query('SELECT value FROM config_settings WHERE key = $1', [CHAVE]);
    assert.deepEqual(rows, [], 'o save recusado não pode deixar linha nenhuma');
  });
});
