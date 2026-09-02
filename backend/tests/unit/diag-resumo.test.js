// Path: tests/unit/diag-resumo.test.js
//
// `montarResumo` e `compararP95`: a COMPOSIÇÃO de uma tela, sem disco e sem banco.
//
// POR QUE ESTE ARQUIVO EXISTE. O `resumo` tem cinco blocos com DUAS fontes, e o que ele
// promete não é a soma dos números: é que um bloco cuja fonte não respondeu DIGA isso em vez
// de imprimir zero. Essa é uma propriedade da COMPOSIÇÃO, não da leitura, e ela tem cinco
// caminhos de indisponibilidade. Um teste que precisasse derrubar o Postgres para exercer "o
// banco está fora" não seria escrito, e é exatamente por isso que a composição mora numa
// função pura em `src/utils/diag-consulta.js` e recebe as peças prontas.
//
// A LIÇÃO QUE ELE PRENDE é a que a aba de Diagnóstico já pagou (`diretorioAusente`, em
// `docs/wiki/observabilidade.md`): "nenhum erro nas últimas 24 horas" desenhado a partir de
// um instrumento DESLIGADO é cobertura vazia passando verde na forma de interface. Num
// relatório de uma tela isso é pior, porque a boa notícia falsa aparece ao lado de quatro
// verdadeiras e ganha a credibilidade delas.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//  - fazer o bloco de arquivo devolver `{ disponivel: true, total: 0 }` com `leitura.ausente`:
//    os três casos de instrumento cego ficam vermelhos, e o modo de falha real é a tela
//    afirmando saúde a partir de ausência de medição;
//  - trocar `taxaDeErro: null` por `0` com zero requisições: o caso da janela vazia fica
//    vermelho;
//  - trocar `p95Anterior: null` por `0` numa rota sem base: o caso da rota nova fica
//    vermelho, e o relatório passaria a gritar em toda rota que um deploy criou;
//  - somar as linhas de `origem` nula ao balde do cliente: o caso do recorte ternário fica
//    vermelho, e a tela inventaria procedência para a maioria das linhas da tabela.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { montarResumo, compararP95, TOPO_DE_DEFEITOS, ROTAS_COMPARADAS } from '../../src/utils/diag-consulta.js';

const HORA = 3_600_000;
const FIM = 1_788_000_000_000;
const PERIODO = { desde: '24h', desdeMs: 24 * HORA, inicio: FIM - 24 * HORA, fim: FIM };

const LEITURA_VIVA = { diretorio: '/var/log/ebgeo', ausente: false, arquivos: 2, linhas: 4321 };

/** Um defeito com a forma que `listarDefeitos` devolve (epoch ms, camelCase). */
function defeito(campos = {}) {
  return {
    id: campos.id ?? 'd-1',
    mensagem: campos.mensagem ?? 'TypeError: x is not a function',
    estado: campos.estado ?? 'aberto',
    origem: 'origem' in campos ? campos.origem : 'store',
    ocorrencias: campos.ocorrencias ?? 1,
    primeiraEm: campos.primeiraEm ?? FIM - 2 * HORA,
    ultimaEm: campos.ultimaEm ?? FIM - HORA,
  };
}

const rota = (nome, n, p95) => ({ rota: nome, release: null, n, p50: p95 / 2, p95, max: p95 * 2 });

describe('compararP95: a base ausente NÃO é zero', () => {
  it('com as duas medições, entrega delta absoluto e percentual', () => {
    assert.deepEqual(compararP95(120, 100), { p95: 120, p95Anterior: 100, delta: 20, deltaPct: 20 });
    assert.deepEqual(compararP95(80, 100), { p95: 80, p95Anterior: 100, delta: -20, deltaPct: -20 });
  });

  it('rota sem base na janela anterior sai com delta null, e NÃO com um delta enorme', () => {
    // Uma rota que um deploy acabou de criar não ficou infinitamente mais lenta: ela não tem
    // com o que ser comparada. Zero na base faria o relatório gritar exatamente onde não há
    // nada a dizer, e quem lê aprenderia a ignorar a coluna.
    assert.deepEqual(compararP95(120, null), { p95: 120, p95Anterior: null, delta: null, deltaPct: null });
    assert.deepEqual(compararP95(120, undefined), { p95: 120, p95Anterior: null, delta: null, deltaPct: null });
  });

  it('base ZERO tem delta absoluto e NÃO tem percentual (não se divide por zero)', () => {
    const r = compararP95(50, 0);
    assert.equal(r.delta, 50);
    assert.equal(r.deltaPct, null, 'Infinity se imprime como número e não é um');
  });

  it('percentual é arredondado a uma casa, e o sinal sobrevive', () => {
    assert.equal(compararP95(133, 100).deltaPct, 33);
    assert.equal(compararP95(101, 300).deltaPct, -66.3);
  });
});

