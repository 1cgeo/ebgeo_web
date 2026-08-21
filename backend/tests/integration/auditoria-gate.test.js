// Path: tests/integration/auditoria-gate.test.js
//
// O GATE DE LEITURA DA TRILHA TEM DOIS RAMOS, E O CREDENCIADO NÃO É UM DELES.
//
// `requireAuditReader` substituiu `requireAdmin` em `GET /api/v1/audit`. Os dois ramos
// são administrador (trilha inteira) e produtor (a OM dele). O credenciado — o papel
// definido como "lê TODO recurso privado e não escreve nada" — leva 403, e a distinção
// é o ponto: ler acervo privado e ler o REGISTRO DE ATOS sobre contas, atlas,
// configuração e permissões são coisas diferentes.
//
// O CONTROLE NEGATIVO que este arquivo prende: trocar o gate por um baseado em
// `fn_has_global_data_access` (o predicado do eixo de DADO, que inclui o credenciado)
// faz o caso do credenciado virar 200. Foi exatamente essa confusão que a fase F9 já
// pagou uma vez em `requireGrantRevoker`.
//
// O PISO VEM PRIMEIRO: o administrador recebe 200 com pelo menos uma linha. Sem ele, os
// 403 dos outros não provam nada — uma rota quebrada devolve erro para todo mundo.
//
// AS DUAS OM DO PRODUTOR SÃO DIFERENTES, E ISSO É O CONTRÁRIO DE UM DETALHE DE FIXTURE.
// `users.organization_id` (LOTAÇÃO) e `users.producer_org_id` (PRODUÇÃO) são colunas
// independentes, e o gate confere a vida das DUAS, espelhando `fn_can_produce_resource`.
// Enquanto a fixture usava a MESMA OM nos dois papéis, desativá-la derrubava os dois
// termos ao mesmo tempo e o 403 não dizia qual deles agira: a revisão adversarial mediu
// que, com duas OM distintas, desativar a PRODUTORA deixava o produtor lendo a trilha do
// acervo que ele já não podia manter. Era um kill-switch que fechava a escrita e deixava
// a leitura aberta. Cada termo tem caso próprio abaixo, e é a separação das duas OM que
// os faz discriminar alguma coisa.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

