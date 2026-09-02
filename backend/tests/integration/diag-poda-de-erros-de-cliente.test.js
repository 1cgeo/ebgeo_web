// Path: tests/integration/diag-poda-de-erros-de-cliente.test.js
//
// A PODA OPORTUNISTA DE `defeitos` (a tabela se chamava `client_errors` até
// `018_defeitos_e_ocorrencias.sql`), e o total de antes do corte na listagem.
//
// O QUE ISTO FECHA. Até 2026-09-01 a tabela não tinha um DELETE em lugar nenhum do
// pacote: nem rota, nem job, nem roteiro. A dedupe por assinatura só segura quando a
// assinatura REPETE, e a assinatura é montada no CLIENTE, então dentro do próprio
// limitador de um único endereço cabiam dezenas de milhares de linhas novas por dia,
// permanentes. Era o modo de falha que o cabeçalho de
// `src/database/migrations/014_observabilidade.sql` diz estar evitando.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça, com a mensagem observada
// anotada no fim de cada caso):
//  - trocar `ultima_em` por `primeira_em` no DELETE: a assinatura ANTIGA e ainda ATIVA (o
//    defeito crônico, o dado mais valioso da tabela) é apagada, e o caso do critério
//    fica vermelho enquanto os dois casos de idade continuam verdes;
//  - tirar o `ORDER BY ... LIMIT` do subselect: o teto por passada deixa de valer e a
//    passada apaga tudo;
//  - trocar o `catch` de `talvezPodar` por um `throw`: a requisição que disparou a poda
//    passa a falhar, e o caso da falha fica vermelho;
//  - tirar a guarda de intervalo: a segunda chamada seguida volta a podar;
//  - tirar o gate de ambiente: a poda passa a rodar sozinha no meio da suíte;
//  - tirar a subconsulta escalar de `LIST_ERROS_CLIENTE`: `totalAssinaturas` some do
//    payload e a tela volta a não saber que a lista foi cortada.
//
// AS ASSERÇÕES SÃO SEMPRE SOBRE AS LINHAS MARCADAS DESTE ARQUIVO, nunca sobre contagem
// global: a poda age na tabela inteira, os arquivos de teste rodam em paralelo contra o
// mesmo banco, e uma contagem global aqui seria verde ou vermelha por trabalho alheio.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';
import {
  devePodar,
  talvezPodar,
  registrarErroDeCliente,
  listarErrosDeCliente,
  INTERVALO_MINIMO_DE_PODA_MS,
} from '../../src/modules/diag/defeitos.service.js';
import { LIST_ERROS_CLIENTE } from '../../src/modules/diag/defeitos.queries.js';