describe('montarResumo: bloco sem fonte DIZ isso, e nunca imprime zero', () => {
  it('sem banco, os DOIS blocos de banco se declaram cegos e não trazem contagem nenhuma', () => {
    const r = montarResumo({
      periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null, defeitosErro: 'Postgres fora',
      latencia: [rota('GET /api/config', 10, 5)], latenciaAnterior: [],
      amostras: { situacao: 'medida', total: 3, faltantes: 0, esperadas: 3, buracos: [], maiorBuraco: null, desdeUltimaMs: 1, ultimaAtrasada: false, intervaloMs: 300000, intervaloOrigem: 'inferido', estimativaFragil: false, discoNaUltima: null },
      status: { total: 10, porFaixa: { '2xx': 10 }, erros: 0 },
    });

    for (const nome of ['defeitos', 'indisponivel']) {
      assert.equal(r[nome].disponivel, false, `${nome} tinha de se declarar sem fonte`);
      assert.match(r[nome].motivo, /Postgres fora/);
      assert.equal(r[nome].premissa, null);
      // A ASSERÇÃO QUE IMPORTA: nenhuma contagem ao lado de `disponivel: false`. Um zero aqui
      // se leria como "nenhum defeito", que é o oposto de "não sei".
      assert.equal(r[nome].novos, undefined);
      assert.equal(r[nome].topo, undefined);
      assert.equal(r[nome].defeitos, undefined);
    }
    // E os três de arquivo continuam vivos: a queda de uma fonte não derruba a outra.
    assert.equal(r.latencia.disponivel, true);
    assert.equal(r.saude.disponivel, true);
    assert.equal(r.status.disponivel, true);
  });

  it('sem diretório de log, os TRÊS blocos de arquivo se declaram cegos', () => {
    const r = montarResumo({
      periodo: PERIODO,
      leitura: { diretorio: '/nao/existe', ausente: true, arquivos: 0, linhas: 0 },
      defeitos: { itens: [defeito()], totalDefeitos: 1 },
      amostras: null, status: null,
    });

    for (const nome of ['latencia', 'saude', 'status']) {
      assert.equal(r[nome].disponivel, false, `${nome} tinha de se declarar cego`);
      assert.match(r[nome].motivo, /CEGO/, 'o motivo precisa dizer que o INSTRUMENTO está desligado');
      assert.equal(r[nome].premissa, null);
      assert.equal(r[nome].total, undefined);
      assert.equal(r[nome].rotas, undefined);
    }
    assert.equal(r.defeitos.disponivel, true);
    assert.equal(r.indisponivel.disponivel, true);
  });

  it('leitura NULA (nem se tentou ler) é outro motivo, e não o mesmo texto', () => {
    const r = montarResumo({ periodo: PERIODO, leitura: null, defeitos: null });
    assert.equal(r.latencia.disponivel, false);
    assert.match(r.latencia.motivo, /não foi lido/);
    assert.doesNotMatch(r.latencia.motivo, /CEGO/, 'não foi lido é diferente de diretório ausente');
  });

  it('as DUAS fontes fora: os cinco blocos falam, e nenhum imprime número', () => {
    const r = montarResumo({ periodo: PERIODO, leitura: null, defeitos: null });
    const blocos = ['defeitos', 'latencia', 'saude', 'indisponivel', 'status'];
    for (const nome of blocos) {
      assert.equal(r[nome].disponivel, false, nome);
      assert.ok(r[nome].motivo.length > 20, `${nome} precisa de motivo escrito`);
    }
    // Não-vacuidade: se um bloco sumisse do retorno, o laço acima passaria por omissão.
    assert.deepEqual(Object.keys(r).sort(), ['defeitos', 'indisponivel', 'latencia', 'periodo', 'saude', 'status']);
  });

  it('NÃO devolve um campo `janela`: ele colide com o envelope do --json', () => {
    // O choque já aconteceu uma vez, CALADO, com `resumirAmostras`: o resumo sobrescrevia o
    // envelope e o documento saía sem dizer de qual diretório veio. `escreverJson` lança
    // desde então, e este caso é o cinto: o campo nasce com outro nome de propósito.
    const r = montarResumo({ periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null });
    for (const proibido of ['janela', 'comando', 'gerado_em']) {
      assert.equal(Object.hasOwn(r, proibido), false, `\`${proibido}\` é do envelope`);
    }
    assert.deepEqual(r.periodo, PERIODO);
  });
});

