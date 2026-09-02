// Path: tests/integration/uso-funil-e-retencao.test.js
//
// As duas metades de COORTE do relatório de uso, dentro do mesmo `GET /uso/resumo`: o funil
// de entrada (cadastro -> primeiro atlas -> primeira edição) e a retenção por semana de
// cadastro. Nenhuma instrumentação nova: as duas são consulta sobre `users`, `atlas`,
// `operations` e `audit_trail`.
//
// ELAS LEEM O PERÍODO DE UM JEITO QUE O RESTO DO RELATÓRIO NÃO LÊ, e é isso que este arquivo
// existe para prender: nas outras consultas a janela recorta o FATO medido, e aqui ela
// recorta a COORTE, com a contagem seguindo depois do fim da janela. Um teste que semeasse
// tudo dentro da janela passaria idêntico para as duas leituras e não discriminaria nada.
//
// COMO ESTE ARQUIVO ASSERE NÚMERO EXATO NUMA TABELA COMPARTILHADA: pela `agora` INJETÁVEL do
// serviço, como `uso-resumo.test.js`. O cenário mora no ANO 2003 (aquele arquivo usa 2001, e
// os dois precisam de janelas disjuntas), então nenhuma linha de outra suíte cai dentro das
// janelas pedidas aqui.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - tirar o aninhamento do funil (fazer `com_producao` sair de `novos` em vez de
//    `com_atlas`): o caso "quem só edita atlas alheio não entra no terceiro passo" reprova
//    com 2 contra 1, e com ele some a monotonicidade que autoriza a tela a chamar aquilo de
//    conversão;
//  - tirar `o.created_at >= c.created_at` do funil: a op semeada ANTES do cadastro de `f2`
//    entra, `produziram` vira 2 e a mediana passa a poder ser negativa;
//  - trocar `percentile_cont` por `avg`: as distâncias até o primeiro atlas são 2h, 4h e 40h,
//    cuja mediana é 4 e cuja média é 15,3. A primeira versão semeava só 2h e 4h, onde mediana
//    e média valem 3 e o controle era VAZIO: foi rodado, ficou verde, e a amostra enviesada
//    entrou para que a linha deste cabeçalho passasse a valer alguma coisa;
//  - passar o NULL de `percentile_cont` por `inteiro()` em vez de `decimalOuNulo`: o caso do
//    passo sem ninguém reprova, porque a mediana vira 0 e 0 hora é uma medida;
//  - trocar `null` por `0` na célula de semana não fechada: o caso do w4 no futuro reprova
//    nomeando a posição, e sem ele uma semana que ainda corre se leria como abandono;
//  - tirar o `DISTINCT` de `retencao`: os dois logins de `f1` na mesma semana contam dois e
//    a célula deixa de ser de PESSOAS;
//  - alargar `a.action = 'LOGIN'`: o LOGOUT semeado na SEGUNDA semana entra, e a célula
//    que vale zero passa a valer um. (Ele foi semeado na TERCEIRA na primeira versão deste
//    arquivo, e ali o controle era vazio: `f1` já contava naquela semana por um LOGIN, e o
//    `DISTINCT` fundia os dois. Foi medido, ficou verde, e o caso mudou de semana.)
//  - contar a semana ZERO como retorno, o que exige remover AS DUAS guardas ao mesmo tempo
//    (`a.created_at >= c.semana + interval '7 days'` E o `FILTER (WHERE r.n = 1)`): a célula
//    S+1 vai de 2 para 4, porque entram os logins que `f1` e `f3` têm dentro da PRÓPRIA
//    semana de cadastro. É a guarda de que retenção não conta o cadastro, e ela é DUPLA:
//    cada metade sozinha já exclui o `n` zero, então reverter só uma delas deixa a suíte
//    verde. As três combinações foram RODADAS, e é essa medição que impede a declaração
//    errada de que qualquer uma das duas basta como controle negativo.
//
// O QUE ESTE ARQUIVO **NÃO** DISCRIMINA, declarado porque controle negativo que ninguém rodou
// é pior que controle nenhum, e os dois primeiros desta lista foram RODADOS e voltaram verdes:
//
//  - os predicados de tempo do `JOIN` da retenção, UM DE CADA VEZ. Tirar qualquer um deixa
//    a suíte verde, e isso é PROPRIEDADE e não buraco: o que entra em cada célula é decidido
//    DUAS vezes, pela faixa do `JOIN` e pelo `FILTER (WHERE r.n = k)`, e uma linha de `n`
//    fora de 1..4 não é contada por filtro nenhum. O `< c.semana + 35 days` e o `>= $1` são
//    restrição de FAIXA pura, e a garantia deles é `EXPLAIN` (medição no cabeçalho de
//    `COORTE_DE_RETENCAO`), nunca esta suíte. A primeira versão deste arquivo declarava o
//    `>= c.semana + 7 days` como controle negativo sozinho; foi rodado, ficou verde, e a
//    declaração foi corrigida em vez de o caso ser inventado em volta dela.
//  - `o.created_at >= $1` no funil, pela mesma razão e com a mesma garantia.
//  - a GRADE DE CALENDÁRIO da semana relativa. Trocar o `date_trunc(...)::date` de `n` pelo
//    `EXTRACT(EPOCH …) / 604800` anterior deixa a suíte VERDE, e vai continuar deixando: as
//    duas grades só divergem numa semana em que o relógio local anda, e não há fuso com
//    horário de verão onde esta suíte roda. Exercitá-lo exigiria fixar o fuso da SESSÃO do
//    banco para as consultas do serviço, que não há como fazer sem vazar o `SET` para o resto
//    da rodada pelo pool. A garantia aqui é a leitura, declarada no cabeçalho de
//    `COORTE_DE_RETENCAO`, e não um caso vermelho;
//  - o `LIMIT` da coorte: ele só morde acima de `MAX_SEMANAS_DE_COORTE` semanas distintas, e
//    semear cinquenta e quatro coortes custaria mais do que a propriedade vale. O que se
//    prende aqui é a DERIVAÇÃO da constante a partir do teto da janela, que é onde ela
//    poderia ficar menor que a janela em silêncio.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createUser, loginUser } from '../helpers/fixtures.js';
import * as usoService from '../../src/modules/uso/uso.service.js';
import { TETO_DA_JANELA_MS } from '../../src/modules/uso/uso.schemas.js';

