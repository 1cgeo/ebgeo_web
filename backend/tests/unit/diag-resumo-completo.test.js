// Path: tests/unit/diag-resumo-completo.test.js
//
// `montarResumoCompleto` e `criarColetaDoResumo`: o GATHERING do resumo, com os DOIS
// leitores injetados, sem disco e sem Postgres.
//
// POR QUE ESTE ARQUIVO EXISTE, tendo `diag-resumo.test.js` a composição e
// `diag-cli-resumo.test.js` o comando de ponta a ponta. Nenhum dos dois cobre a peça do meio:
// a composição recebe as peças prontas, e o teste do comando exercita o leitor de FLUXO, que
// é justamente o que a rota NÃO usa. O que sobra sem cobertura é a coleta com o leitor de
// ANEL, que é a que serve a aba de Administração, e junto com ela as três coisas que só
// aparecem aqui:
//
//   1. o leitor é pedido pelo DOBRO da janela. Errar isso é silencioso: a janela anterior
//      viria vazia e todo delta de p95 sairia `null`, que se lê como "rota nova";
//   2. a falha do BANCO não derruba a metade de ARQUIVO, e vice-versa. São quatro
//      combinações, e derrubar o Postgres de verdade para exercer duas delas não é um teste
//      que alguém escreve;
//   3. `janela` carrega a PROCEDÊNCIA (diretório, arquivos, linhas, `truncado`, `banco`), que
//      é o que torna uma lista vazia falsificável para quem lê a tela e não tem terminal.
//
// CONTROLE NEGATIVO, conferido revertendo cada um, com os casos que ficaram vermelhos
// ANOTADOS em vez de supostos (declarar controle que não discrimina é a forma cara de um
// teste virar decoração, e a de baixo já corrigiu uma declaração errada minha):
//  - pedir `desdeMs` em vez de `desdeMs * 2` ao leitor: DOIS vermelhos, "pede ao leitor o
//    DOBRO" e "o delta de p95", porque a janela anterior some inteira. O segundo só aparece
//    porque o duplo de leitor FILTRA por janela como o real; com um duplo cego à janela, só o
//    primeiro ficava vermelho (medido);
//  - publicar `j.linhas` (o total do anel, que é o do dobro) em vez de `disco.linhas` na
//    premissa: UM vermelho, "pede ao leitor o DOBRO", que é o caso que confere a contagem da
//    janela ATUAL;
//  - tirar o `try/catch` em volta do leitor de defeitos: DOIS vermelhos, "BANCO CEGO" e "AS
//    DUAS FORA", que passam a LANÇAR em vez de devolver blocos cegos; a rota morreria
//    justamente no incidente que ela existe para atravessar;
//  - mandar tudo para o acumulador atual (`naJanela = true`): TRÊS vermelhos, o do corte, o
//    do dobro e o do delta;
//  - emitir `truncado` SEMPRE na premissa de arquivo (`truncado: leitura.truncado === true`,
//    em `montarResumo`): UM vermelho aqui, o dos três estados, e mais UM em
//    `diag-cli-resumo.test.js`, porque o comando passa a declarar corte de um anel que ele
//    não tem;
//  - não propagar `truncado` da leitura para `montarResumo` (deixá-lo só no envelope): DOIS
//    vermelhos, o da procedência e o dos três estados;
//  - voltar o motivo do banco para `err.message`: UM vermelho, o do lançamento que não é
//    `Error`, que volta a escrever "o banco não respondeu (undefined)".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { montarResumoCompleto, criarColetaDoResumo, DEFEITOS_DO_RESUMO } from '../../src/modules/diag/resumo.service.js';
import { MARCADOR_AMOSTRA } from '../../src/utils/amostra-de-saude.js';
import { MARCADOR_QUERY_LENTA } from '../../src/utils/query-lenta.js';

const HORA = 3_600_000;
const AGORA = new Date(1_788_000_000_000);
const FIM = AGORA.getTime();
const NA_JANELA = FIM - HORA;
const NA_ANTERIOR = FIM - 3 * HORA;

