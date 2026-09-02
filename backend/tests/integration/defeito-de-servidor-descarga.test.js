// Path: tests/integration/defeito-de-servidor-descarga.test.js
// A DESCARGA DO AGREGADOR CONTRA O BANCO DE VERDADE, e a metade que o unitário não alcança:
// que N erros agregados em memória viram UM defeito com `ocorrencias + N` e UMA ocorrência
// com a última amostra, e que a falha REAL do driver não sobe nem retém o lote.
//
// POR QUE ESTE ARQUIVO EXISTE AO LADO DO UNITÁRIO. Lá a transação é injetada, então o que se
// prova é a aritmética da janela; aqui quem escreve é `gravarDefeitoComOcorrencia` contra o
// schema, e é o SQL que decide (`ocorrencias + EXCLUDED.ocorrencias`, o CHECK de `origem` que
// precisa aceitar `'servidor'`, a FK da ocorrência). Um duplo de banco provaria que o
// JavaScript chama a query.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - trocar o incremento parametrizado por `+ 1` fixo: o caso das mil ocorrências grava 1 em
//    vez de 1000, e o agregador inteiro deixa de ter efeito visível;
//  - não acrescentar `'servidor'` ao CHECK: a descarga passa a falhar com 23514, e como ela
//    não lança, o sintoma seria a tabela simplesmente nunca receber erro de servidor;
//  - deixar a descarga LANÇAR: o caso do banco fora derruba o teste em vez de devolver
//    `motivo: 'falha'`, e em produção derrubaria o timer (ou o desligamento).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  anotarDefeitoDeServidor,
  descarregarDefeitosDeServidor,
  limparDefeitosDeServidor,
  defeitosDeServidorPendentes,
  defeitoDeRequisicao,
  defeitoDaQueda,
  MARCADOR_DESCARGA_PERDIDA,
} from '../../src/modules/diag/defeitos-de-servidor.js';
import { requestErrorLogPayload } from '../../src/middleware/error-handler.js';
import { TIPO_DE_QUEDA } from '../../src/utils/logger.js';
// O `tx` do PG-PROMISE, e não o `db` de `setupTestEnv`: aquele é um Client cru do `pg`, que
// tem `.query` e NÃO tem `.tx`. Escrever `db.tx(...)` aqui não explode com uma mensagem
// clara, ele vira um `TypeError` DENTRO do `catch` da descarga (que não lança por contrato),
// e o caso passa verde sobre nada. Foi medido: o caso da atomicidade abaixo ficou verde sem
// nunca ter aberto uma transação.
import { tx } from '../../src/database/index.js';

class DatabaseError extends Error {}

