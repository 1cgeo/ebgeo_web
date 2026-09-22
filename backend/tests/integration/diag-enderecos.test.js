// Path: tests/integration/diag-enderecos.test.js
//
// `GET /api/v1/diag/enderecos` contra o banco de teste, e o ESPELHO com
// `npm run diag -- enderecos --json` sobre o MESMO diretório de log.
//
// POR QUE O ESPELHO, e não dois testes independentes: a casa exige que a porta HTTP e o comando
// respondam à mesma pergunta com o mesmo documento (ver `diag-rotas-de-log-espelham-o-cli.test.js`,
// de onde este arquivo copia o método), e dois testes escritos à mão divergem junto com o código
// que eles medem. Aqui o comando e a rota rodam sobre o mesmo diretório, na mesma rodada, e o que
// sai tem de ser o mesmo documento, tirado o envelope. Os nomes das contas vêm do banco nas duas
// portas, pela mesma função (`nomearContas`), e entram na comparação estrita.
//
// POR QUE AS DUAS METADES DO PAR DE ACESSO: o negativo (anônimo 401, comum 403) passaria idêntico
// se a rota não existisse; o positivo (administrador vê, com os nomes resolvidos) é o que prova que
// o gate deixa passar quem deve.
//
// O `import` É DINÂMICO pela razão do irmão: `config.js` é congelado na avaliação e `LOG_DIR`
// precisa estar no ambiente antes, para a rota ler o diretório SEMEADO aqui.
//
// CONTROLE NEGATIVO:
//   - tirar `requireAdmin` da rota: o caso do usuário comum reprova com 200 onde há 403;
//   - trocar `janela('24h')` por `Joi.string()`: o caso do teto reprova, e a rota volta a poder
//     abrir trinta arquivos;
//   - a rota montar a contagem com um agregador próprio: o espelho reprova no campo que diverge;
//   - não chamar `nomearContas` no controller: o caso dos nomes reprova (bloco ausente), e o
//     espelho também, porque o comando continua mandando o bloco.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';

const DIR_DE_LOG = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-diag-enderecos-'));
process.env.LOG_DIR = DIR_DE_LOG;

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const { createUser, createAdminUser, loginUser } = await import('../helpers/fixtures.js');

const COMANDO = fileURLToPath(new URL('../../scripts/diag.js', import.meta.url));
const MIN = 60_000;

