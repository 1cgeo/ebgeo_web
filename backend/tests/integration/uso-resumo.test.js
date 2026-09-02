// Path: tests/integration/uso-resumo.test.js
//
// `GET /uso/resumo`: o relatório de uso, que é CONSULTA sobre `operations`, `audit_trail`,
// `users` e `atlas` — não instrumentação nova. Gate completo (anônimo 401, comum 403,
// produtor 403, credenciado 403, administrador 200) e os NÚMEROS contra dado semeado.
//
// AS DUAS METADES DE COORTE DA MESMA ROTA (o funil de entrada e a retenção por semana de
// cadastro) moram em `uso-funil-e-retencao.test.js`, e a separação é por CENÁRIO e não por
// assunto: elas precisam de contas nascendo em semanas ISO distintas e de conversão
// acontecendo DEPOIS do fim da janela, que é o oposto do que este arquivo semeia. Aqui delas
// fica só a FORMA no caso do contrato.
//
// COMO ESTE ARQUIVO CONSEGUE ASSERIR NÚMERO EXATO NUMA TABELA COMPARTILHADA, que é a
// pergunta difícil: as tabelas são da rodada inteira e toda outra suíte escreve nelas com
// `NOW()`. A saída é a `agora` INJETÁVEL do serviço. Os casos de conteúdo semeiam dado num
// intervalo do ANO 2001 e pedem o relatório com o fim da janela fixado lá, de modo que a
// janela não contém uma única linha que não seja deste arquivo. Não é truque de teste: a
// injeção existe em produção para que as cinco consultas respondam sobre o MESMO intervalo
// (ver o cabeçalho de `uso.queries.js`), e é a mesma propriedade que torna a medição
// determinística aqui.
//
// Os dois números que NÃO têm janela (`pessoas.contasAtivas` e `atlas.vivos`) são estado de
// hoje, e para eles a asserção é de DELTA entre duas leituras do mesmo caso — o corredor
// roda os arquivos em série (`--test-concurrency=1`), então nada escreve entre as duas.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - tirar o `requireAdmin` da rota: os três casos de 403 (comum, produtor, credenciado)
//    passam a 200, e o do produtor/credenciado é o que um `role !== 'user'` deixaria passar
//    em silêncio;
//  - trocar o `generate_series` por um `GROUP BY` direto sobre `operations`: a série perde
//    os dias sem operação e o caso do dia com ZERO reprova nomeando o comprimento;
//  - tirar o `created_at >= $1` do agregado da série diária: o primeiro balde passa a pegar
//    o dia de calendário inteiro, a operação semeada UMA HORA ANTES do início entra na
//    conta, e o caso "a soma da série é igual ao total" reprova com 7 contra 6 (medido);
//
// O QUE ESTE ARQUIVO **NÃO** DISCRIMINA, declarado porque um controle negativo que não
// existe é pior do que nenhum: o `COALESCE(p.total, 0)` da série diária. Tirá-lo mantém a
// suíte verde, porque `inteiro()` no serviço já converte o `null` do `LEFT JOIN` em zero
// antes do payload. A garantia é aquela, não esta; o motivo de o `COALESCE` ficar está no
// comentário da própria consulta.
//  - trocar `MIN(created_at)` por `MIN(created_at) FILTER (WHERE created_at >= $1)`, que é
//    a "simplificação" natural de quem lê a consulta do horizonte achando que ela é da
//    janela: o horizonte passa a ser o começo da janela SEMPRE, os dois casos de horizonte
//    reprovam, e sem eles um pedido de 30 dias respondido sobre 7 nunca mais avisaria;
//  - trocar `COUNT(DISTINCT actor_id)` por `COUNT(*)` em `entraram`: as três entradas do
//    mesmo usuário passam a contar três, e o número deixa de ser "pessoas";
//  - trocar o filtro `action = 'LOGIN'` por qualquer coisa mais larga: a linha de `LOGOUT`
//    semeada entra na conta;
//  - deixar de emitir `LOGIN` em `auth.controller.js`: o caso "a ação TEM emissor" reprova.
//    Ele existe por causa da armadilha declarada em `002_auditoria.sql` — `LOGIN` esteve
//    declarada no CHECK e sem emissor desde o primeiro dia, e um filtro por ela devolvia
//    lista vazia com cara de resposta. Sem este caso, `entraram` poderia valer zero para
//    sempre e a suíte ficaria verde, porque as linhas dos outros casos são semeadas à mão.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createProducerUser, loginUser } from '../helpers/fixtures.js';
import * as usoService from '../../src/modules/uso/uso.service.js';

