// Path: tests/integration/queda-do-processo-registra-no-log.test.js
//
// A MORTE DO PROCESSO PRECISA DEIXAR LINHA NO ARQUIVO, e até 2026-09-01 não deixava.
//
// O BURACO. `src/index.js` não registrava `uncaughtException` nem `unhandledRejection`, e
// a pilha do node vai para o STDERR, que não é destino do pino nesta casa: o log
// estruturado sai no stdout e no `.jsonl` diário. O processo morria e o arquivo, que é a
// única evidência que sobrevive ao fechamento do terminal, não registrava nada. A metade
// complementar é a série de saúde, cujo sinal de queda é o BURACO (`npm run diag -- saude`),
// porque um amostrador dentro do processo não testemunha a própria morte. O buraco ganhou
// leitor; aqui a queda ganha causa.
//
// POR QUE SUBPROCESSO, e não um teste sobre os módulos. O handler termina em
// `process.exit`, então exercê-lo no runner mataria o runner; e sob `NODE_ENV=test` o
// logger está em `silent` e o destino de arquivo nem é montado, de modo que qualquer
// asserção contra o logger passaria verde com o defeito intacto. O filho roda o
// `src/index.js` REAL em `NODE_ENV=development`, com `LOG_DIR` num diretório temporário, e
// o que se assere é o ARQUIVO que ficou em disco mais o código de saída, os dois
// observáveis de fora sem instrumentar o sujeito. (Mesma técnica e mesmas razões de
// `tests/integration/boot-fail-fast.test.js`.)
//
// POR QUE O VOLUME DE LINHAS NO PRIMEIRO CASO. Medido em 2026-09-01, nesta máquina: uma
// única linha `fatal` seguida de `process.exit` SOBREVIVE mesmo sem descarga nenhuma, então
// um teste com uma linha só estaria medindo o acaso do tamanho do buffer e ficaria verde
// com a descarga removida. Com alguns milhares de linhas na fila do `fs.WriteStream` o
// desfecho é categórico e repetiu-se: 4003 linhas com a descarga, 3 linhas sem ela.
//
// O MESMO VOLUME VAI NO CASO DO SIGTERM, e por medição, não por simetria: as esperas do
// desligamento (sockets, `server.close`, `pgp.end`) NÃO dão tempo de a fila escoar
// sozinha, então o caso reprova sem a descarga. Com uma linha só ele reprovava também, mas
// por pouco, e um caso que depende do tamanho do buffer no dia é uma medição de coisa
// probabilística, não uma medição.
//
// O QUE ESTE ARQUIVO NÃO PROVA, declarado: nada sobre o STDOUT. Ele não tem descarga
// síncrona exposta e, quando é um cano, a escrita é assíncrona no POSIX, de modo que a
// última linha do terminal ainda pode ser truncada por `process.exit`. O destino que esta
// camada existe para salvar é o arquivo, que é o que sobrevive ao fechamento do terminal.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(path.resolve(HERE, '../../src/index.js')).href;
const LOGGER_URL = pathToFileURL(path.resolve(HERE, '../../src/utils/logger.js')).href;

/** Quantas linhas se enfileiram antes da queda. Ver a nota do cabeçalho. */
const LINHAS_DE_CARGA = 4000;

/** Binds an ephemeral port just to learn an unused number, then releases it. */
function portaLivre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let diretorio = null;

/**
 * Sobe o `src/index.js` real e resolve com `{ code, stderr, linhas }`, onde `linhas` são os
 * registros JSON que ficaram no `.jsonl` do dia.
 *
 * `NODE_ENV=development` é o ponto: em `test` o logger fica `silent` e o arquivo desligado,
 * ou seja, o próprio teste apagaria o sujeito. `HEALTH_SAMPLE=off` tira do arquivo a série
 * periódica, que aqui só seria ruído.
 */
function rodarFilho(corpo, porta, dir) {
  const bootstrap = `
    await import(${JSON.stringify(INDEX_URL)});
    const { default: logger } = await import(${JSON.stringify(LOGGER_URL)});
    ${corpo}
  `;
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ['--input-type=module', '-e', bootstrap], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(porta),
        LOG_DIR: dir,
        LOG_TO_FILE: 'on',
        HEALTH_SAMPLE: 'off',
      },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    let matou = false;
    const prazo = setTimeout(() => { matou = true; filho.kill(); }, 30000);
    filho.stderr.on('data', (d) => { stderr += d; });
    filho.on('error', (err) => { clearTimeout(prazo); reject(err); });
    filho.on('close', (code) => {
      clearTimeout(prazo);
      const arquivos = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
      const linhas = arquivos.flatMap((n) => fs
        .readFileSync(path.join(dir, n), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)));
      resolve({ code, stderr, linhas, matou, arquivos });
    });
    filho.stdin.end();
  });
}

