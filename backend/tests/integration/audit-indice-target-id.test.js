// Path: tests/integration/audit-indice-target-id.test.js
//
// O ÍNDICE QUE A DOCUMENTAÇÃO PROMETIA E O BANCO NÃO TINHA.
//
// `idx_audit_target` é `(target_type, target_id)`, e a tela de auditoria preenche só o
// `targetId`. O comentário de `src/modules/audit/audit.queries.js` afirmava que a pergunta
// "tudo que já foi feito com o tileset X" "entra pelo mesmo `idx_audit_target`". Ela
// entrava, e era esse o problema: o planejador percorria o índice INTEIRO aplicando o
// `target_id` como condição na segunda coluna, o que custa quase uma varredura e não
// parece errado em plano nenhum. Índice citado como cobertura, sendo lido de ponta a
// ponta, é pior que índice ausente, porque desliga a suspeita.
//
// COMO ESTE ARQUIVO PROVA, e onde ele é fraco. São dois casos com forças diferentes, e a
// diferença está declarada de propósito:
//
//  1. A EXISTÊNCIA do índice, lida de `pg_indexes`. É o mínimo e é FRACO: um índice pode
//     existir e nunca ser escolhido, que é literalmente o defeito que este arquivo fecha.
//     Ele só serve para dar uma mensagem clara quando a migração não rodou.
//  2. O EXPLAIN da consulta REAL (`LIST_AUDIT`, com só o `targetId` preenchido), que é o
//     teste honesto. Ele vem com CONTROLE NEGATIVO embutido: o mesmo plano é medido dentro
//     de uma transação em que o índice foi derrubado, e ali ele NÃO pode aparecer. Sem
//     isso, o caso passaria verde com um plano que menciona o índice por acaso. DDL é
//     transacional no Postgres, então o `ROLLBACK` devolve o índice sem deixar rastro.
//
// O VOLUME É PARTE DO TESTE, não enfeite: com poucas linhas o planejador escolhe a
// varredura porque a tabela cabe nela, e um EXPLAIN nessa condição não diz nada sobre
// índice.
//
// A SELETIVIDADE DO ALVO TAMBÉM É PARTE DO TESTE, e essa parte custou uma medição errada
// antes de ficar de pé. O alvo daqui leva ~1% das linhas, e o número não é arbitrário:
// acima de uns 5% o planejador ABANDONA este índice e volta a percorrer
// `idx_audit_created` filtrando linha a linha, porque a essa altura ler o índice de tempo
// e descartar 19 de cada 20 linhas sai mais barato que ordenar todas as do alvo. Isso é
// escolha CERTA dele, não regressão, e está escrito no cabeçalho de
// `src/database/migrations/016_indice_audit_target_id.sql`. O que este arquivo mede é a
// faixa em que o índice decide, que é a da investigação real (um recurso específico, uma
// fatia pequena da trilha inteira); quem aumentar `FATIA_DO_ALVO` vai ver estes casos
// ficarem vermelhos sem que nada tenha quebrado.
//
// AS LINHAS SEMEADAS SÃO MARCADAS e saem no `after`: `audit_trail` é global e os arquivos
// de teste rodam em paralelo contra o mesmo banco.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { LIST_AUDIT } from '../../src/modules/audit/audit.queries.js';

const INDICE = 'idx_audit_target_id';

/** Quantas linhas o alvo de cardinalidade média recebe, e quantas o resto. */
const LINHAS = 30_000;
const FATIA_DO_ALVO = 100; // 1 em 100 vai para o alvo medido: ~300 linhas, ~1% da tabela

