// Path: tests/unit/diag-cli-json.test.js
//
// `--json` nos cinco comandos que leem o ARQUIVO, dirigindo `scripts/diag.js` de verdade por
// `spawnSync` (o arquivo chama `main()` na avaliação do módulo; importá-lo executaria o
// comando com os argumentos do corredor de testes).
//
// A PROPRIEDADE QUE ESTE ARQUIVO COMPRA É A PUREZA DO STDOUT, e ela não é estética: o
// consumidor desta saída é um `| jq` e um agente, e um único `console.log` de nota humana
// escapando para o stdout quebra os dois com um erro de parse que não aponta para a linha
// culpada. Por isso a asserção é sempre `JSON.parse(stdout)` sobre o stdout INTEIRO, e não um
// `includes` de trecho: só o parse do documento todo prova que nada mais foi escrito ali.
//
// O SEGUNDO ALVO É A PROCEDÊNCIA. O modo humano abre com uma linha `#` que diz o diretório
// resolvido, quantos arquivos foram abertos e quantas linhas a janela tem. Em `--json` isso
// vira o campo `janela`, e é ele que torna a resposta FALSIFICÁVEL: sem ele, uma lista vazia
// vinda de um diretório errado é indistinguível de uma janela limpa, e quem lê é justamente
// quem não tem terminal para desconfiar.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//   - deixar o cabeçalho `#` sair também no modo `--json` e cai todo caso de parse;
//   - mandar a ajuda para o stdout quando `--json` está ligado e cai o caso do comando
//     desconhecido;
//   - tirar `arquivos`/`linhas` de `janela` e cai o caso da procedência, que é o que separa
//     "nada aconteceu" de "li o diretório errado";
//   - ignorar `--limite` no modo JSON e cai o caso do corte, cuja propriedade é os dois modos
//     responderem à MESMA pergunta.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARCADOR_AMOSTRA } from '../../src/utils/amostra-de-saude.js';

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const MIN = 60_000;
const temporarios = [];

after(() => {
  for (const dir of temporarios) fs.rmSync(dir, { recursive: true, force: true });
});

/** O nome de arquivo que `diasDaJanela` vai procurar para um instante (dia LOCAL). */
function arquivoDoDia(t) {
  const d = new Date(t);
  return `ebgeo-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.jsonl`;
}

/**
 * Um diretório de log com o mínimo para que os cinco comandos tenham o que dizer: erros de
 * assinaturas diferentes, duas requisições com duração e uma série de três amostras de saúde.
 * As contagens exatas ficam nas asserções, e não nesta frase, porque é lá que elas têm guarda.
 */
function logSintetico() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-diagjson-'));
  temporarios.push(dir);
  const agora = Date.now();
  // O SHAPE DA LINHA É PLANO (`url`, `method`, `statusCode`, `duration`), como
  // `requestLogPayload` (`src/middleware/request-logger.js`) a escreve, e não aninhado sob
  // `req`/`res`. A primeira versão desta fixture aninhava, e o custo é a razão de o comentário
  // existir: os agregadores não casavam nada, o documento saía com zero de tudo e as
  // asserções foram ESCRITAS em cima desse zero. Era cobertura vazia sobre uma fixture
  // errada, e passava verde.
  const registros = [
    { level: 50, time: agora - 9 * MIN, msg: 'boom', err: { type: 'TypeError', message: 'a is not a function', stack: 'TypeError: a' }, url: '/api/v1/atlas/11111111-1111-1111-1111-111111111111/sync', method: 'POST', ip: '10.0.0.1' },
    { level: 50, time: agora - 8 * MIN, msg: 'boom', err: { type: 'TypeError', message: 'a is not a function', stack: 'TypeError: a' }, url: '/api/v1/atlas/22222222-2222-2222-2222-222222222222/sync', method: 'POST', ip: '10.0.0.2' },
    { level: 50, time: agora - 7 * MIN, msg: 'outro', err: { type: 'RangeError', message: 'fora de faixa', stack: 'RangeError: b' }, ip: '10.0.0.3' },
    // OS DOIS `msg` SÃO OS REAIS, e a diferença entre eles importa: `requestLogger`
    // (`src/middleware/request-logger.js`) escreve `'request'` abaixo de 400 e
    // `'request error'` de 400 para cima. `assinaturaDeErro` cai em `reg.msg` quando não há
    // `err`, então uma fixture com um terceiro texto inventado produziria uma assinatura que
    // o produto nunca gera, e as asserções abaixo mediriam a fixture em vez do agregador.
    { level: 30, time: agora - 6 * MIN, msg: 'request', url: '/api/v1/config', method: 'GET', statusCode: 200, duration: 12, ip: '10.0.0.2' },
    { level: 40, time: agora - 5 * MIN, msg: 'request error', url: '/api/v1/config', method: 'GET', statusCode: 500, duration: 220, ip: '10.0.0.2' },
    { level: 30, time: agora - 15 * MIN, amostra: MARCADOR_AMOSTRA, banco: { ok: true, ms: 2 }, msg: 'amostra' },
    { level: 30, time: agora - 10 * MIN, amostra: MARCADOR_AMOSTRA, banco: { ok: true, ms: 2 }, msg: 'amostra' },
    { level: 30, time: agora - 5 * MIN, amostra: MARCADOR_AMOSTRA, banco: { ok: true, ms: 3 }, msg: 'amostra' },
  ];
  const porArquivo = new Map();
  for (const r of registros) {
    const nome = arquivoDoDia(r.time);
    if (!porArquivo.has(nome)) porArquivo.set(nome, []);
    porArquivo.get(nome).push(JSON.stringify(r));
  }
  for (const [nome, linhas] of porArquivo) fs.writeFileSync(path.join(dir, nome), `${linhas.join('\n')}\n`);
  return { dir, registros };
}