/** Um diretório de log por caso, senão um arquivo do dia acumularia as linhas de todos. */
function dirNovo() {
  const d = fs.mkdtempSync(path.join(diretorio, 'caso-'));
  return d;
}

describe('A queda do processo deixa linha no arquivo de log', () => {
  before(() => {
    diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-queda-'));
  });

  after(() => {
    fs.rmSync(diretorio, { recursive: true, force: true });
  });

  it('uncaughtException: sai diferente de zero e a linha fatal chega ao .jsonl com a fila cheia', async () => {
    const dir = dirNovo();
    const r = await rodarFilho(`
      setTimeout(() => {
        for (let i = 0; i < ${LINHAS_DE_CARGA}; i++) {
          logger.info({ i, enchimento: 'x'.repeat(120) }, 'linha de carga');
        }
        throw new Error('explosão proposital');
      }, 300);
    `, await portaLivre(), dir);

    assert.equal(r.matou, false, 'o filho tem de morrer sozinho, não pela mão do teste');
    assert.notEqual(r.code, 0, 'uma exceção não tratada não pode virar saída limpa');

    // A queda ficou registrada, e por MARCADOR estrutural, não por texto da mensagem.
    const quedas = r.linhas.filter((l) => l.queda === 'uncaughtException');
    assert.equal(quedas.length, 1, 'exatamente uma linha de queda no arquivo');
    assert.equal(quedas[0].level, 60, 'a queda é `fatal`, e é isso que a separa de um erro de requisição');
    assert.match(quedas[0].err.stack, /explosão proposital/);

    // E ela chegou COM a fila cheia atrás dela: sem a descarga, o arquivo fica com um
    // punhado de linhas e sem a última. É esta contagem que reprova a remoção da descarga.
    assert.ok(
      r.linhas.length >= LINHAS_DE_CARGA,
      `só ${r.linhas.length} linhas no arquivo: a fila do fs.WriteStream foi descartada na saída`
    );
    assert.equal(
      r.linhas[r.linhas.length - 1].queda,
      'uncaughtException',
      'a linha da queda tem de ser a ÚLTIMA do arquivo'
    );
  });

  it('unhandledRejection com um valor que não é Error: também mata, e guarda o valor', async () => {
    // Registrar o handler tira o default do node (derrubar o processo), então NÃO sair aqui
    // seria trocar uma queda barulhenta por um zumbi silencioso. E uma string rejeitada não
    // tem pilha: sem o Error sintético a linha sairia sem tipo e sem rastro.
    const dir = dirNovo();
    const r = await rodarFilho(`
      setTimeout(() => { Promise.reject('rejeicao-crua'); }, 300);
    `, await portaLivre(), dir);

    assert.equal(r.matou, false, 'o handler não pode deixar o processo vivo em estado desconhecido');
    assert.notEqual(r.code, 0);

    const quedas = r.linhas.filter((l) => l.queda === 'unhandledRejection');
    assert.equal(quedas.length, 1);
    assert.equal(quedas[0].level, 60);
    assert.equal(quedas[0].err.valorBruto, 'rejeicao-crua');
  });

  it('SIGTERM: sai com zero e a linha de conclusão é a ÚLTIMA do arquivo', async () => {
    // No Windows o `kill()` do node não entrega SIGTERM de verdade ao filho, então o sinal
    // é levantado DENTRO dele, como em `boot-fail-fast.test.js`. Isso exercita o registro do
    // handler e o corpo inteiro do desligamento; o que fica de fora é a entrega pelo SO.
    const dir = dirNovo();
    const r = await rodarFilho(`
      setTimeout(() => {
        for (let i = 0; i < ${LINHAS_DE_CARGA}; i++) {
          logger.info({ i, enchimento: 'x'.repeat(120) }, 'linha de carga');
        }
        process.emit('SIGTERM');
      }, 300);
    `, await portaLivre(), dir);

    assert.equal(r.matou, false);
    assert.equal(r.code, 0, `desligamento limpo tem de sair 0; stderr: ${r.stderr}`);

    assert.ok(
      r.linhas.length >= LINHAS_DE_CARGA,
      `só ${r.linhas.length} linhas no arquivo: a fila foi descartada no desligamento`
    );
    const conclusoes = r.linhas.filter((l) => l.msg === 'Desligamento concluído');
    assert.equal(conclusoes.length, 1, 'o desligamento tem de deixar rastro no arquivo, que é o que explica um deploy');
    assert.equal(
      r.linhas[r.linhas.length - 1].msg,
      'Desligamento concluído',
      'nada pode ser logado depois de o log fechar: ele é o ÚLTIMO a fechar'
    );
  });
});
