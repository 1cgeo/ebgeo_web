// Path: tests/integration/diag-erro-de-cliente-identidade.test.js
// AS QUATRO COLUNAS DE `017_erro_cliente_identidade.sql` (`sessao_id`, `stack_bruta`,
// `origem`, `contexto`), da borda até o banco e de volta na listagem.
//
// O QUE ELAS MUDAM NA PERGUNTA. `defeitos` (que se chamava `client_errors` até
// `018_defeitos_e_ocorrencias.sql`) respondia "qual defeito e quantas vezes";
// com estas colunas ela responde também de qual ABA (a mesma sessão que o servidor carimba
// nas linhas de log), com que pilha REAL, por qual porta o erro entrou e em que estado o
// app estava. Sem elas, o erro do navegador e as linhas do servidor do mesmo instante
// continuavam sendo duas evidências que ninguém conseguia juntar.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - tornar qualquer um dos quatro obrigatório no Joi: o caso do relato SEM nenhum deles
//    passa a 422, e ele é o caso de todo navegador com script antigo em cache;
//  - trocar `COALESCE(defeitos.stack_bruta, EXCLUDED.stack_bruta)` pela ordem normal:
//    o caso da assimetria fica vermelho, e a linha passa a ter pilha de uma build com o
//    `release` de outra, que é pior que pilha nenhuma porque parece endereço;
//  - tirar o CHECK da migração: o caso do INSERT direto com origem inventada passa a
//    ACEITAR, e o vocabulário deixa de valer para toda escrita que não passe pelo Joi;
//  - derivar a lista do Joi à mão em vez de `ORIGENS_DE_ERRO`: as duas listas divergem e o
//    caso do 422 vira um 400 opaco vindo do 23514;
//  - `JSON.stringify` no `contexto` antes do INSERT: o caso que lê a coluna como objeto
//    fica vermelho, porque o JSONB passaria a guardar uma STRING JSON, que se lê igual numa
//    tela e quebra toda consulta por chave;
//  - ler `sessaoId` como identidade de pessoa: o caso do anônimo com sessão fica vermelho.
//
// O PAR COMPLETO da leitura já está em `diag-erro-de-cliente.test.js` (401/403/200); aqui a
// listagem só é exercida para provar o MAPEAMENTO das quatro colunas novas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { ORIGENS_DE_ERRO, OrigemDeErro } from '../../src/modules/diag/origens-de-erro.js';

