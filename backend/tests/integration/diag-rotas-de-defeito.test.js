// Path: tests/integration/diag-rotas-de-defeito.test.js
// `GET /diag/defeitos` (a listagem nova, com ciclo de vida e filtros) e a prova de que
// `GET /diag/erros-cliente` continua respondendo EXATAMENTE o que respondia antes da
// renomeação da tabela.
//
// O PAR COMPLETO DO GATE está aqui, e ele é o que a casa exige de todo filtro de acesso: o
// negativo (anônimo 401, usuário comum 403) E o positivo do mesmo par (administrador 200
// vendo as linhas semeadas). O negativo sozinho passaria idêntico se a rota sumisse, se a
// fixture não existisse ou se o filtro passasse a negar tudo.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - trocar `origem IS DISTINCT FROM 'servidor'` por `origem <> 'servidor'` em
//    `LIST_ERROS_CLIENTE`: o caso da compatibilidade fica vermelho, porque
//    `NULL <> 'servidor'` é NULL e a esmagadora maioria das linhas (origem não declarada)
//    sumiria da lista, deixando a tela com cara de "quase não há erro de navegador";
//  - tirar o recorte inteiro: o mesmo caso fica vermelho pelo outro lado, com o erro de
//    SERVIDOR aparecendo numa tela que diz "erros do navegador";
//  - deixar um filtro cair no SQL como `undefined`: o caso de cada filtro fica vermelho, e o
//    modo de falha real seria ZERO linhas, calado (o `NOT $6::boolean` de `novos` avalia NULL);
//  - divergir o predicado do total do predicado do corpo: o caso do total fica vermelho, e a
//    tela passaria a anunciar "50 de 400" ao lado de uma lista de 3.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('GET /diag/defeitos e a compatibilidade de /diag/erros-cliente', () => {
  let app, db, comum, comumToken, admin, adminToken;
  const marca = randomUUID().slice(0, 8);
  const assinaturas = [];

  function assinatura(nome) {
    const a = `TypeError | ${nome} | ${marca}`;
    assinaturas.push(a);
    return a;
  }

  /** Semeia direto no banco: aqui o assunto é a LEITURA, não o caminho de escrita. */
  async function semear(nome, campos = {}) {
    const a = assinatura(nome);
    // `pagina` carrega a MARCA por padrão, e `listar` filtra por ela quando a query não traz
    // outra: sem isso o recorte "só os desta rodada" era estatístico, porque o `LIMIT 200` é
    // aplicado no SQL ANTES do `meus()`, e uma tabela compartilhada com mais de 200 linhas
    // recentes (outros arquivos desta suíte, ou o resíduo de um `--reuse-db`) tiraria a linha
    // semeada da resposta e o caso reprovaria apontando para longe da causa.
    const {
      estado = 'aberto', origem = null, release = null, pagina = `p-${marca}`,
      ocorrencias = 1, idadeDias = 0, nascidoHaDias = null,
    } = campos;
    await db.query(
      `INSERT INTO defeitos
         (assinatura, mensagem, estado, origem, release, pagina, ocorrencias,
          primeira_release, ultima_release, primeira_em, ultima_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $5, $5,
               NOW() - ($8::int * INTERVAL '1 day'),
               NOW() - ($9::int * INTERVAL '1 day'))`,
      [a, `mensagem de ${nome}`, estado, origem, release, pagina, ocorrencias,
        nascidoHaDias ?? idadeDias, idadeDias]
    );
    return a;
  }

  /** Acrescenta o recorte por marca quando a query não escolhe uma `pagina` própria. */
  const comMarca = (query) => (/[?&]pagina=/.test(query) ? query : `${query}&pagina=p-${marca}`);

  const listar = (query, token = adminToken) => supertest(app)
    .get(`/api/v1/diag/defeitos${comMarca(query)}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200)
    .then((res) => res.body.data);

  /** Só os desta rodada: a tabela é compartilhada. */
  const meus = (dados) => dados.itens.filter((i) => i.assinatura.includes(marca));

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    comum = await createUser(db, { username: `df_user_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `df_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
  });

  it('anônimo leva 401 e usuário comum leva 403', async () => {
    await supertest(app).get('/api/v1/diag/defeitos').expect(401);
    await supertest(app).get('/api/v1/diag/defeitos')
      .set('Authorization', `Bearer ${comumToken}`).expect(403);
  });

  it('o administrador vê o defeito com o ciclo de vida inteiro no item', async () => {
    const a = await semear('item-completo', {
      estado: 'resolvido', origem: 'store', release: 'v3', ocorrencias: 7,
    });
    await db.query(
      `UPDATE defeitos
          SET resolvido_em = NOW(), resolvido_por = $2,
              resolvido_na_release = 'v3', resolvido_no_commit = 'abc1234'
        WHERE assinatura = $1`,
      [a, admin.id]
    );

    const item = meus(await listar('?desde=1h&limite=200')).find((i) => i.assinatura === a);
    assert.ok(item, 'o defeito semeado precisa aparecer');
    assert.equal(item.estado, 'resolvido');
    assert.equal(typeof item.resolvidoEm, 'number', 'epoch ms, como toda data desta família');
    assert.equal(item.resolvidoPor, admin.id);
    assert.equal(item.resolvidoPorUsername, admin.username, 'o segundo LEFT JOIN traz o nome');
    assert.equal(item.resolvidoNaRelease, 'v3');
    assert.equal(item.resolvidoNoCommit, 'abc1234');
    assert.equal(item.primeiraRelease, 'v3');
    assert.equal(item.ultimaRelease, 'v3');
    assert.equal(item.ocorrencias, 7);
    assert.equal(item.origem, 'store');
  });

  it('quem NUNCA foi resolvido traz os quatro campos nulos, e não a chave ausente', async () => {
    const a = await semear('nunca-resolvido');
    const item = meus(await listar('?desde=1h&limite=200')).find((i) => i.assinatura === a);
    assert.equal(item.estado, 'aberto');
    assert.equal(item.resolvidoEm, null);
    assert.equal(item.resolvidoPor, null);
    assert.equal(item.resolvidoPorUsername, null);
    assert.equal(item.resolvidoNoCommit, null);
  });

  it('o filtro `estado` recorta, e o valor inventado é 422 na borda', async () => {
    const aberto = await semear('filtro-aberto', { estado: 'aberto' });
    const regrediu = await semear('filtro-regrediu', { estado: 'regrediu' });

    const so = meus(await listar('?desde=1h&limite=200&estado=regrediu')).map((i) => i.assinatura);
    assert.deepEqual(so, [regrediu]);
    assert.equal(so.includes(aberto), false);

    // E sem o filtro, os dois voltam: sem este par o caso passaria com um recorte que nega tudo.
    const todos = meus(await listar('?desde=1h&limite=200')).map((i) => i.assinatura);
    assert.ok(todos.includes(aberto) && todos.includes(regrediu));

    await supertest(app).get('/api/v1/diag/defeitos?estado=zumbi')
      .set('Authorization', `Bearer ${adminToken}`).expect(422);
  });

  it('os filtros de origem, release e página recortam cada um o seu eixo', async () => {
    const doServidor = await semear('filtro-servidor', { origem: 'servidor', release: 'v9' });
    const doCliente = await semear('filtro-cliente', { origem: 'maplibre', release: 'v8' });
    // O eixo de PÁGINA precisa de semente própria, porque as demais carregam a página da marca
    // (é ela que faz o recorte desta rodada) e um filtro que casasse todas não discriminaria.
    const daPagina = await semear('filtro-pagina', { origem: 'maplibre', pagina: `pagina-${marca}` });

    const porOrigem = meus(await listar('?desde=1h&limite=200&origem=servidor')).map((i) => i.assinatura);
    assert.deepEqual(porOrigem, [doServidor]);

    const porRelease = meus(await listar('?desde=1h&limite=200&release=v8')).map((i) => i.assinatura);
    assert.deepEqual(porRelease, [doCliente]);

    const porPagina = meus(await listar(`?desde=1h&limite=200&pagina=pagina-${marca}`))
      .map((i) => i.assinatura);
    assert.deepEqual(porPagina, [daPagina]);
  });

  it('`novos=1` usa a MESMA janela: nascido dentro dela, não num período próprio', async () => {
    // Um defeito CRÔNICO: nasceu há 5 dias e ocorreu agora. Ele é o caso mais valioso da
    // tabela e precisa continuar aparecendo na listagem sem o filtro.
    const cronico = await semear('cronico', { idadeDias: 0, nascidoHaDias: 5 });
    const novo = await semear('recem-nascido', { idadeDias: 0, nascidoHaDias: 0 });

    const semFiltro = meus(await listar('?desde=7d&limite=200')).map((i) => i.assinatura);
    assert.ok(semFiltro.includes(cronico) && semFiltro.includes(novo));

    const soNovos = meus(await listar('?desde=1h&limite=200&novos=1')).map((i) => i.assinatura);
    assert.ok(soNovos.includes(novo));
    assert.equal(soNovos.includes(cronico), false, 'o crônico não é novo dentro da última hora');

    // E `novos=1` sobre uma janela LARGA volta a incluir o crônico: o filtro é relativo à
    // janela, não a um período próprio.
    const janelaLarga = meus(await listar('?desde=7d&limite=200&novos=1')).map((i) => i.assinatura);
    assert.ok(janelaLarga.includes(cronico));
  });

  it('a janela corta por `ultima_em`, e o total é o de ANTES do corte por limite', async () => {
    const antigo = await semear('antigo-2-dias', { idadeDias: 2 });
    const perto = meus(await listar('?desde=1h&limite=200')).map((i) => i.assinatura);
    assert.equal(perto.includes(antigo), false);
    const longe = meus(await listar('?desde=7d&limite=200')).map((i) => i.assinatura);
    assert.equal(longe.includes(antigo), true);

    // O total responde sobre a JANELA, e a lista sobre o limite: sem ele, "1 defeito" seria
    // indistinguível de "1 de 400", e quem lê concluiria que viu tudo.
    const cortado = await listar('?desde=7d&limite=1');
    assert.equal(cortado.itens.length, 1);
    assert.ok(cortado.totalDefeitos > 1, `o total precisa ser o de antes do corte, veio ${cortado.totalDefeitos}`);
  });

  it('o total obedece ao MESMO predicado da lista: filtrar estreita os dois juntos', async () => {
    await semear('total-a', { estado: 'ignorado', release: 'v-total' });
    await semear('total-b', { estado: 'ignorado', release: 'v-total' });
    await semear('total-c', { estado: 'aberto', release: 'v-total' });

    const filtrado = await listar('?desde=1h&limite=200&release=v-total&estado=ignorado');
    assert.equal(filtrado.itens.length, 2);
    assert.equal(filtrado.totalDefeitos, 2, 'total e lista precisam contar a MESMA coisa');
  });

  it('a listagem vem da mais recente para a mais antiga', async () => {
    const primeiro = await semear('ordem-1', { idadeDias: 3 });
    const segundo = await semear('ordem-2', { idadeDias: 1 });
    const ordem = meus(await listar('?desde=7d&limite=200')).map((i) => i.assinatura);
    assert.ok(ordem.indexOf(segundo) < ordem.indexOf(primeiro));
  });

  it('a janela acima do teto de 7 dias é 422, com a mensagem que aponta o comando', async () => {
    const res = await supertest(app).get('/api/v1/diag/defeitos?desde=30d')
      .set('Authorization', `Bearer ${adminToken}`).expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  // ── a rota transitória, que precisa continuar respondendo o mesmo ──

  it('`erros-cliente` mantém o shape ANTIGO, chave por chave', async () => {
    const a = await semear('shape-antigo', { origem: 'console', release: 'v1', pagina: 'atlas' });
    const res = await supertest(app)
      .get('/api/v1/diag/erros-cliente?desde=1h&limite=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const dados = res.body.data;
    assert.deepEqual(Object.keys(dados).sort(), ['desde', 'itens', 'totalAssinaturas']);
    const item = dados.itens.find((i) => i.assinatura === a);
    assert.ok(item, 'a linha semeada precisa aparecer');
    assert.deepEqual(Object.keys(item).sort(), [
      'assinatura', 'atlasId', 'contexto', 'id', 'mensagem', 'ocorrencias', 'origem',
      'pagina', 'primeiraEm', 'release', 'sessaoId', 'stack', 'stackBruta', 'ultimaEm',
      'url', 'userAgent', 'userId', 'username',
    ], 'o shape congelado da rota transitória mudou');
    // As colunas do lote B NÃO vazam para esta rota: ela é a de antes.
    assert.equal(Object.hasOwn(item, 'estado'), false);
    assert.equal(Object.hasOwn(item, 'primeiraRelease'), false);
  });

  it('`erros-cliente` NÃO mostra o defeito de servidor, e o `IS DISTINCT FROM` é o motivo', async () => {
    const doServidor = await semear('cliente-nao-ve-servidor', { origem: 'servidor' });
    const semOrigem = await semear('cliente-sem-origem-declarada', { origem: null });
    const doCliente = await semear('cliente-com-origem', { origem: 'ws' });

    const res = await supertest(app)
      .get('/api/v1/diag/erros-cliente?desde=1h&limite=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const vistas = res.body.data.itens.map((i) => i.assinatura);

    assert.equal(vistas.includes(doServidor), false, 'o erro de servidor não é do navegador');
    // A METADE QUE UM `<>` QUEBRARIA, e ela é a maioria das linhas: origem não declarada.
    assert.equal(vistas.includes(semOrigem), true, '`NULL <> servidor` é NULL: some tudo');
    assert.equal(vistas.includes(doCliente), true);

    // E a rota nova enxerga os três, porque lá o recorte é escolha de quem consulta.
    const todos = meus(await listar('?desde=1h&limite=200')).map((i) => i.assinatura);
    assert.ok([doServidor, semOrigem, doCliente].every((s) => todos.includes(s)));
  });

  it('`erros-cliente` mantém os gates: anônimo 401, comum 403', async () => {
    await supertest(app).get('/api/v1/diag/erros-cliente').expect(401);
    await supertest(app).get('/api/v1/diag/erros-cliente')
      .set('Authorization', `Bearer ${comumToken}`).expect(403);
  });
});