describe('Auditoria — os quatro ramos do gate de leitura', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgLotacao, orgProducao, orgAdmin;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM gate ${rotulo} ${sufixo}`, `om-gate-${rotulo}-${sufixo}`,
        `${rotulo}${sufixo.slice(0, 3)}`],
    )).rows[0].id;
    orgLotacao = await criaOrg('L');
    orgProducao = await criaOrg('P');
    orgAdmin = await criaOrg('A');

    atores.admin = await createAdminUser(db, {
      username: `gate_admin_${sufixo}`, organization_id: orgAdmin,
    });
    atores.credenciado = await createUser(db, {
      username: `gate_cred_${sufixo}`, role: 'credenciado',
    });
    atores.comum = await createUser(db, { username: `gate_comum_${sufixo}` });
    // AS DUAS OM DELE SÃO DISTINTAS, e nenhuma é a `default` que o fixture usa: os casos
    // de liveness abaixo DESATIVAM uma OM de cada vez, e com a `default` isso derrubaria
    // o administrador e o credenciado junto. A primeira versão deste arquivo fez
    // exatamente isso, e o sintoma (o administrador levando 403 três casos depois) não
    // apontava para a causa. A segunda usou a mesma OM nos dois papéis, e aí o 403 não
    // discriminava qual dos termos o produziu.
    atores.produtor = await createProducerUser(db, orgProducao, {
      username: `gate_prod_${sufixo}`, organization_id: orgLotacao,
    });
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('piso: o administrador recebe 200 com pelo menos uma linha', async () => {
    const res = await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.ok(
      res.body.data.data.length >= 1,
      'sem linha nenhuma, os 403 abaixo seriam indistinguíveis de uma rota quebrada',
    );
  });

  it('anônimo é 401 (autenticação), não 403 (autorização)', async () => {
    await supertest(app).get('/api/v1/audit').expect(401);
  });

  it('o usuário comum é 403', async () => {
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.comum}`).expect(403);
  });

  it('o CREDENCIADO é 403 — ele lê todo recurso privado e mesmo assim não lê a trilha', async () => {
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.credenciado}`).expect(403);

    // A METADE QUE IMPEDE A LEITURA ERRADA: o 403 acima não é "o credenciado não tem
    // nada". Ele continua enxergando o eixo de recurso privado, no mesmo instante e com
    // o mesmo token. Sem isto, uma fixture com credenciado quebrado passaria igual.
    await supertest(app).get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens.credenciado}`).expect(200);
  });

  it('o PRODUTOR é 200 — e essa é a mudança que o lote trouxe', async () => {
    const res = await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.produtor}`)
      .expect(200);
    assert.equal(res.body.data.administra, false);
    assert.equal(res.body.data.escopoOrgId, orgProducao, 'o escopo é a OM de PRODUÇÃO');
  });

  it('produtor DESATIVADO perde a trilha, e os DOIS caminhos dão códigos diferentes', async () => {
    // MEDIDO, E OS NÚMEROS CONTRARIAM A EXPECTATIVA COM QUE ESTE CASO FOI ESCRITO. Ele
    // pedia 403 nos dois e recebeu 401 no primeiro: a reconciliação ao vivo do `auth`
    // (`org-status.js`) roda ANTES do gate e já derruba a SESSÃO de conta desativada,
    // enquanto a OM de LOTAÇÃO desativada atravessa o `auth` e morre no gate. Os dois
    // resultados estão certos, e escrever os códigos aqui é o que impede a próxima
    // revisão de "consertar" o 401.
    //
    // O QUE IMPORTA PARA O PRODUTO é o mesmo nos dois: quem foi suspenso não lê a trilha.
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [atores.produtor.id]);
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.produtor}`).expect(401);
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [atores.produtor.id]);

    // Volta a 200 — sem esta linha, o 401 acima poderia ser um token inválido por
    // qualquer outra razão, e o caso não discriminaria nada.
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.produtor}`).expect(200);

    // A OM DE LOTAÇÃO é a SEGUNDA coluna do predicado, e ela aponta para uma organização
    // DIFERENTE da de produção: desativá-la suspende a pessoa, e é o gate que recusa.
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgLotacao]);
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.produtor}`).expect(403);
    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [orgLotacao]);
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.produtor}`).expect(200);

    // A OM PRODUTORA é a TERCEIRA, e era a que faltava. Desativá-la faz
    // `fn_can_produce_resource` devolver `false` — a pessoa deixa de poder manter o
    // acervo daquela OM —, e sem este termo ela continuava LENDO a trilha dele. As duas
    // asserções andam juntas de propósito: a primeira mede o predicado que o gate diz
    // espelhar, por caminho independente da rota, e a segunda mede o gate.
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgProducao]);
    const podeProduzir = await db.query(
      'SELECT fn_can_produce_resource($1::uuid, $2::text, $3::text) AS ok',
      [atores.produtor.id, 'tileset', 'inexistente'],
    );
    assert.equal(podeProduzir.rows[0].ok, false, 'piso do espelho: ele já não produz');
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.produtor}`).expect(403);
    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [orgProducao]);
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.produtor}`).expect(200);

    // A DISCRIMINAÇÃO que a primeira versão deste arquivo não tinha: o administrador,
    // no mesmo instante, continua com 200. Sem ela, "desativei a OM e tudo caiu" seria
    // indistinguível de "o predicado passou a negar todo mundo" — que foi literalmente
    // o que aconteceu quando a lotação do produtor era a OM `default` compartilhada.
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.admin}`).expect(200);
  });

  it('o gate SOZINHO recusa o produtor desativado (o ramo que o `auth` esconde)', async () => {
    // O CAMINHO INDEPENDENTE daquele que produziu o resultado acima: aqui o `auth` não
    // roda, e o que se mede é o predicado do middleware. Sem este caso, os dois termos
    // de liveness de `requireAuditReader` seriam código que nenhum teste alcança — e
    // apagá-los deixaria tudo verde.
    const { requireAuditReader } = await import('../../src/middleware/require-audit-reader.js');
    const chamar = (user) => new Promise((resolve) => {
      const req = { user };
      requireAuditReader(req, {}, (err) => resolve({ err, escopo: req.auditScope }));
    });

    const vivo = await chamar({ id: atores.produtor.id });
    assert.equal(vivo.err, undefined, 'piso: com a conta viva o gate deixa passar');
    assert.deepEqual(vivo.escopo, { administra: false, orgId: orgProducao });

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [atores.produtor.id]);
    const morto = await chamar({ id: atores.produtor.id });
    assert.equal(morto.err?.statusCode ?? morto.err?.status, 403);
    assert.deepEqual(morto.escopo, { administra: false, orgId: null }, 'falha FECHADA');
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [atores.produtor.id]);

    // AS DUAS OM, uma de cada vez, porque são colunas diferentes e termos diferentes do
    // mesmo `WHERE`. Apagar UM dos dois termos precisa ficar vermelho sozinho; com a
    // mesma OM nos dois papéis, apagar qualquer um deles continuaria verde pelo outro.
    for (const [rotulo, alvo] of [['lotação', orgLotacao], ['produtora', orgProducao]]) {
      await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [alvo]);
      const semOm = await chamar({ id: atores.produtor.id });
      assert.equal(
        semOm.err?.statusCode ?? semOm.err?.status, 403,
        `a OM de ${rotulo} desativada precisa derrubar o gate sozinha`,
      );
      assert.deepEqual(semOm.escopo, { administra: false, orgId: null }, 'falha FECHADA');
      await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [alvo]);
      const devolta = await chamar({ id: atores.produtor.id });
      assert.equal(devolta.err, undefined, `e reativar a OM de ${rotulo} devolve a leitura`);
    }

    // E sem principal nenhum é 401, nunca 403: ausência de credencial é autenticação.
    const anonimo = await chamar(null);
    assert.equal(anonimo.err?.statusCode ?? anonimo.err?.status, 401);
  });

  it('a lotação do ADMINISTRADOR: quem o derruba é o `auth`, não este gate', async () => {
    // MEDIDO PORQUE UMA REVISÃO APOSTOU NO CONTRÁRIO, e a aposta era razoável: o termo da
    // lotação fica FORA do ramo do produtor no `WHERE`, então ele vale para
    // `u.role = 'admin'` também, e daí se concluiu que administrador com lotação
    // desativada manteria `GET /users` (`requireAdmin`, que decide pelo JWT) e perderia
    // `GET /audit`. A medição diz outra coisa: os DOIS respondem 403, porque a
    // reconciliação ao vivo do `auth` (`utils/org-status.js`, `LIVE_AUTH_STATE`) roda
    // antes de qualquer gate e já barra membro de OM desativada. Não há divergência de
    // comportamento entre os dois middlewares pela rota.
    //
    // O TERMO NO GATE NÃO É REDUNDANTE POR ISSO: ele é a segunda linha de defesa e o
    // que mantém o espelho de `fn_can_produce_resource` fiel quando o middleware é
    // chamado sozinho — que é como o serviço o exercita e como um caminho futuro sem
    // `auth` estrito o exercitaria. A segunda metade do caso mede exatamente isso, por
    // caminho independente da rota.
    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgAdmin]);
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.admin}`).expect(403);
    await supertest(app).get('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`).expect(403);

    const { requireAuditReader } = await import('../../src/middleware/require-audit-reader.js');
    const chamar = (user) => new Promise((resolve) => {
      const req = { user };
      requireAuditReader(req, {}, (err) => resolve({ err, escopo: req.auditScope }));
    });
    const semLotacao = await chamar({ id: atores.admin.id });
    assert.equal(
      semLotacao.err?.statusCode ?? semLotacao.err?.status, 403,
      'o gate sozinho recusa o administrador de lotação desativada, como '
      + '`fn_can_produce_resource` (cujo `WHERE` derruba antes do `IF v_role = admin`)',
    );

    // O PAR DE VOLTA, sem o qual os 403 acima poderiam ser qualquer coisa.
    await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [orgAdmin]);
    await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.admin}`).expect(200);
    await supertest(app).get('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`).expect(200);
    const comLotacao = await chamar({ id: atores.admin.id });
    assert.equal(comLotacao.err, undefined);
    assert.deepEqual(comLotacao.escopo, { administra: true, orgId: null });
  });

  it('a resposta MARCA escopo de cache: ela passou a variar por chamador', async () => {
    // O CONTROLLER GANHOU `marcarEscopoJson` com uma justificativa de segurança e
    // nenhuma verificação — medido: apagar a linha reporia a trilha inteira do
    // administrador para um produtor num cache compartilhado, e todo o `npm test`
    // continuaria verde. A rota está declarada FORA de `CENSO_REGIME`, que é a única
    // lista que cobra marcador de regime, então a frase do censo era prosa.
    const doAdmin = await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.admin}`).expect(200);
    assert.match(
      String(doAdmin.headers['cache-control'] ?? ''), /private/,
      'sem `Cache-Control: private`, o RFC 9111 autoriza um cache compartilhado a guardar '
      + 'por heurística e repor a trilha do administrador para o produtor (a isenção do '
      + 'RFC para `Authorization` não cobre a autenticação por cookie)',
    );
    const doProdutor = await supertest(app).get('/api/v1/audit')
      .set('Authorization', `Bearer ${tokens.produtor}`).expect(200);
    assert.match(String(doProdutor.headers['cache-control'] ?? ''), /private/);

    // A DISCRIMINAÇÃO, e ela é o que impede este caso de estar medindo um cabeçalho
    // GLOBAL do app: uma rota vizinha, autenticada e na mesma origem, que NÃO marca.
    const vizinha = await supertest(app).get('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.admin}`).expect(200);
    assert.ok(
      !/private/.test(String(vizinha.headers['cache-control'] ?? '')),
      'se `GET /users` também viesse `private`, o marcador viria de um middleware global '
      + 'e as asserções acima não provariam nada sobre este controller',
    );
  });

  it('o 403 de papel vem ANTES do 422 de query: o gate roda antes do validate', async () => {
    // A ordem é contrato na rota. Quem não lê a trilha não precisa saber que a query
    // dele estava malformada — e um 422 aqui diria que o gate rodou depois.
    await supertest(app).get('/api/v1/audit?limit=999')
      .set('Authorization', `Bearer ${tokens.comum}`).expect(403);
    // A discriminação: para quem PASSA no gate, o 422 continua acontecendo.
    await supertest(app).get('/api/v1/audit?limit=999')
      .set('Authorization', `Bearer ${tokens.admin}`).expect(422);
  });
});
