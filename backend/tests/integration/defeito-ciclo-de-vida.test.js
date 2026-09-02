// Path: tests/integration/defeito-ciclo-de-vida.test.js
// A MÁQUINA DE ESTADO DO UPSERT, que é a única transição AUTOMÁTICA do produto.
//
// Ela vive no `CASE` de `UPSERT_DEFEITO` (`src/modules/diag/defeitos.queries.js`), em SQL, e
// é exercida aqui pelo caminho de verdade: a rota anônima que grava o relato. Testá-la por
// um duplo de banco provaria que o JavaScript chama a query, e é justamente o SQL que decide.
//
// AS QUATRO ARESTAS, e por que a segunda é a que importa mais:
//  - `aberto` + ocorrência -> continua `aberto`;
//  - `resolvido` + ocorrência na MESMA release -> continua `resolvido`. É o navegador com o
//    bundle velho em cache, que acontece SEMPRE (quem tinha a aba aberta no deploy segue com
//    o código antigo até recarregar). Marcar regressão aqui ensinaria o administrador a
//    ignorar o estado, e um campo de ciclo de vida que se ignora é decoração;
//  - `resolvido` + ocorrência em OUTRA release -> vira `regrediu`. É a regressão de verdade;
//  - `ignorado` + ocorrência -> continua `ignorado`, em QUALQUER release. Ignorar significa
//    "eu sei, e não quero mais ouvir sobre isto", e reabrir desfaria o único ato que existe
//    para calar ruído conhecido.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - trocar o `IS DISTINCT FROM` por `<>`: o caso do resolvido SEM release anotada fica
//    vermelho, porque `NULL <> 'x'` é NULL e o CASE cai no ELSE calado;
//  - comparar por TEMPO ("chegou depois de resolvido, logo regrediu") em vez de por release:
//    o caso do bundle velho passa a acusar regressão, e ele é o caso frequente;
//  - tirar o `AND EXCLUDED.release IS NOT NULL` do CASE: o caso do relato SEM release passa a
//    reabrir como `regrediu` um defeito corrigido, porque `NULL IS DISTINCT FROM 'v3'` é
//    verdadeiro. É a direção oposta do bug do bundle velho e igualmente frequente: cliente
//    antigo, versão sem carimbo de build e fila de relatos gravada antes do deploy chegam
//    todos sem release;
//  - estender o CASE ao `ignorado`: o caso do ignorado fica vermelho;
//  - tirar o `COALESCE(defeitos.primeira_release, EXCLUDED.release)`: o caso das duas
//    releases fica vermelho, e a `stack_bruta` (fixada na primeira) perde a build contra a
//    qual ela deve ser lida, que é a razão inteira de a coluna existir.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

