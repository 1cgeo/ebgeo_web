// Path: tests/integration/diag-rotas-de-log-espelham-o-cli.test.js
//
// As respostas do log que até 2026-09-02 só o terminal dava (`GET /diag/saude`,
// `GET /diag/linhas`) e as DUAS BANDEIRAS que faltavam nas rotas que já existiam
// (`?porRelease=` em `/diag/lento` e `?intervalo=` em `/diag/resumo`), com a prova de que as
// duas portas não podem divergir.
//
// AS DUAS BANDEIRAS ENTRARAM PORQUE A WIKI PASSOU A AFIRMAR que a porta HTTP cobre o comando
// inteiro, e a afirmação era falsa por elas: `lento --por-release` é a única forma de ver uma
// regressão de latência entre duas builds (a média das duas numa linha só a ESCONDE), e
// `resumo --intervalo` é a saída para a série em que a inferência do intervalo não alcança.
// Uma frase de doc que promete cobertura vale o que a menor das rotas entrega.
//
// POR QUE ESTE ARQUIVO EXISTE, e por que ele espelha em vez de asserir números próprios. A
// decisão do dono naquela data foi que o caso comum é um agente com credencial de
// administrador operando de FORA do host, lendo JSON; o comando é o gêmeo de quem tem shell.
// Duas portas para a mesma pergunta é exatamente o arranjo que diverge em silêncio: alguém
// conserta a contagem de buracos num lado, o outro continua verde, e o produto passa a dar
// DUAS respostas sobre a mesma queda sem nada indicando qual está certa. A guarda contra isso
// não pode ser "os dois têm teste", porque dois testes escritos à mão divergem junto com o
// código que eles medem. Ela é a COMPARAÇÃO: o comando e a rota rodam sobre o MESMO diretório
// temporário, na mesma rodada, e o que sai tem de ser o mesmo documento.
//
// O QUE SE COMPARA, E O QUE FICA DE FORA. O `--json` do comando embrulha a estrutura num
// envelope de três campos (`comando`, `janela`, `gerado_em`); a rota publica a mesma
// procedência sob `janela` e não tem os outros dois. Tirando o envelope dos dois lados sobra
// exatamente a estrutura do comando, e é ela que precisa ser igual. Os campos DERIVADOS DO
// RELÓGIO não podem ser comparados por igualdade (as duas invocações acontecem em instantes
// diferentes, com segundos de distância), e por isso eles são conferidos com TOLERÂNCIA, um a
// um, por NOME: a lista deles é fechada aqui, e um campo novo que passasse a depender do
// relógio cairia na comparação estrita e ficaria vermelho, que é a direção certa.
//
// A COMPARAÇÃO DE CHAVES VEM ANTES DA DE VALORES, e não é redundante: um documento a que
// faltasse metade dos campos passaria numa comparação campo a campo escrita à mão. Aqui os
// dois conjuntos de chaves são asseridos iguais, e depois os valores.
//
// O `import` É DINÂMICO, como em `diag-rota-de-resumo.test.js`: `config.js` é um singleton
// congelado na avaliação do módulo e `src/app.js` o puxa transitivamente, então `LOG_DIR`
// precisa estar no ambiente ANTES daquela avaliação para que a rota leia o diretório SEMEADO
// aqui em vez do `./data/logs` da máquina. O runner dá um processo por arquivo de teste, então
// a variável não vaza para os vizinhos, e o log em arquivo fica DESLIGADO sob `NODE_ENV=test`
// (`src/utils/logger.js`), de modo que nada além desta fixture escreve no diretório.
//
// CONTROLE NEGATIVO, conferido revertendo cada peça:
//  - trocar o `resumirAmostras` da rota por uma contagem própria: os dois casos de espelho de
//    saúde ficam vermelhos, com o campo divergente nomeado na diferença;
//  - fazer a rota filtrar o texto re-serializado (`JSON.stringify(reg)`) em vez da linha crua
//    de `brutas`: o caso do escape fica vermelho, e é o único que pega essa troca, porque
//    sobre uma fixture sem acento escapado as duas formas casam igual;
//  - desalinhar os dois anéis de `lerJanela` (retirar o `desenrolar` compartilhado e desenrolar
//    `brutas` com outro corte): o caso do espelho de linhas fica vermelho, porque o item
//    devolvido deixa de ser o da linha que casou;
//  - tirar `requireAdmin` de qualquer uma das duas: UM vermelho por rota, o do usuário comum;
//  - tirar `auth`: DOIS por rota, o do anônimo e o do comum;
//  - trocar `janela('24h')`/`janela('1h')` por um `Joi.string()` nu: os casos de gramática e de
//    teto ficam vermelhos, e a requisição volta a poder abrir trinta arquivos de log;
//  - tirar o `.required()` de `filtro`: o caso do filtro obrigatório fica vermelho, e a rota
//    volta a poder despejar a janela inteira;
//  - devolver as linhas como TEXTO em `itens` (copiando o comando): o caso do espelho de linhas
//    fica vermelho na comparação com `JSON.parse`, que é onde a decisão está escrita.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import supertest from 'supertest';
import { randomUUID } from 'crypto';