describe('defeitos: poda oportunista por idade e total antes do corte', () => {
  let app, db, admin, adminToken;
  const marca = randomUUID().slice(0, 8);
  const assinaturas = [];

  // O RELÓGIO INJETADO É MONOTÔNICO E DE PASSO LARGO, porque a guarda de intervalo é
  // estado de MÓDULO e sobrevive de um caso para o outro. Cada passada deliberada pede um
  // instante um dia à frente do anterior, o que faz a guarda deixar passar sempre, menos
  // no caso que a testa de propósito.
  let relogio = Date.now();
  const proximoInstante = () => (relogio += 86_400_000);

  /** Uma assinatura irrepetível: a tabela é compartilhada pela rodada inteira. */
  function assinatura(nome) {
    const a = `PodaTest | ${nome} | ${marca}`;
    assinaturas.push(a);
    return a;
  }

  /**
   * Semeia uma linha com as duas datas escolhidas em separado, que é o que permite
   * construir o caso do defeito crônico (nasceu há um ano, ocorreu hoje).
   */
  async function semear(a, { primeiraHaDias, ultimaHaDias }) {
    await db.query(
      `INSERT INTO defeitos (assinatura, mensagem, primeira_em, ultima_em)
       VALUES ($1, $2,
               NOW() - ($3::double precision * INTERVAL '1 day'),
               NOW() - ($4::double precision * INTERVAL '1 day'))`,
      [a, `semeada ${a}`, primeiraHaDias, ultimaHaDias],
    );
    return a;
  }

  const existe = async (a) => {
    const { rows } = await db.query('SELECT 1 FROM defeitos WHERE assinatura = $1', [a]);
    return rows.length === 1;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: `poda_adm_${randomUUID().slice(0, 6)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
  });

  // ── a decisão, pura ──

  it('a decisão de podar: o gate de ambiente vence tudo, e a primeira passada não espera', () => {
    const base = { agoraMs: 1_000_000, intervaloMs: INTERVALO_MINIMO_DE_PODA_MS };

    // O gate de teste é o PRIMEIRO ramo de propósito: em teste a poda não pode disparar
    // sozinha no meio de uma asserção sobre a tabela.
    assert.deepEqual(
      devePodar({ ...base, ultimaPodaEm: 0, emTeste: true }),
      { podar: false, motivo: 'teste' },
    );

    // Nunca podou neste processo: roda na primeira escrita, e não uma hora depois dela.
    assert.deepEqual(devePodar({ ...base, ultimaPodaEm: 0, emTeste: false }), { podar: true });

    // Dentro do intervalo: recusa.
    assert.deepEqual(
      devePodar({ ...base, ultimaPodaEm: base.agoraMs - 60_000, emTeste: false }),
      { podar: false, motivo: 'intervalo' },
    );

    // Na borda EXATA do intervalo já passou: `<` e não `<=`.
    assert.deepEqual(
      devePodar({ ...base, ultimaPodaEm: base.agoraMs - INTERVALO_MINIMO_DE_PODA_MS, emTeste: false }),
      { podar: true },
    );

    // Intervalo sem sentido não vira "podar sempre": falha FECHADA.
    for (const intervaloMs of [0, -1, NaN, Infinity, undefined]) {
      assert.deepEqual(
        devePodar({ agoraMs: 1_000_000, ultimaPodaEm: 0, intervaloMs, emTeste: false }),
        { podar: false, motivo: 'intervalo-invalido' },
        `intervalo ${intervaloMs} deveria falhar fechado`,
      );
    }
  });

  it('em teste a poda NÃO dispara sozinha: a escrita pela rota não apaga a linha velha', async () => {
    // ESTE CASO VEM ANTES DE QUALQUER PODA DELIBERADA, e a posição é a metade do teste.
    // Ele exercita o caminho de PRODUÇÃO (`talvezPodar()` sem argumento nenhum, como o
    // controller chama), e o único que pode barrar aí é o gate de ambiente: a guarda de
    // intervalo ainda não tem carimbo (`ultimaPodaEm` é zero) e a idade da semente passa
    // folgada dos 30 dias de `LOG_RETENTION_DAYS`. Medido: com o caso na ORDEM ERRADA,
    // depois das passadas deliberadas, o relógio injetado já tinha carimbado um instante
    // no futuro e era a GUARDA DE INTERVALO que segurava a poda, de modo que apagar o gate
    // de ambiente deixava este caso verde. Um caso que passa pelo motivo errado é o
    // verde-que-não-verifica da constituição.
    //
    // O que ele protege é concreto: sem o gate, esta mesma semente desapareceria no meio de
    // QUALQUER outro arquivo de teste que escrevesse um relato de erro de cliente.
    const velha = await semear(assinatura('gate'), { primeiraHaDias: 200, ultimaHaDias: 200 });

    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .send({ assinatura: assinatura('gate-gatilho'), mensagem: 'dispara a poda' })
      .expect(204);

    assert.equal(await existe(velha), true, 'a poda rodou sozinha em teste e comeu a semente');
  });

  // ── as duas metades da idade ──

  it('apaga o que passou da idade E PRESERVA o que está dentro dela', async () => {
    // As duas metades no MESMO caso, porque um teste que só prova que apaga fica verde
    // se a poda apagar tudo, que é o defeito pior dos dois.
    const velha = await semear(assinatura('velha'), { primeiraHaDias: 40, ultimaHaDias: 40 });
    const naBorda = await semear(assinatura('na-borda'), { primeiraHaDias: 29, ultimaHaDias: 29 });
    const nova = await semear(assinatura('nova'), { primeiraHaDias: 0.5, ultimaHaDias: 0.5 });

    const r = await talvezPodar({
      emTeste: false,
      agoraMs: proximoInstante(),
      retencaoDias: 30,
      teto: 1000,
    });
    assert.equal(r.podou, true, `a poda precisava rodar; veio ${JSON.stringify(r)}`);
    assert.ok(r.apagadas >= 1, 'a poda precisava apagar ao menos a linha de 40 dias');

    assert.equal(await existe(velha), false, 'a linha de 40 dias sobreviveu à poda de 30');
    assert.equal(await existe(naBorda), true, 'a linha de 29 dias foi apagada por uma poda de 30');
    assert.equal(await existe(nova), true, 'a linha de meio dia foi apagada por uma poda de 30');
  });

  it('o critério é `ultima_em`: a assinatura ANTIGA e ainda ATIVA sobrevive', async () => {
    // O defeito CRÔNICO: nasceu há um ano e disparou de novo hoje. É o dado mais valioso
    // da tabela, e podar por nascimento seria apagar exatamente ele.
    const cronica = await semear(assinatura('cronica'), { primeiraHaDias: 365, ultimaHaDias: 0.1 });
    // O par que fecha a asserção: mesma IDADE DE NASCIMENTO, sem ocorrência recente.
    const morta = await semear(assinatura('morta'), { primeiraHaDias: 365, ultimaHaDias: 365 });

    const r = await talvezPodar({
      emTeste: false,
      agoraMs: proximoInstante(),
      retencaoDias: 30,
      teto: 1000,
    });
    assert.equal(r.podou, true);

    assert.equal(
      await existe(cronica),
      true,
      'a assinatura de um ano AINDA ATIVA foi apagada: o critério virou `primeira_em`',
    );
    assert.equal(await existe(morta), false, 'a assinatura de um ano sem ocorrência recente ficou');
  });

  it('o teto limita a passada, e o que sobra sai na próxima', async () => {
    const velhas = [];
    for (let i = 0; i < 4; i += 1) {
      // Idades distintas: o subselect ordena por `ultima_em`, então as mais velhas saem
      // primeiro, e é isso que impede duas passadas de circularem pela cauda.
      velhas.push(await semear(assinatura(`teto-${i}`), {
        primeiraHaDias: 100 + i, ultimaHaDias: 100 + i,
      }));
    }

    const primeira = await talvezPodar({
      emTeste: false, agoraMs: proximoInstante(), retencaoDias: 30, teto: 2,
    });
    assert.equal(primeira.podou, true);
    assert.equal(primeira.apagadas, 2, 'a passada ignorou o teto de 2 linhas');

    const vivas = [];
    for (const a of velhas) if (await existe(a)) vivas.push(a);
    assert.equal(vivas.length, 2, 'sobraram duas linhas velhas para a próxima passada');

    const segunda = await talvezPodar({
      emTeste: false, agoraMs: proximoInstante(), retencaoDias: 30, teto: 2,
    });
    assert.equal(segunda.apagadas, 2, 'a segunda passada precisava continuar de onde a primeira parou');
    assert.equal(velhas.length, 4, 'sem as quatro sementes o laço abaixo não asseria nada');
    for (const a of velhas) {
      assert.equal(await existe(a), false, `${a} sobreviveu às duas passadas`);
    }
  });

  // ── a guarda de intervalo ──

  it('a guarda de intervalo não deixa a poda rodar duas vezes seguidas', async () => {
    const alvo = await semear(assinatura('intervalo'), { primeiraHaDias: 90, ultimaHaDias: 90 });
    const instante = proximoInstante();

    const primeira = await talvezPodar({
      emTeste: false, agoraMs: instante, retencaoDias: 30, teto: 1000,
    });
    assert.equal(primeira.podou, true);
    assert.equal(await existe(alvo), false);

    // Um minuto depois, com o mesmo intervalo mínimo de uma hora: recusa, e recusa
    // NOMEANDO o motivo, para que "não apagou nada" não se confunda com "não rodou".
    const segunda = await talvezPodar({
      emTeste: false,
      agoraMs: instante + 60_000,
      intervaloMs: INTERVALO_MINIMO_DE_PODA_MS,
      retencaoDias: 30,
      teto: 1000,
    });
    assert.deepEqual(segunda, { podou: false, motivo: 'intervalo' });
  });

  // ── a poda não derruba quem a disparou ──

  it('poda que FALHA não derruba a requisição, e a linha do relato continua gravada', async () => {
    const a = assinatura('poda-quebrada');

    // `retencaoDias` inválido faz o `$1::int` do DELETE estourar no driver, que é uma
    // falha REAL do mesmo caminho (não um duplo de teste): o UPSERT já aconteceu, e o que
    // se afirma aqui é que o erro da higiene não sobe.
    await registrarErroDeCliente(
      { assinatura: a, mensagem: 'a poda vai quebrar depois de mim' },
      null,
      { emTeste: false, agoraMs: proximoInstante(), retencaoDias: 'trinta', teto: 1000 },
    );

    assert.equal(await existe(a), true, 'o relato se perdeu porque a higiene falhou');
  });

  it('a falha da poda é RELATADA, nunca engolida em silêncio', async () => {
    // Um `catch` vazio seria o verificador quebrando calado: a tabela cresceria para
    // sempre e o sintoma apareceria como disco cheio, meses depois e longe daqui.
    const avisos = [];
    const r = await talvezPodar({
      emTeste: false,
      agoraMs: proximoInstante(),
      retencaoDias: 'trinta',
      teto: 1000,
      registrar: {
        info: () => {},
        warn: (obj, msg) => avisos.push({ obj, msg }),
        error: () => {},
      },
    });

    assert.deepEqual(r, { podou: false, motivo: 'falha' });
    assert.equal(avisos.length, 1, 'a falha de poda passou muda');
    assert.match(avisos[0].msg, /podar defeitos/);
    assert.ok(avisos[0].obj.err, 'o aviso precisa carregar a causa, senão não diagnostica nada');
  });

  it('depois de uma falha a guarda continua valendo: a poda não vira tempestade de log', async () => {
    // O carimbo do relógio é posto ANTES do DELETE. Marcá-lo só no sucesso faria CADA
    // requisição seguinte tentar de novo e escrever um aviso, em cima de um banco que já
    // está sofrendo.
    const instante = proximoInstante();
    await talvezPodar({ emTeste: false, agoraMs: instante, retencaoDias: 'trinta', teto: 1000, registrar: { info() {}, warn() {}, error() {} } });
    const seguinte = await talvezPodar({
      emTeste: false, agoraMs: instante + 60_000, retencaoDias: 30, teto: 1000,
    });
    assert.deepEqual(seguinte, { podou: false, motivo: 'intervalo' });
  });

  // ── o total de antes do corte ──

  it('`totalAssinaturas` é MAIOR que a lista quando o limite corta', async () => {
    for (let i = 0; i < 6; i += 1) {
      await semear(assinatura(`total-${i}`), { primeiraHaDias: 0.01 * i, ultimaHaDias: 0.01 * i });
    }

    const cortado = await listarErrosDeCliente({ desde: '1h', limite: 3 });
    assert.equal(cortado.itens.length, 3, 'o limite precisa ter cortado, senão o caso não mede nada');
    assert.ok(
      cortado.totalAssinaturas > cortado.itens.length,
      `o total precisava ser maior que a lista: total=${cortado.totalAssinaturas}, itens=${cortado.itens.length}`,
    );

    // E o número é o da JANELA, não um teto arbitrário: pedindo tudo, os dois coincidem.
    const inteiro = await listarErrosDeCliente({ desde: '1h', limite: 200 });
    assert.equal(
      inteiro.totalAssinaturas,
      cortado.totalAssinaturas,
      'o total mudou com o limite, ou seja, ele está sendo contado DEPOIS do corte',
    );
    assert.ok(inteiro.itens.length <= inteiro.totalAssinaturas);
  });

  it('o total respeita a janela e não conta a tabela inteira', async () => {
    const foraDaJanela = await semear(assinatura('fora-da-janela'), {
      primeiraHaDias: 5, ultimaHaDias: 5,
    });

    const curta = await listarErrosDeCliente({ desde: '1h', limite: 200 });
    const larga = await listarErrosDeCliente({ desde: '7d', limite: 200 });

    assert.ok(
      larga.totalAssinaturas > curta.totalAssinaturas,
      `a janela de 7d precisa contar mais que a de 1h: 7d=${larga.totalAssinaturas}, 1h=${curta.totalAssinaturas}`,
    );
    assert.equal(curta.itens.some((i) => i.assinatura === foraDaJanela), false);
    assert.equal(larga.itens.some((i) => i.assinatura === foraDaJanela), true);
  });

  it('a rota devolve `totalAssinaturas` e nenhum campo do item mudou de nome', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/erros-cliente?desde=1h&limite=3')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    assert.equal(typeof res.body.data.totalAssinaturas, 'number');
    assert.equal(typeof res.body.data.desde, 'number');
    assert.ok(Array.isArray(res.body.data.itens));
    assert.ok(res.body.data.totalAssinaturas >= res.body.data.itens.length);

    // O resto do payload é o mesmo de antes: `total_assinaturas` é detalhe da query e não
    // pode ter vazado para dentro do item.
    const item = res.body.data.itens[0];
    assert.ok(item, 'a janela precisa ter ao menos um item, senão o caso não mede nada');
    // As quatro últimas nasceram em `017_erro_cliente_identidade.sql` (2026-09-01) e são
    // ADITIVAS: nenhum nome anterior mudou, e é isso que esta lista continua cobrando.
    assert.deepEqual(
      Object.keys(item).sort(),
      ['assinatura', 'atlasId', 'contexto', 'id', 'mensagem', 'ocorrencias', 'origem',
        'pagina', 'primeiraEm', 'release', 'sessaoId', 'stack', 'stackBruta', 'ultimaEm',
        'url', 'userAgent', 'userId', 'username'],
      'o shape do item mudou',
    );
  });

  it('a lista vazia só pode significar total zero porque o predicado é o MESMO nos dois lugares', () => {
    // Este é o caso que a leitura "o total vem da primeira linha" poderia quebrar, e ele
    // NÃO é testável por dado: a tabela é compartilhada e nenhuma janela pedida a um
    // relógio que anda pode ser garantidamente vazia numa suíte paralela. Um caso que
    // dependesse disso passaria quase sempre e falharia por vizinho, ensinando a duvidar
    // do teste. O que se prende então é a PROPRIEDADE que torna a leitura correta: o
    // mesmo `$1` filtra a lista e alimenta a contagem, então zero linhas implica zero na
    // contagem. Divergir os dois é o que produziria "50 de 400" ao lado de uma lista de 3.
    const ocorrencias = LIST_ERROS_CLIENTE.match(/ultima_em >= \$1/g) ?? [];
    assert.equal(
      ocorrencias.length,
      2,
      `esperava o mesmo predicado na contagem e no corpo, achei ${ocorrencias.length} ocorrência(s)`,
    );
    assert.match(
      LIST_ERROS_CLIENTE,
      /\(SELECT COUNT\(\*\)::int FROM defeitos\s+WHERE ultima_em >= \$1 AND origem IS DISTINCT FROM 'servidor'\) AS total_assinaturas/,
      'a contagem deixou de ser a subconsulta escalar medida no cabeçalho da query',
    );
    // E o `COUNT(*) OVER ()`, que é a forma tentadora, fica fora: medido, ele materializa
    // a janela inteira antes do LIMIT e levou a rota de 0,05 ms a 257 ms.
    assert.equal(/COUNT\(\*\) OVER/.test(LIST_ERROS_CLIENTE), false);
  });
});