/** As linhas do `.jsonl` que os dois acumuladores precisam separar. */
function registros() {
  const linhas = [];
  for (let i = 0; i < 20; i += 1) {
    linhas.push({ time: NA_JANELA, method: 'POST', url: '/atlas/11111111-2222-3333-4444-555555555555/sync', duration: 300, statusCode: 200 });
    linhas.push({ time: NA_ANTERIOR, method: 'POST', url: '/atlas/11111111-2222-3333-4444-555555555555/sync', duration: 30, statusCode: 200 });
  }
  // Só na janela atual: precisa sair com base `null`, e não com um delta contra zero.
  linhas.push({ time: NA_JANELA, method: 'GET', url: '/api/config', duration: 12, statusCode: 200 });
  linhas.push({ time: NA_JANELA, method: 'GET', url: '/api/v1/atlas', duration: 5, statusCode: 500, err: { type: 'Error', message: 'x' } });
  linhas.push({ time: NA_JANELA, amostra: MARCADOR_AMOSTRA });
  linhas.push({ time: NA_JANELA + 300_000, amostra: MARCADOR_AMOSTRA });
  // Contagens DIFERENTES nas duas janelas: iguais passariam verdes com o corte quebrado.
  linhas.push({ time: NA_JANELA, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 900 });
  linhas.push({ time: NA_JANELA, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 800 });
  linhas.push({ time: NA_JANELA, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 700 });
  linhas.push({ time: NA_ANTERIOR, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 600 });
  return linhas;
}

/**
 * Um leitor de disco falso, com a MESMA forma de retorno de `lerJanela`.
 *
 * ELE FILTRA POR `desdeMs`, COMO O REAL, e isso não é zelo: um duplo que devolvesse a lista
 * inteira qualquer que fosse a janela pedida deixaria PASSAR a regressão mais provável deste
 * arquivo (pedir a janela simples em vez do dobro), porque a base de comparação continuaria
 * chegando. Medido revertendo: com o duplo cego à janela, só o caso que confere o argumento
 * ficava vermelho; com ele filtrando, o do delta também fica.
 */
function leitorDeDisco({ ausente = false, truncado = false, arquivos = 2, linhas = null } = {}) {
  const chamadas = [];
  const ler = async (opts) => {
    chamadas.push(opts);
    const inicio = opts.agora.getTime() - opts.desdeMs;
    const todos = linhas ?? registros();
    const naJanela = todos.filter((r) => typeof r.time !== 'number' || r.time >= inicio);
    return {
      diretorio: '/var/log/ebgeo',
      diretorioAusente: ausente,
      arquivos: ausente ? 0 : arquivos,
      truncado,
      inicio: new Date(inicio),
      registros: ausente ? [] : naJanela,
      // O total do ANEL, que é o do DOBRO da janela: ele NÃO pode virar a premissa.
      linhas: ausente ? 0 : naJanela.length,
    };
  };
  return { ler, chamadas };
}

/** Um leitor de banco falso, na forma de `listarDefeitos`. */
function leitorDeDefeitos(itens) {
  const chamadas = [];
  const lerDefeitos = async (q) => {
    chamadas.push(q);
    return { desde: FIM - 24 * HORA, totalDefeitos: itens.length, itens };
  };
  return { lerDefeitos, chamadas };
}

const defeito = (campos = {}) => ({
  id: campos.id ?? 'd-1',
  mensagem: campos.mensagem ?? 'TypeError: x is not a function',
  estado: campos.estado ?? 'aberto',
  origem: 'origem' in campos ? campos.origem : 'store',
  ocorrencias: campos.ocorrencias ?? 1,
  primeiraEm: campos.primeiraEm ?? FIM - 2 * HORA,
  ultimaEm: campos.ultimaEm ?? FIM - HORA,
});

const ITENS = [
  defeito({ id: 'novo', origem: 'servidor', ocorrencias: 50 }),
  defeito({ id: 'queda', origem: 'indisponivel', ocorrencias: 7 }),
  defeito({ id: 'regre', estado: 'regrediu', ocorrencias: 12, primeiraEm: FIM - 40 * HORA }),
];