/** O dia local em AAAA-MM-DD, o mesmo formato que `log-diario.js` escreve. */
function diaLocal(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${d}`;
}

function semEnvelope(doc) {
  const copia = { ...doc };
  delete copia.comando;
  delete copia.janela;
  delete copia.gerado_em;
  return copia;
}

describe('GET /diag/enderecos e o espelho com o comando', () => {
  let app, db, comum, comumToken, admin, adminToken;
  const agora = Date.now();

  const pedir = (rota, token = adminToken) => supertest(app)
    .get(`/api/v1/diag${rota}`)
    .set('Authorization', `Bearer ${token}`);

  function cli(args) {
    const r = spawnSync(process.execPath, [COMANDO, ...args, '--dir', DIR_DE_LOG, '--json'], {
      encoding: 'utf8', env: process.env, timeout: 30_000, killSignal: 'SIGKILL',
    });
    assert.equal(r.signal, null, `o comando foi morto por ${r.signal} (pool vazado?)`);
    assert.equal(r.status, 0, `o comando saiu com ${r.status}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    comum = await createUser(db, { username: `end_usr_${randomUUID().slice(0, 6)}`, nome: 'Fulano de Tal' });
    admin = await createAdminUser(db, { username: `end_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);

    // A FIXTURE FICA LONGE DAS BORDAS DO "AGORA" (dois minutos e duas horas), para que o `recente`
    // não mude entre a invocação do comando e a da rota, que acontecem com segundos de distância.
    const linha = (min, ip, extra = {}) => ({
      level: 30, time: agora - min * MIN, reqId: randomUUID(), ip, method: 'GET',
      url: '/api/v1/config', statusCode: 200, duration: 3, msg: 'request', ...extra,
    });
    const conta = randomUUID();
    const registros = [
      linha(2, '198.51.100.1', { userId: comum.id, sessaoId: randomUUID() }),
      linha(3, '198.51.100.1', { userId: comum.id }),
      linha(4, '198.51.100.1'),
      linha(120, '198.51.100.2', { userId: `public-${randomUUID()}`, statusCode: 401, msg: 'request error' }),
      // Uma conta que NÃO existe no banco: o bloco a conta como não encontrada.
      linha(125, '198.51.100.3', { userId: conta }),
      // O que NÃO é requisição, e não pode entrar: a recusa do limitador.
      { level: 40, time: agora - 5 * MIN, reqId: randomUUID(), limiter: 'auth', ip: '198.51.100.9' },
    ];
    fs.writeFileSync(
      path.join(DIR_DE_LOG, `ebgeo-${diaLocal(new Date(agora))}.jsonl`),
      `${registros.map((r) => JSON.stringify(r)).join('\n')}\n`
    );
  });

  after(async () => {
    await teardownTestEnv(db);
    fs.rmSync(DIR_DE_LOG, { recursive: true, force: true });
  });

  it('anônimo leva 401 e usuário comum leva 403', async () => {
    await supertest(app).get('/api/v1/diag/enderecos').expect(401);
    await pedir('/enderecos', comumToken).expect(403);
  });

  it('a borda recusa janela além de sete dias, forma estranha e limite fora da faixa', async () => {
    await pedir('/enderecos?desde=8d').expect(422);
    await pedir('/enderecos?desde=24hs').expect(422);
    await pedir('/enderecos?limite=0').expect(422);
    await pedir('/enderecos?limite=501').expect(422);
  });

  it('o administrador VÊ, com os NOMES resolvidos pelo banco', async () => {
    const { body } = await pedir('/enderecos?desde=24h').expect(200);
    const d = body.data;

    assert.equal(d.janela.desde, '24h');
    assert.equal(d.janela.diretorio, path.resolve(DIR_DE_LOG));
    assert.equal(d.janela.diretorioAusente, false);
    assert.equal(d.janela.truncado, false);

    assert.equal(d.distintos, 3);
    assert.equal(d.recentes, 1);
    assert.equal(d.requisicoes, 5);
    assert.deepEqual(d.enderecos.map((e) => e.ip), ['198.51.100.1', '198.51.100.2', '198.51.100.3']);

    const um = d.enderecos[0];
    assert.equal(um.recente, true);
    assert.equal(um.requisicoes, 3);
    assert.equal(um.sessoes, 1);
    assert.equal(um.anonimas, 1);
    assert.deepEqual(um.contas.map((c) => [c.userId, c.requisicoes]), [[comum.id, 2]]);

    const publico = d.enderecos[1];
    assert.equal(publico.contasDistintas, 0);
    assert.equal(publico.deLinkPublico, 1);
    assert.equal(publico.comErro, 1);

    assert.equal(d.contas.disponivel, true);
    assert.equal(d.contas.pedidas, 2);
    assert.equal(d.contas.achadas, 1);
    assert.equal(d.contas.naoEncontradas, 1);
    assert.deepEqual(d.contas.porId[comum.id], { username: comum.username, nome: 'Fulano de Tal', ativo: true });
  });

  it('o limite corta os endereços e as contagens continuam sendo da janela inteira', async () => {
    const { body } = await pedir('/enderecos?desde=24h&limite=1').expect(200);
    assert.equal(body.data.limite, 1);
    assert.equal(body.data.distintos, 3);
    assert.equal(body.data.enderecos.length, 1);
    // Só as contas do endereço PUBLICADO são nomeadas.
    assert.equal(body.data.contas.pedidas, 1);
  });

  it('o documento da rota é o do comando, tirado o envelope', async () => {
    const doc = cli(['enderecos', '--desde', '24h']);
    const { body } = await pedir('/enderecos?desde=24h').expect(200);
    const daRota = { ...body.data };
    const premissa = daRota.janela;
    delete daRota.janela;

    // A procedência é conferida à parte, porque os dois envelopes têm formatos diferentes.
    assert.equal(doc.comando, 'enderecos');
    assert.equal(doc.janela.dir, premissa.diretorio);
    assert.equal(doc.janela.arquivos, premissa.arquivos);
    assert.equal(doc.janela.linhas, premissa.linhas);

    const doComando = semEnvelope(doc);
    assert.deepEqual(Object.keys(daRota).sort(), Object.keys(doComando).sort());
    assert.deepEqual(daRota, doComando);
  });
});