const DIA = 86_400_000;

/** O fim da janela dos casos de FUNIL. Longe de qualquer `NOW()` de outra suíte. */
const FIM_FUNIL = new Date('2003-06-10T12:00:00.000Z');
/** O início da janela de 7d correspondente. */
const INICIO_FUNIL = new Date('2003-06-03T12:00:00.000Z');

/**
 * O fim da janela dos casos de COORTE. Escolhido para que a coorte de 02/06 tenha TRÊS
 * semanas fechadas e a quarta ainda correndo, que é o estado que a tabela precisa saber
 * desenhar.
 */
const FIM_COORTE = new Date('2003-07-05T12:00:00.000Z');

/** A segunda-feira de cada coorte, como `date_trunc('week')` a devolve. */
const COORTE_A = '2003-06-02';
const COORTE_B = '2003-06-09';

/**
 * O "piso no último passo do funil", derivado do payload e não lido de um campo.
 *
 * NÃO HÁ BOOLEANO DE VEREDITO NA RESPOSTA, de propósito e por decisão já registrada no
 * `fileoverview` de `uso.horizonte.js`: `horizonte.operacoesDesde` e `desde` viajam juntos, na
 * mesma unidade, e a comparação entre eles dá ao consumidor QUATRO desfechos que um booleano
 * colapsaria em dois. Esta função é a mesma comparação que o cliente faz (`estadoDoHorizonte`,
 * em `frontend/src/js/admin/uso-phrases.js`), escrita aqui para que o teste exercite a
 * propriedade e não um campo.
 * @param {Object} d
 * @returns {boolean}
 */
function pisoNoUltimoPasso(d) {
  const alcance = d.horizonte.operacoesDesde;
  return alcance === null || alcance > d.desde;
}