const completo = (extras = {}) => montarResumoCompleto({
  diretorio: '/var/log/ebgeo', desde: '2h', agora: AGORA, ...extras,
});

describe('criarColetaDoResumo: o corte entre as duas janelas', () => {
  it('separa os registros pelo `time`, e conta as linhas da janela ATUAL', () => {
    const coleta = criarColetaDoResumo({ inicio: FIM - 2 * HORA });
    for (const reg of registros()) coleta.ver(reg);
    const r = coleta.resultado({ agora: FIM });

    // 20 do sync + config + o 500 + 2 amostras + 3 queries lentas = 27 na janela atual.
    assert.equal(r.linhas, 27, 'a premissa é da janela ATUAL, não do dobro lido');
    assert.deepEqual(r.queriesLentas, { janela: 3, anterior: 1 });

    const agora = r.latencia.find((l) => l.rota === 'POST /atlas/:id/sync');
    const antes = r.latenciaAnterior.find((l) => l.rota === 'POST /atlas/:id/sync');
    assert.equal(agora.n, 20, 'só as da janela atual');
    assert.equal(agora.p95, 300);
    assert.equal(antes.p95, 30, 'a base vem do acumulador da janela anterior');
    assert.equal(r.status.total, 22, 'o pulso conta só a linha com `statusCode`, da janela atual');
    assert.equal(r.status.erros, 1);
  });

  it('linha SEM `time` conta como da janela ATUAL, e nunca como base de comparação', () => {
    // A direção do erro é conservadora: ela infla o "agora", que é o lado que se olha com
    // atenção. Mandá-la para a janela anterior a poria na base de um período que ela não
    // representa, e o delta passaria a ser calculado contra ela.
    const coleta = criarColetaDoResumo({ inicio: FIM - 2 * HORA });
    coleta.ver({ method: 'GET', url: '/api/config', duration: 999, statusCode: 200 });
    const r = coleta.resultado({ agora: FIM });
    assert.equal(r.linhas, 1);
    assert.equal(r.latencia.length, 1);
    assert.equal(r.latenciaAnterior.length, 0, 'nada pode ter caído na base');
  });

  it('registro nulo não derruba a coleta nem entra na contagem', () => {
    const coleta = criarColetaDoResumo({ inicio: FIM - 2 * HORA });
    coleta.ver(null);
    coleta.ver(undefined);
    assert.equal(coleta.resultado({ agora: FIM }).linhas, 0);
  });
});

