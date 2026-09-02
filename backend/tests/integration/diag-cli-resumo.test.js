// Path: tests/integration/diag-cli-resumo.test.js
//
// `npm run diag -- resumo` de ponta a ponta, dirigindo `scripts/diag.js` por `spawnSync`
// sobre um diretório de log TEMPORÁRIO e o banco de teste.
//
// POR QUE ESTE ARQUIVO EXISTE, quando `tests/unit/diag-resumo.test.js` já prende a composição.
// A parte pura recebe as peças prontas; o que só o comando de verdade prova é o GATHERING, e
// ele tem três coisas que um teste de unidade não alcança:
//
//   1. o comando é HÍBRIDO e é o único: ele lê o `.jsonl` E o Postgres na mesma invocação.
//      Nenhum dos outros oito faz isso, e o despacho de `main()` tinha dois ramos exclusivos
//      até ele nascer. Um `resumo` que caísse no ramo de banco nunca abriria o log; um que
//      caísse no de arquivo morreria com código 1 num diretório ausente, que para ele é um
//      estado NORMAL;
//   2. a JANELA ANTERIOR sai de uma passada só sobre o DOBRO da janela, com cada registro
//      caindo num de dois acumuladores pelo `time`. Errar o corte é o defeito mais fácil
//      aqui, e ele é silencioso: as duas janelas ficariam iguais e todo delta seria zero;
//   3. as `linhas` da premissa são as da janela ATUAL, e não as do dobro que foi lido.
//      `percorrerRegistros` devolve o total lido, e publicá-lo faria a premissa do relatório
//      dizer o dobro do que os blocos mediram — justamente no campo que existe para tornar a
//      resposta falsificável.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//  - publicar `lida.linhas` em vez de `linhasNaJanela`: o caso da premissa fica vermelho;
//  - mandar tudo para o acumulador atual (ignorar o corte por `time`): o caso do delta fica
//    vermelho, porque o p95 anterior passa a ser o da janela inteira;
//  - fazer o `resumo` cair no ramo de arquivo de `main()`: o caso do diretório ausente passa
//    a sair com código 1 em vez de um relatório com três blocos cegos.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { MARCADOR_AMOSTRA } from '../../src/utils/amostra-de-saude.js';
import { MARCADOR_QUERY_LENTA } from '../../src/utils/query-lenta.js';

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const MARCA = randomUUID().slice(0, 8);
const PAGINA = `resumo-${MARCA}`;
const HORA = 3_600_000;

const temporarios = [];

/** Ver o cabeçalho de `diag-cli-defeitos.test.js`: prazo e `signal` não são zelo. */
function rodar(args) {
  const r = spawnSync(process.execPath, [COMANDO, ...args], {
    encoding: 'utf8', env: process.env, timeout: 30_000, killSignal: 'SIGKILL',
  });
  assert.equal(r.signal, null, `o comando foi morto por ${r.signal}: pool vazado ou consulta presa`);
  return { codigo: r.status, saida: r.stdout || '', erro: r.stderr || '' };
}

/**
 * Escreve um `.jsonl` do dia de HOJE num diretório temporário.
 *
 * O NOME DO ARQUIVO É O QUE `diasDaJanela` PROCURA (`ebgeo-AAAA-MM-DD.jsonl`, fuso LOCAL), e
 * o dia é o de hoje porque a janela do teste é de horas: um arquivo com data de ontem só
 * seria aberto por uma janela que atravessasse a meia-noite, e o caso passaria ou falharia
 * conforme a hora em que a suíte rodasse.
 */
function diretorioComLinhas(linhas) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-resumo-'));
  temporarios.push(dir);
  const d = new Date();
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(
    path.join(dir, `ebgeo-${dia}.jsonl`),
    `${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`
  );
  return dir;
}

