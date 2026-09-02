// Path: tests/integration/release-no-log-e-no-diag-status.test.js
// QUAL BUILD ESCREVEU ESTA LINHA. `EBGEO_RELEASE` entra no `base` do pino
// (`src/utils/logger.js`), portanto em TODA linha do `.jsonl`, e no payload de
// `GET /api/v1/diag/status`, que é de ADMINISTRADOR.
//
// ONDE ELE NÃO ENTRA, E ISSO É METADE DO ARQUIVO: o `GET /api/v1/health` não tem credencial
// nenhuma, e o commit implantado nomeia a versão exata do código no ar. A primeira versão desta
// mudança o publicava lá, e o caso do `/health` aqui é hoje o CONTROLE NEGATIVO disso: com a env
// posta, o 200 continua sendo `{ status: 'ok' }` e nada mais. Um campo a mais numa rota pública
// é o tipo de coisa que entra por efeito colateral e ninguém remove depois.
//
// POR QUE UM SUBPROCESSO PARA A METADE DO LOG. Sob `NODE_ENV=test` o logger sai em
// `level: 'silent'` e o destino de arquivo nem é montado, então uma asserção contra o
// logger desta suíte passaria verde com o `base` inteiro apagado — que é exatamente a
// "cobertura vazia passa verde" da constituição. O filho roda o `src/index.js` REAL em
// `NODE_ENV=development`, com `LOG_DIR` num diretório temporário, e o que se assere é o
// ARQUIVO que ficou em disco. Mesma técnica e mesmas razões de
// `tests/integration/queda-do-processo-registra-no-log.test.js`.
//
// A AMOSTRA DE SAÚDE É O CASO QUE IMPORTA. Ela é emitida por `src/index.js`, longe de
// qualquer código desta mudança, e não ganhou uma linha de fiação: se ela carrega o
// `release`, está provado que o campo viaja pelo `base` do pino e não por um payload que
// alguém lembrou de carimbar. É por isso que o filho liga o amostrador de verdade em vez de
// o teste escrever a linha à mão.
//
// E É POR ISSO QUE ESTE ARQUIVO DEMORA ONZE SEGUNDOS. O piso de
// `HEALTH_SAMPLE_INTERVAL_MS` é 10 s, declarado em `NUMERIC_ENV_RULES` (`src/config.js`)
// com o motivo (abaixo disso o amostrador vira carga no mesmo pool que serve o sync), e o
// boot RECUSA SUBIR com valor menor. Encurtar a espera exigiria afrouxar aquele piso ou
// chamar `amostrarAgora` à mão, e as duas trocas custam justamente a propriedade que o caso
// existe para provar: que a linha sai da fiação real, sem ninguém a carimbar.
//
// CONTROLE NEGATIVO, e ele é um CASO e não um comentário: o segundo filho sobe SEM a
// variável, e nenhuma linha dele pode ter `release`. Sem isso, um `release` escrito por
// acidente em toda linha (um default, um valor herdado do ambiente) passaria verde.
//
// O que fica vermelho ao reverter cada peça:
//  - tirar o `base` do logger: a amostra e as linhas de boot perdem o campo;
//  - passar `base: { release }` sem pid/hostname: os casos que exigem os dois ficam
//    vermelhos, e é a perda silenciosa desta mudança (o hostname separa duas instâncias);
//  - dar um default a `parseRelease`: o filho sem a variável passa a carimbar algo, e o
//    controle negativo fica vermelho;
//  - publicar `release` em QUALQUER resposta do `/health` (200 ou 503): o caso do controle
//    negativo fica vermelho, que é a única guarda dessa decisão de exposição;
//  - tirar o `release` do `/diag/status`: o caso do administrador fica vermelho, e a build no
//    ar deixa de ter QUALQUER porta (o `.jsonl` responde, mas exige shell no servidor).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_URL = pathToFileURL(path.resolve(HERE, '../../src/index.js')).href;

/** O valor de teste. Não é um hash de verdade de propósito: nada o interpreta. */
const RELEASE = 'teste-c497f12e';