describe('montarResumoCompleto: as DUAS fontes vivas', () => {
  it('pede ao leitor o DOBRO da janela, e a premissa publica as linhas da atual', async () => {
    const disco = leitorDeDisco();
    const banco = leitorDeDefeitos(ITENS);
    const r = await completo({ ler: disco.ler, lerDefeitos: banco.lerDefeitos });

    // O DOBRO, e não a janela: o bloco de latência compara com o período imediatamente
    // anterior, do mesmo tamanho, e um leitor pedido pela janela simples devolveria nada dele.
    assert.equal(disco.chamadas.length, 1);
    assert.equal(disco.chamadas[0].desdeMs, 4 * HORA, 'o leitor tem de ser pedido pelo DOBRO');
    assert.equal(disco.chamadas[0].diretorio, '/var/log/ebgeo');
    assert.equal(disco.chamadas[0].agora, AGORA);

    assert.equal(r.janela.linhas, 27, 'a premissa é da janela ATUAL');
    assert.ok(r.janela.linhas < registros().length, 'e é MENOR que o total lido, que é o do dobro');
    assert.equal(r.latencia.premissa.linhas, 27, 'os três blocos de arquivo compartilham a premissa');
    assert.equal(r.status.premissa.linhas, 27);
  });

  it('os cinco blocos saem disponíveis, com premissa em cada um', async () => {
    const disco = leitorDeDisco();
    const banco = leitorDeDefeitos(ITENS);
    const r = await completo({ ler: disco.ler, lerDefeitos: banco.lerDefeitos });

    for (const bloco of ['defeitos', 'latencia', 'saude', 'indisponivel', 'status']) {
      assert.equal(r[bloco].disponivel, true, `${bloco} tinha de estar disponível`);
      assert.ok(r[bloco].premissa, `${bloco} precisa declarar a premissa, mesmo na boa notícia`);
    }
    assert.equal(r.latencia.premissa.fonte, 'arquivo');
    assert.equal(r.defeitos.premissa.fonte, 'banco');
    assert.deepEqual(r.periodo, { desde: '2h', desdeMs: 2 * HORA, inicio: FIM - 2 * HORA, fim: FIM });
  });

  it('o delta de p95 compara com a janela ANTERIOR, e a rota sem base sai com delta null', async () => {
    const disco = leitorDeDisco();
    const banco = leitorDeDefeitos(ITENS);
    const r = await completo({ ler: disco.ler, lerDefeitos: banco.lerDefeitos });

    const sync = r.latencia.rotas.find((x) => x.rota === 'POST /atlas/:id/sync');
    assert.equal(sync.n, 20);
    assert.equal(sync.p95, 300);
    assert.equal(sync.p95Anterior, 30);
    assert.equal(sync.delta, 270);

    const config = r.latencia.rotas.find((x) => x.rota === 'GET /api/config');
    assert.equal(config.p95Anterior, null, 'rota nova não tem base, e base ausente NÃO é zero');
    assert.equal(config.delta, null);

    assert.deepEqual(r.latencia.queriesLentas, { janela: 3, anterior: 1 });
    const ja = r.latencia.premissa.janelaAnterior;
    assert.equal(ja.fim - ja.inicio, 2 * HORA, 'a base tem o MESMO tamanho da janela');
  });

  it('os blocos de banco recortam por origem, e a queda vista pelo cliente é a `indisponivel`', async () => {
    const banco = leitorDeDefeitos(ITENS);
    const r = await completo({ ler: leitorDeDisco().ler, lerDefeitos: banco.lerDefeitos });

    assert.equal(r.defeitos.porOrigem.servidor, 1);
    assert.equal(r.defeitos.porOrigem.cliente, 2, 'store e indisponivel são do navegador');
    assert.equal(r.defeitos.novos, 2, 'nascidos DENTRO da janela de 2h');
    assert.equal(r.defeitos.regressoes, 1);
    assert.equal(r.indisponivel.defeitos, 1);
    assert.equal(r.indisponivel.ocorrencias, 7, 'ocorrências, e não assinaturas');
  });

  it('a janela e o limite viajam para a consulta de defeitos, com o padrão do comando', async () => {
    const banco = leitorDeDefeitos(ITENS);
    await completo({ ler: leitorDeDisco().ler, lerDefeitos: banco.lerDefeitos });
    assert.deepEqual(banco.chamadas[0], { desde: '2h', limite: DEFEITOS_DO_RESUMO });

    const outro = leitorDeDefeitos(ITENS);
    await completo({ ler: leitorDeDisco().ler, lerDefeitos: outro.lerDefeitos, limite: 7 });
    assert.equal(outro.chamadas[0].limite, 7);
  });
});

