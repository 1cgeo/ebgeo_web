// Path: tests/integration/upload-negado-perde-a-resposta.repro.test.js
//
// UM ERRO RESPONDIDO ANTES DE O CORPO SER LIDO NAO CHEGA AO CLIENTE.
//
// A causa. `POST /atlas/:atlasId/images` tem o gate de permissao ANTES do
// multer (`images.routes.js`), o que esta certo: recusar sem gravar byte nenhum
// e o ponto. So que a resposta saia enquanto o cliente ainda enviava o arquivo,
// e o node derrubava o socket com um corpo por ler. O cliente recebia
// ECONNRESET no lugar do 403, e um ECONNRESET nao diz se faltou permissao, se o
// servidor caiu ou se a rede quebrou. O status estava certo; a ENTREGA e que
// nao acontecia.
//
// Por que passou tanto tempo despercebido. O sintoma depende do TAMANHO do
// corpo: o que cabe no buffer do socket ja chegou quando a resposta sai, e nada
// falha. O PNG de 70 bytes da suite falhava umas 3 vezes em 8, o suficiente
// para parecer flake de ambiente e ser dispensado como tal. Medido com o app
// real, antes da correcao: 70 bytes 0/20 resetaram, 3 MB 20/20. Depois: 0/20
// nos dois.
//
// Este teste NAO repete a estatistica. Ele usa o corpo grande, que e a
// interleaving perdedora tornada deterministica: sem o `drainOnError` ele falha
// em toda execucao, e nao numa fracao delas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// PNG 1x1 valido: o servico confere os bytes magicos, entao um texto qualquer
// falharia pelo motivo errado.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

// 3 MB e o bastante para nao caber no buffer do socket, e continua abaixo do
// teto de upload da rota, entao a recusa vem do GATE e nao do tamanho.
const RECHEIO_BYTES = 3 * 1024 * 1024;

describe('upload negado nao pode perder a propria resposta', () => {
  let app, db;
  const sfx = randomUUID().slice(0, 8);
  let dono, leitor, estranho, tokLeitor, tokEstranho, atlas;
  let pngGrande, pngPequeno;

  before(async () => {
    ({ app, db } = await setupTestEnv());

    dono = await createUser(db, { username: `drena-dono-${sfx}` });
    leitor = await createUser(db, { username: `drena-leitor-${sfx}` });
    estranho = await createUser(db, { username: `drena-estranho-${sfx}` });
    tokLeitor = await loginUser(app, leitor.username, leitor.password);
    tokEstranho = await loginUser(app, estranho.username, estranho.password);

    atlas = await createAtlas(db, dono.id, { name: `drena ${sfx}` });
    // `read` e o caso que produz 403: o leitor ALCANCA o atlas e nao pode escrever.
    // O estranho nao tem relacao nenhuma, entao recebe 404, e os dois passam pelo
    // mesmo ponto do error handler.
    await createShare(db, atlas.id, leitor.id, 'read', dono.id);

    const dir = join(__dirname, '..', 'fixtures');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    pngGrande = join(dir, `drena-g-${sfx}.png`);
    pngPequeno = join(dir, `drena-p-${sfx}.png`);
    writeFileSync(pngGrande, Buffer.concat([PNG_1X1, Buffer.alloc(RECHEIO_BYTES, 0x41)]));
    writeFileSync(pngPequeno, PNG_1X1);
  });

  after(async () => {
    for (const p of [pngGrande, pngPequeno]) if (p && existsSync(p)) rmSync(p);
    await teardownTestEnv(db);
  });

  /**
   * Tenta o upload e devolve o status HTTP, ou o codigo do erro de socket.
   * Nao usa `.expect()` de proposito: um ECONNRESET rebenta antes de haver
   * status, e a mensagem sairia sobre a asercao em vez de sobre a conexao.
   *
   * @param {string} token
   * @param {string} caminho
   * @returns {Promise<{status: number|null, erro: string|null}>}
   */
  async function tentaUpload(token, caminho) {
    try {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('image', caminho);
      return { status: res.status, erro: null };
    } catch (e) {
      return { status: null, erro: e.code || e.message };
    }
  }

  it('o 403 do leitor chega, mesmo com 3 MB ainda subindo', async () => {
    const r = await tentaUpload(tokLeitor, pngGrande);
    assert.equal(r.erro, null,
      `a conexao morreu antes da resposta: ${r.erro}`);
    assert.equal(r.status, 403);
  });

  it('o 404 de quem nao alcanca o atlas tambem chega', async () => {
    const r = await tentaUpload(tokEstranho, pngGrande);
    assert.equal(r.erro, null, `a conexao morreu antes da resposta: ${r.erro}`);
    assert.equal(r.status, 404);
  });

  it('e chega em TODA tentativa, nao numa fracao delas', async () => {
    // O defeito era probabilistico do ponto de vista de quem media, e uma
    // execucao verde nao o distinguia do corrigido. Cinco seguidas com o corpo
    // grande: antes da correcao, as cinco falhavam.
    const rodadas = [];
    for (let i = 0; i < 5; i += 1) {
      rodadas.push(await tentaUpload(tokLeitor, pngGrande));
    }
    assert.equal(rodadas.length, 5);
    const quebradas = rodadas.filter(r => r.erro !== null);
    assert.equal(quebradas.length, 0,
      `${quebradas.length}/5 perderam a resposta: ${quebradas.map(r => r.erro).join(', ')}`);
    for (const r of rodadas) assert.equal(r.status, 403);
  });

  it('o corpo pequeno segue funcionando (controle: a correcao nao trocou o defeito de lado)', async () => {
    const r = await tentaUpload(tokLeitor, pngPequeno);
    assert.equal(r.erro, null);
    assert.equal(r.status, 403);
  });

  it('o chamador ANONIMO nao e drenado, porque isso seria amplificacao', async () => {
    // Drenar o corpo ja foi considerado e RECUSADO uma vez (livro-razao,
    // 2026-07-25, ao consertar o 413 do /images/bulk para token expirado): ler o
    // corpo de quem nao se identificou deixa um anonimo empurrar dezenas de MB
    // pelo servidor, que e a amplificacao que o parser do bulk existe para
    // impedir. A objecao continua valendo, entao o drain exige principal
    // verificado, o mesmo criterio que o `app.js` usa para o parser ampliado.
    //
    // O que este caso prende e a ESCOLHA, nao um acidente: sem principal
    // verificado o corpo nao e lido, entao o status se perde e a conexao cai.
    // Medido, deterministico. Trocar o `if (!req.user)` por um drain
    // incondicional faz este caso virar 401 e passar a ler os megabytes de
    // qualquer um, que e a decisao recusada voltando pela porta dos fundos.
    const r = await tentaUpload(null, pngGrande);
    assert.equal(r.status, null,
      `o anonimo recebeu status ${r.status}, ou seja, o corpo dele foi lido`);
    assert.notEqual(r.erro, null);
  });

  it('e o upload legitimo nao foi drenado junto', async () => {
    // O `drainOnError` so roda no caminho de ERRO. Se ele vazasse para o
    // caminho feliz, o multer receberia um stream ja consumido e o 201 viraria
    // 400. Este e o controle que separa uma coisa da outra.
    const tokDono = await loginUser(app, dono.username, dono.password);
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${tokDono}`)
      .attach('image', pngPequeno)
      .expect(201);
    assert.ok(res.body.data?.id, 'o upload autorizado nao criou a linha');
  });
});