/**
 * Roda o comando num processo filho.
 *
 * `semBanco` APAGA `DATABASE_URL` E `JWT_SECRET` DO AMBIENTE DO FILHO, e sem isso o caso
 * que diz "reclama antes de tocar no banco" não prova nada: o corredor de testes exporta as
 * duas (`scripts/run-tests.js` as monta explicitamente), o `spawnSync` herda o ambiente
 * inteiro, e o comando abriria o pool com sucesso. O caso passaria verde com a validação
 * REMOVIDA, que é a definição de cobertura vazia.
 *
 * O `timeout` existe pela razão do irmão de integração: um pool que vaze prende o filho
 * para sempre e leva a rodada inteira junto, sem um sintoma que aponte para a causa.
 */
function rodar(args, { semBanco = false } = {}) {
  const env = { ...process.env };
  if (semBanco) {
    delete env.DATABASE_URL;
    delete env.JWT_SECRET;
  }
  const r = spawnSync(process.execPath, [COMANDO, ...args], {
    encoding: 'utf8', env, timeout: 30_000, killSignal: 'SIGKILL',
  });
  assert.equal(r.signal, null, `o comando foi morto por ${r.signal} (travou?)`);
  return { codigo: r.status, saida: r.stdout || '', erro: r.stderr || '' };
}

/** Roda com `--json` e devolve o documento, provando de passagem que o stdout só tem ele. */
function documento(args) {
  const r = rodar([...args, '--json']);
  const doc = JSON.parse(r.saida);
  return { ...r, doc };
}

const COMANDOS_DE_LOG = ['erros', 'lento', 'status', 'saude', 'linhas'];