describe('Relatório de uso — funil de entrada e coorte de retenção', () => {
  let app, db;
  let adminToken;
  // f1 desce o funil inteiro; f2 para no atlas; f3 edita atlas alheio e não tem o seu;
  // f4 nasceu antes da janela; f5 é a segunda coorte.
  let f1, f2, f3, f4, f6;
  let atlasF1, atlasAntigo;

  const marca = randomUUID().slice(0, 8);
  const usuariosSemeados = [];
  const atlasSemeados = [];

  async function usuarioEm(nome, nascidoEm) {
    const u = await createUser(db, { username: `funil_${nome}_${marca}` });
    await db.query('UPDATE users SET created_at = $1 WHERE id = $2', [nascidoEm, u.id]);
    usuariosSemeados.push(u.id);
    return u;
  }

  async function atlasEm(nome, donoId, criadoEm) {
    const { rows } = await db.query(
      'INSERT INTO atlas (name, owner_id, created_at) VALUES ($1, $2, $3) RETURNING *',
      [`Funil ${nome} ${marca}`, donoId, criadoEm]
    );
    atlasSemeados.push(rows[0].id);
    return rows[0];
  }

  async function opEm(atlasId, autorId, quando) {
    await db.query(
      `INSERT INTO operations
         (atlas_id, op_type, entity_type, entity_id, client_timestamp, client_id, user_id, created_at)
       VALUES ($1, 'create', 'feature', gen_random_uuid(), $2, $3, $4, $5)`,
      [atlasId, quando.getTime(), `cli_${marca}`, autorId, quando]
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

    const admin = await createAdminUser(db, { username: `funil_adm_${marca}` });
    usuariosSemeados.push(admin.id);
    adminToken = await loginUser(app, admin.username, admin.password);

    // ---- as contas -------------------------------------------------------------------
    // Meio-dia UTC em todas: um deslocamento de fuso do servidor de algumas horas não pode
    // mudar o DIA DA SEMANA de nenhuma delas, senão a coorte muda de linha e o teste passa
    // a medir o fuso da máquina.
    f1 = await usuarioEm('f1', new Date('2003-06-04T12:00:00.000Z'));
    f2 = await usuarioEm('f2', new Date('2003-06-05T12:00:00.000Z'));
    f3 = await usuarioEm('f3', new Date('2003-06-06T12:00:00.000Z'));
    f4 = await usuarioEm('f4', new Date('2003-01-01T11:00:00.000Z'));
    await usuarioEm('f5', new Date('2003-06-11T12:00:00.000Z'));
    // f6 desce até o segundo passo com uma distância ENVIESADA (40h), e existe por causa do
    // controle negativo da mediana: com só duas amostras simétricas, mediana e média coincidem
    // e trocar `percentile_cont` por `avg` não reprovaria nada.
    f6 = await usuarioEm('f6', new Date('2003-06-04T12:00:00.000Z'));

    // ---- os atlas --------------------------------------------------------------------
    // As TRÊS distâncias até o primeiro atlas são 2h, 4h e 40h: a mediana é 4 e a média é
    // 15,3, e é essa assimetria que faz o controle negativo de `percentile_cont` reprovar.
    atlasF1 = await atlasEm('f1', f1.id, new Date('2003-06-04T14:00:00.000Z'));
    await atlasEm('f2', f2.id, new Date('2003-06-05T16:00:00.000Z'));
    // 40h depois do cadastro de f6: a amostra que separa mediana (4) de média (15,3).
    await atlasEm('f6', f6.id, new Date('2003-06-06T04:00:00.000Z'));
    atlasAntigo = await atlasEm('antigo', f4.id, new Date('2003-01-01T12:00:00.000Z'));

    // ---- as operações ----------------------------------------------------------------
    // A ÂNCORA DO HORIZONTE: ela garante que `MIN(operations.created_at)` do banco inteiro
    // seja anterior a qualquer janela de junho pedida aqui, INDEPENDENTE do que as outras
    // suítes tenham escrito. Sem ela, o caso "a janela cabe no dado" dependeria da ordem em
    // que o corredor visita os arquivos.
    await opEm(atlasAntigo.id, f4.id, new Date('2003-01-01T18:00:00.000Z'));

    // f1 desce o funil inteiro: 6h entre o cadastro e a primeira edição.
    await opEm(atlasF1.id, f1.id, new Date('2003-06-04T18:00:00.000Z'));
    // f3 edita o atlas de f1 e nunca criou o seu: ele NÃO pode aparecer no terceiro passo.
    await opEm(atlasF1.id, f3.id, new Date('2003-06-07T12:00:00.000Z'));
    // f2 tem uma op ANTERIOR ao próprio cadastro (um dono de atlas pode mudar; aqui a linha
    // é semeada à mão). O piso de tempo do funil a exclui, e sem ele a mediana ficaria
    // negativa.
    await opEm(atlasF1.id, f2.id, new Date('2003-06-04T12:00:00.000Z'));

    // ---- a trilha --------------------------------------------------------------------
    // Coorte de 02/06 (f1, f2, f3). As janelas dela, a partir da segunda-feira:
    //   S+1 [09/06, 16/06)   S+2 [16/06, 23/06)   S+3 [23/06, 30/06)   S+4 [30/06, 07/07)
    await trilhaEm('LOGIN', f1.id, new Date('2003-06-05T12:00:00.000Z')); // S+0: não conta
    await trilhaEm('LOGIN', f1.id, new Date('2003-06-10T12:00:00.000Z')); // S+1
    await trilhaEm('LOGIN', f1.id, new Date('2003-06-12T12:00:00.000Z')); // S+1 de novo
    await trilhaEm('LOGIN', f1.id, new Date('2003-06-25T12:00:00.000Z')); // S+3
    // O LOGOUT vai na S+2, e não na S+3: em S+3 `f1` já conta por um LOGIN, o `DISTINCT`
    // fundiria os dois e o caso ficaria verde com o filtro de ação alargado. Medido.
    await trilhaEm('LOGOUT', f1.id, new Date('2003-06-18T12:00:00.000Z')); // ação errada, S+2
    await trilhaEm('LOGIN', f1.id, new Date('2003-07-20T12:00:00.000Z')); // além de S+4
    await trilhaEm('LOGIN', f2.id, new Date('2003-06-11T12:00:00.000Z')); // S+1
    // f3 entra UMA vez, na própria semana do cadastro: retenção não conta o cadastro, e sem
    // uma linha de `n` zero nada distingue "não conta" de "não existe".
    await trilhaEm('LOGIN', f3.id, new Date('2003-06-07T12:00:00.000Z')); // S+0: não conta
    // f5 nunca volta: a coorte com zero em toda célula fechada precisa existir.
  });

  after(async () => {
    // A ordem é a das FKs: a trilha e as operações apontam para as contas, e `operations`
    // some por CASCADE quando o atlas some.
    if (usuariosSemeados.length) {
      await db.query('DELETE FROM audit_trail WHERE actor_id = ANY($1::uuid[])', [usuariosSemeados]);
    }
    if (atlasSemeados.length) {
      await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [atlasSemeados]);
    }
    if (usuariosSemeados.length) {
      // As contas SAEM, ao contrário do que a suíte irmã faz: uma conta de 2003 que
      // sobrevivesse contaminaria a coorte de uma rodada com banco reaproveitado
      // (`test:fast`), e o sintoma seria um denominador maior sem nada apontar para a causa.
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [usuariosSemeados]);
    }
    await teardownTestEnv(db);
  });

  // ─────────────────────────── o funil ───────────────────────────
  describe('o funil de entrada', () => {
    let d;

    before(async () => {
      d = await usoService.resumo({ desde: '7d', agora: FIM_FUNIL });
    });

    it('a janela é a esperada, e o cenário inteiro cabe nela', () => {
      assert.equal(d.desde, INICIO_FUNIL.getTime());
    });

    it('os três passos contam o que cada um promete', () => {
      // f1, f2, f3 e f6 nasceram na janela; f4 nasceu em janeiro e f5 nasce no dia seguinte
      // ao fim dela.
      assert.equal(d.funil.cadastraram, 4);
      // f1, f2 e f6 viraram donos de um atlas; f3 nunca criou o seu.
      assert.equal(d.funil.criaramAtlas, 3);
      // Só f1 editou. f3 editou o atlas de f1 e não está aqui (ver o caso seguinte), e a op
      // de f2 é anterior ao cadastro dele.
      assert.equal(d.funil.produziram, 1);
    });

    it('o funil é MONOTÔNICO, que é o que autoriza a tela a falar em conversão', () => {
      // Sem esta propriedade a "conversão" da tela passaria de 100% com o dado inteiro e
      // correto, e é ela que o aninhamento das CTEs compra.
      assert.ok(d.funil.cadastraram >= d.funil.criaramAtlas);
      assert.ok(d.funil.criaramAtlas >= d.funil.produziram);
    });

    it('quem só edita atlas ALHEIO não entra no terceiro passo', () => {
      // f3 tem operação na janela e aparece em `editaram`, que conta pessoas com produção
      // em qualquer atlas. O funil é outra pergunta, e a diferença entre os dois números é a
      // prova de que ele não virou uma cópia daquele.
      assert.equal(d.pessoas.editaram, 3, 'f1, f2 e f3 têm op na janela; f6 não editou');
      assert.equal(d.funil.produziram, 1);
    });

    it('as medianas são de HORAS desde o cadastro, e vêm cruas', () => {
      // 2h (f1), 4h (f2) e 40h (f6) -> MEDIANA 4. A média das três é 15,3, e é essa distância
      // entre os dois números que faz o caso discriminar `percentile_cont` de `avg`.
      assert.equal(d.funil.horasAteAtlas, 4);
      assert.notEqual(d.funil.horasAteAtlas, (2 + 4 + 40) / 3);
      // Uma só amostra no terceiro passo -> 6h.
      assert.equal(d.funil.horasAteProducao, 6);
      assert.equal(typeof d.funil.horasAteAtlas, 'number');
    });

    it('o passo a que ninguém chegou tem mediana `null`, e NUNCA zero', () => {
      // A janela de um dia sobre o dia 09: ninguém se cadastrou nele, então os três passos
      // são zero e as duas medianas não existem. Zero hora seria a afirmação "chegaram lá no
      // mesmo instante do cadastro", sobre um conjunto vazio.
      const vazio = { desde: '1d', agora: new Date('2003-06-10T00:00:00.000Z') };
      return usoService.resumo(vazio).then((r) => {
        assert.equal(r.funil.cadastraram, 0);
        assert.equal(r.funil.horasAteAtlas, null);
        assert.equal(r.funil.horasAteProducao, null);
        assert.notEqual(r.funil.horasAteAtlas, 0);
      });
    });
  });

  // ─────────────────── o horizonte do terceiro passo ───────────────────
  describe('o horizonte, que faz do terceiro passo um PISO', () => {
    it('a janela que CABE no dado não impõe piso nenhum', async () => {
      // A âncora de janeiro garante isto sem depender de nenhuma outra suíte.
      const d = await usoService.resumo({ desde: '7d', agora: FIM_FUNIL });
      assert.ok(d.horizonte.operacoesDesde <= d.desde);
      assert.equal(pisoNoUltimoPasso(d), false);
    });

    it('a MESMA leitura vira piso quando a janela começa antes do dado, e volta atrás', async () => {
      // As duas janelas são ancoradas no horizonte REAL do banco, e não numa data escrita
      // aqui: assim o caso discrimina o mesmo par de desfechos qualquer que seja a linha mais
      // antiga de `operations` no momento da rodada.
      const base = await usoService.resumo({ desde: '7d', agora: FIM_FUNIL });
      const alcance = base.horizonte.operacoesDesde;
      assert.equal(typeof alcance, 'number', 'a âncora garante que existe operação no banco');

      const curta = await usoService.resumo({ desde: '7d', agora: new Date(alcance + DIA) });
      assert.ok(curta.desde < alcance, 'a janela começa antes da primeira operação que existe');
      assert.equal(pisoNoUltimoPasso(curta), true);

      const larga = await usoService.resumo({ desde: '7d', agora: new Date(alcance + 30 * DIA) });
      assert.ok(larga.desde > alcance, 'agora a janela começa depois');
      assert.equal(pisoNoUltimoPasso(larga), false);
    });

    it('o payload NÃO ganhou um booleano de veredito, e a ausência é a decisão', async () => {
      // Publicar um `piso: true` daria ao consumidor uma resposta MAIS POBRE que a que ele já
      // tem, e seria a primeira que o próximo consumidor alcançaria: os dois instantes
      // distinguem quatro desfechos (cobre, encurtado, vazio, servidor não informou) e o
      // booleano distingue dois. Ver o `fileoverview` de `uso.horizonte.js`.
      const d = await usoService.resumo({ desde: '7d', agora: FIM_FUNIL });
      // A LISTA CRESCEU EM 2026-09-02 e a REGRA não: `usoDesde` e `usoSessoesDesde` são dois
      // INSTANTES, da mesma natureza dos dois primeiros, e entraram porque limitam metades
      // diferentes do bloco de sessões (ver `HORIZONTE_DE_USO`). O que este caso prende é a
      // FORMA de tudo o que mora aqui, e não a contagem: nenhum campo de `horizonte` pode ser
      // um veredito. Um booleano passaria pela lista de chaves de uma versão anterior deste
      // caso, que só as ordenava, e é por isso que a segunda asserção existe.
      assert.deepEqual(
        Object.keys(d.horizonte).sort(),
        ['operacoesDesde', 'trilhaDesde', 'usoDesde', 'usoSessoesDesde']
      );
      const vereditos = Object.entries(d.horizonte)
        .filter(([, v]) => typeof v === 'boolean')
        .map(([k]) => k);
      assert.deepEqual(vereditos, [], 'nenhum campo de `horizonte` pode ser um veredito');

      const foraDeForma = Object.entries(d.horizonte)
        .filter(([, v]) => v !== null && !Number.isFinite(v))
        .map(([k]) => k);
      assert.deepEqual(foraDeForma, [], 'todo campo de `horizonte` é epoch ms ou `null`');

      assert.ok(!Object.hasOwn(d.funil, 'piso'));
    });
  });

  // ─────────────────────────── a retenção ───────────────────────────
  describe('a coorte de retenção', () => {
    let semanas;

    before(async () => {
      const d = await usoService.resumo({ desde: '35d', agora: FIM_COORTE });
      semanas = d.retencao.semanas;
    });

    it('há uma linha por semana ISO com cadastro, na ordem cronológica', () => {
      assert.equal(semanas.length, 2);
      assert.deepEqual(semanas.map((s) => s.semana), [COORTE_A, COORTE_B]);
      // A semana é a string 'AAAA-MM-DD' do contrato, e não uma data serializada: um `Date`
      // no driver viraria ISO em UTC no `JSON.stringify`, e a coorte poderia RECUAR um dia.
      for (const s of semanas) {
        assert.match(s.semana, /^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('a coorte de 02/06 tem quatro contas e volta na S+1 e na S+3', () => {
      const a = semanas.find((s) => s.semana === COORTE_A);
      assert.equal(a.cadastrados, 4, 'f1, f2, f3 e f6');
      // S+1: f1 (dois logins, uma pessoa) e f2. S+2: ninguém. S+3: f1. S+4: ainda correndo.
      assert.deepEqual(a.retidos, [2, 0, 1, null]);
    });

    it('a S+4 no futuro é `null`, e não zero: ela ainda não terminou', () => {
      // Um zero ali se lê como abandono, que é a afirmação oposta à verdadeira, e o número
      // ainda vai crescer. É a mesma armadilha do buraco na série diária, pelo outro lado.
      const a = semanas.find((s) => s.semana === COORTE_A);
      assert.equal(a.retidos[3], null);
      assert.notEqual(a.retidos[3], 0);
      // E o par que fecha a discriminação: a semana FECHADA em que ninguém voltou é ZERO, e
      // não `null`. Sem este lado, um código que devolvesse `null` sempre passaria.
      assert.strictEqual(a.retidos[1], 0);
    });

    it('a coorte mais nova tem MENOS semanas fechadas, e o corte é por semana e não por linha', () => {
      const b = semanas.find((s) => s.semana === COORTE_B);
      assert.equal(b.cadastrados, 1, 'f5');
      // Sete dias mais nova que a outra, logo uma célula a menos fechada.
      assert.deepEqual(b.retidos, [0, 0, null, null]);
    });

    it('cada linha traz exatamente as quatro semanas do contrato', () => {
      assert.equal(semanas.length, 2, 'sem linha nenhuma o laço abaixo não asseriria nada');
      for (const s of semanas) {
        assert.equal(s.retidos.length, 4, `${s.semana} deveria ter 4 células`);
      }
    });

    it('semana SEM cadastro não vira linha, e isso é o avesso do preenchimento de dias', () => {
      // Entre 02/06 e 09/06 não há buraco, mas a janela de 35 dias começa em 31/05 e as
      // semanas anteriores a 02/06 não aparecem: não há coorte, e uma linha de denominador
      // zero não tem retenção nenhuma para mostrar (0 de 0 não é 0%).
      assert.equal(semanas.length, 2);
      assert.ok(!semanas.some((s) => s.cadastrados === 0));
    });
  });

  // ─────────────────────────── o teto de linhas ───────────────────────────
  it('o teto de coortes cobre a PIOR fase da janela, e a prova ENUMERA as fases', () => {
    // ESTE CASO NÃO REPETE A FÓRMULA, e é esse o ponto: a primeira versão asseria
    // `MAX_SEMANAS_DE_COORTE === floor(teto/semana) + 1`, que é a própria expressão do código.
    // Um teste assim concorda com o defeito por construção, e o defeito estava lá: 365 dias
    // são 52 semanas MAIS UM DIA, então quantas segundas-feiras a janela toca depende da FASE
    // dela dentro da semana, e não só do comprimento. `floor` dá 53, e a pior fase toca 54.
    //
    // O FUSO NÃO ENTRA NA CONTA porque as fases são enumeradas TODAS: mudar o fuso desloca a
    // fase, e o máximo sobre o conjunto inteiro é o mesmo.
    const semana = 7 * DIA;
    const ANCORA = Date.UTC(1970, 0, 5); // uma segunda-feira qualquer
    const balde = (t) => Math.floor((t - ANCORA) / semana);

    let maximo = 0;
    let piores = 0;
    for (let fase = 0; fase < 168; fase += 1) {
      const inicio = ANCORA + fase * 3600000;
      // A janela é meio-aberta: o último instante que pode carregar um cadastro é `fim - 1`.
      const tocadas = balde(inicio + TETO_DA_JANELA_MS - 1) - balde(inicio) + 1;
      if (tocadas > maximo) {
        maximo = tocadas;
        piores = 0;
      }
      if (tocadas === maximo) piores += 1;
    }

    assert.equal(maximo, 54, 'a pior fase de uma janela de 365 dias toca 54 segundas-feiras');
    assert.ok(piores > 0 && piores < 168, `${piores} fases atingem o máximo: nem uma, nem todas`);
    // O cinto cobre a pior fase. `>=` e não igualdade porque folga é aceitável e falta não é.
    assert.ok(
      usoService.MAX_SEMANAS_DE_COORTE >= maximo,
      `o teto (${usoService.MAX_SEMANAS_DE_COORTE}) cortaria coortes reais na pior fase`
    );
    // E o controle negativo da própria constante: a fórmula ANTERIOR não cobria.
    assert.ok(
      Math.floor(TETO_DA_JANELA_MS / semana) + 1 < maximo,
      'sem este par, trocar ceil por floor voltaria a passar'
    );
  });

  // ─────────────────────────── o contrato HTTP ───────────────────────────
  it('os dois blocos atravessam a rota, com o mesmo gate do resto do relatório', async () => {
    // Sem este caso, os dois blocos poderiam existir no serviço e não no payload: todos os
    // outros exercitam `usoService.resumo` direto, por causa da `agora` injetável.
    const res = await supertest(app)
      .get('/api/v1/uso/resumo?desde=30d')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const d = res.body.data;
    for (const chave of ['cadastraram', 'criaramAtlas', 'produziram']) {
      assert.equal(typeof d.funil[chave], 'number', `funil.${chave} precisa ser número`);
    }
    // AS DUAS MEDIANAS PRECISAM EXISTIR COMO CHAVE mesmo valendo null, e a razão é de
    // CONTRATO, não de tela: `medianaLabel`, no cliente, trata `null` e ausência do mesmo
    // jeito, então nenhuma frase distingue os dois. O que a asserção compra é que o campo não
    // possa SUMIR do payload sem nada ficar vermelho, que é o modo de falha real de uma
    // reescrita da consulta ou do mapeamento.
    for (const chave of ['horasAteAtlas', 'horasAteProducao']) {
      assert.ok(Object.hasOwn(d.funil, chave), `funil.${chave} ausente`);
    }
    assert.ok(Array.isArray(d.retencao.semanas));
    // O administrador desta suíte nasceu agora, então a janela de 30 dias tem ao menos uma
    // coorte por construção: sem esta linha o laço abaixo poderia não asserir nada.
    assert.ok(d.retencao.semanas.length > 0, 'a conta criada nesta rodada é uma coorte');
    for (const linha of d.retencao.semanas) {
      assert.match(linha.semana, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(typeof linha.cadastrados, 'number');
      assert.equal(linha.retidos.length, 4);
    }
  });

  it('ANÔNIMO não alcança os dois blocos novos: o gate é o do relatório inteiro', async () => {
    await supertest(app).get('/api/v1/uso/resumo').expect(401);
  });
});
