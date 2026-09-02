// Path: tests/integration/uso-resumo-blocos.test.js
/**
 * @fileoverview Os QUATRO blocos novos de `GET /uso/resumo` (sessões, gestos, desempenho e
 * disponibilidade), e a COSTURA entre o dia agregado e o dia que ainda tem sessões.
 *
 * A JANELA DESTE ARQUIVO FICA NO PASSADO, E ISSO É O QUE O TORNA DETERMINÍSTICO. `resumo` não
 * tem filtro por marca: ele conta TUDO na janela, e os outros arquivos desta família escrevem
 * sessões de HOJE. Com `agora` injetado 45 dias atrás e uma janela de seis dias, a resposta é
 * sobre uma faixa que só este arquivo semeia. Sem isso, cada asserção de contagem seria
 * refém de quem mais estivesse rodando, e um vermelho aqui não diria nada sobre o código.
 *
 * CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
 *  - somar `uso_diario` e `uso_sessoes` em vez de deixar o primeiro vencer: o dia com as duas
 *    fontes passa a contar em dobro, e o número é plausível;
 *  - tirar o `NOT EXISTS` por (dia, PÁGINA) e testá-lo só por dia: a página cuja primeira
 *    sessão apareceu depois da agregação some do relatório;
 *  - tirar o `generate_series`: o dia sem sessão some da série em vez de aparecer como zero, e
 *    o gráfico encosta os dois lados do buraco;
 *  - preferir `uso_diario` ao calcular desempenho: o p75 da janela vira mediana de p75
 *    diários sem que nada diga, e `origem` deixa de discriminar;
 *  - somar a série para `usuariosDistintos` da janela: pessoas que voltaram em dois dias
 *    passam a contar duas vezes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { resumo } from '../../src/modules/uso/uso.service.js';

describe('Uso do produto — os blocos do resumo e a costura dia fechado / dia aberto', () => {
  let db, app, adminToken, pessoaA, pessoaB;

  /** 45 dias atrás: o fim da janela deste arquivo. Ver o cabeçalho. */
  const AGORA = new Date(Date.now() - 45 * 86_400_000);
  const JANELA = '6d';

  const sessoes = [];
  const dias = [];
  const props = [];
  let d51, d50, d49, d48, d47, d45;

  /** O dia D-n como `{ data, texto }`: a série viaja como string 'AAAA-MM-DD' no contrato. */
  async function dia(n) {
    const { rows } = await db.query(
      "SELECT (CURRENT_DATE - $1::int) AS d, to_char(CURRENT_DATE - $1::int, 'YYYY-MM-DD') AS t",
      [n]
    );
    dias.push(rows[0].d);
    return { data: rows[0].d, texto: rows[0].t };
  }

  async function semearSessao(diaAlvo, pagina, campos = {}) {
    const id = randomUUID();
    sessoes.push(id);
    const {
      userId = null, duracaoS = 30, erros = 0, idadeDias = 50,
      lcp = null, inp = null, cls = null, ateMapa = null,
    } = campos;
    await db.query(
      `INSERT INTO uso_sessoes (
         sessao_id, dia, user_id, pagina_inicial, release, navegador,
         inicio, ultimo_sinal, eventos, erros, lcp_ms, inp_ms, cls, tempo_ate_mapa_ms
       ) VALUES (
         $1, $2, $3, $4, NULL, 'Chrome',
         NOW() - ($5::int * INTERVAL '1 day') - ($6::int * INTERVAL '1 second'),
         NOW() - ($5::int * INTERVAL '1 day'),
         0, $7, $8, $9, $10, $11
       )`,
      [id, diaAlvo.data, userId, pagina, idadeDias, duracaoS, erros, lcp, inp, cls, ateMapa]
    );
  }

  async function semearDiario(diaAlvo, pagina, v) {
    await db.query(
      `INSERT INTO uso_diario (
         dia, pagina, sessoes, sessoes_autenticadas, usuarios_distintos, sessoes_com_erro,
         duracao_mediana_s, lcp_p75_ms, inp_p75_ms, cls_p75, tempo_ate_mapa_p75_ms
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [diaAlvo.data, pagina, v.sessoes, v.autenticadas, v.distintos, v.comErro,
        v.duracao ?? null, v.lcp ?? null, v.inp ?? null, v.cls ?? null, v.ateMapa ?? null]
    );
  }

  async function semearEvento(diaAlvo, pagina, evento, prop, contagem) {
    if (prop) props.push(prop);
    await db.query(
      `INSERT INTO uso_eventos_dia (dia, pagina, evento, prop, contagem)
       VALUES ($1, $2, $3, $4, $5)`,
      [diaAlvo.data, pagina, evento, prop ?? '', contagem]
    );
  }

  const doDia = (serie, texto) => serie.find((l) => l.dia === texto);

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    app = env.app;

    pessoaA = await createUser(db, { username: `usor_a_${randomUUID().slice(0, 6)}` });
    pessoaB = await createUser(db, { username: `usor_b_${randomUUID().slice(0, 6)}` });
    const admin = await createAdminUser(db, { username: `usor_adm_${randomUUID().slice(0, 6)}` });
    adminToken = await loginUser(app, admin.username, admin.password);

    // D-51 é a ponta INICIAL da faixa (o `agora` está em D-45 e a janela é de seis dias) e
    // não recebe dado nenhum: ele existe para que a asserção da faixa não possa ser satisfeita
    // por acaso pelo primeiro dia que tem linha.
    d51 = await dia(51);
    d50 = await dia(50);
    d49 = await dia(49);
    d48 = await dia(48);
    d47 = await dia(47);
    d45 = await dia(45);

    // D-50: a COSTURA. A página `mapa` já foi agregada E ainda tem sessões de pé (é o estado
    // normal entre a agregação e a poda); `uso_diario` tem de VENCER. A página `atlas` do
    // mesmo dia só existe como agregado, e é ela que exercita `origem: 'diario'`.
    await semearDiario(d50, 'mapa', {
      sessoes: 7, autenticadas: 5, distintos: 4, comErro: 2, duracao: 111,
      lcp: 1111, inp: 111, cls: 0.111, ateMapa: 1111,
    });
    await semearSessao(d50, 'mapa', { userId: pessoaA.id, duracaoS: 10, lcp: 900, idadeDias: 50 });
    await semearSessao(d50, 'mapa', { duracaoS: 90, erros: 1, lcp: 900, idadeDias: 50 });
    await semearDiario(d50, 'atlas', {
      sessoes: 3, autenticadas: 1, distintos: 1, comErro: 0, duracao: 22,
      lcp: 2222, inp: 222, cls: 0.222, ateMapa: 2222,
    });

    // D-49: dia fechado que a agregação ainda NÃO alcançou. Ele existe só como sessões, e o
    // relatório precisa mostrá-lo mesmo assim, senão o intervalo entre a meia-noite e a
    // primeira escrita do dia seguinte seria um buraco na tela.
    await semearSessao(d49, 'mapa', { userId: pessoaA.id, duracaoS: 20, idadeDias: 49 });
    await semearSessao(d49, 'mapa', { userId: pessoaB.id, duracaoS: 40, erros: 3, idadeDias: 49 });

    // D-48: só eventos, nenhuma sessão. É o dia que prova o preenchimento com zero.
    await semearEvento(d48, 'mapa', 'indisponivel.visto', '', 5);

    // D-45 (o dia do `agora` injetado): o dia "aberto" da janela.
    await semearSessao(d45, 'mapa', {
      userId: pessoaB.id, duracaoS: 60, idadeDias: 45,
      lcp: 500, inp: 50, cls: 0.05, ateMapa: 700,
    });

    // Os GESTOS da janela, em dias diferentes, para que a soma seja sobre a janela e não
    // sobre um dia. Os qualificadores são irrepetíveis porque a tabela é compartilhada.
    const ferramenta = `t${randomUUID().slice(0, 8)}`;
    await semearEvento(d50, 'mapa', 'ferramenta.ativada', ferramenta, 30);
    await semearEvento(d49, 'mapa', 'ferramenta.ativada', ferramenta, 12);
    await semearEvento(d49, 'mapa', 'visualizador3d.aberto', '', 4);
    await semearEvento(d47, 'mapa', 'indisponivel.visto', '', 2);
    props.push(ferramenta);
  });

  after(async () => {
    await db.query('DELETE FROM uso_sessoes WHERE sessao_id = ANY($1::uuid[])', [sessoes]);
    await db.query('DELETE FROM uso_diario WHERE dia = ANY($1::date[])', [dias]);
    await db.query('DELETE FROM uso_eventos_dia WHERE dia = ANY($1::date[])', [dias]);
    await teardownTestEnv(db);
  });

  it('a COSTURA: o dia agregado vale pelo agregado, e as sessões dele NÃO somam por cima', async () => {
    const r = await resumo({ desde: JANELA, agora: AGORA });
    const linha = doDia(r.sessoes.porDia, d50.texto);
    assert.ok(linha, 'o dia agregado precisa aparecer na série');
    // A SÉRIE É POR DIA E O AGREGADO É POR (dia, PÁGINA), então o número do dia é a soma das
    // duas linhas agregadas: 7 (`mapa`) + 3 (`atlas`) = 10. O que este caso discrimina é o
    // 12: seria esse o número se as duas sessões vivas de `mapa`, que já estão DENTRO do
    // agregado, somassem por cima dele.
    assert.equal(linha.sessoes, 10);
    assert.equal(linha.sessoesAutenticadas, 5 + 1);
    assert.equal(linha.sessoesComErro, 2 + 0);
    assert.equal(linha.usuariosDistintos, 4 + 1);
  });

  it('o dia fechado que a agregação NÃO alcançou aparece, contado pelas sessões', async () => {
    const r = await resumo({ desde: JANELA, agora: AGORA });
    const linha = doDia(r.sessoes.porDia, d49.texto);
    assert.ok(linha);
    assert.equal(linha.sessoes, 2);
    assert.equal(linha.sessoesAutenticadas, 2);
    assert.equal(linha.usuariosDistintos, 2);
    assert.equal(linha.sessoesComErro, 1);
  });

  it('o dia SEM sessão nenhuma aparece com zero, e não como buraco', async () => {
    const r = await resumo({ desde: JANELA, agora: AGORA });
    const linha = doDia(r.sessoes.porDia, d48.texto);
    assert.ok(linha, 'uma série que pula dias é lida como queda de uso');
    assert.equal(linha.sessoes, 0);
    assert.equal(linha.sessoesComErro, 0);
    // E a série cobre a janela inteira, do primeiro ao último dia, sem falta.
    assert.equal(r.sessoes.porDia.length, 7, 'seis dias de janela mais o dia corrente dela');
  });

  it('a FAIXA publicada é a janela ARREDONDADA PARA O DIA, nas duas pontas', async () => {
    // A metade nova do relatório encosta em colunas `date` e compara `dia >= $1::date AND
    // dia <= $2::date`: ela arredonda e é INCLUSIVA dos dois lados, enquanto a metade derivada
    // compara instantes num intervalo meio-aberto. Sem `faixa`, a única forma de o cliente
    // saber sobre quais dias a resposta fala seria refazer o arredondamento, e para isso ele
    // precisaria adivinhar o fuso do servidor.
    const r = await resumo({ desde: JANELA, agora: AGORA });
    assert.equal(r.sessoes.faixa.deDia, d51.texto, 'seis dias antes do fim, e não cinco');
    assert.equal(r.sessoes.faixa.ateDia, d45.texto, 'o dia do `agora` ENTRA na faixa');

    // A faixa é a mesma série que a tela desenha, ponta a ponta: publicá-la de outra fonte
    // abriria a chance de os dois números discordarem sobre o mesmo período.
    assert.equal(r.sessoes.faixa.deDia, r.sessoes.porDia[0].dia);
    assert.equal(r.sessoes.faixa.ateDia, r.sessoes.porDia[r.sessoes.porDia.length - 1].dia);
    assert.equal(r.sessoes.faixa.ateDia, r.disponibilidade[r.disponibilidade.length - 1].dia,
      'as duas séries precisam terminar no mesmo dia, senão os gráficos não se alinham');
  });

  it('os totais somam a SÉRIE, e os dois não-aditivos saem das sessões retidas', async () => {
    const r = await resumo({ desde: JANELA, agora: AGORA });
    // 10 (agregado de D-50, as duas páginas) + 2 (D-49) + 1 (D-45).
    assert.equal(r.sessoes.total, 13);
    assert.equal(r.sessoes.autenticadas, 5 + 1 + 2 + 1);
    assert.equal(r.sessoes.comErro, 2 + 1);

    // `usuariosDistintos` NÃO é a soma da série: a pessoa A aparece em D-50 e D-49, e a B em
    // D-49 e D-45. São DUAS pessoas, e a soma da coluna daria mais.
    assert.equal(r.sessoes.usuariosDistintos, 2);
    const somaDaColuna = r.sessoes.porDia.reduce((s, l) => s + l.usuariosDistintos, 0);
    assert.ok(somaDaColuna > r.sessoes.usuariosDistintos,
      'sem esta diferença o caso não discrimina a soma da contagem distinta');

    // A mediana das durações das cinco sessões RETIDAS da janela: 10, 90, 20, 40, 60 -> 40.
    assert.equal(r.sessoes.duracaoMedianaS, 40);
    assert.equal(r.sessoes.sessoesRetidas, 5,
      'o número que separa "ninguém usou" de "a retenção já levou as sessões"');
  });

  it('os GESTOS somam a janela inteira e vêm ordenados por contagem', async () => {
    const r = await resumo({ desde: JANELA, agora: AGORA });
    const ferramenta = r.ferramentas.find((f) => f.evento === 'ferramenta.ativada');
    assert.ok(ferramenta, 'o gesto semeado precisa aparecer');
    assert.equal(ferramenta.contagem, 42, 'a soma é da JANELA, não de um dia');

    const tresD = r.ferramentas.find((f) => f.evento === 'visualizador3d.aberto');
    assert.ok(tresD, 'o bloco NÃO é filtrado por ferramenta: os desfechos caros entram');
    assert.equal(tresD.contagem, 4);
    assert.equal(tresD.prop, '', 'o qualificador vazio é um VALOR, não ausência');

    const contagens = r.ferramentas.map((f) => f.contagem);
    assert.deepEqual(contagens, [...contagens].sort((a, b) => b - a), 'a ordem é decrescente');
  });

  it('o DESEMPENHO prefere a sessão e DECLARA a fonte quando ela não existe', async () => {
    const r = await resumo({ desde: JANELA, agora: AGORA });

    const mapa = r.desempenho.find((d) => d.pagina === 'mapa');
    assert.ok(mapa);
    assert.equal(mapa.origem, 'sessoes', 'onde há sessão, o p75 é o de verdade');
    assert.equal(mapa.amostras, 5, 'aqui `amostras` conta SESSÕES');
    // p75 de [900, 900, 500] -> 900. Se a linha viesse do agregado seria 1111, e é essa a
    // diferença que faz o caso discriminar a preferência.
    assert.equal(mapa.lcpP75Ms, 900);

    const atlas = r.desempenho.find((d) => d.pagina === 'atlas');
    assert.ok(atlas, 'a página que só tem agregado precisa aparecer');
    assert.equal(atlas.origem, 'diario', 'sem sessão retida, a fonte é o agregado e ela é DITA');
    assert.equal(atlas.amostras, 1, 'e aqui `amostras` conta DIAS, que é a razão de `origem` existir');
    assert.equal(atlas.lcpP75Ms, 2222);
    assert.equal(atlas.clsP75, 0.222);
  });

  it('a DISPONIBILIDADE é série densa, e o zero é a boa notícia', async () => {
    const r = await resumo({ desde: JANELA, agora: AGORA });
    assert.equal(doDia(r.disponibilidade, d48.texto).vistos, 5);
    assert.equal(doDia(r.disponibilidade, d47.texto).vistos, 2);
    assert.equal(doDia(r.disponibilidade, d49.texto).vistos, 0,
      'um buraco ao lado de um pico se leria como "não sabemos"');
    assert.equal(r.disponibilidade.length, r.sessoes.porDia.length,
      'as duas séries cobrem a mesma janela, senão os dois gráficos não se alinham');
  });

  it('o HORIZONTE de uso traz os dois instantes, e um deles é mais estreito que o outro', async () => {
    const r = await resumo({ desde: JANELA, agora: AGORA });
    assert.equal(typeof r.horizonte.usoDesde, 'number');
    assert.equal(typeof r.horizonte.usoSessoesDesde, 'number');
    assert.ok(
      r.horizonte.usoDesde <= r.horizonte.usoSessoesDesde,
      '`usoDesde` é o menor entre a sessão mais antiga e o dia agregado mais antigo'
    );
    // Ele é GLOBAL (sem `WHERE`), como o horizonte de `operations`: a pergunta é sobre a
    // TABELA, não sobre a janela. Por isso a asserção é sobre a ordem, e não sobre um
    // instante exato que outro arquivo desta rodada pode ter empurrado para trás.
    assert.ok(r.horizonte.usoDesde <= AGORA.getTime());
  });

  it('a ROTA devolve os quatro blocos, e continua fechada para quem não administra', async () => {
    await supertest(app).get('/api/v1/uso/resumo').expect(401);

    const r = await supertest(app)
      .get('/api/v1/uso/resumo?desde=6d')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    for (const bloco of ['sessoes', 'ferramentas', 'desempenho', 'disponibilidade']) {
      assert.ok(bloco in r.body.data, `o bloco ${bloco} sumiu do payload`);
    }
    assert.ok(Array.isArray(r.body.data.sessoes.porDia));
    assert.ok('usoDesde' in r.body.data.horizonte);
    assert.ok('usoSessoesDesde' in r.body.data.horizonte);
  });
});