describe('montarResumo: bloco 1, os defeitos', () => {
  const itens = [
    defeito({ id: 'novo', primeiraEm: FIM - 2 * HORA, ocorrencias: 3 }),
    defeito({ id: 'antigo', primeiraEm: FIM - 40 * HORA, ultimaEm: FIM - HORA, ocorrencias: 900 }),
    defeito({ id: 'regre', estado: 'regrediu', ultimaEm: FIM - 3 * HORA, ocorrencias: 12 }),
    defeito({ id: 'regre-velho', estado: 'regrediu', ultimaEm: FIM - 90 * HORA, ocorrencias: 7 }),
    defeito({ id: 'srv', origem: 'servidor', ocorrencias: 40 }),
    defeito({ id: 'sem', origem: null, ocorrencias: 5 }),
  ];
  const r = montarResumo({
    periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: { itens, totalDefeitos: itens.length },
  });

  it('NOVO é nascido dentro da janela, e não "ainda aberto"', () => {
    // Um defeito nascido hoje e já resolvido continua sendo novo, e é justamente o que se
    // quer ver depois de um dia de trabalho.
    assert.equal(r.defeitos.novos, 5, 'os cinco de primeira_em dentro da janela; "antigo" fica fora');
  });

  it('REGRESSÃO é o estado E a última ocorrência dentro da janela', () => {
    // O estado é escrito pela MÁQUINA (o CASE de UPSERT_DEFEITO) e nunca à mão; o recorte por
    // `ultima_em` é o que separa notícia desta janela de história antiga.
    assert.equal(r.defeitos.regressoes, 1);
  });

  it('o recorte de origem é TERNÁRIO, e as três parcelas fecham com o total', () => {
    // A maioria das linhas reais tem `origem` NULA (o cliente não declarou). Somá-las ao
    // cliente inventaria procedência; escondê-las faria as contagens não fecharem.
    const o = r.defeitos.porOrigem;
    assert.equal(o.servidor, 1);
    assert.equal(o.cliente, 4);
    assert.equal(o.semOrigem, 1);
    assert.equal(o.servidor + o.cliente + o.semOrigem, itens.length);
  });

  it('o topo é por OCORRÊNCIAS, corta em cinco e desempata de forma determinística', () => {
    assert.equal(r.defeitos.topo.length, TOPO_DE_DEFEITOS);
    // 900, 40, 12, 7, 5 — e `novo` (3 ocorrências) fica de fora, ainda que seja o mais
    // recente. A ordenação é por VOLUME de propósito: o defeito que mais dói é o que mais
    // acontece, e a listagem por recência já existe em `diag -- defeitos`.
    assert.deepEqual(r.defeitos.topo.map((t) => t.id), ['antigo', 'srv', 'regre', 'regre-velho', 'sem']);
  });

  it('a premissa DECLARA lista parcial, que é o que salva o topo de mentir', () => {
    const parcial = montarResumo({
      periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: { itens, totalDefeitos: 900 },
    });
    assert.equal(parcial.defeitos.premissa.parcial, true);
    assert.equal(parcial.defeitos.premissa.vistos, 6);
    assert.equal(parcial.defeitos.premissa.total, 900);
    assert.equal(r.defeitos.premissa.parcial, false, 'lista completa NÃO se declara parcial');
  });

  it('lista vazia é lista vazia, e não ausência de fonte', () => {
    const vazio = montarResumo({
      periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: { itens: [], totalDefeitos: 0 },
    });
    assert.equal(vazio.defeitos.disponivel, true, 'zero defeitos é uma RESPOSTA');
    assert.equal(vazio.defeitos.novos, 0);
    assert.deepEqual(vazio.defeitos.topo, []);
  });
});

