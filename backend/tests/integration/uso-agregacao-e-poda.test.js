// Path: tests/integration/uso-agregacao-e-poda.test.js
/**
 * @fileoverview A PASSADA DE MANUTENÇÃO: agregar o dia fechado e só então podar as sessões
 * vencidas.
 *
 * ELA É UMA FUNÇÃO SÓ, E O TESTE MEDE A CONJUNÇÃO, porque a ordem é o contrato inteiro:
 * invertida, a poda leva embora as sessões de um dia que ainda não virou linha em
 * `uso_diario`, e o dia some do relatório sem erro nenhum, sem log e sem nada ficar vermelho.
 *
 * O CONTROLE NEGATIVO ESTÁ NA FORMA DA ASSERÇÃO, e não numa frase: o caso principal semeia um
 * dia, roda a passada, e exige AO MESMO TEMPO que `uso_diario` carregue os números daquelas
 * sessões e que as sessões não existam mais. Pular a agregação deixa `uso_diario` vazio e o
 * caso reprova nomeando o dia; pular a poda deixa as sessões de pé e ele reprova também.
 * Medido revertendo cada metade, nas duas direções.
 *
 * ─── ESTE ARQUIVO ESCREVE NUMA TABELA COMPARTILHADA, E A DEPENDÊNCIA ESTÁ DECLARADA ───
 *
 * `agregarEPodar` é GLOBAL por construção: ela varre `uso_sessoes` inteira e apaga por idade,
 * sem filtro por marca. Num arquivo de teste isso significa que ela alcança o que os arquivos
 * VIZINHOS semearam, e por isso a retenção usada aqui é ENORME de propósito
 * ({@link RETENCAO_LARGA}, duzentos dias): o dado mais antigo que qualquer irmão desta família
 * semeia tem setenta dias (`diag-status-releases.test.js`), então a poda deste arquivo não
 * alcança nenhum deles, e as asserções de contagem daqueles arquivos continuam valendo mesmo
 * numa rodada paralela. As sessões PRÓPRIAS ficam além dos duzentos dias, que é o que as torna
 * podáveis sem levar mais ninguém junto.
 *
 * A METADE QUE NÃO DÁ PARA ISOLAR, dita em voz alta: com retenção larga, a AGREGAÇÃO alcança os
 * dias dos vizinhos e pode criar linha em `uso_diario` para eles. Isso é NUMERICAMENTE NEUTRO,
 * e o motivo é a própria invariante da costura: `SESSOES_POR_DIA` calcula o mesmo número a
 * partir das duas fontes enquanto todas as sessões do dia existem, então uma linha agregada a
 * mais não muda resposta nenhuma. O único caso em que os dois lados divergem de propósito é o
 * `d50` de `uso-resumo-blocos.test.js`, que semeia um agregado MAIOR que as sessões vivas para
 * medir a precedência; ali quem protege é o `WHERE EXCLUDED.sessoes >= uso_diario.sessoes` da
 * própria consulta, que recusa encolher a linha. As duas propriedades juntas são a razão de
 * esta interferência ser aceitável em vez de tolerada.
 *
 * O RELÓGIO DA GUARDA É ESTADO DE MÓDULO, e é por isso que `_zerarRelogioDeManutencao` existe e
 * é chamado a cada caso: sem ele o segundo caso mediria `motivo: 'intervalo'` achando que mediu
 * a manutenção. Ele é local ao PROCESSO, então nenhum arquivo vizinho o enxerga.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';
import {
  agregarEPodar, _zerarRelogioDeManutencao,
} from '../../src/modules/uso/uso.eventos.service.js';

/**
 * A retenção que toda passada deste arquivo usa. Ver o cabeçalho: ela é grande para que a poda
 * não alcance o que os arquivos vizinhos semearam, e as sessões próprias nascem além dela.
 */
const RETENCAO_LARGA = 200;

/**
 * A idade das sessões que este arquivo quer ver PODADAS: um dia além da retenção.
 *
 * O `+ 1` casa com o piso da agregação (`retenção + 1` dias, ver `AGREGAR_DIAS_FECHADOS`), e é
 * justamente a faixa de um dia em que agregar e podar acontecem na MESMA passada. Escolher
 * `+ 2` deixaria o dia fora do alcance da agregação e o caso principal mediria outra coisa.
 */