describe('montarResumoCompleto: uma fonte de cada vez, e a outra sobrevive', () => {
  it('DISCO CEGO: os três blocos de arquivo se declaram, e nenhum imprime número', async () => {
    const disco = leitorDeDisco({ ausente: true });
    const banco = leitorDeDefeitos(ITENS);
    const r = await completo({ ler: disco.ler, lerDefeitos: banco.lerDefeitos });

    for (const bloco of ['latencia', 'saude', 'status']) {
      assert.equal(r[bloco].disponivel, false, bloco);
      assert.match(r[bloco].motivo, /CEGO/, 'o motivo precisa dizer que o INSTRUMENTO está desligado');
      assert.equal(r[bloco].premissa, null);
      // A ASSERÇÃO QUE IMPORTA: zero ao lado da indisponibilidade se leria como "nada
      // aconteceu", que é o oposto de "não sei".
      assert.equal(r[bloco].total, undefined);
      assert.equal(r[bloco].rotas, undefined);
      assert.equal(r[bloco].amostras, undefined);
    }
    assert.equal(r.defeitos.disponivel, true, 'a queda de uma fonte não derruba a outra');
    assert.equal(r.indisponivel.disponivel, true);
    assert.equal(r.janela.diretorioAusente, true);
    assert.equal(r.janela.arquivos, 0);
    assert.equal(r.janela.banco, true);
  });

  it('BANCO CEGO: os dois blocos de banco se declaram, com a mensagem do driver', async () => {
    const disco = leitorDeDisco();
    const r = await completo({
      ler: disco.ler,
      lerDefeitos: async () => { throw new Error('ECONNREFUSED 127.0.0.1:5432'); },
    });

    for (const bloco of ['defeitos', 'indisponivel']) {
      assert.equal(r[bloco].disponivel, false, bloco);
      // A MENSAGEM DO DRIVER VIAJA: "o banco não respondeu" não distingue Postgres fora de
      // `DATABASE_URL` ausente, e as duas pedem coisas opostas.
      assert.match(r[bloco].motivo, /ECONNREFUSED/);
      assert.equal(r[bloco].premissa, null);
      assert.equal(r[bloco].novos, undefined);
      assert.equal(r[bloco].topo, undefined);
      assert.equal(r[bloco].defeitos, undefined);
    }
    assert.equal(r.latencia.disponivel, true, 'a metade de ARQUIVO chega inteira');
    assert.equal(r.saude.disponivel, true);
    assert.equal(r.status.disponivel, true);
    assert.equal(r.janela.banco, false, '`banco` é a mesma afirmação, num nome só');
  });

  it('o que foi LANÇADO sem ser `Error` continua produzindo motivo legível, e com teto', async () => {
    // `err.message` sozinho escrevia literalmente "o banco não respondeu (undefined)" para uma
    // rejeição com string, com objeto ou com `undefined`, que é uma frase sem informação
    // nenhuma no lugar onde ela mais importa: é a única pista que o administrador tem sobre
    // POR QUE o bloco está cego, e as duas causas prováveis (Postgres fora, `DATABASE_URL`
    // ausente) pedem coisas opostas.
    const comString = await completo({
      ler: leitorDeDisco().ler,
      lerDefeitos: async () => { throw 'ECONNREFUSED cru'; },
    });
    assert.match(comString.defeitos.motivo, /ECONNREFUSED cru/);
    assert.doesNotMatch(comString.defeitos.motivo, /undefined/);

    const comObjeto = await completo({
      ler: leitorDeDisco().ler,
      lerDefeitos: async () => { throw { code: '3D000' }; },
    });
    assert.doesNotMatch(comObjeto.defeitos.motivo, /undefined/, 'objeto sem `message` também não vira "undefined"');

    // O TETO: o texto não passou por Joi nenhum e um erro de driver pode carregar a query
    // inteira, com o `detail` de uma violação de CHECK dentro. Ele vai para um payload de tela.
    const longo = await completo({
      ler: leitorDeDisco().ler,
      lerDefeitos: async () => { throw new Error('x'.repeat(5000)); },
    });
    assert.ok(longo.defeitos.motivo.length < 400, `o motivo veio com ${longo.defeitos.motivo.length} caracteres`);
    assert.equal(longo.defeitos.motivo, longo.indisponivel.motivo, 'os dois blocos de banco dizem a MESMA frase');
  });

  it('AS DUAS FORA: os cinco blocos falam, e a resposta continua bem-formada', async () => {
    const r = await completo({
      ler: leitorDeDisco({ ausente: true }).ler,
      lerDefeitos: async () => { throw new Error('sem banco'); },
    });
    for (const bloco of ['defeitos', 'latencia', 'saude', 'indisponivel', 'status']) {
      assert.equal(r[bloco].disponivel, false, bloco);
      assert.ok(r[bloco].motivo.length > 20, `${bloco} precisa de motivo escrito`);
    }
    assert.equal(r.janela.diretorioAusente, true);
    assert.equal(r.janela.banco, false);
    assert.equal(typeof r.gerado_em, 'number');
  });
});