// A variável precisa estar no ambiente ANTES da avaliação de `src/config.js`, que é um
// singleton congelado, e `src/app.js` o puxa transitivamente. Um `import` estático de
// `helpers/setup.js` rodaria antes de qualquer linha deste corpo, daí o import dinâmico —
// a mesma razão (e o mesmo desenho) de `tests/integration/diag-log-em-arquivo.test.js`. O
// runner dá um processo por arquivo de teste, então isto não vaza para os vizinhos.
process.env.EBGEO_RELEASE = RELEASE;

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const { createUser, createAdminUser, loginUser } = await import('../helpers/fixtures.js');
const { default: config } = await import('../../src/config.js');

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

/**
 * Sobe o `src/index.js` real, deixa-o amostrar, desliga e devolve as linhas do `.jsonl`.
 *
 * `NODE_ENV=development` é o ponto: em `test` o logger fica `silent` e o arquivo desligado.
 * O SIGTERM é levantado DENTRO do filho porque no Windows o `kill()` do node não o entrega
 * de verdade (mesma nota de `queda-do-processo-registra-no-log.test.js`); o desligamento
 * limpo é o que garante a descarga do arquivo antes da saída.
 */
function rodarFilho({ dir, porta, release, amostra, esperaMs }) {
  const bootstrap = `
    await import(${JSON.stringify(INDEX_URL)});
    setTimeout(() => { process.emit('SIGTERM'); }, ${esperaMs});
  `;
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(porta),
    LOG_DIR: dir,
    LOG_TO_FILE: 'on',
    // 10 s é o PISO que o boot aceita (ver a nota do cabeçalho), não uma escolha.
    HEALTH_SAMPLE: amostra ? 'on' : 'off',
    HEALTH_SAMPLE_INTERVAL_MS: '10000',
    HEALTH_SAMPLE_DB_TIMEOUT_MS: '2000',
  };
  if (release === null) delete env.EBGEO_RELEASE;
  else env.EBGEO_RELEASE = release;

  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ['--input-type=module', '-e', bootstrap], {
      env,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    let matou = false;
    const prazo = setTimeout(() => { matou = true; filho.kill(); }, 25000);
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
      resolve({ code, stderr, linhas, matou });
    });
    filho.stdin.end();
  });
}