const IDADE_PODAVEL = RETENCAO_LARGA + 1;

/** Um registrador mudo: a passada loga, e a saída do pino não é o sujeito deste arquivo. */
const mudo = { info() {}, warn() {} };

describe('Uso do produto — a passada de manutenção (agregar, depois podar)', () => {
  let db, usuario;
  const sessoes = [];
  const dias = [];

  /** O dia D-n, como `Date` na meia-noite local do servidor (o mesmo fuso das colunas). */
  async function diaAtras(n) {
    const { rows } = await db.query('SELECT (CURRENT_DATE - $1::int) AS d', [n]);
    dias.push(rows[0].d);
    return rows[0].d;
  }

  /**
   * Semeia uma sessão diretamente, com o dia e a idade escolhidos.
   *
   * PELO SQL E NÃO PELA ROTA, de propósito: a rota prende o instante entre o relógio do
   * servidor e a retenção (é o que `uso-eventos-persistencia.test.js` mede), então ela é
   * incapaz de criar a sessão VELHA que esta passada existe para agregar e podar.
   */
  async function semear(dia, pagina, campos = {}) {
    const id = randomUUID();
    sessoes.push(id);
    const {
      userId = null, duracaoS = 30, erros = 0, release = null,
      lcp = null, inp = null, cls = null, ateMapa = null, idadeDias = IDADE_PODAVEL,
    } = campos;
    await db.query(
      `INSERT INTO uso_sessoes (
         sessao_id, dia, user_id, pagina_inicial, release, navegador,
         inicio, ultimo_sinal, eventos, erros, lcp_ms, inp_ms, cls, tempo_ate_mapa_ms
       ) VALUES (
         $1, $2, $3, $4, $5, 'Chrome',
         NOW() - ($6::int * INTERVAL '1 day') - ($7::int * INTERVAL '1 second'),
         NOW() - ($6::int * INTERVAL '1 day'),
         0, $8, $9, $10, $11, $12
       )`,
      [id, dia, userId, pagina, release, idadeDias, duracaoS, erros, lcp, inp, cls, ateMapa]
    );
    return id;
  }

  const passada = () => agregarEPodar({
    emTeste: false, retencaoDias: RETENCAO_LARGA, registrar: mudo,
  });

  const diarioDe = (dia, pagina) => db.query(
    'SELECT * FROM uso_diario WHERE dia = $1 AND pagina = $2', [dia, pagina]
  ).then((r) => r.rows[0]);

  const sessoesVivas = (dia) => db.query(
    'SELECT COUNT(*)::int AS n FROM uso_sessoes WHERE dia = $1', [dia]
  ).then((r) => r.rows[0].n);

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    usuario = await createUser(db, { username: `usoag_${randomUUID().slice(0, 6)}` });
  });

  beforeEach(() => {
    _zerarRelogioDeManutencao();
  });

  after(async () => {
    await db.query('DELETE FROM uso_sessoes WHERE sessao_id = ANY($1::uuid[])', [sessoes]);
    await db.query('DELETE FROM uso_diario WHERE dia = ANY($1::date[])', [dias]);
    await teardownTestEnv(db);
  });

  it('o agregado do dia é EXATAMENTE o das sessões que a passada apaga em seguida', async () => {
    const dia = await diaAtras(IDADE_PODAVEL);
    // Três sessões numa página e uma noutra. Duas do mesmo usuário e uma anônima: é o que
    // separa `sessoes`, `sessoes_autenticadas` e `usuarios_distintos`, que num conjunto
    // homogêneo seriam o mesmo número e não discriminariam nada.
    await semear(dia, 'mapa', { userId: usuario.id, duracaoS: 10, lcp: 100, inp: 10, cls: 0.1, ateMapa: 1000 });
    await semear(dia, 'mapa', { userId: usuario.id, duracaoS: 20, erros: 2, lcp: 200, inp: 20, cls: 0.2, ateMapa: 2000 });
    await semear(dia, 'mapa', { duracaoS: 60, lcp: 300, inp: 30, cls: 0.3, ateMapa: 3000 });
    await semear(dia, 'atlas', { duracaoS: 5 });

    const r = await passada();
    assert.equal(r.passou, true, `a passada não rodou: ${r.motivo}`);

    const mapa = await diarioDe(dia, 'mapa');
    assert.ok(mapa, 'o dia fechado precisa ter virado linha em uso_diario');
    assert.equal(mapa.sessoes, 3);
    assert.equal(mapa.sessoes_autenticadas, 2);
    assert.equal(mapa.usuarios_distintos, 1, 'duas sessões da mesma pessoa são UMA pessoa');
    assert.equal(mapa.sessoes_com_erro, 1);
    // Mediana de [10, 20, 60].
    assert.equal(mapa.duracao_mediana_s, 20);
    // p75 de [100, 200, 300] com interpolação: 250. Os quatro vitais usam a mesma amostra
    // deslocada, para que uma coluna trocada por outra fique vermelha.
    assert.equal(mapa.lcp_p75_ms, 250);
    assert.equal(mapa.inp_p75_ms, 25);
    assert.equal(Number(mapa.cls_p75), 0.25);
    assert.equal(mapa.tempo_ate_mapa_p75_ms, 2500);

    const atlas = await diarioDe(dia, 'atlas');
    assert.ok(atlas, 'cada página vira a sua linha');
    assert.equal(atlas.sessoes, 1);
    assert.equal(atlas.duracao_mediana_s, 5);
    // Página sem mapa não tem vital de carga, e o NULL precisa sobreviver: zero seria uma
    // MEDIDA ("o mapa apareceu instantaneamente").
    assert.equal(atlas.lcp_p75_ms, null);
    assert.equal(atlas.tempo_ate_mapa_p75_ms, null);

    // A OUTRA METADE DA CONJUNÇÃO: as sessões que geraram os números acima não existem mais.
    // O dia está a `retenção + 1` de distância, que é exatamente a faixa em que a agregação
    // ainda enxerga e a poda já alcança.
    assert.equal(await sessoesVivas(dia), 0, 'a poda tem de ter levado as sessões vencidas');
  });

  it('o dia FECHADO mas ainda DENTRO da retenção é agregado e NÃO é podado', async () => {
    // A distinção que separa as duas metades: "fechado" é sobre o CALENDÁRIO (o dia acabou) e
    // "vencido" é sobre a RETENÇÃO. Sem este caso, uma poda que apagasse tudo o que foi
    // agregado passaria verde no caso anterior.
    const dia = await diaAtras(2);
    await semear(dia, 'mapa', { idadeDias: 2, duracaoS: 42 });

    assert.equal((await passada()).passou, true);

    const linha = await diarioDe(dia, 'mapa');
    assert.ok(linha, 'o dia de anteontem já fechou e precisa estar agregado');
    assert.equal(linha.sessoes, 1);
    assert.equal(linha.duracao_mediana_s, 42);
    assert.equal(await sessoesVivas(dia), 1, 'dentro da retenção a sessão FICA');
  });

  it('o dia de HOJE não é agregado, porque ele ainda não terminou', async () => {
    const { rows } = await db.query('SELECT CURRENT_DATE AS d');
    const hoje = rows[0].d;
    const id = await semear(hoje, 'admin', { idadeDias: 0, duracaoS: 7 });

    await passada();

    assert.equal(await diarioDe(hoje, 'admin'), undefined,
      'agregar o dia corrente publicaria um número que ainda vai crescer');
    const viva = await db.query('SELECT 1 FROM uso_sessoes WHERE sessao_id = $1', [id]);
    assert.equal(viva.rowCount, 1);
    // Limpeza local: `hoje` não entra em `dias`, para não apagar linhas de outro arquivo.
  });

  it('a linha CONVERGE: a sessão que chega tarde para um dia já agregado entra no número', async () => {
    // É O CASO QUE O `DO NOTHING` PERDIA, e ele não é excêntrico: é a fila offline
    // descarregando de manhã o que foi feito na véspera. Com `DO NOTHING`, aquela sessão sumia
    // dos DOIS lados, porque `SESSOES_POR_DIA` deixa `uso_diario` vencer onde ele existe.
    const dia = await diaAtras(3);
    await semear(dia, 'mapa', { idadeDias: 3, duracaoS: 11 });

    await passada();
    const primeira = await diarioDe(dia, 'mapa');
    assert.ok(primeira);
    assert.equal(primeira.sessoes, 1);
    assert.equal(primeira.duracao_mediana_s, 11);

    await semear(dia, 'mapa', { idadeDias: 3, duracaoS: 31 });
    _zerarRelogioDeManutencao();
    await passada();

    const segunda = await diarioDe(dia, 'mapa');
    assert.equal(segunda.sessoes, 2, 'o lote atrasado precisa entrar no dia dele');
    // Mediana de [11, 31]: interpolada, 21.
    assert.equal(segunda.duracao_mediana_s, 21, 'e as MEDIDAS também são recalculadas');

    const quantas = await db.query(
      'SELECT COUNT(*)::int AS n FROM uso_diario WHERE dia = $1 AND pagina = $2', [dia, 'mapa']
    );
    assert.equal(quantas.rows[0].n, 1, 'convergir não é duplicar: a PK continua sendo uma linha');
  });

  it('a convergência NÃO ANDA PARA TRÁS: um dia meio podado não encolhe a linha publicada', async () => {
    // A poda mira um INSTANTE e a agregação agrupa por DIA, então na fronteira da retenção um
    // dia pode ter parte das sessões apagada. Sem o `WHERE EXCLUDED.sessoes >= uso_diario.sessoes`,
    // a passada seguinte recomputaria aquele dia a partir do subconjunto sobrevivente e
    // sobrescreveria um número correto por um menor, plausível e definitivo.
    const dia = await diaAtras(4);
    await semear(dia, 'mapa', { idadeDias: 4, duracaoS: 77 });
    await db.query(
      `INSERT INTO uso_diario (
         dia, pagina, sessoes, sessoes_autenticadas, usuarios_distintos, sessoes_com_erro,
         duracao_mediana_s
       ) VALUES ($1, 'mapa', 99, 40, 30, 5, 123)`,
      [dia]
    );

    await passada();

    const linha = await diarioDe(dia, 'mapa');
    assert.equal(linha.sessoes, 99, 'a linha publicada não pode encolher para o que sobrou');
    assert.equal(linha.duracao_mediana_s, 123, 'e nenhuma das medidas dela é reescrita junto');
  });

  it('a guarda de intervalo bloqueia a segunda passada, e o modo de teste bloqueia a primeira', async () => {
    assert.equal((await passada()).passou, true);
    assert.deepEqual(await passada(), { passou: false, motivo: 'intervalo' });

    _zerarRelogioDeManutencao();
    const emTeste = await agregarEPodar({ retencaoDias: RETENCAO_LARGA, registrar: mudo });
    assert.deepEqual(emTeste, { passou: false, motivo: 'teste' },
      'o default em teste PRECISA ser não podar: um DELETE que ninguém pediu no meio de uma '
      + 'asserção sobre a tabela é vermelho que vem do vizinho');
  });

  it('NUNCA LANÇA, e a AGREGAÇÃO falhando impede a poda de rodar', async () => {
    // A manutenção não é parte do contrato da rota: quando ela falha, o lote já foi gravado e
    // a resposta segue 204. `retencaoDias` inválido derruba o `$2::int` da AGREGAÇÃO, que é a
    // primeira metade, e o motivo devolvido prova que a segunda não rodou: os dois `try` são
    // separados justamente para que a metade destrutiva não aconteça sobre uma agregação que
    // não aconteceu.
    const avisos = [];
    const r = await agregarEPodar({
      emTeste: false,
      retencaoDias: 'duzentos',
      registrar: { info() {}, warn: (obj, msg) => avisos.push(msg) },
    });
    assert.equal(r.passou, false);
    assert.equal(r.motivo, 'falha-agregacao', 'a poda não pode rodar depois de a agregação falhar');
    assert.equal(avisos.length, 1, 'falha de manutenção não pode ser MUDA');
    assert.match(avisos[0], /agregar/);
  });
});