describe('Descarga de defeitos de servidor: o lote vira UMA linha com a contagem', () => {
  let db;
  const marca = randomUUID().slice(0, 8);
  const assinaturas = [];
  const mudo = { info: () => {}, warn: () => {}, error: () => {} };

  /** O `erro500` carrega a marca na mensagem, que é o que torna a assinatura irrepetível. */
  function erro500(nome) {
    const err = new DatabaseError(`${nome} ${marca}`);
    err.statusCode = 500;
    return err;
  }

  const req = (over = {}) => ({
    id: 'req-1',
    method: 'POST',
    originalUrl: '/api/v1/atlas/6f1c4b90-1111-2222-3333-444455556666/sync',
    ...over,
  });

  function anotar(nome, over) {
    const anotacao = defeitoDeRequisicao(requestErrorLogPayload(erro500(nome), req(over)));
    assinaturas.push(anotacao.assinatura);
    anotarDefeitoDeServidor(anotacao);
    return anotacao.assinatura;
  }

  const linhaDe = (a) => db.query('SELECT * FROM defeitos WHERE assinatura = $1', [a])
    .then((r) => r.rows[0]);

  const ocorrenciasDe = (id) => db.query(
    'SELECT * FROM defeito_ocorrencias WHERE defeito_id = $1 ORDER BY em DESC, id DESC', [id]
  ).then((r) => r.rows);

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  beforeEach(() => limparDefeitosDeServidor());

  after(async () => {
    limparDefeitosDeServidor();
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
  });

  it('mil erros idênticos viram UM defeito com ocorrencias = 1000 e UMA ocorrência', async () => {
    let a = null;
    for (let i = 0; i < 1000; i += 1) a = anotar('em rajada', { id: `req-${i}` });
    assert.equal(defeitosDeServidorPendentes(), 1);

    const r = await descarregarDefeitosDeServidor({ registrar: mudo, release: 'v-servidor' });
    // `descartadas: 0` faz parte do retorno desde que o teto de assinaturas passou a CONTAR
    // o que recusa. O `deepEqual` é sobre o objeto INTEIRO de propósito: um campo novo no
    // retorno é mudança de contrato desta função, e quem a chama (o timer, o desligamento, a
    // queda) precisa reprovar aqui em vez de descobrir depois.
    assert.deepEqual(r, { descarregados: 1, ocorrencias: 1000, descartadas: 0 });
    assert.equal(defeitosDeServidorPendentes(), 0, 'a janela é esvaziada pela descarga');

    const linha = await linhaDe(a);
    assert.ok(linha, 'o defeito precisa existir');
    assert.equal(linha.ocorrencias, 1000, 'UM upsert com +1000, nunca mil escritas');
    assert.equal(linha.origem, 'servidor');
    assert.equal(linha.estado, 'aberto');
    assert.equal(linha.release, 'v-servidor');
    assert.equal(linha.primeira_release, 'v-servidor');
    assert.equal(linha.ultima_release, 'v-servidor');
    assert.equal(linha.user_id, null, 'a requisição era anônima');

    // UMA ocorrência por DESCARGA, não por erro: ela é a AMOSTRA, e a amostra é a última.
    const ocs = await ocorrenciasDe(linha.id);
    assert.equal(ocs.length, 1);
    assert.equal(ocs[0].req_id, 'req-999', 'a amostra guardada é a mais recente');
    assert.equal(ocs[0].status_code, 500);
    assert.equal(ocs[0].rota, 'POST /api/v1/atlas/:id/sync');
    assert.equal(ocs[0].origem, 'servidor');
    assert.equal(ocs[0].migalhas, null, 'não houve navegador para deixar rastro');
  });

  it('duas descargas somam na MESMA linha, e a segunda acrescenta a segunda ocorrência', async () => {
    const a = anotar('duas descargas', { id: 'req-a' });
    await descarregarDefeitosDeServidor({ registrar: mudo });
    anotar('duas descargas', { id: 'req-b' });
    anotar('duas descargas', { id: 'req-c' });
    await descarregarDefeitosDeServidor({ registrar: mudo });

    const linha = await linhaDe(a);
    assert.equal(linha.ocorrencias, 3, '1 + 2, na mesma assinatura');
    const ocs = await ocorrenciasDe(linha.id);
    assert.equal(ocs.length, 2, 'uma ocorrência por DESCARGA');
    assert.equal(ocs[0].req_id, 'req-c');
  });

  it('assinaturas distintas viram linhas distintas, na mesma transação', async () => {
    const a = anotar('assinatura A');
    const b = anotar('assinatura B');
    const r = await descarregarDefeitosDeServidor({ registrar: mudo });
    assert.deepEqual(r, { descarregados: 2, ocorrencias: 2, descartadas: 0 });
    assert.ok(await linhaDe(a));
    assert.ok(await linhaDe(b));
  });

  it('a QUEDA do processo também vira defeito, com origem de servidor e sem rota', async () => {
    const anotacao = defeitoDaQueda(TIPO_DE_QUEDA.EXCECAO, new Error(`morreu ${marca}`));
    assinaturas.push(anotacao.assinatura);
    anotarDefeitoDeServidor(anotacao);
    await descarregarDefeitosDeServidor({ registrar: mudo });

    const linha = await linhaDe(anotacao.assinatura);
    assert.ok(linha, 'a queda é a única falha do produto que não passa pelo errorHandler');
    assert.equal(linha.origem, 'servidor');
    assert.match(linha.assinatura, /queda: uncaughtException/);
    const ocs = await ocorrenciasDe(linha.id);
    assert.equal(ocs[0].rota, null, 'não houve requisição');
    assert.equal(ocs[0].status_code, null, 'nem resposta HTTP para inventar um status');
  });

  it('o defeito de servidor CONVIVE com o do navegador na mesma tabela, e se separa por origem', async () => {
    const a = anotar('do servidor');
    await descarregarDefeitosDeServidor({ registrar: mudo });

    const doCliente = `TypeError | do navegador | ${marca}`;
    assinaturas.push(doCliente);
    await db.query(
      "INSERT INTO defeitos (assinatura, mensagem, origem) VALUES ($1, 'x', 'store')",
      [doCliente]
    );

    const { rows } = await db.query(
      `SELECT assinatura FROM defeitos
        WHERE assinatura = ANY($1::text[]) AND origem IS DISTINCT FROM 'servidor'`,
      [[a, doCliente]]
    );
    assert.deepEqual(rows.map((r) => r.assinatura), [doCliente],
      'o recorte que mantém GET /diag/erros-cliente respondendo o que respondia antes');
  });

  it('o BANCO FORA não derruba nada, descarta o lote e acusa UMA vez, com a contagem', async () => {
    // O erro é REAL e vem do driver: uma transação que roda um SQL inválido no MESMO pool
    // da aplicação. Não é um duplo, é a falha do caminho de verdade — a mesma escolha de
    // `tests/integration/db-erro-real-nao-vaza-credencial.test.js`.
    anotar('vai falhar', { id: 'req-x' });
    anotar('vai falhar', { id: 'req-y' });
    assert.equal(defeitosDeServidorPendentes(), 1);

    const avisos = [];
    const r = await descarregarDefeitosDeServidor({
      transacao: (cb) => tx(async (t) => {
        await t.none('SELECT * FROM tabela_que_nao_existe_no_schema');
        return cb(t);
      }),
      registrar: { info: () => {}, warn: (obj, msg) => avisos.push({ obj, msg }), error: () => {} },
    });

    assert.deepEqual(r, { descarregados: 0, ocorrencias: 0, descartadas: 0, motivo: 'falha' });
    assert.equal(defeitosDeServidorPendentes(), 0, 'o lote é DESCARTADO, nunca retido');
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].msg, MARCADOR_DESCARGA_PERDIDA);
    assert.equal(avisos[0].obj.ocorrencias, 2, 'o aviso diz QUANTO se perdeu');
    // O `.jsonl` é a testemunha nesse caso, e é por isso que descartar é aceitável: cada um
    // destes erros já foi escrito linha a linha pelo `errorHandler` antes de chegar aqui.
    assert.equal(avisos[0].obj.err.code, '42P01');
  });

  it('a transação é ATÔMICA: um lote que falha no meio não deixa metade escrita', async () => {
    const bom = anotar('lote atomico A');
    const ruim = anotar('lote atomico B');
    // A segunda escrita do lote quebra: a primeira precisa ser desfeita junto.
    let n = 0;
    await descarregarDefeitosDeServidor({
      transacao: (cb) => tx(async (t) => cb({
        one: (...args) => { n += 1; return t.one(...args); },
        none: (...args) => {
          if (n >= 2) throw Object.assign(new Error('falhou no meio'), { code: '08006' });
          return t.none(...args);
        },
      })),
      registrar: mudo,
    });

    assert.equal(await linhaDe(bom), undefined, 'nada de meia escrita');
    assert.equal(await linhaDe(ruim), undefined);
  });
});