describe('auditoria: o filtro por targetId sozinho tem índice próprio', () => {
  let db;
  const marca = randomUUID().slice(0, 8);
  const alvoMedio = `alvo-medio-${marca}`;

  /** O plano da consulta REAL, com só o `targetId` preenchido, como a tela faz. */
  async function planoDaTela(targetId, offset = 0) {
    const { rows } = await db.query(
      `EXPLAIN (FORMAT TEXT) ${LIST_AUDIT}`,
      [null, null, null, targetId, null, null, null, 50, offset],
    );
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  }

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    await db.query(
      `INSERT INTO audit_trail (action, actor_id, target_type, target_id, target_name, ip, created_at)
       SELECT 'CATALOG_UPDATE', gen_random_uuid(), 'TILESET',
              CASE WHEN i % $2 = 0 THEN $3 ELSE 'alvo-frio-' || $4 || '-' || (i % 500) END,
              'semente', '127.0.0.1', NOW() - (i || ' seconds')::interval
         FROM generate_series(1, $1) i`,
      [LINHAS, FATIA_DO_ALVO, alvoMedio, marca],
    );
    await db.query('ANALYZE audit_trail');
  });

  after(async () => {
    await db.query("DELETE FROM audit_trail WHERE target_name = 'semente' AND target_id LIKE $1", [`%${marca}%`]);
    await teardownTestEnv(db);
  });

  it('o índice existe, com `target_id` na LIDERANÇA (o mínimo, e é fraco)', async () => {
    const { rows } = await db.query(
      'SELECT indexdef FROM pg_indexes WHERE tablename = $1 AND indexname = $2',
      ['audit_trail', INDICE],
    );
    assert.equal(rows.length, 1, `${INDICE} não existe: a migração não rodou`);

    // A ORDEM DAS COLUNAS É A PROPRIEDADE INTEIRA. Um índice com o mesmo nome e
    // `(target_type, target_id)` dentro passaria numa checagem de existência e não
    // serviria a pergunta nenhuma, que é exatamente o estado anterior.
    assert.match(rows[0].indexdef, /\(target_id, created_at DESC\)/, rows[0].indexdef);

    // E o antigo continua de pé: ele serve o par completo, que é outra pergunta.
    const { rows: antigo } = await db.query(
      'SELECT indexdef FROM pg_indexes WHERE tablename = $1 AND indexname = $2',
      ['audit_trail', 'idx_audit_target'],
    );
    assert.equal(antigo.length, 1, 'idx_audit_target sumiu; o par (tipo, id) ficou sem índice');
  });

  it('o plano da consulta REAL alcança o índice, e SEM o nó de Sort', async () => {
    const plano = await planoDaTela(alvoMedio);

    assert.ok(plano.includes(INDICE), `o plano deveria alcançar ${INDICE}.\n\n${plano}`);
    // `Index Cond` e não `Filter`: com o índice apenas presente no plano como leitura
    // completa, a coluna vira filtro e o índice segue ocioso. É esta linha que separa
    // "usa o índice" de "tem o índice no plano".
    assert.match(plano, /Index Cond: \(target_id = /, plano);
    // A segunda coluna do índice é o que tira o Sort: a paginação por `created_at DESC`
    // sai ordenada do próprio índice. Sem ela o planejador ordena as centenas de linhas
    // do alvo a cada página.
    assert.equal(/\bSort Key: /.test(plano), false, `o Sort voltou ao plano:\n\n${plano}`);
  });

  it('a página paginada (OFFSET 100) chega às linhas pelo MESMO índice', async () => {
    // O QUE ESTE CASO NÃO PROVA, dito em voz alta, porque foi medido e contraria o que a
    // segunda coluna do índice promete. Na página 1 o planejador toma o caminho ORDENADO
    // e o Sort some do plano; com OFFSET ele troca por Bitmap Index Scan mais Sort, e nas
    // ~300 linhas deste alvo essa troca é a escolha certa dele (ordenar 300 linhas custa
    // menos que percorrer o índice ordenado descartando 100). O ganho ordenado da
    // paginação aparece em escala maior: medido fora da suíte, com 200 mil linhas e 2 mil
    // no alvo, a página com OFFSET 500 saiu por `Index Scan` sem Sort, 0,330 ms contra
    // 6,218 ms de um índice de `(target_id)` sozinho. Aqui a asserção que se sustenta é a
    // do CAMINHO: as linhas do alvo são achadas pelo índice novo, e não varrendo tabela
    // nem índice de tempo.
    //
    // E O QUE O POSTGRES 18 MUDOU, medido em 2026-09-05 (18.1, esta máquina, 30 mil linhas
    // semeadas, 1 em 100 no alvo, ANALYZE feito): com OFFSET 100 o planejador escolhe
    // `Index Scan using idx_audit_target` (o composto ANTIGO, `(target_type, target_id)`) com
    // `Index Cond: (target_id = ...)` e `Index Searches: 2`, seguido de Sort, custo estimado
    // 426 contra 522 do caminho pelo índice novo. É o SKIP SCAN da 18: com uma só coluna
    // líder de cardinalidade 1, o composto responde a pergunta em duas buscas, e a premissa
    // deste arquivo ("condição só na segunda coluna custa o índice inteiro") deixa de valer
    // nessa versão. Medido em buffers, os dois caminhos empatam (306 pelo composto contra
    // 304 pelo novo sozinho, com o composto derrubado numa transação): a diferença é do
    // heap das 300 linhas e dos joins, não do índice. Então a asserção honesta aqui é a do
    // CAMINHO, como o parágrafo acima já dizia: as linhas são achadas por um índice que tem
    // `target_id` como condição de busca, e não varrendo a tabela nem descendo
    // `idx_audit_created` linha a linha. Qual dos dois índices o planejador prefere na
    // paginação depende da versão, e não é o que este caso prende; a página 1 (caso acima)
    // continua exigindo o índice novo e o plano sem Sort, que é o ganho que ele existe para
    // dar. Exigir o índice novo também aqui reprovava a 18 por escolha certa dela.
    const plano = await planoDaTela(alvoMedio, 100);
    assert.match(plano, /Index Cond: \(target_id = /, `as linhas do alvo têm de chegar por índice com target_id na condição.\n\n${plano}`);
    assert.match(
      plano,
      /Index Scan using (idx_audit_target_id|idx_audit_target)\b|Bitmap Index Scan on idx_audit_target_id/,
      `o caminho até as linhas tem de ser um índice por target_id (o novo, ou o composto por skip scan na 18).\n\n${plano}`,
    );
    assert.equal(/idx_audit_created/.test(plano), false, `o plano voltou a descer o índice de tempo filtrando linha a linha:\n\n${plano}`);
    assert.equal(/Seq Scan on audit_trail/.test(plano), false, `o plano voltou à varredura da tabela:\n\n${plano}`);
  });

  it('CONTROLE NEGATIVO: sem o índice o mesmo plano volta a percorrer outra coisa', async () => {
    // DDL é transacional no Postgres, então o índice cai só para esta medição e o
    // `ROLLBACK` o devolve intacto. Sem este caso, o anterior seria verde sobre um plano
    // que poderia mencionar o índice por qualquer motivo.
    await db.query('BEGIN');
    try {
      await db.query(`DROP INDEX ${INDICE}`);
      const plano = await planoDaTela(alvoMedio);
      assert.equal(
        plano.includes(INDICE),
        false,
        `o índice caiu e o plano ainda o nomeia; a medição não está medindo o índice.\n\n${plano}`,
      );
      // O que sobra é o estado ANTERIOR ao conserto: ou a varredura, ou um dos índices
      // que não servem a esta pergunta.
      assert.match(plano, /idx_audit_created|idx_audit_target\b|Seq Scan/, plano);
    } finally {
      await db.query('ROLLBACK');
    }

    // E o índice sobreviveu ao controle negativo.
    const { rows } = await db.query(
      'SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2',
      ['audit_trail', INDICE],
    );
    assert.equal(rows.length, 1, 'o ROLLBACK não devolveu o índice');
  });
});