const DIR_DE_LOG = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-diag-espelho-'));
process.env.LOG_DIR = DIR_DE_LOG;

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const { createUser, createAdminUser, loginUser } = await import('../helpers/fixtures.js');
const { MARCADOR_AMOSTRA } = await import('../../src/utils/amostra-de-saude.js');

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const MIN = 60_000;
const MARCA = randomUUID().slice(0, 8);

/** As duas builds da mesma rota, para o `porRelease` ter o que separar. */
const RELEASE_VELHA = `1.0.0+${randomUUID().slice(0, 6)}`;
const RELEASE_NOVA = `1.0.0+${randomUUID().slice(0, 6)}`;

/**
 * Os registros que estouram o ORÇAMENTO DE BYTES de `linhas()`.
 *
 * CINCO DE 1,2 MB SÃO 6 MB CONTRA UM ORÇAMENTO DE 4 MB, o que garante o corte com folga em vez
 * de encostar na fronteira: um teste que empatasse com o teto passaria ou não conforme o tamanho
 * exato do JSON de cada linha, que é detalhe do serializador e não do assunto.
 */
const GRANDES = 5;
const TAMANHO_GRANDE = 1_200_000;
/**
 * O MARCADOR DOS GRANDES NÃO PODE CONTER `MARCA`, e a primeira versão continha
 * (`grande-${MARCA}`): o filtro é por SUBSTRING, então todo caso que procurava `MARCA` passava
 * a casar os cinco registros de 1,2 MB, e o comando morria com o stdout estourando o `maxBuffer`
 * do `spawnSync`. O sintoma ("o comando foi morto por SIGKILL") não aponta para o marcador em
 * lugar nenhum.
 */
const MARCA_GRANDE = `grande-${randomUUID().slice(0, 8)}`;