describe('diag CLI: resumo, o comando híbrido', () => {
  let db;
  let dir;
  const agora = Date.now();

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    // ── o arquivo: DUAS janelas de 2h, para o delta ter base ──
    const naJanela = agora - HORA;
    const naAnterior = agora - 3 * HORA;
    const linhas = [];
    // A rota mais chamada, mais lenta AGORA do que ANTES: é o contraste que o bloco 2 existe
    // para mostrar.
    for (let i = 0; i < 20; i += 1) {
      linhas.push({ time: naJanela, method: 'POST', url: '/atlas/11111111-2222-3333-4444-555555555555/sync', duration: 300, statusCode: 200 });
      linhas.push({ time: naAnterior, method: 'POST', url: '/atlas/11111111-2222-3333-4444-555555555555/sync', duration: 30, statusCode: 200 });
    }
    // Uma segunda rota, só na janela atual: ela precisa sair com delta null, e não com um
    // delta enorme contra uma base zero inventada.
    linhas.push({ time: naJanela, method: 'GET', url: '/api/config', duration: 12, statusCode: 200 });
    // Um erro, para o bloco 5 não ser vácuo.
    linhas.push({ time: naJanela, method: 'GET', url: '/api/v1/atlas', duration: 5, statusCode: 500, err: { type: 'Error', message: 'x' } });
    // Duas amostras de saúde, para o bloco 3 ter série.
    linhas.push({ time: naJanela, amostra: MARCADOR_AMOSTRA });
    linhas.push({ time: naJanela + 300_000, amostra: MARCADOR_AMOSTRA });
    // Queries lentas nas duas janelas, com contagens DIFERENTES: contagens iguais passariam
    // verdes mesmo com o corte por tempo quebrado.
    linhas.push({ time: naJanela, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 900 });
    linhas.push({ time: naJanela, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 800 });
    linhas.push({ time: naJanela, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 700 });
    linhas.push({ time: naAnterior, level: 40, msg: MARCADOR_QUERY_LENTA, duration: 600 });
    dir = diretorioComLinhas(linhas);

    // ── o banco ──
    await db.query(
      `INSERT INTO defeitos (assinatura, mensagem, pagina, estado, origem, ocorrencias,
                             primeira_em, ultima_em)
       VALUES ($1, 'novo do servidor', $2, 'aberto',   'servidor',     50, NOW(), NOW()),
              ($3, 'queda vista',      $2, 'aberto',   'indisponivel', 7,  NOW(), NOW()),
              ($4, 'antigo do store',  $2, 'regrediu', 'store',        3,
               NOW() - INTERVAL '40 days', NOW())`,
      [`A | ${MARCA}`, PAGINA, `B | ${MARCA}`, `C | ${MARCA}`]
    );
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE pagina = $1', [PAGINA]);
    for (const d of temporarios) fs.rmSync(d, { recursive: true, force: true });
    await teardownTestEnv(db);
  });

  it('com as DUAS fontes vivas, os cinco blocos saem disponíveis', () => {
    const r = rodar(['resumo', '--dir', dir, '--desde', '2h', '--json']);
    assert.equal(r.codigo, 0, r.erro);
    const doc = JSON.parse(r.saida);

    assert.equal(doc.comando, 'resumo');
    for (const bloco of ['defeitos', 'latencia', 'saude', 'indisponivel', 'status']) {
      assert.equal(doc[bloco].disponivel, true, `${bloco} tinha de estar disponível`);
    }
    // O envelope carrega a PROCEDÊNCIA, e o corpo carrega o `periodo`: os dois nomes
    // convivem, e é isso que a colisão de `escreverJson` existe para impedir.
    assert.equal(doc.janela.dir, path.resolve(dir));
    assert.equal(doc.janela.banco, true);
    assert.equal(doc.periodo.desde, '2h');
  });

  it('a premissa conta as linhas da janela ATUAL, e não as do dobro que foi lido', () => {
    // 43 linhas na janela de 2h contra 64 no arquivo inteiro. Publicar o total lido faria a
    // premissa dizer o dobro do que os blocos mediram.
    const doc = JSON.parse(rodar(['resumo', '--dir', dir, '--desde', '2h', '--json']).saida);
    const linhasNaJanela = doc.latencia.premissa.linhas;
    const linhasDoArquivo = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8').trim().split('\n').length;
    assert.ok(linhasNaJanela > 0, 'não-vacuidade: alguma linha precisa ter sido lida');
    assert.ok(
      linhasNaJanela < linhasDoArquivo,
      `a premissa (${linhasNaJanela}) tem de ser MENOR que o arquivo inteiro (${linhasDoArquivo}), que é o dobro da janela`
    );
    assert.equal(doc.status.premissa.linhas, linhasNaJanela, 'os três blocos de arquivo compartilham a premissa');
  });

  it('o delta de p95 compara com a janela ANTERIOR, e a rota sem base sai com delta null', () => {
    const doc = JSON.parse(rodar(['resumo', '--dir', dir, '--desde', '2h', '--json']).saida);
    const sync = doc.latencia.rotas.find((x) => x.rota === 'POST /atlas/:id/sync');
    assert.ok(sync, 'a rota mais chamada precisa aparecer');
    assert.equal(sync.n, 20, 'só as 20 da janela atual');
    assert.equal(sync.p95, 300);
    assert.equal(sync.p95Anterior, 30, 'a base vem da janela anterior, do mesmo tamanho');
    assert.equal(sync.delta, 270);

    const config = doc.latencia.rotas.find((x) => x.rota === 'GET /api/config');
    assert.equal(config.p95Anterior, null, 'rota nova não tem base');
    assert.equal(config.delta, null);

    const ja = doc.latencia.premissa.janelaAnterior;
    assert.equal(ja.fim - ja.inicio, 2 * HORA);
  });

  it('a premissa NÃO carrega `truncado`: o leitor de fluxo não tem anel para estourar', () => {
    // O CAMPO É DA OUTRA PORTA. `GET /diag/resumo` lê pelo anel de 200 mil de
    // `diag.service.js`, que descarta o registro mais ANTIGO (a base do delta) e declara
    // `truncado` na premissa de cada bloco de arquivo. Aqui o leitor é `percorrerRegistros`,
    // em fluxo e sem teto, então a chave não nasce: um `truncado: false` seria uma promessa
    // sobre um mecanismo ausente, indistinguível da rota tendo medido e não cortado.
    const doc = JSON.parse(rodar(['resumo', '--dir', dir, '--desde', '2h', '--json']).saida);
    for (const bloco of ['latencia', 'saude', 'status']) {
      assert.equal(doc[bloco].premissa.fonte, 'arquivo', 'não-vacuidade: a premissa existe');
      assert.equal(
        Object.hasOwn(doc[bloco].premissa, 'truncado'), false,
        `${bloco} não pode declarar corte de anel: este leitor não tem anel`
      );
    }
    // E o ENVELOPE deste comando também não o carrega, pela mesma razão.
    assert.equal(Object.hasOwn(doc.janela, 'truncado'), false);
  });

  it('as queries lentas são contadas nas DUAS janelas, e as contagens diferem', () => {
    const doc = JSON.parse(rodar(['resumo', '--dir', dir, '--desde', '2h', '--json']).saida);
    assert.deepEqual(doc.latencia.queriesLentas, { janela: 3, anterior: 1 });
  });

  it('os defeitos vêm do BANCO, com o recorte de origem e a queda vista pelo cliente', () => {
    const doc = JSON.parse(rodar(['resumo', '--dir', dir, '--desde', '2h', '--json']).saida);
    // A tabela é compartilhada pela suíte, então as contagens absolutas do bloco não são
    // asseríveis; o que É asserível é que as linhas SEMEADAS aparecem, e com o recorte certo.
    const meus = doc.defeitos.topo.filter((t) => t.mensagem.includes('do servidor') || t.mensagem.includes('queda'));
    assert.ok(doc.defeitos.porOrigem.servidor >= 1);
    assert.ok(doc.defeitos.premissa.vistos >= 3);
    assert.ok(meus.length >= 1, 'o defeito de 50 ocorrências tem de estar entre os cinco maiores');
    assert.ok(doc.indisponivel.defeitos >= 1, 'a origem `indisponivel` vira o bloco 4');
    assert.ok(doc.indisponivel.ocorrencias >= 7, 'ocorrências, e não assinaturas');
  });

  it('DIRETÓRIO AUSENTE: o comando responde 0, com os TRÊS blocos de arquivo cegos', () => {
    // Este é o comportamento que o separa dos cinco comandos de log, que morrem com código 1
    // nesse caso. Para o resumo, instrumento cego é um bloco que se declara, não um erro
    // fatal: o relatório continua saindo com a metade que a outra fonte sustenta.
    const r = rodar(['resumo', '--dir', path.join(os.tmpdir(), `nao-existe-${MARCA}`), '--desde', '2h', '--json']);
    assert.equal(r.codigo, 0, r.erro);
    const doc = JSON.parse(r.saida);

    assert.equal(doc.janela.diretorioAusente, true);
    for (const bloco of ['latencia', 'saude', 'status']) {
      assert.equal(doc[bloco].disponivel, false, bloco);
      assert.match(doc[bloco].motivo, /CEGO/);
      // A ASSERÇÃO QUE IMPORTA: nenhum zero ao lado da indisponibilidade.
      assert.equal(doc[bloco].total, undefined);
      assert.equal(doc[bloco].rotas, undefined);
    }
    assert.equal(doc.defeitos.disponivel, true, 'a queda de uma fonte não derruba a outra');
    assert.equal(doc.indisponivel.disponivel, true);
  });

  it('a saída HUMANA nomeia os blocos e a premissa de cada um', () => {
    const r = rodar(['resumo', '--dir', dir, '--desde', '2h']);
    assert.equal(r.codigo, 0, r.erro);
    for (const titulo of ['DEFEITOS', 'LATÊNCIA', 'SAÚDE DO PROCESSO', 'INDISPONIBILIDADE', 'STATUS']) {
      assert.match(r.saida, new RegExp(titulo), `o bloco ${titulo} precisa aparecer`);
    }
    // A premissa de cada bloco sai, inclusive nos que trazem boa notícia: foi uma frase
    // tranquilizadora sem premissa visível que mentiu por meses em `resumirAmostras`.
    assert.ok((r.saida.match(/premissa:/g) || []).length >= 5, 'uma premissa por bloco');
    // E o zero do bloco 4 sai ACOMPANHADO da ressalva, porque ele é o mais fácil de ler
    // errado: o relato de indisponibilidade é enfileirado no cliente.
    assert.match(r.saida, /NÃO prova disponibilidade/);
  });

  it('com o diretório ausente, a saída humana DIZ que o instrumento está cego', () => {
    const r = rodar(['resumo', '--dir', path.join(os.tmpdir(), `nao-existe-${MARCA}`), '--desde', '2h']);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /SEM FONTE/);
    assert.match(r.saida, /zero se leria como/, 'a ausência de número é explicada, e não só omitida');
  });

  it('BANCO FORA: o relatório sai com os blocos de banco cegos, e o stdout continua UM documento', () => {
    // O CENÁRIO QUE O COMANDO EXISTE PARA ATRAVESSAR, e o que ele quase quebrou. O hook
    // `error` de `database/index.js` loga em `error` (sempre ligado) e o pino escreve no
    // STDOUT: com o Postgres fora, a linha "DB Error" com pilha saía ANTES do documento e
    // quebrava todo `| jq` exatamente quando alguém está diagnosticando. Daí o
    // silenciamento do logger em `abrirBanco` — o comando relata a falha com as próprias
    // palavras, no stderr.
    // `NODE_ENV=development` NÃO É DETALHE, É O QUE FAZ ESTE CASO VERIFICAR ALGUMA COISA.
    // Sob `NODE_ENV=test` o pino já está em `silent` (`config.isTest ? 'silent' : ...`, em
    // `src/utils/logger.js`), então o filho herdado da suíte NUNCA imprimiria a linha "DB
    // Error" e o caso passaria verde com o silenciamento REMOVIDO — foi medido exatamente
    // assim na primeira versão dele, que era cobertura vazia. Com o ambiente de
    // desenvolvimento o logger volta ao nível normal, e é só aí que o defeito existe.
    // `LOG_TO_FILE=off` porque fora de teste o log em arquivo liga, e um comando de leitura
    // não pode passar a escrever no diretório da suíte.
    const r = spawnSync(process.execPath, [COMANDO, 'resumo', '--dir', dir, '--desde', '2h', '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        LOG_TO_FILE: 'off',
        HEALTH_SAMPLE: 'off',
        DATABASE_URL: 'postgresql://ebgeo:ebgeo_secret@localhost:5432/nao_existe_este_banco',
      },
      timeout: 30_000,
      killSignal: 'SIGKILL',
    });
    assert.equal(r.signal, null);
    assert.equal(r.status, 0, 'banco fora é estado NORMAL para o resumo, não erro fatal');

    // A ASSERÇÃO CENTRAL: o stdout parseia inteiro. Um `JSON.parse` que engolisse lixo antes
    // do documento não existe, então isto falha na hora se qualquer linha vazar.
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.janela.banco, false);
    assert.equal(doc.defeitos.disponivel, false);
    assert.equal(doc.indisponivel.disponivel, false);
    assert.match(doc.defeitos.motivo, /banco/);
    // E a metade de ARQUIVO continua respondendo: é a promessa que separa este comando dos
    // dois que leem só o banco.
    assert.equal(doc.latencia.disponivel, true);
    assert.equal(doc.status.disponivel, true);
    // Não-vacuidade do stdout: um documento vazio também parseia.
    assert.ok(r.stdout.length > 200);
  });

  it('janela inválida continua sendo recusada, como nos outros comandos', () => {
    const r = rodar(['resumo', '--dir', dir, '--desde', '2hs']);
    assert.equal(r.codigo, 1);
    assert.match(r.erro, /Janela inválida/);
  });
});