describe('Defeito: o ciclo de vida e as quatro arestas do UPSERT', () => {
  let app, db;
  const marca = randomUUID().slice(0, 8);
  const assinaturas = [];

  /** Uma assinatura irrepetível: a tabela é compartilhada pela rodada inteira. */
  function assinatura(nome) {
    const a = `TypeError | ${nome} | ${marca}`;
    assinaturas.push(a);
    return a;
  }

  const linhaDe = (a) => db.query('SELECT * FROM defeitos WHERE assinatura = $1', [a])
    .then((r) => r.rows[0]);

  const relatar = (corpo) => supertest(app)
    .post('/api/v1/diag/erro-cliente')
    .send(corpo)
    .expect(204);

  /** Marca o defeito como resolvido, como o lote seguinte fará por rota. */
  const resolver = (a, release) => db.query(
    `UPDATE defeitos
        SET estado = 'resolvido', resolvido_em = NOW(), resolvido_na_release = $2
      WHERE assinatura = $1`,
    [a, release]
  );

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
  });

  it('o defeito NASCE aberto, e a ocorrência seguinte não o move', async () => {
    const a = assinatura('nasce-aberto');
    await relatar({ assinatura: a, mensagem: 'primeira', release: 'v1' });
    assert.equal((await linhaDe(a)).estado, 'aberto');

    await relatar({ assinatura: a, mensagem: 'segunda', release: 'v1' });
    const linha = await linhaDe(a);
    assert.equal(linha.estado, 'aberto', 'aberto não vira nada sozinho');
    assert.equal(linha.ocorrencias, 2);
  });

  it('RESOLVIDO + ocorrência na MESMA release CONTINUA resolvido (bundle velho em cache)', async () => {
    const a = assinatura('cache-velho');
    await relatar({ assinatura: a, mensagem: 'antes do conserto', release: 'v2' });
    await resolver(a, 'v2');

    await relatar({ assinatura: a, mensagem: 'de novo, mesma build', release: 'v2' });
    const linha = await linhaDe(a);
    assert.equal(linha.estado, 'resolvido', 'a mesma release NÃO é regressão');
    assert.equal(linha.ocorrencias, 2, 'e mesmo assim a ocorrência é CONTADA');
    assert.equal(linha.ultima_release, 'v2');
  });

  it('RESOLVIDO + ocorrência em OUTRA release vira REGREDIU', async () => {
    const a = assinatura('regressao');
    await relatar({ assinatura: a, mensagem: 'antes do conserto', release: 'v2' });
    await resolver(a, 'v2');

    await relatar({ assinatura: a, mensagem: 'voltou na build nova', release: 'v3' });
    const linha = await linhaDe(a);
    assert.equal(linha.estado, 'regrediu');
    assert.equal(linha.ultima_release, 'v3');
    assert.equal(linha.primeira_release, 'v2', 'a primeira não se mexe');
    assert.equal(linha.resolvido_na_release, 'v2', 'nem o registro do conserto');
  });

  it('REGREDIU não regride de novo: ele já está no pior estado que a máquina alcança', async () => {
    const a = assinatura('regrediu-de-novo');
    await relatar({ assinatura: a, mensagem: 'x', release: 'v2' });
    await resolver(a, 'v2');
    await relatar({ assinatura: a, mensagem: 'x', release: 'v3' });
    assert.equal((await linhaDe(a)).estado, 'regrediu');

    await relatar({ assinatura: a, mensagem: 'x', release: 'v4' });
    const linha = await linhaDe(a);
    assert.equal(linha.estado, 'regrediu');
    assert.equal(linha.ocorrencias, 3);
  });

  it('resolvido + relato SEM release CONTINUA resolvido: build desconhecida não afirma nada', async () => {
    // A DIREÇÃO OPOSTA DO CASO ANTERIOR, e a que `IS DISTINCT FROM` sozinho erra: com ele,
    // `NULL IS DISTINCT FROM 'v3'` é VERDADEIRO, e todo relato de cliente antigo (script em
    // cache, versão sem carimbo de build, fila gravada antes do deploy) reabriria como
    // regressão um defeito corrigido. É a mesma assimetria do `COALESCE` das outras colunas:
    // relato que não traz o campo não apaga o que já se sabia, logo também não pode afirmar
    // o contrário.
    const a = assinatura('relato-sem-release-nao-regride');
    await relatar({ assinatura: a, mensagem: 'x', release: 'v3' });
    await resolver(a, 'v3');

    await relatar({ assinatura: a, mensagem: 'x' });
    const linha = await linhaDe(a);
    assert.equal(linha.estado, 'resolvido', 'build desconhecida não é build diferente');
    assert.equal(linha.ocorrencias, 2, 'e mesmo assim a ocorrência é CONTADA');
    assert.equal(linha.ultima_release, 'v3', 'o COALESCE preserva a última conhecida');

    // E o par POSITIVO, no mesmo defeito: quando a release aparece e é outra, ele regride.
    // Sem este par, o caso acima passaria idêntico com o CASE recusando tudo.
    await relatar({ assinatura: a, mensagem: 'x', release: 'v4' });
    assert.equal((await linhaDe(a)).estado, 'regrediu');
  });

  it('resolvido SEM release anotada + ocorrência COM release regride (o desfecho conservador)', async () => {
    // É aqui que `IS DISTINCT FROM` se separa de `<>`: com `<>`, `NULL <> 'v9'` é NULL, o
    // CASE cairia no ELSE e o defeito ficaria `resolvido` calado. Sem saber em qual build o
    // conserto entrou, não há como afirmar que esta ocorrência é de um build velho.
    const a = assinatura('resolvido-sem-release');
    await relatar({ assinatura: a, mensagem: 'x', release: 'v8' });
    await resolver(a, null);

    await relatar({ assinatura: a, mensagem: 'x', release: 'v9' });
    assert.equal((await linhaDe(a)).estado, 'regrediu');
  });

  it('IGNORADO não se move, nem na mesma release nem em outra', async () => {
    const a = assinatura('ignorado');
    await relatar({ assinatura: a, mensagem: 'ruído conhecido', release: 'v2' });
    await db.query("UPDATE defeitos SET estado = 'ignorado' WHERE assinatura = $1", [a]);

    await relatar({ assinatura: a, mensagem: 'ruído conhecido', release: 'v2' });
    assert.equal((await linhaDe(a)).estado, 'ignorado');
    await relatar({ assinatura: a, mensagem: 'ruído conhecido', release: 'v7' });
    const linha = await linhaDe(a);
    assert.equal(linha.estado, 'ignorado', 'ignorar é definitivo até alguém desfazer');
    assert.equal(linha.ocorrencias, 3, 'e mesmo assim a contagem sobe');
  });

  it('as DUAS releases dizem coisas diferentes: a primeira fixa, a última anda', async () => {
    const a = assinatura('duas-releases');
    await relatar({ assinatura: a, mensagem: 'x', release: 'v1', stackBruta: 'pilha da v1' });
    await relatar({ assinatura: a, mensagem: 'x', release: 'v2', stackBruta: 'pilha da v2' });
    await relatar({ assinatura: a, mensagem: 'x', release: 'v3' });

    const linha = await linhaDe(a);
    assert.equal(linha.primeira_release, 'v1');
    assert.equal(linha.ultima_release, 'v3');
    // O par que se lê JUNTO: a pilha crua fica na primeira, e `primeira_release` é a build
    // contra a qual ela resolve. Trocar uma das duas regras faria a linha descrever builds
    // diferentes na mesma frase.
    assert.equal(linha.stack_bruta, 'pilha da v1');
    assert.equal(linha.release, 'v3', '`release` continua sendo a do relato mais recente');
  });

  it('relato SEM release não apaga o que já se sabia sobre as builds', async () => {
    const a = assinatura('sem-release');
    await relatar({ assinatura: a, mensagem: 'x', release: 'v5' });
    await relatar({ assinatura: a, mensagem: 'x' });

    const linha = await linhaDe(a);
    assert.equal(linha.primeira_release, 'v5');
    assert.equal(linha.ultima_release, 'v5', 'o COALESCE preserva a última conhecida');
    assert.equal(linha.ocorrencias, 2);
  });

  it('o defeito que nasce sem release nenhuma tem as duas nulas, e ganha a primeira depois', async () => {
    const a = assinatura('nasce-sem-release');
    await relatar({ assinatura: a, mensagem: 'x' });
    let linha = await linhaDe(a);
    assert.equal(linha.primeira_release, null);
    assert.equal(linha.ultima_release, null);

    await relatar({ assinatura: a, mensagem: 'x', release: 'v6' });
    linha = await linhaDe(a);
    assert.equal(linha.primeira_release, 'v6', 'a primeira CONHECIDA, não a primeira ocorrência');
    assert.equal(linha.ultima_release, 'v6');
  });

  it('o CHECK do banco recusa estado inventado, mesmo por escrita direta', async () => {
    // O par do caso de borda em `tests/unit/diag-estado-de-defeito.test.js`: lá o Joi recusa
    // o filtro, aqui o banco recusa a escrita. Um CHECK escrito no arquivo e nunca aplicado
    // seria a mesma cobertura vazia que aquele arquivo existe para evitar.
    const a = assinatura('estado-invalido');
    await assert.rejects(
      () => db.query(
        'INSERT INTO defeitos (assinatura, mensagem, estado) VALUES ($1, $2, $3)',
        [a, 'x', 'zumbi']
      ),
      (err) => {
        assert.equal(err.code, '23514');
        assert.match(err.constraint, /defeitos_estado_check/);
        return true;
      }
    );
  });
});