const ORG_PADRAO = '00000000-0000-0000-0000-000000000001';

/** O fim da janela dos casos de conteúdo. Longe de qualquer `NOW()` de outra suíte. */
const FIM = new Date('2001-06-10T12:00:00.000Z');
/** O início da janela de 7d correspondente. */
const INICIO = new Date('2001-06-03T12:00:00.000Z');
/** Uma hora ANTES do início: é o que prova que o primeiro dia da série é PARCIAL. */
const ANTES = new Date('2001-06-03T11:00:00.000Z');

const maisTarde = (base, horas) => new Date(base.getTime() + horas * 3_600_000);

describe('Relatório de uso — GET /uso/resumo', () => {
  let app, db;
  let admin, adminToken, comum, comumToken, produtor, produtorToken, credenciado, credenciadoToken;
  // Os três autores do dado do ano 2001.
  let autorA, autorB, autorC;
  let atlasNovo, atlasApagado, atlasIntocado;

  const marca = randomUUID().slice(0, 8);
  const usuariosSemeados = [];
  const atlasSemeados = [];

  /** Um usuário do cenário de 2001, com `created_at` posto à mão. */
  async function usuarioEm(nome, nascidoEm) {
    const u = await createUser(db, { username: `uso_${nome}_${marca}` });
    await db.query('UPDATE users SET created_at = $1 WHERE id = $2', [nascidoEm, u.id]);
    usuariosSemeados.push(u.id);
    return u;
  }

  /** Um atlas do cenário de 2001. `created_at`/`deleted_at` não passam pela fixture. */
  async function atlasEm(nome, criadoEm, apagadoEm = null) {
    const { rows } = await db.query(
      `INSERT INTO atlas (name, owner_id, created_at, deleted_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [`Uso ${nome} ${marca}`, autorA.id, criadoEm, apagadoEm]
    );
    atlasSemeados.push(rows[0].id);
    return rows[0];
  }

  async function opEm(atlasId, entidade, autorId, quando) {
    await db.query(
      `INSERT INTO operations
         (atlas_id, op_type, entity_type, entity_id, client_timestamp, client_id, user_id, created_at)
       VALUES ($1, 'create', $2, gen_random_uuid(), $3, $4, $5, $6)`,
      [atlasId, entidade, quando.getTime(), `cli_${marca}`, autorId, quando]
    );
  }

  async function trilhaEm(acao, atorId, quando) {
    await db.query(
      `INSERT INTO audit_trail (action, actor_id, target_type, target_id, ip, created_at)
       VALUES ($1, $2, 'USER', $3, '127.0.0.1', $4)`,
      [acao, atorId, atorId, quando]
    );
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `uso_adm_${marca}` });
    comum = await createUser(db, { username: `uso_usr_${marca}` });
    produtor = await createProducerUser(db, ORG_PADRAO, { username: `uso_prd_${marca}` });
    credenciado = await createUser(db, { username: `uso_cre_${marca}`, role: 'credenciado' });
    usuariosSemeados.push(admin.id, comum.id, produtor.id, credenciado.id);

    adminToken = await loginUser(app, admin.username, admin.password);
    comumToken = await loginUser(app, comum.username, comum.password);
    produtorToken = await loginUser(app, produtor.username, produtor.password);
    credenciadoToken = await loginUser(app, credenciado.username, credenciado.password);

    // ---- o cenário do ano 2001 ------------------------------------------------------
    // DUAS contas nascem DENTRO da janela e uma ANTES: `novasContas` é 2.
    autorA = await usuarioEm('a', maisTarde(INICIO, 2));
    autorB = await usuarioEm('b', maisTarde(INICIO, 3));
    autorC = await usuarioEm('c', new Date('2001-01-01T00:00:00.000Z'));

    // Atlas: dois criados na janela (um deles ainda vivo), um criado antes e APAGADO nela.
    atlasNovo = await atlasEm('novo', maisTarde(INICIO, 2));
    atlasIntocado = await atlasEm('intocado', maisTarde(INICIO, 4));
    atlasApagado = await atlasEm(
      'apagado', new Date('2001-01-02T00:00:00.000Z'), maisTarde(INICIO, 5)
    );

    // A operação FORA da janela, uma hora antes do início. Ela existe por dois motivos: é
    // ela que fixa o `horizonte` de `operations`, e é ela que o primeiro balde da série
    // NÃO pode contar.
    await opEm(atlasNovo.id, 'feature', autorC.id, ANTES);

    // Dentro da janela: 4 no primeiro dia e 2 no último, com o miolo VAZIO de propósito.
    await opEm(atlasNovo.id, 'feature', autorA.id, maisTarde(INICIO, 1));
    await opEm(atlasNovo.id, 'feature', autorA.id, maisTarde(INICIO, 1));
    await opEm(atlasNovo.id, 'map', autorB.id, maisTarde(INICIO, 1));
    // Op SEM autor: `editaram` conta pessoas, e `COUNT(DISTINCT)` ignora NULL.
    await opEm(atlasNovo.id, 'feature', null, maisTarde(INICIO, 1));
    await opEm(atlasApagado.id, 'layer', autorA.id, maisTarde(FIM, -1));
    await opEm(atlasApagado.id, 'feature', autorA.id, maisTarde(FIM, -1));
    // `atlasIntocado` não recebe operação nenhuma: é ele que separa `vivos` de `comEdicao`
    // e que mantém o ranking com DOIS atlas, não três.

    // A trilha. Três LOGIN do mesmo ator + um de outro = DUAS pessoas; um LOGIN fora da
    // janela (que também fixa o horizonte da trilha) e um LOGOUT dentro, que não conta.
    await trilhaEm('LOGIN', autorA.id, new Date('2001-06-01T09:00:00.000Z'));
    await trilhaEm('LOGIN', autorA.id, maisTarde(INICIO, 2));
    await trilhaEm('LOGIN', autorA.id, maisTarde(INICIO, 3));
    await trilhaEm('LOGIN', autorA.id, maisTarde(INICIO, 4));
    await trilhaEm('LOGIN', autorB.id, maisTarde(INICIO, 5));
    await trilhaEm('LOGOUT', autorC.id, maisTarde(INICIO, 6));
  });

  after(async () => {
    // Apagar o atlas leva as operações junto (`ON DELETE CASCADE`), e é a única razão pela
    // qual este hard-delete é aceitável aqui: são linhas do ano 2001 que existem só para
    // este arquivo, e deixá-las mudaria o `horizonte` de qualquer leitura futura.
    if (atlasSemeados.length) {
      await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [atlasSemeados]);
    }
    if (usuariosSemeados.length) {
      await db.query('DELETE FROM audit_trail WHERE actor_id = ANY($1::uuid[])', [usuariosSemeados]);
    }
    await teardownTestEnv(db);
  });

  // ─────────────────────────── o gate, par completo ───────────────────────────
  describe('gate', () => {
    it('ANÔNIMO leva 401', async () => {
      await supertest(app).get('/api/v1/uso/resumo').expect(401);
    });

    it('usuário COMUM leva 403', async () => {
      await supertest(app)
        .get('/api/v1/uso/resumo')
        .set('Authorization', `Bearer ${comumToken}`)
        .expect(403);
    });

    it('PRODUTOR leva 403: manter o acervo da própria OM não é administrar o sistema', async () => {
      await supertest(app)
        .get('/api/v1/uso/resumo')
        .set('Authorization', `Bearer ${produtorToken}`)
        .expect(403);
    });

    it('CREDENCIADO leva 403: ler recurso privado não é ler o uso da instalação', async () => {
      // O caso que um `role !== 'user'` no gate deixaria passar em silêncio, que é o risco
      // INVERSO ao da lista fechada por atlas (backend/CLAUDE.md, "DOIS eixos").
      await supertest(app)
        .get('/api/v1/uso/resumo')
        .set('Authorization', `Bearer ${credenciadoToken}`)
        .expect(403);
    });

    it('ADMINISTRADOR vê, e o payload tem a forma do contrato', async () => {
      const res = await supertest(app)
        .get('/api/v1/uso/resumo')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const d = res.body.data;
      assert.equal(typeof d.desde, 'number');
      // O padrão é 30d, e ele precisa ser o padrão de verdade: sem `desde` na query, a
      // janela tem de ter 30 dias.
      const trintaDias = 30 * 86_400_000;
      const largura = Date.now() - d.desde;
      assert.ok(
        Math.abs(largura - trintaDias) < 60_000,
        `janela padrão deveria ter 30 dias, tem ${largura} ms`
      );

      // As DUAS chaves precisam EXISTIR mesmo quando valem null: o consumidor distingue
      // "não há dado" (null) de "servidor anterior não informou" (chave ausente), e são
      // avisos diferentes na tela.
      for (const chave of ['operacoesDesde', 'trilhaDesde']) {
        assert.ok(Object.hasOwn(d.horizonte, chave), `horizonte.${chave} ausente`);
      }
      for (const chave of ['contasAtivas', 'novasContas', 'entraram', 'editaram']) {
        assert.equal(typeof d.pessoas[chave], 'number', `pessoas.${chave} precisa ser número`);
      }
      for (const chave of ['vivos', 'criados', 'excluidos', 'comEdicao']) {
        assert.equal(typeof d.atlas[chave], 'number', `atlas.${chave} precisa ser número`);
      }
      assert.ok(Array.isArray(d.atlas.top));
      assert.equal(typeof d.producao.total, 'number');
      assert.ok(Array.isArray(d.producao.porEntidade));
      assert.ok(Array.isArray(d.producao.porDia));

      // Os dois blocos de COORTE. O comportamento deles está em
      // `uso-funil-e-retencao.test.js`, com cenário próprio; o que se prende AQUI é a
      // FORMA, porque é este o caso que responde "o payload do contrato tem tudo", e um
      // bloco que sumisse do serviço passaria por ele sem nada ficar vermelho.
      for (const chave of ['cadastraram', 'criaramAtlas', 'produziram']) {
        assert.equal(typeof d.funil[chave], 'number', `funil.${chave} precisa ser número`);
      }
      // As medianas precisam EXISTIR como chave mesmo valendo null, e a razão NÃO é a mesma
      // das duas do horizonte: lá a distinção chega à tela (são avisos diferentes), aqui não
      // chega, porque `medianaLabel`, no cliente, trata `null` e ausência do mesmo jeito. A
      // razão é de CONTRATO: sem esta asserção o campo pode sumir do payload numa reescrita
      // da consulta ou do mapeamento sem nada ficar vermelho.
      for (const chave of ['horasAteAtlas', 'horasAteProducao']) {
        assert.ok(Object.hasOwn(d.funil, chave), `funil.${chave} ausente`);
      }
      assert.ok(Array.isArray(d.retencao.semanas));
    });

    it('janela malformada é 422, e não um default silencioso', async () => {
      await supertest(app)
        .get('/api/v1/uso/resumo?desde=30dias')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(422);
    });

    it('acima do teto de 365d é 422', async () => {
      await supertest(app)
        .get('/api/v1/uso/resumo?desde=400d')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(422);
    });

    it('a janela grande PASSA até o teto: 365d é aceito', async () => {
      // O par do caso acima. Sem ele, um teto de 1d passaria os dois anteriores.
      await supertest(app)
        .get('/api/v1/uso/resumo?desde=365d')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  // ─────────────────────── a ação LOGIN tem emissor de verdade ───────────────────────
  it('LOGIN é EMITIDO pelo caminho real, e não só declarado no CHECK', async () => {
    // Sem este caso, `entraram` poderia valer zero para sempre e nada ficaria vermelho: os
    // outros casos semeiam a trilha à mão. É a armadilha nomeada em `002_auditoria.sql`.
    const novo = await createUser(db, { username: `uso_login_${marca}` });
    usuariosSemeados.push(novo.id);

    const { rows: antes } = await db.query(
      "SELECT COUNT(*)::int AS n FROM audit_trail WHERE action = 'LOGIN' AND actor_id = $1", [novo.id]
    );
    assert.equal(antes[0].n, 0);

    await loginUser(app, novo.username, novo.password);

    const { rows: depois } = await db.query(
      "SELECT COUNT(*)::int AS n FROM audit_trail WHERE action = 'LOGIN' AND actor_id = $1", [novo.id]
    );
    assert.equal(depois[0].n, 1, 'POST /auth/login precisa gravar LOGIN na trilha');
  });

  // ─────────────────────────── os números, contra o dado semeado ───────────────────────────
  describe('os números da janela de 2001', () => {
    let d;

    before(async () => {
      d = await usoService.resumo({ desde: '7d', agora: FIM });
    });

    it('a janela é exatamente a esperada', () => {
      assert.equal(d.desde, INICIO.getTime());
    });

    it('pessoas: duas contas novas, duas pessoas que entraram, duas que editaram', () => {
      assert.equal(d.pessoas.novasContas, 2, 'autorA e autorB nasceram na janela; autorC, antes');
      // Três LOGIN de autorA + um de autorB = duas PESSOAS. O LOGIN de autorA fora da
      // janela e o LOGOUT de autorC não entram.
      assert.equal(d.pessoas.entraram, 2);
      // autorA e autorB escreveram ops; autorC escreveu fora da janela; uma op é sem autor.
      assert.equal(d.pessoas.editaram, 2);
    });

    it('atlas: dois criados, um excluído, dois com edição', () => {
      assert.equal(d.atlas.criados, 2, 'atlasNovo e atlasIntocado');
      assert.equal(d.atlas.excluidos, 1, 'atlasApagado, pela data do soft-delete');
      assert.equal(d.atlas.comEdicao, 2, 'atlasIntocado não recebeu operação nenhuma');
    });

    it('o ranking traz os dois atlas com edição, ordenados, com nome e dono', () => {
      assert.equal(d.atlas.top.length, 2);
      assert.equal(d.atlas.top[0].id, atlasNovo.id);
      assert.equal(d.atlas.top[0].operacoes, 4);
      assert.equal(d.atlas.top[0].nome, atlasNovo.name);
      assert.equal(d.atlas.top[0].dono, autorA.nome);
      assert.equal(d.atlas.top[1].id, atlasApagado.id);
      assert.equal(d.atlas.top[1].operacoes, 2);
      // O atlas SOFT-deletado continua no ranking: ele foi usado na janela, e escondê-lo
      // faria a produção da lista não somar com o total.
      assert.ok(!d.atlas.top.some((a) => a.id === atlasIntocado.id));
    });

    it('produção: total, por entidade, e a operação de FORA não entra', () => {
      // Seis ops na janela; a sétima está uma hora antes do início.
      assert.equal(d.producao.total, 6);
      const porEntidade = Object.fromEntries(d.producao.porEntidade.map((e) => [e.entidade, e.total]));
      assert.deepEqual(porEntidade, { feature: 4, map: 1, layer: 1 });
      // A ordem é por contagem decrescente, com desempate por nome.
      assert.equal(d.producao.porEntidade[0].entidade, 'feature');
    });

    it('a série diária NÃO tem buracos: o dia sem operação aparece com ZERO', () => {
      const { porDia } = d.producao;
      // Uma janela de 7 dias cheios, de meio-dia a meio-dia, toca OITO dias de calendário.
      assert.equal(porDia.length, 8, `a série deveria cobrir 8 dias, cobre ${porDia.length}`);
      for (const ponto of porDia) {
        assert.match(ponto.dia, /^\d{4}-\d{2}-\d{2}$/, 'o dia é a string AAAA-MM-DD do contrato');
        assert.equal(typeof ponto.total, 'number');
      }
      // Estritamente crescente: um `generate_series` sem ORDER BY devolveria qualquer ordem.
      const dias = porDia.map((p) => p.dia);
      assert.deepEqual(dias, [...dias].sort(), 'a série precisa vir em ordem cronológica');
      assert.equal(new Set(dias).size, dias.length, 'nenhum dia repetido');

      // O miolo é vazio de propósito. O limite é frouxo (>= 5) porque o fuso do SERVIDOR
      // desloca as fronteiras: o que se prende é que dia sem operação EXISTE na série com
      // zero, não em qual posição ele cai.
      const zerados = porDia.filter((p) => p.total === 0);
      assert.ok(zerados.length >= 5, `esperava >= 5 dias com zero, achei ${zerados.length}`);
    });

    it('a soma da série é o total: o primeiro dia é PARCIAL e não pega o que veio antes', () => {
      // É esta a asserção que o `o.created_at >= $1` dentro do LEFT JOIN existe para
      // sustentar. Sem ele o primeiro balde pegaria o dia inteiro e a soma daria 7.
      const soma = d.producao.porDia.reduce((s, p) => s + p.total, 0);
      assert.equal(soma, d.producao.total);
      assert.equal(soma, 6);
    });

    it('estado de HOJE: contasAtivas e vivos não têm janela e crescem com o que se semeia', async () => {
      // Os dois números que não são do período. A asserção é de DELTA porque as tabelas são
      // da rodada inteira; o corredor roda os arquivos em série, então nada escreve entre
      // as duas leituras deste caso.
      const antes = await usoService.resumo({ desde: '7d', agora: FIM });
      const u = await createUser(db, { username: `uso_delta_${marca}` });
      usuariosSemeados.push(u.id);
      const { rows } = await db.query(
        'INSERT INTO atlas (name, owner_id) VALUES ($1, $2) RETURNING id',
        [`Uso delta ${marca}`, u.id]
      );
      atlasSemeados.push(rows[0].id);

      const depois = await usoService.resumo({ desde: '7d', agora: FIM });
      assert.equal(depois.pessoas.contasAtivas, antes.pessoas.contasAtivas + 1);
      assert.equal(depois.atlas.vivos, antes.atlas.vivos + 1);
      // E eles NÃO contaminam o período: o atlas nasceu agora, a janela é de 2001.
      assert.equal(depois.atlas.criados, antes.atlas.criados);
      assert.equal(depois.pessoas.novasContas, antes.pessoas.novasContas);
    });
  });

  // ─────────────────────────── o horizonte ───────────────────────────
  describe('o horizonte, que é o que separa este relatório de um que mente', () => {
    it('a janela que CABE no dado: os dois horizontes começam ANTES do início dela', async () => {
      const d = await usoService.resumo({ desde: '7d', agora: FIM });
      // O registro mais antigo de `operations` é a op de fora da janela (uma hora antes do
      // início), e o da trilha é o LOGIN de 01/06. Os dois em epoch ms, a MESMA unidade de
      // `desde` — é essa igualdade de unidade que torna a comparação possível no consumidor.
      assert.equal(d.horizonte.operacoesDesde, ANTES.getTime());
      assert.equal(d.horizonte.trilhaDesde, new Date('2001-06-01T09:00:00.000Z').getTime());
      assert.ok(d.horizonte.operacoesDesde <= d.desde, 'a produção cobre a janela inteira');
      assert.ok(d.horizonte.trilhaDesde <= d.desde, 'a trilha cobre a janela inteira');
    });

    it('a janela que ULTRAPASSA o horizonte é DETECTÁVEL por quem chama', async () => {
      // Trinta dias pedidos, sete dias de dado. As contagens continuam corretas sobre o que
      // existe — e é justamente por isso que sem este sinal o relatório seria indistinguível
      // de um mês de pouco uso. O sinal é a comparação, e ela só funciona porque os dois
      // instantes viajam no MESMO payload que `desde`.
      const d = await usoService.resumo({ desde: '30d', agora: FIM });
      assert.ok(
        d.horizonte.operacoesDesde > d.desde,
        'a produção começa DEPOIS do início da janela, e isso precisa ser visível'
      );
      assert.ok(d.horizonte.trilhaDesde > d.desde, 'a trilha também começa depois');
      // Os instantes são números, e não Date nem string: a tela precisa NOMEAR a data
      // ("os dados começam em 03/06") sem adivinhar formato.
      assert.equal(typeof d.horizonte.operacoesDesde, 'number');
      assert.equal(typeof d.horizonte.trilhaDesde, 'number');
      // O par que fecha a discriminação: o MESMO dado com a janela de 7d cobre (caso acima).
      const curta = await usoService.resumo({ desde: '7d', agora: FIM });
      assert.equal(curta.horizonte.operacoesDesde, d.horizonte.operacoesDesde);
      assert.ok(curta.horizonte.operacoesDesde <= curta.desde);
    });

    it('a janela maior ainda produz série sem buracos, e a soma continua batendo', async () => {
      const d = await usoService.resumo({ desde: '30d', agora: FIM });
      assert.equal(d.producao.porDia.length, 31);
      const soma = d.producao.porDia.reduce((s, p) => s + p.total, 0);
      assert.equal(soma, d.producao.total);
      // A op de fora da janela de 7d cabe na de 30d: sete operações agora.
      assert.equal(d.producao.total, 7);
    });
  });
});