/** O dia local em AAAA-MM-DD, o mesmo formato que `log-diario.js` escreve. */
function diaLocal(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${d}`;
}

/**
 * OS CAMPOS DO RESUMO DE SAÚDE QUE DEPENDEM DO RELÓGIO, e por isso não se comparam por
 * igualdade entre duas invocações.
 *
 * A lista é FECHADA de propósito, e é ela que dá valor ao resto: tudo o que não estiver aqui é
 * comparado com `deepStrictEqual`, então um campo novo que passasse a derivar do instante da
 * consulta ficaria vermelho até alguém decidir onde ele entra. O contrário (tolerar tudo o que
 * pareça um número) transformaria o espelho em decoração.
 *
 *  - `janelaDaSerie` são as PONTAS da janela que o resumo recebeu (`{ inicio, fim }`), e as
 *    duas andam com o relógio;
 *  - `desdeUltimaMs` é a distância da última amostra até AGORA, que é o único número do
 *    relatório que fala do presente;
 *  - `desconhecidoAntesMs` é o trecho anterior à primeira amostra, medido a partir do começo
 *    da janela, que também anda.
 */
const CAMPOS_DE_RELOGIO = ['janelaDaSerie', 'desdeUltimaMs', 'desconhecidoAntesMs'];

/** Quanto as duas invocações podem se afastar no tempo. Generoso: elas são sequenciais. */
const TOLERANCIA_MS = 120_000;

function semEnvelope(doc) {
  const copia = { ...doc };
  delete copia.comando;
  delete copia.janela;
  delete copia.gerado_em;
  return copia;
}

describe('GET /diag/saude e /diag/linhas espelham o comando', () => {
  let app, db, comum, comumToken, admin, adminToken;
  const agora = Date.now();

  const pedir = (rota, token = adminToken) => supertest(app)
    .get(`/api/v1/diag${rota}`)
    .set('Authorization', `Bearer ${token}`);

  /**
   * Roda o comando contra o MESMO diretório, sempre em `--json`.
   *
   * `timeout` + `killSignal` pela razão dos irmãos: um pool que vaze prende o filho para
   * sempre e leva a rodada inteira junto, sem sintoma que aponte para a causa. Estes dois
   * comandos são de LOG e não abrem banco, mas a guarda custa nada e o dia em que alguém os
   * mudar é o dia em que ela vale.
   */
  function cli(args) {
    const r = spawnSync(process.execPath, [COMANDO, ...args, '--dir', DIR_DE_LOG, '--json'], {
      encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL',
      // O `maxBuffer` DEFAULT É 1 MB, e estourá-lo MATA o filho com o `killSignal`: a falha
      // chega como "o comando foi morto por SIGKILL", indistinguível de um travamento e sem
      // uma palavra sobre tamanho. Um documento de diagnóstico legitimamente passa de 1 MB
      // (esta fixture tem registros de 1,2 MB de propósito), então o teto vai para um valor em
      // que só um defeito real chega.
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(r.signal, null, `o comando foi morto por ${r.signal} (travou?)`);
    assert.equal(r.status, 0, `o comando saiu com ${r.status}: ${r.stderr}`);
    // O parse do stdout INTEIRO é de propósito: ele prova, de passagem, que nada além do
    // documento foi escrito ali, que é o contrato do `--json`.
    return JSON.parse(r.stdout);
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    comum = await createUser(db, { username: `esp_usr_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `esp_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);

    // A SÉRIE DE AMOSTRAS, com um BURACO no meio: cadência de 5 min, e um silêncio de 30 min
    // entre a terceira e a quarta, que são 5 amostras faltando. Os números exatos ficam nas
    // asserções e não nesta frase, porque é lá que eles têm guarda.
    //
    // A ÚLTIMA AMOSTRA FICA A 2 MIN DE AGORA, e não a 5: com ela na borda do intervalo,
    // `ultimaAtrasada` viraria `true` para a invocação mais tardia e `false` para a outra, e o
    // espelho reprovaria por causa do relógio e não do código. É a mesma razão de os campos de
    // relógio serem comparados com tolerância.
    const registros = [];
    for (const minutos of [62, 57, 52, 22, 17, 12, 7, 2]) {
      registros.push({
        level: 30, time: agora - minutos * MIN, msg: 'amostra',
        amostra: MARCADOR_AMOSTRA, banco: { ok: true, ms: 2 },
      });
    }

    // O TRÁFEGO, para o `linhas` ter o que casar. `MARCA` é única por rodada e não aparece em
    // linha nenhuma que não seja desta fixture.
    registros.push({
      level: 30, time: agora - 30 * MIN, msg: 'request',
      url: `/api/v1/atlas?marca=${MARCA}`, method: 'GET', statusCode: 200, duration: 11,
    });

    // AS DUAS BUILDS DA MESMA ROTA, e elas são o caso inteiro do `porRelease`: sem a bandeira
    // as quatro linhas viram UMA, com um p95 que é a média das duas builds; com ela viram
    // DUAS, uma por `release`, e a regressão aparece. A rota é outra (`/api/v1/sync`) para não
    // se misturar com a de cima, que existe para o filtro de `linhas`.
    for (const [release, duracao] of [[RELEASE_VELHA, 20], [RELEASE_NOVA, 900]]) {
      for (let i = 0; i < 2; i += 1) {
        registros.push({
          level: 30, time: agora - (26 - i) * MIN, msg: 'request', release,
          url: '/api/v1/sync', method: 'POST', statusCode: 200, duration: duracao,
        });
      }
    }

    // OS REGISTROS GRANDES, para o ORÇAMENTO DE BYTES ter o que cortar. Eles carregam um
    // marcador próprio (nenhum outro caso filtra por ele) e ficam a 20 HORAS de distância, no
    // fundo da janela: os casos que pedem "as N mais recentes" não podem cair sobre eles, senão
    // um teste de corte por ITEM passaria a medir o corte por BYTE sem dizer.
    for (let i = 0; i < GRANDES; i += 1) {
      // O `time` CRESCE COM `i` para que a ordem do ARQUIVO seja a cronológica: o leitor
      // preserva a ordem em que as linhas estão no disco, e não reordena por `time`. Escritos
      // do mais novo para o mais velho, "o último item" da resposta seria o mais ANTIGO, e a
      // asserção de "sobram os mais recentes" mediria o contrário do que afirma.
      registros.push({
        level: 30, time: agora - (20 * 60 + GRANDES - i) * MIN, msg: `${MARCA_GRANDE} ${i}`,
        recheio: 'x'.repeat(TAMANHO_GRANDE),
      });
    }
    registros.push({
      level: 50, time: agora - 29 * MIN, msg: 'request error',
      url: `/api/v1/atlas?marca=${MARCA}`, method: 'GET', statusCode: 500, duration: 300,
      err: { type: 'TypeError', message: `estourou ${MARCA}`, stack: 'TypeError: x' },
    });
    // A LINHA COM ACENTO ESCAPADO é a única que separa "casou a linha do disco" de "casou uma
    // re-serialização": `JSON.stringify` de um objeto com `é` escreve o caractere LITERAL,
    // enquanto esta linha guarda a forma ESCAPADA. Quem filtrar o texto re-serializado não a
    // acha por `\\u00e9`, e quem filtrar o disco acha. Ela é escrita à mão por isso.
    registros.push({ level: 30, time: agora - 28 * MIN, msg: 'ACENTO_LITERAL' });

    const linhas = registros.map((r) => JSON.stringify(r));
    linhas.push(`{"level":30,"time":${agora - 27 * MIN},"msg":"caf\\u00e9 ${MARCA}"}`);
    fs.writeFileSync(
      path.join(DIR_DE_LOG, `ebgeo-${diaLocal(new Date(agora))}.jsonl`),
      `${linhas.join('\n')}\n`
    );
  });

  after(async () => {
    await teardownTestEnv(db);
    fs.rmSync(DIR_DE_LOG, { recursive: true, force: true });
  });

  // ─────────────────────────── os gates, dos dois lados ───────────────────────────

  it('anônimo leva 401 e usuário comum leva 403, nas DUAS rotas', async () => {
    for (const rota of ['/saude', `/linhas?filtro=${MARCA}`]) {
      await supertest(app).get(`/api/v1/diag${rota}`).expect(401);
      await pedir(rota, comumToken).expect(403);
    }
  });

  it('o administrador VÊ, que é a metade do par que só o negativo não prova', async () => {
    const saude = await pedir('/saude').expect(200);
    assert.equal(saude.body.data.total, 8);
    const linhas = await pedir(`/linhas?filtro=${MARCA}`).expect(200);
    assert.ok(linhas.body.data.total >= 3, 'a fixture tem ao menos três linhas com a marca');
  });

  // ─────────────────────────────── o espelho: saúde ───────────────────────────────

  it('saude: o documento da rota é o do comando, com o intervalo INFORMADO', async () => {
    const doc = cli(['saude', '--desde', '24h', '--intervalo', '5m']);
    const { body } = await pedir('/saude?desde=24h&intervalo=5m').expect(200);
    const rota = body.data;

    // A premissa da rota é conferida à parte (o envelope do comando tem outro formato), e ela
    // é o que torna a resposta falsificável: sem `diretorio` e `linhas`, uma janela vazia vinda
    // do diretório errado é indistinguível de uma janela limpa.
    assert.equal(rota.janela.desde, '24h');
    assert.equal(rota.janela.diretorio, path.resolve(DIR_DE_LOG));
    assert.equal(rota.janela.diretorioAusente, false);
    assert.equal(rota.janela.arquivos, 1);
    assert.equal(rota.janela.linhas, doc.janela.linhas);
    // O ESPELHO SÓ VALE ABAIXO DO ANEL, e por isso a premissa entra como asserção e não como
    // suposição: acima de `MAX_REGISTROS` a rota descarta os registros mais antigos e o comando
    // não, então os dois documentos PODEM divergir de forma legítima. Aqui não divergem, e é o
    // `truncado: false` que autoriza a comparação estrita abaixo.
    assert.equal(rota.janela.truncado, false);

    const doComando = semEnvelope(doc);
    const daRota = { ...rota };
    delete daRota.janela;

    assert.deepEqual(
      Object.keys(daRota).sort(), Object.keys(doComando).sort(),
      'as duas portas publicam conjuntos de campos diferentes'
    );

    for (const campo of CAMPOS_DE_RELOGIO) {
      assert.ok(campo in doComando, `${campo} sumiu do comando: reveja CAMPOS_DE_RELOGIO`);
      delete doComando[campo];
      delete daRota[campo];
    }
    assert.deepEqual(daRota, doComando);

    // E o que foi tirado da comparação estrita é conferido com tolerância, senão o espelho
    // estaria simplesmente ignorando três campos.
    assert.ok(Math.abs(rota.desdeUltimaMs - doc.desdeUltimaMs) < TOLERANCIA_MS);
    assert.ok(Math.abs(rota.desconhecidoAntesMs - doc.desconhecidoAntesMs) < TOLERANCIA_MS);
    assert.ok(Math.abs(rota.janelaDaSerie.fim - doc.janelaDaSerie.fim) < TOLERANCIA_MS);
    assert.equal(rota.janelaDaSerie.fim - rota.janelaDaSerie.inicio, 86_400_000);

    // Os números da fixture, em absoluto: sem eles as duas portas poderiam estar igualmente
    // erradas e o espelho não notaria.
    assert.equal(rota.situacao, 'medida');
    assert.equal(rota.total, 8);
    assert.equal(rota.intervaloOrigem, 'informado');
    assert.equal(rota.intervaloMs, 300_000);
    assert.equal(rota.faltantes, 5);
    assert.equal(rota.esperadas, 13);
    assert.equal(rota.buracos.length, 1);
    assert.equal(rota.ultimaAtrasada, false);
  });

  it('saude: espelha TAMBÉM com o intervalo INFERIDO, que é o caminho sem premissa dada', async () => {
    // O caso do intervalo informado não exercita a inferência, que é a metade do relatório com
    // decisão dentro (o p10 das distâncias, a fragilidade da estimativa). Se as duas portas
    // divergissem só ali, o caso acima passaria verde.
    const doc = cli(['saude', '--desde', '24h']);
    const { body } = await pedir('/saude?desde=24h').expect(200);
    const rota = body.data;

    const doComando = semEnvelope(doc);
    const daRota = { ...rota };
    delete daRota.janela;
    for (const campo of CAMPOS_DE_RELOGIO) {
      delete doComando[campo];
      delete daRota[campo];
    }
    assert.deepEqual(daRota, doComando);

    assert.equal(rota.intervaloOrigem, 'inferido');
    assert.equal(rota.intervaloPercentil, 10);
    assert.equal(rota.intervaloMs, 300_000);
    // Sete distâncias: o posto do p10 é 1, ou seja, a estimativa É a menor delas. O relatório
    // diz isso em voz alta, e é essa honestidade que o espelho precisa carregar dos dois lados.
    assert.equal(rota.estimativaFragil, true);
    assert.equal(rota.faltantes, 5);
  });

  // ────────────────────────────── o espelho: linhas ──────────────────────────────

  it('linhas: os MESMOS itens, na mesma ordem, com o mesmo total', async () => {
    const doc = cli(['linhas', '--desde', '24h', '--filtro', MARCA, '--limite', '100']);
    const { body } = await pedir(`/linhas?desde=24h&filtro=${MARCA}&limite=100`).expect(200);
    const rota = body.data;

    assert.equal(rota.filtro, doc.filtro);
    assert.equal(rota.total, doc.casaram);
    assert.equal(rota.janela.linhas, doc.naJanela);
    assert.equal(rota.janela.truncado, false);

    // O COMANDO DEVOLVE TEXTO E A ROTA DEVOLVE OBJETO, e a divergência é decisão: a resposta da
    // rota JÁ é JSON, e um objeto embrulhado em string dentro dela obrigaria todo consumidor a
    // um segundo parse. O que precisa ser igual é o CONTEÚDO, e é isso que o parse afirma.
    assert.equal(rota.itens.length, doc.linhas.length);
    assert.deepEqual(rota.itens, doc.linhas.map((l) => JSON.parse(l)));
    assert.ok(rota.itens.length >= 3, 'a fixture precisa ter o que casar, senão isto é vazio');

    // A ORDEM É A DO ARQUIVO, do mais antigo para o mais recente dentro do corte, e ela é
    // asserida porque uma inversão passaria pela comparação de conjunto acima se ela fosse
    // feita por `Set`.
    const instantes = rota.itens.map((i) => i.time);
    assert.deepEqual(instantes, [...instantes].sort((a, b) => a - b));
  });

  it('linhas: o filtro casa a LINHA DO DISCO, escape inclusive', async () => {
    // A fixture tem uma linha escrita à mão com o acento ESCAPADO e outra com o mesmo texto em
    // forma literal. Filtrar a forma escapada casa exatamente uma; filtrar a literal casa a
    // outra. Uma rota que casasse `JSON.stringify(registro)` inverteria as duas respostas, e
    // nenhuma asserção sobre contagem total pegaria isso.
    const escapado = await pedir(`/linhas?desde=24h&filtro=caf%5Cu00e9`).expect(200);
    assert.equal(escapado.body.data.total, 1);
    // O `msg` volta DECODIFICADO, porque `itens` é o registro parseado: o escape cumpriu o
    // papel dele no CASAMENTO, que é onde ele importa, e não no transporte.
    assert.equal(escapado.body.data.itens[0].msg, `café ${MARCA}`);

    const literal = await pedir('/linhas?desde=24h&filtro=ACENTO_LITERAL').expect(200);
    assert.equal(literal.body.data.total, 1);

    // E o comando concorda, que é o ponto do arquivo.
    const doc = cli(['linhas', '--desde', '24h', '--filtro', 'caf\\u00e9']);
    assert.equal(doc.casaram, 1);
  });

  it('linhas: `casouTudo` denuncia o filtro que não estreitou nada', async () => {
    // A expectativa errada mais natural é que o filtro case só VALOR. A linha crua carrega o
    // NOME de cada campo, então `time` casa toda linha que o tenha, e sem este campo o
    // resultado se lê como "tudo isto tem a ver com o que eu procuro".
    const tudo = await pedir('/linhas?desde=24h&filtro=time&limite=5').expect(200);
    assert.equal(tudo.body.data.casouTudo, true);
    assert.equal(tudo.body.data.total, tudo.body.data.janela.linhas);
    // E o corte do `limite` é dito à parte do corte do ANEL: os dois `truncado` desta resposta
    // significam coisas diferentes, e aqui só o de cima é verdadeiro.
    assert.equal(tudo.body.data.truncado, true);
    assert.equal(tudo.body.data.itens.length, 5);
    assert.equal(tudo.body.data.janela.truncado, false);

    const estreito = await pedir(`/linhas?desde=24h&filtro=${MARCA}`).expect(200);
    assert.equal(estreito.body.data.casouTudo, false);
    assert.equal(estreito.body.data.truncado, false);
  });

  it('linhas: as últimas do corte, e não as primeiras', async () => {
    // Quem pergunta "o que quebrou" quer o fim da janela. Um corte que guardasse o começo
    // responderia sobre ontem com cara de resposta sobre agora.
    const cortado = await pedir('/linhas?desde=24h&filtro=time&limite=1').expect(200);
    const inteiro = await pedir('/linhas?desde=24h&filtro=time&limite=2000').expect(200);
    assert.deepEqual(cortado.body.data.itens, inteiro.body.data.itens.slice(-1));
  });


  it('linhas: sem `?desde=`, as duas portas assumem a MESMA janela', async () => {
    // O default era `1h` na rota e `24h` no comando, e a divergência é do tipo que só aparece
    // quando alguém compara: o MESMO pedido, sem parâmetro, respondia sobre períodos
    // diferentes conforme a porta, e a fixture inteira desta suíte cabe em 24h e não em 1h.
    const doc = cli(['linhas', '--filtro', MARCA, '--limite', '100']);
    const { body } = await pedir(`/linhas?filtro=${MARCA}&limite=100`).expect(200);
    assert.equal(body.data.janela.desde, '24h');
    assert.equal(doc.janela.desde, '24h');
    assert.equal(body.data.total, doc.casaram);
    assert.deepEqual(body.data.itens, doc.linhas.map((l) => JSON.parse(l)));
    // A janela de 1h não alcançaria a amostra mais antiga da fixture, que é de 62 min atrás:
    // é ela que torna este caso capaz de reprovar a divergência em vez de só documentá-la.
    assert.ok(body.data.janela.linhas > 8, 'a janela precisa alcançar o começo da fixture');
  });

  it('linhas: o ORÇAMENTO DE BYTES corta, e diz que cortou', async () => {
    // O `limite` conta ITENS, e quem escolhe o TAMANHO de um item é quem escreveu a linha de
    // log. Cinco registros de 1,2 MB passam folgados no `limite` de 100 e são 6 MB de resposta
    // montada dentro do processo que também atende sync.
    const { body } = await pedir(`/linhas?filtro=${MARCA_GRANDE}&limite=100`).expect(200);
    const r = body.data;

    assert.equal(r.total, GRANDES, 'os cinco casaram: o corte é de BYTES, não de casamento');
    assert.equal(r.truncadoPorBytes, true);
    assert.ok(r.itens.length < GRANDES, `o orçamento não cortou nada: ${r.itens.length} itens`);
    assert.ok(r.itens.length >= 1, 'cortar até a lista vazia se leria como rota quebrada');
    // O `truncado` do `limite` continua FALSO: 5 cabem em 100. Os dois campos existem separados
    // exatamente para que este caso possa dizer QUAL corte valeu.
    assert.equal(r.truncado, false);

    // O QUE SOBRA SÃO OS MAIS RECENTES, como no corte por item: a fixture numera o `msg`, e os
    // grandes foram escritos do mais recente (0) para o mais antigo, então quem fica é o 0.
    assert.equal(r.itens[r.itens.length - 1].msg, `${MARCA_GRANDE} ${GRANDES - 1}`);
    assert.equal(r.itens[0].msg !== `${MARCA_GRANDE} 0`, true, 'o corte tem de cair no começo');

    // E o que sobrou cabe no orçamento, que é a propriedade e não o efeito colateral.
    const bytes = r.itens.reduce((s, i) => s + Buffer.byteLength(JSON.stringify(i), 'utf8'), 0);
    assert.ok(bytes <= 4 * 1024 * 1024, `a resposta ficou com ${bytes} bytes de registro`);
  });

  it('lento: `?porRelease=1` espelha `--por-release`, e SEM ele as duas builds viram uma', async () => {
    // A pergunta que só esta forma responde é a de todo deploy. Sem a bandeira, as quatro
    // linhas de `/api/v1/sync` (duas por build, uma delas 45 vezes mais lenta) viram UMA rota
    // com um p95 que é a média das duas, e a regressão desaparece na tabela.
    const semBandeira = await pedir('/lento?desde=24h&limite=100').expect(200);
    const daRota = semBandeira.body.data.rotas.filter((r) => r.rota === 'POST /api/v1/sync');
    assert.equal(daRota.length, 1, 'sem a bandeira, a rota é UMA linha');
    assert.equal(semBandeira.body.data.porRelease, false);

    const doc = cli(['lento', '--desde', '24h', '--limite', '100', '--por-release']);
    const { body } = await pedir('/lento?desde=24h&limite=100&porRelease=1').expect(200);
    assert.equal(body.data.porRelease, true);
    assert.deepEqual(body.data.rotas, doc.rotas, 'as duas portas discordam sobre as rotas');
    assert.equal(body.data.total, doc.totalDeRotas);

    const porBuild = body.data.rotas.filter((r) => r.rota === 'POST /api/v1/sync');
    assert.equal(porBuild.length, 2, 'com a bandeira, uma linha por build');
    assert.deepEqual(
      porBuild.map((r) => r.release).sort(), [RELEASE_VELHA, RELEASE_NOVA].sort()
    );
    // O número que a bandeira existe para revelar: a build nova é a lenta.
    const nova = porBuild.find((r) => r.release === RELEASE_NOVA);
    const velha = porBuild.find((r) => r.release === RELEASE_VELHA);
    assert.ok(nova.max > velha.max * 10, 'a fixture precisa ter uma regressão visível');
  });

  it('resumo: `?intervalo=` decide a PREMISSA do bloco de saúde, e espelha o comando', async () => {
    // Sem a bandeira o bloco responde sobre o intervalo INFERIDO, e a inferência não alcança a
    // série em que nenhuma distância é nominal. A rota não tinha porta para isso, então a única
    // saída era ir ao host — que é justamente o que a decisão de 2026-09-02 tirou da mesa.
    const inferido = await pedir('/resumo?desde=24h').expect(200);
    assert.equal(inferido.body.data.saude.intervaloOrigem, 'inferido');

    const doc = cli(['resumo', '--desde', '24h', '--intervalo', '5m']);
    const { body } = await pedir('/resumo?desde=24h&intervalo=5m').expect(200);
    assert.equal(body.data.saude.intervaloOrigem, 'informado');
    assert.equal(body.data.saude.intervaloMs, 300_000);
    // O bloco inteiro, das duas portas, MENOS as duas divergências conhecidas: é o mesmo
    // `montarResumo` sobre o mesmo arquivo, então qualquer outra diferença aqui é a bandeira
    // chegando diferente de um dos dois lados.
    //
    //  - `desdeUltimaMs` anda com o relógio (as duas invocações são sequenciais);
    //  - `premissa.truncado` SÓ EXISTE NA ROTA, e a ausência dele no comando é decisão
    //    registrada: o leitor de fluxo não tem teto para estourar, e um `truncado: false` lá
    //    seria promessa sobre um mecanismo ausente.
    const daRota = { ...body.data.saude, premissa: { ...body.data.saude.premissa } };
    const doComando = { ...doc.saude, premissa: { ...doc.saude.premissa } };
    assert.equal(daRota.premissa.truncado, false);
    assert.equal('truncado' in doComando.premissa, false, 'o comando não tem anel para truncar');
    delete daRota.premissa.truncado;
    assert.ok(Math.abs(daRota.desdeUltimaMs - doComando.desdeUltimaMs) < TOLERANCIA_MS);
    delete daRota.desdeUltimaMs;
    delete doComando.desdeUltimaMs;
    assert.deepEqual(daRota, doComando);
    // E a recusa da forma vale aqui como em `/diag/saude`: uma gramática por rota seria uma
    // segunda verdade sobre o que "5m" significa.
    await pedir('/resumo?intervalo=300000').expect(422);
  });

  // ────────────────────────────────── a borda ──────────────────────────────────

  it('a gramática e o teto da janela valem nas duas, com a MESMA mensagem das irmãs', async () => {
    for (const rota of ['/saude', `/linhas?filtro=${MARCA}`]) {
      const juncao = rota.includes('?') ? '&' : '?';
      const forma = await pedir(`${rota}${juncao}desde=24hs`).expect(422);
      assert.match(JSON.stringify(forma.body), /Janela inválida/);
      const teto = await pedir(`${rota}${juncao}desde=30d`).expect(422);
      assert.match(JSON.stringify(teto.body), /7d/);
    }
  });

  it('`intervalo` recusa o número NU, que seria ambíguo com a variável em ms', async () => {
    const nu = await pedir('/saude?intervalo=300000').expect(422);
    assert.match(JSON.stringify(nu.body), /Intervalo inválido/);
    await pedir('/saude?intervalo=30s').expect(200);
    await pedir('/saude?intervalo=1h').expect(200);
  });

  it('`filtro` é OBRIGATÓRIO e tem piso de dois caracteres', async () => {
    // Sem filtro, a resposta seria a janela inteira atravessando o ciclo HTTP; com um
    // caractere, o que volta não é um recorte, é o teto do `limite` com cara de resposta.
    await pedir('/linhas?desde=24h').expect(422);
    await pedir('/linhas?desde=24h&filtro=a').expect(422);
    await pedir('/linhas?desde=24h&filtro=ab').expect(200);
  });

  it('`limite` fora da faixa reprova em vez de cair no default', async () => {
    await pedir(`/linhas?filtro=${MARCA}&limite=0`).expect(422);
    await pedir(`/linhas?filtro=${MARCA}&limite=2001`).expect(422);
  });

  it('diretório de log ausente responde 200 e DIZ que está cego', async () => {
    // A regra da casa: instrumento desligado não desenha boa notícia. Aqui a rota não tem como
    // saber a diferença entre "nenhuma amostra" e "nenhum arquivo", e por isso publica as duas
    // coisas: `diretorioAusente` e `situacao`.
    const salvo = fs.readdirSync(DIR_DE_LOG);
    const guardado = salvo.map((n) => [n, fs.readFileSync(path.join(DIR_DE_LOG, n))]);
    for (const n of salvo) fs.rmSync(path.join(DIR_DE_LOG, n));
    fs.rmdirSync(DIR_DE_LOG);
    try {
      const { body } = await pedir('/saude').expect(200);
      assert.equal(body.data.janela.diretorioAusente, true);
      assert.equal(body.data.janela.linhas, 0);
      assert.equal(body.data.situacao, 'sem-amostras');
      assert.equal(body.data.faltantes, null, 'ausência de medição NÃO pode sair como zero');

      const linhas = await pedir(`/linhas?filtro=${MARCA}`).expect(200);
      assert.equal(linhas.body.data.janela.diretorioAusente, true);
      assert.equal(linhas.body.data.total, 0);
      assert.equal(linhas.body.data.casouTudo, false, 'zero de zero não é "casou tudo"');
    } finally {
      fs.mkdirSync(DIR_DE_LOG, { recursive: true });
      for (const [n, conteudo] of guardado) fs.writeFileSync(path.join(DIR_DE_LOG, n), conteudo);
    }
  });
});