describe('Erro do navegador — identidade, pilha crua, origem e contexto', () => {
  let app, db, comum, comumToken, admin, adminToken;
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

  const relatar = (corpo) => supertest(app).post('/api/v1/diag/erro-cliente').send(corpo);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    comum = await createUser(db, { username: `cei_user_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `cei_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
  });

  // ── o contrato que NÃO pode ter mudado ──
  it('o relato SEM nenhum dos quatro campos novos continua sendo 204, e as colunas ficam NULL', async () => {
    const a = assinatura('sem-nada');
    await relatar({ assinatura: a, mensagem: 'quebrou' }).expect(204);

    const linha = await linhaDe(a);
    assert.ok(linha, 'a linha precisa existir');
    assert.equal(linha.sessao_id, null);
    assert.equal(linha.stack_bruta, null);
    assert.equal(linha.origem, null, 'NULL é "não declarou", e é um estado legítimo');
    assert.equal(linha.contexto, null);
    assert.equal(linha.ocorrencias, 1);
  });

  // ── a escrita dos quatro ──
  it('os quatro chegam ao banco, e o `contexto` é JSONB de verdade (objeto, não string)', async () => {
    const a = assinatura('completo');
    const sessao = randomUUID();
    await relatar({
      assinatura: a,
      mensagem: 'falha ao desenhar a camada',
      stack: 'TypeError: x is undefined\n    at <marcador>',
      stackBruta: 'TypeError: x is undefined\n    at render (build-9f3a2.js:12:44)',
      origem: OrigemDeErro.MAPLIBRE,
      sessaoId: sessao,
      contexto: { atlasKind: 'servidor', conexao: 'online', causa: 'tile-403', camada: 'ortofoto', status: 403 },
    }).expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.sessao_id, sessao);
    assert.match(linha.stack_bruta, /build-9f3a2\.js/, 'a pilha crua ainda aponta o bundle');
    assert.equal(linha.origem, 'maplibre');
    // Se o INSERT gravasse texto JSON dentro do JSONB, isto viria como string.
    assert.equal(typeof linha.contexto, 'object');
    assert.deepEqual(linha.contexto, {
      atlasKind: 'servidor', conexao: 'online', causa: 'tile-403', camada: 'ortofoto', status: 403,
    });
  });

  it('a sessão NÃO é identidade de pessoa: o anônimo com sessão continua anônimo', async () => {
    const a = assinatura('sessao-nao-e-pessoa');
    const sessao = randomUUID();
    await relatar({ assinatura: a, mensagem: 'x', sessaoId: sessao, userId: admin.id }).expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.sessao_id, sessao, 'a aba é aceita do corpo');
    assert.equal(linha.user_id, null, 'a pessoa continua saindo do token, nunca do corpo');
  });

  it('autenticado: a aba vem do corpo e a pessoa vem do token, ao mesmo tempo', async () => {
    const a = assinatura('sessao-com-token');
    const sessao = randomUUID();
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .set('Authorization', `Bearer ${comumToken}`)
      .send({ assinatura: a, mensagem: 'x', sessaoId: sessao })
      .expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.sessao_id, sessao);
    assert.equal(linha.user_id, comum.id);
  });

  // ── a assimetria do UPSERT ──
  it('`stack_bruta` guarda a PRIMEIRA, enquanto `release` e as outras seguem a mais nova', async () => {
    // A pilha crua carrega o hash do bundle e só se lê contra a build que a produziu.
    // Como `release` segue a regra normal (o relato novo vence), deixar a pilha crua
    // seguir junto faria as duas colunas descreverem builds DIFERENTES na mesma linha.
    const a = assinatura('assimetria');
    await relatar({
      assinatura: a, mensagem: 'primeira', release: 'build-1',
      stackBruta: 'at render (build-1.js:1:1)', origem: OrigemDeErro.STORE,
    }).expect(204);
    await relatar({
      assinatura: a, mensagem: 'segunda', release: 'build-2',
      stackBruta: 'at render (build-2.js:9:9)', origem: OrigemDeErro.WS,
    }).expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.ocorrencias, 2);
    assert.equal(linha.stack_bruta, 'at render (build-1.js:1:1)', 'a PRIMEIRA pilha crua fica');
    assert.equal(linha.release, 'build-2', 'o release segue a regra normal: o novo vence');
    assert.equal(linha.origem, 'ws', 'a origem também: o relato novo vence');
    assert.equal(linha.mensagem, 'segunda');
  });

  it('o relato mais pobre não apaga o que o anterior trouxe', async () => {
    const a = assinatura('preserva');
    const sessao = randomUUID();
    await relatar({
      assinatura: a, mensagem: 'primeira', sessaoId: sessao,
      origem: OrigemDeErro.CONSOLE, contexto: { conexao: 'offline' },
    }).expect(204);
    await relatar({ assinatura: a, mensagem: 'segunda' }).expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.ocorrencias, 2);
    assert.equal(linha.sessao_id, sessao);
    assert.equal(linha.origem, 'console');
    assert.deepEqual(linha.contexto, { conexao: 'offline' });
  });

  // ── a borda recusa, e recusa NOMEANDO ──
  it('origem desconhecida é 422 (Joi), e nada é escrito', async () => {
    const a = assinatura('origem-inventada');
    const res = await relatar({ assinatura: a, mensagem: 'x', origem: 'inventada' }).expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.match(JSON.stringify(res.body.error.details), /origem/);
    assert.equal(await linhaDe(a), undefined, 'nada foi escrito');
  });

  it('sessaoId que não é UUID é 422 (a coluna é UUID: sem isto seria um 500 por 22P02)', async () => {
    const a = assinatura('sessao-invalida');
    await relatar({ assinatura: a, mensagem: 'x', sessaoId: 'aba-3' }).expect(422);
    assert.equal(await linhaDe(a), undefined);
  });

  it('stackBruta acima do teto é 422, não erro do driver', async () => {
    const a = assinatura('pilha-gigante');
    await relatar({ assinatura: a, mensagem: 'x', stackBruta: 'z'.repeat(4001) }).expect(422);
    assert.equal(await linhaDe(a), undefined);
  });

  it('o `contexto` tem forma fechada: valor fora da faixa e tipo errado são 422', async () => {
    const invalidos = [
      { atlasKind: 'nuvem' },
      { status: 99 },
      { status: 600 },
      { status: 'quatrocentos' },
      { conexao: 'x'.repeat(21) },
      { causa: 'y'.repeat(41) },
      { camada: 'w'.repeat(81) },
    ];
    assert.equal(invalidos.length, 7);
    for (const contexto of invalidos) {
      await relatar({ assinatura: `${marca}-ctx-${JSON.stringify(contexto)}`, mensagem: 'x', contexto })
        .expect(422);
    }
  });

  it('chave não declarada no `contexto` é RECUSADA com 422, e o campo é nomeado', async () => {
    // MEDIDO, e contraria a leitura natural: `VALIDATION_OPTIONS` roda com `stripUnknown`,
    // que descartaria a chave em silêncio, mas o `unknown(false)` explícito do schema VENCE
    // a opção e transforma a chave extra em 422. O caso está aqui para prender esse
    // desfecho, porque ele é o oposto do que "stripUnknown" sugere e porque tem preço: um
    // cliente que invente um campo perde o relato inteiro, não só o campo.
    const a = assinatura('ctx-extra');
    const res = await relatar({
      assinatura: a, mensagem: 'x',
      contexto: { conexao: 'online', inventado: 'isto reprova' },
    }).expect(422);

    assert.match(JSON.stringify(res.body.error.details), /inventado/, 'o 422 nomeia a chave');
    assert.equal(await linhaDe(a), undefined, 'nada foi escrito');
  });

  it('o `contexto` com só PARTE dos campos declarados é aceito', async () => {
    // O par positivo da recusa acima: sem ele, o caso anterior passaria idêntico se o
    // schema recusasse todo `contexto`.
    const a = assinatura('ctx-parcial');
    await relatar({ assinatura: a, mensagem: 'x', contexto: { conexao: 'online' } }).expect(204);
    assert.deepEqual((await linhaDe(a)).contexto, { conexao: 'online' });
  });

  // ── o CHECK do banco, que é a segunda porta ──
  it('o CHECK recusa a origem inventada mesmo por INSERT DIRETO, e aceita as ONZE', async () => {
    // O Joi protege a borda; o CHECK protege TODA escrita, inclusive a que não passa por
    // ela (um roteiro, um INSERT à mão, um controller futuro). Sem o par positivo abaixo,
    // este caso passaria idêntico se o CHECK recusasse tudo.
    const inserir = (origem) => db.query(
      'INSERT INTO defeitos (assinatura, mensagem, origem) VALUES ($1, $2, $3)',
      [`${marca}-check-${origem}`, 'direto', origem]
    );
    assinaturas.push(`${marca}-check-inventada`);

    await assert.rejects(
      () => inserir('inventada'),
      (err) => {
        assert.equal(err.code, '23514', 'violação de CHECK');
        assert.match(err.constraint, /defeitos_origem_check/);
        return true;
      }
    );

    // ONZE e não dez desde `018_defeitos_e_ocorrencias.sql`: o CHECK precisa aceitar
    // `'servidor'` porque é a MESMA coluna que o agregador de 5xx escreve. A borda ANÔNIMA é
    // que recorta (`ORIGENS_DO_CLIENTE`, `tests/unit/diag-origem-de-erro.test.js`), e as duas
    // listas não podem ser confundidas: aqui vale a do banco.
    assert.equal(ORIGENS_DE_ERRO.length, 11);
    for (const origem of ORIGENS_DE_ERRO) {
      assinaturas.push(`${marca}-check-${origem}`);
      await inserir(origem);
    }
    const { rows } = await db.query(
      "SELECT origem FROM defeitos WHERE assinatura LIKE $1 ORDER BY origem",
      [`${marca}-check-%`]
    );
    assert.equal(rows.length, 11, 'as onze entraram');
  });

  it('o CHECK aceita NULL: relato que não declara origem continua entrando por qualquer porta', async () => {
    const a = `${marca}-check-nula`;
    assinaturas.push(a);
    await db.query('INSERT INTO defeitos (assinatura, mensagem) VALUES ($1, $2)', [a, 'sem origem']);
    const linha = await linhaDe(a);
    assert.equal(linha.origem, null);
  });

  // ── a listagem mapeia as quatro ──
  it('o administrador recebe os quatro campos, em camelCase', async () => {
    const a = assinatura('listagem');
    const sessao = randomUUID();
    await relatar({
      assinatura: a, mensagem: 'para a listagem', sessaoId: sessao,
      stackBruta: 'at boot (build-7.js:3:3)', origem: OrigemDeErro.BOOT,
      contexto: { atlasKind: 'publico', status: 503 },
    }).expect(204);

    const res = await supertest(app)
      .get('/api/v1/diag/erros-cliente?desde=1h&limite=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const item = res.body.data.itens.find((i) => i.assinatura === a);
    assert.ok(item, 'a linha recém-escrita precisa aparecer');
    assert.equal(item.sessaoId, sessao);
    assert.equal(item.stackBruta, 'at boot (build-7.js:3:3)');
    assert.equal(item.origem, 'boot');
    assert.deepEqual(item.contexto, { atlasKind: 'publico', status: 503 });
  });

  it('a linha SEM os campos os publica como null, e não como chave ausente', async () => {
    // `null` aqui significa uma coisa só ("o cliente não declarou"), ao contrário da
    // metade A, onde a chave ausente distingue "servidor antigo" de "zero endereços".
    const a = assinatura('listagem-vazia');
    await relatar({ assinatura: a, mensagem: 'sem contexto' }).expect(204);

    const res = await supertest(app)
      .get('/api/v1/diag/erros-cliente?desde=1h&limite=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const item = res.body.data.itens.find((i) => i.assinatura === a);
    assert.ok(item);
    assert.equal(item.sessaoId, null);
    assert.equal(item.stackBruta, null);
    assert.equal(item.origem, null);
    assert.equal(item.contexto, null);
  });
});