describe('O release da build: no log, no /diag/status, e NÃO no /health', () => {
  let app, db, raiz, adminToken, comumToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-release-'));

    const admin = await createAdminUser(db, { username: `rel_adm_${randomUUID().slice(0, 6)}` });
    const comum = await createUser(db, { username: `rel_user_${randomUUID().slice(0, 6)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    comumToken = await loginUser(app, comum.username, comum.password);
  });

  after(async () => {
    await teardownTestEnv(db);
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  // ── o /health NÃO publica, e é por isso que ele vem primeiro ──
  it('CONTROLE NEGATIVO: o 200 do /health NÃO carrega release, mesmo com a env posta', async () => {
    // A env está posta (a guarda abaixo prova), então este verde não é o verde de quem não
    // configurou nada: é a rota pública recusando publicar a build. Sem a guarda, o caso
    // passaria idêntico numa instalação sem `EBGEO_RELEASE`, que é cobertura vazia.
    assert.equal(config.release, RELEASE, 'guarda: a env chegou ao config antes da avaliação');
    const res = await supertest(app).get('/api/v1/health').expect(200);
    assert.deepEqual(res.body, { status: 'ok' }, 'a rota sem credencial não nomeia a build');
  });

  // ── quem publica é o /diag/status, atrás de requireAdmin ──
  it('o /diag/status do ADMINISTRADOR carrega o release, ao lado das contagens', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/status?desde=1h')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    assert.equal(res.body.data.release, RELEASE);
    // Guarda: é mesmo o payload do status, e o campo novo não comeu nada do que já vinha.
    assert.equal(typeof res.body.data.total, 'number');
    assert.equal(typeof res.body.data.erros, 'number');
    assert.equal(typeof res.body.data.porFaixa, 'object');
    assert.equal(typeof res.body.data.diretorioAusente, 'boolean');
  });

  it('o gate não mudou: anônimo leva 401 e usuário comum leva 403 no /diag/status', async () => {
    // O release passou a viajar por esta rota, então o gate dela virou parte desta decisão:
    // sem este caso, um `requireAdmin` que caísse publicaria a build para qualquer conta.
    await supertest(app).get('/api/v1/diag/status').expect(401);
    await supertest(app).get('/api/v1/diag/status')
      .set('Authorization', `Bearer ${comumToken}`).expect(403);
  });

  // O outro lado do `?? null` (instalação SEM release) mora em
  // `tests/integration/diag-status-sem-release.test.js`, e precisa de arquivo próprio: `config`
  // é singleton congelado na avaliação do módulo, e este arquivo põe a env antes dela. Fingir
  // aquele caso aqui, montando um objeto à mão, seria asserir sobre o teste e não sobre o
  // controller.

  // ── o arquivo, com o servidor de verdade ──
  it('TODA linha do .jsonl carrega o release, a amostra de saúde INCLUSIVE', async () => {
    const dir = fs.mkdtempSync(path.join(raiz, 'com-'));
    const r = await rodarFilho({
      dir, porta: await portaLivre(), release: RELEASE, amostra: true, esperaMs: 11000,
    });

    assert.equal(r.matou, false, `o filho tem de desligar sozinho; stderr: ${r.stderr}`);
    assert.equal(r.code, 0, `desligamento limpo sai 0; stderr: ${r.stderr}`);
    assert.ok(r.linhas.length >= 3, `esperava várias linhas, vieram ${r.linhas.length}`);

    const semRelease = r.linhas.filter((l) => l.release !== RELEASE);
    assert.deepEqual(semRelease.map((l) => l.msg), [], 'linha sem o release da build');

    // A AMOSTRA É A PROVA DE QUE O CAMPO VEM DO `base`: ela é emitida por `src/index.js`,
    // sem uma linha de fiação desta mudança.
    const amostras = r.linhas.filter((l) => l.amostra === 'saude');
    assert.ok(amostras.length >= 1, `nenhuma amostra de saúde no arquivo (${r.linhas.length} linhas)`);
    assert.equal(amostras[0].release, RELEASE);
    assert.equal(typeof amostras[0].banco, 'object', 'guarda: é mesmo a linha da amostra');

    // E o default do pino continua de pé: `base` substitui, não acrescenta.
    const semPid = r.linhas.filter((l) => typeof l.pid !== 'number');
    assert.deepEqual(semPid.map((l) => l.msg), [], 'o pid sumiu do arquivo');
    const semHost = r.linhas.filter((l) => typeof l.hostname !== 'string' || l.hostname === '');
    assert.deepEqual(semHost.map((l) => l.msg), [], 'o hostname sumiu do arquivo');
  });

  it('CONTROLE NEGATIVO: sem a variável, NENHUMA linha carrega release (e pid/hostname ficam)', async () => {
    const dir = fs.mkdtempSync(path.join(raiz, 'sem-'));
    // Sem amostra aqui: o que este caso precisa é de LINHAS, e as do boot bastam. Pagar os
    // onze segundos duas vezes compraria a mesma afirmação.
    const r = await rodarFilho({
      dir, porta: await portaLivre(), release: null, amostra: false, esperaMs: 800,
    });

    assert.equal(r.matou, false, `stderr: ${r.stderr}`);
    assert.equal(r.code, 0, `stderr: ${r.stderr}`);
    assert.ok(r.linhas.length >= 3, `esperava várias linhas, vieram ${r.linhas.length}`);

    const comRelease = r.linhas.filter((l) => Object.hasOwn(l, 'release'));
    assert.deepEqual(comRelease.map((l) => l.msg), [], 'ninguém pode inventar um release');

    const boot = r.linhas.filter((l) => l.msg === 'EBGeo backend started');
    assert.equal(boot.length, 1, 'guarda: o filho de controle subiu o servidor de verdade');

    const semPid = r.linhas.filter((l) => typeof l.pid !== 'number');
    assert.deepEqual(semPid.map((l) => l.msg), [], 'sem release, o base nem é passado');
  });
});