describe('montarResumoCompleto: a procedência que torna a resposta falsificável', () => {
  it('`janela` carrega diretório, arquivos, linhas, `truncado` e `banco`', async () => {
    const disco = leitorDeDisco({ truncado: true, arquivos: 3 });
    const banco = leitorDeDefeitos(ITENS);
    const r = await completo({ ler: disco.ler, lerDefeitos: banco.lerDefeitos });

    assert.deepEqual(Object.keys(r.janela).sort(), [
      'arquivos', 'banco', 'desde', 'desdeMs', 'dir', 'diretorioAusente', 'fim', 'inicio',
      'linhas', 'truncado',
    ]);
    assert.equal(r.janela.dir, '/var/log/ebgeo');
    assert.equal(r.janela.arquivos, 3);
    // `truncado` É SÓ DESTA PORTA: o anel de 200 mil descarta o registro mais ANTIGO, ou seja,
    // a janela de comparação antes da janela mostrada. A direção é a certa e mesmo assim
    // precisa ser dita, porque o delta passa a ser uma conta sobre uma base cortada.
    assert.equal(r.janela.truncado, true);

    // E ELE CHEGA NA PREMISSA DE CADA BLOCO DE ARQUIVO, que é onde ele fica AO LADO da conta
    // que ele qualifica. Só no envelope, o aviso ficaria longe do "era 30 ms" que ele
    // relativiza, e quem lê a tabela de rotas não passa pelo envelope.
    for (const bloco of ['latencia', 'saude', 'status']) {
      assert.equal(r[bloco].premissa.truncado, true, `${bloco} precisa carregar a premissa do corte`);
    }
  });

  it('o `false` do anel É publicado, e a chave SOME quando o leitor não tem anel', async () => {
    // TRÊS ESTADOS, e não dois. `true` é "cortou"; `false` é MEDIÇÃO ("o anel rodou e não
    // mordeu"), que é afirmação útil e falsificável; a AUSÊNCIA é "a pergunta não se aplica",
    // que é o caso do leitor de fluxo do comando. Colapsar os dois últimos faria uma leitura
    // sem teto se anunciar como leitura íntegra sob teto.
    const comAnel = await completo({
      ler: leitorDeDisco({ truncado: false }).ler, lerDefeitos: leitorDeDefeitos(ITENS).lerDefeitos,
    });
    assert.equal(comAnel.latencia.premissa.truncado, false);

    // Um leitor que NÃO declara o campo (é o que `percorrerRegistros` faz no comando).
    const semAnel = async (opts) => {
      const lido = await leitorDeDisco().ler(opts);
      delete lido.truncado;
      return lido;
    };
    const r = await completo({ ler: semAnel, lerDefeitos: leitorDeDefeitos(ITENS).lerDefeitos });
    for (const bloco of ['latencia', 'saude', 'status']) {
      assert.equal(
        Object.hasOwn(r[bloco].premissa, 'truncado'), false,
        `${bloco} não pode inventar um \`truncado: false\` onde não há anel`
      );
    }
    assert.equal(r.janela.desde, '2h');
    assert.equal(r.janela.desdeMs, 2 * HORA);
    assert.equal(r.janela.fim, FIM);
    assert.equal(r.janela.inicio, FIM - 2 * HORA);
  });

  it('o documento é o do `--json` do comando: os cinco blocos, `periodo`, `janela` e `gerado_em`', async () => {
    const r = await completo({
      ler: leitorDeDisco().ler, lerDefeitos: leitorDeDefeitos(ITENS).lerDefeitos,
    });
    // Não-vacuidade: um bloco que sumisse do retorno faria os laços acima passar por omissão.
    assert.deepEqual(Object.keys(r).sort(), [
      'defeitos', 'gerado_em', 'indisponivel', 'janela', 'latencia', 'periodo', 'saude', 'status',
    ]);
    // `comando` é do envelope do TERMINAL e não tem sentido numa rota: aqui quem responde é
    // o endereço, e um campo com o nome de um comando confundiria as duas portas.
    assert.equal(Object.hasOwn(r, 'comando'), false);
  });
});