describe('montarResumo: bloco 2, a latência contra a janela anterior', () => {
  const agora = [rota('GET /api/config', 900, 40), rota('POST /atlas/:id/sync', 500, 300), rota('GET /raro', 2, 9000)];
  const antes = [rota('GET /api/config', 800, 38), rota('POST /atlas/:id/sync', 450, 120)];
  const r = montarResumo({
    periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null,
    latencia: agora, latenciaAnterior: antes, queriesLentas: { janela: 7, anterior: 2 },
  });

  it('compara as MAIS CHAMADAS, e não as mais lentas', () => {
    // `resumirLatencia` já devolve ordenado por p95, e reusar aquela ordem responderia outra
    // pergunta: `GET /raro` tem o maior p95 do arquivo e duas chamadas no dia.
    assert.deepEqual(r.latencia.rotas.map((x) => x.rota), ['GET /api/config', 'POST /atlas/:id/sync', 'GET /raro']);
    assert.ok(ROTAS_COMPARADAS >= 3);
  });

  it('o delta sai por rota, e a rota sem base anterior sai com delta null', () => {
    const sync = r.latencia.rotas.find((x) => x.rota === 'POST /atlas/:id/sync');
    assert.equal(sync.delta, 180);
    assert.equal(sync.deltaPct, 150);
    const raro = r.latencia.rotas.find((x) => x.rota === 'GET /raro');
    assert.equal(raro.p95Anterior, null);
    assert.equal(raro.delta, null);
  });

  it('a janela ANTERIOR é declarada e tem o MESMO tamanho da atual', () => {
    // Comparar 24h com 7d produziria um p95 anterior mais estável por construção, e todo
    // delta pareceria uma piora.
    const ja = r.latencia.premissa.janelaAnterior;
    assert.equal(ja.fim, PERIODO.inicio);
    assert.equal(ja.fim - ja.inicio, PERIODO.desdeMs);
  });

  it('a contagem de queries lentas mora aqui, com a janela anterior ao lado', () => {
    assert.deepEqual(r.latencia.queriesLentas, { janela: 7, anterior: 2 });
  });

  it('sem contagem informada, ela é zero e não `undefined`', () => {
    const sem = montarResumo({ periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null, latencia: agora });
    assert.deepEqual(sem.latencia.queriesLentas, { janela: 0, anterior: 0 });
  });
});

describe('montarResumo: blocos 3, 4 e 5', () => {
  const amostras = {
    situacao: 'medida', total: 200, faltantes: 12, esperadas: 212,
    buracos: [{ duracaoMs: 3 * HORA }, { duracaoMs: HORA }],
    maiorBuraco: { duracaoMs: 3 * HORA }, desdeUltimaMs: 60_000, ultimaAtrasada: false,
    intervaloMs: 300_000, intervaloOrigem: 'inferido', estimativaFragil: true,
    discoNaUltima: { livreMb: 800, totalMb: 20_000 },
  };

  it('a saúde carrega a PREMISSA do número de faltantes, e não só a contagem', () => {
    // Foi a frase sem esta procedência ("nenhuma amostra faltando") que mentiu por meses.
    const r = montarResumo({ periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null, amostras });
    assert.equal(r.saude.faltantes, 12);
    assert.equal(r.saude.esperadas, 212);
    assert.equal(r.saude.buracos, 2);
    assert.equal(r.saude.maiorBuracoMs, 3 * HORA);
    assert.equal(r.saude.intervaloMs, 300_000);
    assert.equal(r.saude.intervaloOrigem, 'inferido');
    assert.equal(r.saude.estimativaFragil, true);
    assert.deepEqual(r.saude.discoNaUltima, { livreMb: 800, totalMb: 20_000 });
  });

  it('os três estados de ausência de `resumirAmostras` chegam INTEIROS, sem virar zero', () => {
    for (const [situacao, faltantes] of [['sem-amostras', null], ['amostra-unica', null], ['medida', null]]) {
      const r = montarResumo({
        periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null,
        amostras: { ...amostras, situacao, faltantes, esperadas: null, maiorBuraco: null, buracos: [] },
      });
      assert.equal(r.saude.situacao, situacao);
      assert.equal(r.saude.faltantes, null, 'null é o terceiro estado; zero seria a mentira tranquilizadora');
    }
  });

  it('a indisponibilidade conta assinaturas E ocorrências da origem `indisponivel`', () => {
    const itens = [
      defeito({ id: 'a', origem: 'indisponivel', ocorrencias: 30 }),
      defeito({ id: 'b', origem: 'indisponivel', ocorrencias: 4 }),
      defeito({ id: 'c', origem: 'store', ocorrencias: 999 }),
    ];
    const r = montarResumo({
      periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: { itens, totalDefeitos: 3 },
    });
    assert.equal(r.indisponivel.defeitos, 2);
    assert.equal(r.indisponivel.ocorrencias, 34, 'ocorrências, e não assinaturas: é a contagem de quedas vistas');
  });

  it('a taxa de erro é NULL com zero requisições, e não 0%', () => {
    // Uma janela sem tráfego não tem taxa de erro de 0%: ela não tem taxa. Zero ali afirmaria
    // saúde a partir de ausência de medição.
    const vazio = montarResumo({
      periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null,
      status: { total: 0, porFaixa: {}, erros: 0 },
    });
    assert.equal(vazio.status.disponivel, true);
    assert.equal(vazio.status.total, 0);
    assert.equal(vazio.status.taxaDeErro, null);

    const cheio = montarResumo({
      periodo: PERIODO, leitura: LEITURA_VIVA, defeitos: null,
      status: { total: 1000, porFaixa: { '2xx': 970, '5xx': 30 }, erros: 33 },
    });
    assert.equal(cheio.status.taxaDeErro, 3.3);
  });
});