describe('diag --json: o envelope', () => {
  it('os cinco comandos de log escrevem UM documento e nada mais no stdout', () => {
    const { dir } = logSintetico();
    assert.equal(COMANDOS_DE_LOG.length, 5);
    for (const comando of COMANDOS_DE_LOG) {
      const { codigo, doc } = documento([comando, '--dir', dir, '--desde', '24h']);
      assert.equal(codigo, 0, `${comando} saiu com ${codigo}`);
      assert.equal(doc.comando, comando);
      assert.equal(typeof doc.gerado_em, 'number', `${comando} sem gerado_em numérico`);
      // `typeof null` é 'object', então a asserção de tipo sozinha passaria com a janela
      // ausente, que é exatamente o estado que este caso existe para proibir nos comandos de
      // log (só `pilha` e `defeitos --id` têm janela nula, e por decisão).
      assert.notEqual(doc.janela, null, `${comando} sem janela`);
      assert.equal(typeof doc.janela, 'object');
      assert.equal(doc.janela.desde, '24h');
    }
  });

  it('`gerado_em` é EPOCH MS, a mesma unidade dos instantes de dentro do documento', () => {
    // Duas unidades de tempo no mesmo documento é conversão errada esperando para acontecer:
    // `primeira`/`ultima` dos grupos vêm do `time` do pino, que é epoch ms.
    const { dir } = logSintetico();
    const { doc } = documento(['erros', '--dir', dir]);
    assert.ok(doc.gerado_em > 1_600_000_000_000, 'gerado_em não parece epoch ms');
    assert.equal(doc.assinaturas.length, 3);
    assert.ok(doc.assinaturas[0].primeira > 1_600_000_000_000, 'primeira não é epoch ms');
  });

  it('`janela` carrega a PROCEDÊNCIA que o cabeçalho `#` dá ao humano', () => {
    const { dir, registros } = logSintetico();
    const { doc } = documento(['linhas', '--dir', dir, '--desde', '24h']);
    assert.equal(doc.janela.desde, '24h');
    assert.equal(doc.janela.desdeMs, 86_400_000);
    assert.equal(doc.janela.dir, path.resolve(dir));
    assert.equal(doc.janela.arquivos, 1);
    assert.equal(doc.janela.linhas, registros.length);
    assert.equal(doc.janela.fim - doc.janela.inicio, 86_400_000);
  });

  it('nenhum comando SOBRESCREVE um campo do envelope, e a colisão LANÇA', () => {
    // A ordem do espalhamento é a guarda: com o envelope escrito primeiro, uma estrutura que
    // trouxesse `janela`, `comando` ou `gerado_em` o apagaria em silêncio. Foi assim que
    // `saude` perdeu a procedência do documento inteiro por uma revisão, sem um teste
    // vermelho. Aqui os três campos são exigidos EM TODOS, com o valor que o envelope põe.
    const { dir } = logSintetico();
    assert.equal(COMANDOS_DE_LOG.length, 5);
    for (const comando of COMANDOS_DE_LOG) {
      const { doc } = documento([comando, '--dir', dir, '--desde', '12h']);
      assert.equal(doc.comando, comando);
      assert.equal(doc.janela.desde, '12h', `${comando} perdeu a janela do envelope`);
      assert.equal(doc.janela.dir, path.resolve(dir), `${comando} perdeu o diretório`);
      assert.ok(doc.gerado_em > 1_600_000_000_000, `${comando} perdeu o gerado_em`);
    }
  });

  it('o cabeçalho `#` do modo humano NÃO sai no modo JSON', () => {
    const { dir } = logSintetico();
    const humano = rodar(['status', '--dir', dir]);
    assert.match(humano.saida, /^# /, 'o modo humano perdeu o cabeçalho');
    const { saida } = documento(['status', '--dir', dir]);
    assert.equal(saida.includes('#'), false);
  });
});

describe('diag --json: a estrutura de cada comando', () => {
  it('erros: assinaturas cortadas pelo `--limite`, com a contagem de ANTES do corte', () => {
    const { dir } = logSintetico();
    const inteiro = documento(['erros', '--dir', dir]).doc;
    // TRÊS assinaturas para QUATRO ocorrências: os dois `TypeError` caem na mesma porque
    // `normalizarRota` troca o uuid do atlas por `:id`, e o 500 do `request-logger` entra
    // pelo terceiro termo de `ehErro` (statusCode >= 400), sem `err` nenhum.
    assert.equal(inteiro.totalDeAssinaturas, 3);
    assert.equal(inteiro.totalDeOcorrencias, 4);
    assert.equal(inteiro.assinaturas.length, 3);
    assert.equal(inteiro.assinaturas[0].assinatura, 'POST /api/v1/atlas/:id/sync | TypeError | a is not a function');
    assert.equal(inteiro.assinaturas[0].total, 2);
    assert.equal(inteiro.enderecos.distintos, 3);

    // O `--limite` vale nos DOIS modos: o mesmo comando com os mesmos argumentos responde à
    // mesma pergunta, senão comparar as duas saídas deixa de provar coisa alguma.
    const cortado = documento(['erros', '--dir', dir, '--limite', '1']).doc;
    assert.equal(cortado.limite, 1);
    assert.equal(cortado.assinaturas.length, 1);
    assert.equal(cortado.totalDeAssinaturas, 3);
  });

  it('lento: uma rota por posto, com percentis', () => {
    const { dir } = logSintetico();
    const { doc } = documento(['lento', '--dir', dir]);
    assert.equal(doc.totalDeRotas, 1);
    assert.equal(doc.rotas.length, 1);
    assert.equal(doc.rotas[0].rota, 'GET /api/v1/config');
    assert.equal(doc.rotas[0].n, 2);
    assert.equal(doc.rotas[0].max, 220);
  });

  it('status: total, faixas e a contagem de erros', () => {
    const { dir } = logSintetico();
    const { doc } = documento(['status', '--dir', dir]);
    assert.equal(doc.total, 2);
    assert.deepEqual(doc.porFaixa, { '2xx': 1, '5xx': 1 });
    // UM, e não quatro. O pulso conta REQUISIÇÃO desde 2026-09-02: a única linha com
    // `statusCode >= 400` da fixture. Antes ele contava REGISTRO, com `ehErro` sobre a
    // janela inteira, e somava os três `level: 50` (que não são requisições) mais a
    // requisição com 500 — quatro erros sobre duas requisições, ou seja, 200%. Ver
    // `criarResumoDeStatus`.
    assert.equal(doc.erros, 1);
    assert.ok(doc.erros <= doc.total, 'o numerador nunca passa do denominador');
  });

  it('saude: o resumo inteiro, com a situação e a origem do intervalo', () => {
    const { dir } = logSintetico();
    const { doc } = documento(['saude', '--dir', dir, '--intervalo', '5m']);
    assert.equal(doc.total, 3);
    assert.equal(doc.intervaloOrigem, 'informado');
    assert.equal(doc.intervaloMs, 300_000);
    // Três amostras a cinco minutos de distância, com o intervalo informado: série medida,
    // três esperadas, nenhuma faltando. O `--intervalo` está aqui de propósito, porque com
    // ele a premissa é DECLARADA em vez de inferida, e é o número da premissa que o
    // documento tem de carregar.
    assert.equal(doc.situacao, 'medida');
    assert.equal(doc.esperadas, 3);
    assert.equal(doc.faltantes, 0);

    // O ENVELOPE SOBREVIVE AO RESUMO, e este é o único comando em que ele não sobrevivia:
    // `resumirAmostras` devolve um campo `janela` próprio (as pontas que recebeu) e, com o
    // envelope escrito ANTES do espalhamento, ele o sobrescrevia. O documento de `saude`
    // saía sem diretório, sem contagem de arquivos e sem contagem de linhas, ou seja, sem a
    // metade que o torna falsificável, e nada ficava vermelho.
    assert.equal(doc.janela.dir, path.resolve(dir));
    assert.equal(doc.janela.arquivos, 1);
    assert.equal(doc.janela.linhas, 8);
    // E o campo do resumo continua no documento, com outro nome: ele é o que o resumo usou
    // para separar buraco de desconhecido, e um leitor que compare os dois está conferindo.
    assert.equal(typeof doc.janelaDaSerie, 'object');
    assert.notEqual(doc.janelaDaSerie, null);
    assert.equal(doc.janelaDaSerie.inicio, doc.janela.inicio);
    assert.equal(doc.janelaDaSerie.fim, doc.janela.fim);
  });

  it('linhas: as linhas CRUAS do disco, não uma re-serialização', () => {
    const { dir } = logSintetico();
    const { doc } = documento(['linhas', '--dir', dir, '--filtro', 'RangeError']);
    assert.equal(doc.casaram, 1);
    assert.equal(doc.naJanela, 8);
    assert.equal(doc.filtro, 'RangeError');
    assert.equal(doc.linhas.length, 1);
    assert.equal(typeof doc.linhas[0], 'string');
    // Conferível com um `grep` no mesmo arquivo, que é a propriedade do `--filtro`.
    const noDisco = fs.readFileSync(path.join(dir, arquivoDoDia(Date.now())), 'utf8').split('\n');
    assert.ok(noDisco.includes(doc.linhas[0]), 'a linha do documento não existe no disco como está');
  });
});

describe('diag --json: os erros de uso', () => {
  it('`--desde` inválido sai com 1 e escreve no STDERR nos dois modos, com stdout vazio', () => {
    const { dir } = logSintetico();
    const humano = rodar(['erros', '--dir', dir, '--desde', '24hs']);
    assert.equal(humano.codigo, 1);
    assert.equal(humano.saida, '');
    assert.match(humano.erro, /Janela inválida/);

    const json = rodar(['erros', '--dir', dir, '--desde', '24hs', '--json']);
    assert.equal(json.codigo, 1);
    assert.equal(json.saida, '');
    assert.match(json.erro, /Janela inválida/);
  });

  it('comando desconhecido manda a AJUDA para o stderr quando `--json` está ligado', () => {
    // No modo humano ela vai para o stdout, como sempre foi; sob `--json` isso quebraria todo
    // `| jq` exatamente no caso em que o operador errou o comando.
    const humano = rodar(['xpto']);
    assert.equal(humano.codigo, 1);
    assert.match(humano.saida, /npm run diag/);

    const json = rodar(['xpto', '--json']);
    assert.equal(json.codigo, 1);
    assert.equal(json.saida, '');
    assert.match(json.erro, /npm run diag/);
  });

  it('diretório de log inexistente sai com 1 e não escreve no stdout', () => {
    const inexistente = path.join(os.tmpdir(), `ebgeo-nao-existe-${Date.now()}`);
    const r = rodar(['erros', '--dir', inexistente, '--json']);
    assert.equal(r.codigo, 1);
    assert.equal(r.saida, '');
    assert.match(r.erro, /Diretório de log não encontrado/);
  });

  it('`--estado` e `--origem` inválidos reclamam ANTES de tocar no banco', () => {
    // O comando é de banco, mas a validação acontece antes do primeiro import do pool. O
    // `semBanco` é o que torna isso VERIFICÁVEL: com `DATABASE_URL` herdada do corredor, o
    // comando abriria o pool e o caso passaria verde com a validação removida.
    const estado = rodar(['defeitos', '--estado', 'abertos'], { semBanco: true });
    assert.equal(estado.codigo, 1);
    assert.equal(estado.saida, '');
    assert.match(estado.erro, /--estado inválido: "abertos"/);
    assert.match(estado.erro, /aberto, resolvido, ignorado, regrediu/);
    assert.equal(estado.erro.includes('abrir o banco'), false, 'chegou a tentar o banco');

    const origem = rodar(['defeitos', '--origem', 'navegador'], { semBanco: true });
    assert.equal(origem.codigo, 1);
    assert.match(origem.erro, /--origem inválido/);
    assert.equal(origem.erro.includes('abrir o banco'), false, 'chegou a tentar o banco');
  });

  it('`--limite` inválido RECUSA em voz alta, em vez de cair no default', () => {
    // `parseInt('abc')` é NaN e `0` é falso: os dois caíam no `|| 20` e o comando cortava a
    // lista num tamanho que ninguém pediu, sem dizer nada. É a mesma classe do `--desde
    // 24hs` que `parseJanela` recusa, e a mesma decisão.
    const { dir } = logSintetico();
    for (const valor of ['abc', '0', '-3', '12abc', '']) {
      const r = rodar(['erros', '--dir', dir, '--limite', valor]);
      assert.equal(r.codigo, 1, `--limite ${JSON.stringify(valor)} não reprovou`);
      assert.equal(r.saida, '', `--limite ${JSON.stringify(valor)} escreveu no stdout`);
      assert.match(r.erro, /Limite inválido/);
    }
    // E o válido continua passando, senão a guarda estaria só recusando tudo.
    const bom = rodar(['erros', '--dir', dir, '--limite', '1', '--json']);
    assert.equal(bom.codigo, 0);
    assert.equal(JSON.parse(bom.saida).limite, 1);
  });

  it('`pilha` sem `--mapas` reclama do argumento, não do banco', () => {
    const semMapas = rodar(['pilha', '--id', '11111111-1111-1111-1111-111111111111'], { semBanco: true });
    assert.equal(semMapas.codigo, 1);
    assert.match(semMapas.erro, /Falta --mapas/);
    assert.equal(semMapas.saida, '');
  });

  it('`pilha` sem NENHUM dos dois cobra `--mapas` primeiro, e isso é decisão', () => {
    // A precedência não é acidente: `--mapas` é argumento de ARQUIVO e é cobrado antes do
    // pool, enquanto o formato de `--id` só é conferido dentro de `buscarDefeito`, depois da
    // conexão. Trocar a ordem faria um `diag -- pilha` nu reclamar do banco com o Postgres
    // fora, em vez de reclamar da bandeira que falta.
    const nu = rodar(['pilha'], { semBanco: true });
    assert.equal(nu.codigo, 1);
    assert.equal(nu.saida, '');
    assert.match(nu.erro, /Falta --mapas/);
    assert.equal(nu.erro.includes('--id'), false, 'reclamou de --id antes de --mapas');
  });
});
