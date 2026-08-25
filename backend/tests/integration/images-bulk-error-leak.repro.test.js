// Path: tests/integration/images-bulk-error-leak.repro.test.js
//
// Achados 108 e 80, que vivem no MESMO catch de `bulkUploadImages` e por isso são
// provados juntos.
//
//   108 — o catch fazia `results.failed.push({ localId, error: err.message })` dentro
//         de uma resposta 201. Esse caminho não passa pelo `errorHandler`, então
//         escapava das três proteções dele: o mapa SQLSTATE (cujo comentário diz
//         literalmente que o texto do driver expõe nome de coluna/constraint), a
//         máscara de produção e o gate `err.expose`. Um localId que colide com a PK
//         GLOBAL de `images` devolvia `images_pkey`; uma falha de escrita devolvia o
//         CAMINHO ABSOLUTO do disco do servidor, que é o dado mais sensível do
//         conjunto.
//
//    80 — a linha é inserida ANTES de o blob ir para o disco e o catch não a removia.
//         O item saía como `failed` e a imagem MESMO ASSIM aparecia em
//         `GET /atlas/:id/images`, com download 404 permanente: a API publicando um
//         estado que a própria resposta negou.
//
// GATILHO DE FALHA DE ESCRITA. Determinístico e independente de plataforma: fixa-se o
// `crypto.randomUUID` (mesma instância ESM que o serviço importa) e cria-se um
// DIRETÓRIO exatamente no `storagePath` que ele vai produzir, de modo que o
// `writeFile` falhe. `chmod` não serve — no Windows ele não torna um diretório
// somente-leitura, e um teste que só roda no Linux é cobertura vazia nesta máquina.
//
// NÃO-VACUIDADE (o ponto mais delicado). Depois da compensação, "linha ausente" é
// indistinguível de "INSERT nunca aconteceu": o teste ficaria verde com o INSERT
// removido. Por isso o lote manda o MESMO localId duas vezes — a primeira falha na
// escrita, a segunda escreve bem. A segunda só consegue `serverId === localId` se a
// primeira tiver (a) inserido a linha e (b) devolvido a PK ao removê-la. Se a
// compensação não rodasse, a segunda bateria em unique_violation; se ela removesse a
// linha sem liberar o `seenLocalIds`, a segunda receberia um id novo. Um único
// `mapping[localId] === localId` prende as duas coisas.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import logger from '../../src/utils/logger.js';

// PNG 1x1 real (magic bytes válidos), o mesmo das outras suítes de imagem.
const PNG_1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0x00, 0x00,
  0x00, 0x01, 0x00, 0x01, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_B64 = PNG_1x1.toString('base64');

/** Texto que só nasce no driver do Postgres ou no fs. */
const DRIVER_TEXT = /constraint|pkey|sqlstate|violates|column|relation|duplicate key|ENOENT|EACCES|EISDIR|EPERM/i;

function spyLogger() {
  const records = [];
  const saved = [];
  for (const level of ['warn', 'error']) {
    saved.push([level, Object.getOwnPropertyDescriptor(logger, level)]);
    Object.defineProperty(logger, level, {
      configurable: true, writable: true, enumerable: false,
      value: (obj, msg) => { records.push({ level, obj, msg }); },
    });
  }
  return {
    records,
    restore() {
      for (const [level, d] of saved) {
        if (d) Object.defineProperty(logger, level, d);
        else delete logger[level];
      }
    },
  };
}

/**
 * Faz `crypto.randomUUID` devolver os valores da fila e só depois voltar ao original.
 * Funciona porque `images.service.js` faz `import crypto from 'crypto'`, ou seja, usa
 * a MESMA instância de módulo (mesma manobra do espião de logger).
 */
function queueUuids(fila) {
  const original = crypto.randomUUID;
  const restantes = [...fila];
  crypto.randomUUID = () => (restantes.length > 0 ? restantes.shift() : original());
  return () => { crypto.randomUUID = original; };
}

describe('POST /images/bulk — erro sanitizado e sem linha órfã (108 + 80)', () => {
  let app, db, owner, token, atlas, spy, restoreUuid;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `bulkleak_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Bulk Leak Atlas' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  beforeEach(() => { spy = spyLogger(); restoreUuid = null; });
  afterEach(() => { spy.restore(); if (restoreUuid) restoreUuid(); });

  const bulk = (images) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
    .set('Authorization', `Bearer ${token}`)
    .send({ images });

  /**
   * Metade (b) do contrato: o erro CRU tem de chegar ao log, POR ESTE catch.
   *
   * O filtro é pela mensagem do próprio log, não por "algum registro com um Error".
   * A versão frouxa foi escrita primeiro e o controle negativo a derrubou: removendo
   * o `logger.warn` do catch, o caso da colisão de PK continuava VERDE, porque a
   * camada de banco já emite um 'DB Error' com o mesmo erro anexado. A asserção
   * passava provando o log de outra pessoa — cobertura vazia exata, e justamente no
   * teste cujo trabalho é impedir um fix que engole o erro.
   */
  function logsComErro() {
    const meus = spy.records.filter((r) => r.msg === 'Bulk image item failed');
    assert.equal(
      meus.length,
      1,
      `o catch do lote tem de logar exatamente uma vez: ${JSON.stringify(spy.records.map((r) => r.msg))}`
    );
    assert.ok(meus[0].obj.err instanceof Error, 'o log tem de carregar o objeto de erro, não uma string');
    return meus[0].obj.err.message;
  }

  it('colisão na PK global devolve texto fixo, sem `images_pkey`, e loga o erro cru', async () => {
    // Primeiro upload legítimo: fixa o localId como PK global.
    const localId = randomUUID();
    const ok = await bulk([{ localId, filename: 'a.png', mimeType: 'image/png', data: PNG_B64 }]).expect(201);
    assert.equal(ok.body.data.uploaded.length, 1, 'o primeiro envio tem de entrar (não-vacuidade)');
    spy.records.length = 0;

    // Reenvio do MESMO localId: unique_violation na PK.
    const res = await bulk([{ localId, filename: 'b.png', mimeType: 'image/png', data: PNG_B64 }]).expect(201);

    // (a) o cliente recebe texto fixo, idêntico ao que o errorHandler daria no REST.
    assert.equal(res.body.data.uploaded.length, 0);
    assert.equal(res.body.data.failed.length, 1);
    assert.equal(res.body.data.failed[0].localId, localId);
    assert.equal(res.body.data.failed[0].error, 'Já existe um registro com esses dados. Altere e tente de novo.');
    const corpo = JSON.stringify(res.body);
    assert.doesNotMatch(corpo, DRIVER_TEXT, `texto de driver no corpo: ${corpo}`);

    // (b) e o erro cru, com o nome da constraint, ficou no log do servidor.
    assert.match(logsComErro(), /images_pkey/, 'o nome da constraint tem de sobreviver NO LOG');
  });

  it('falha de escrita não deixa linha órfã, não vaza o caminho do disco, e devolve a PK', async () => {
    const localId = randomUUID();
    const uuidRuim = randomUUID();
    const uuidBom = randomUUID();
    restoreUuid = queueUuids([uuidRuim, uuidBom]);

    // Um DIRETÓRIO no storagePath do primeiro item faz o writeFile falhar.
    const atlasDir = join(config.images.dir, atlas.id);
    const bloqueio = join(atlasDir, `${uuidRuim}.png`);
    await mkdir(bloqueio, { recursive: true });

    try {
      const item = { localId, filename: 'colisao.png', mimeType: 'image/png', data: PNG_B64 };
      const res = await bulk([item, { ...item }]).expect(201);

      // (a) o item que falhou não devolve caminho nem errno.
      assert.equal(res.body.data.failed.length, 1, 'exatamente o primeiro item falha');
      assert.equal(res.body.data.failed[0].localId, localId);
      assert.equal(res.body.data.failed[0].error, 'Unknown error');
      const corpo = JSON.stringify(res.body);
      assert.doesNotMatch(corpo, DRIVER_TEXT, `texto de driver/fs no corpo: ${corpo}`);
      assert.ok(!corpo.includes(uuidRuim), `o nome do blob vazou no corpo: ${corpo}`);
      assert.ok(
        !corpo.includes(resolve(config.images.dir).replace(/\\/g, '\\\\')),
        `o caminho absoluto do servidor vazou no corpo: ${corpo}`
      );

      // (b) o caminho absoluto — o dado retido — está no log.
      assert.match(logsComErro(), new RegExp(uuidRuim), 'o erro cru (com o caminho) tem de estar no log');

      // 80 — a linha órfã não existe, E o segundo item provou que ela EXISTIU:
      // `serverId === localId` só é possível se a PK tiver sido inserida e devolvida.
      assert.equal(res.body.data.uploaded.length, 1);
      assert.equal(res.body.data.uploaded[0].serverId, localId,
        'o retry no mesmo lote precisa reaproveitar a PK liberada pela compensação');
      assert.equal(res.body.data.mapping[localId], localId);

      const { rows } = await db.query('SELECT id, storage_path FROM images WHERE id = $1', [localId]);
      assert.equal(rows.length, 1, 'exatamente uma linha: a do item que escreveu de fato');
      assert.match(rows[0].storage_path, new RegExp(`${uuidBom}\\.png$`),
        'a linha sobrevivente é a do blob que foi gravado, não a do que falhou');

      // A API não pode listar nada que a resposta tenha negado.
      const lista = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const desteTeste = lista.body.data.filter((i) => i.id === localId);
      assert.equal(desteTeste.length, 1, 'listada exatamente uma vez, a que existe em disco');
    } finally {
      await rm(bloqueio, { recursive: true, force: true });
    }
  });

  it('80 — a extensão do blob vem do mimeType validado, nunca do sufixo do filename', async () => {
    // Sem ponto no nome, `filename.split('.').pop()` devolvia o NOME INTEIRO como
    // componente de caminho — a mesma expressão que, com uma barra, produzia um
    // diretório inexistente e o ENOENT que gerava a linha órfã.
    const localId = randomUUID();
    const res = await bulk([
      { localId, filename: 'arquivo-sem-ponto', mimeType: 'image/png', data: PNG_B64 },
    ]).expect(201);

    assert.equal(res.body.data.failed.length, 0, `nada pode falhar: ${JSON.stringify(res.body.data.failed)}`);
    assert.equal(res.body.data.uploaded.length, 1);

    const { rows } = await db.query('SELECT storage_path, filename FROM images WHERE id = $1', [localId]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].storage_path, /\.png$/, 'a extensão em disco vem do mimeType');
    assert.ok(!rows[0].storage_path.includes('arquivo-sem-ponto'),
      `o nome do cliente não pode virar componente de caminho: ${rows[0].storage_path}`);
    // O nome do cliente continua preservado na COLUNA, que é o que o download devolve.
    assert.equal(rows[0].filename, 'arquivo-sem-ponto');
  });

  it('80 — o schema recusa na borda um filename com separador de caminho (422)', async () => {
    const res = await bulk([
      { localId: randomUUID(), filename: 'a.png/x', mimeType: 'image/png', data: PNG_B64 },
    ]).expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    const barraInvertida = await bulk([
      { localId: randomUUID(), filename: 'a.png\\x', mimeType: 'image/png', data: PNG_B64 },
    ]).expect(422);
    assert.equal(barraInvertida.body.error.code, 'VALIDATION_ERROR');
  });

  it('um nome pt-BR acentuado continua aceito (o guarda não pode ser um filtro de caracteres)', async () => {
    const localId = randomUUID();
    const res = await bulk([
      { localId, filename: 'coordenação-do-ataque.png', mimeType: 'image/png', data: PNG_B64 },
    ]).expect(201);
    assert.equal(res.body.data.failed.length, 0, `nada pode falhar: ${JSON.stringify(res.body.data.failed)}`);
    assert.equal(res.body.data.uploaded[0].filename, 'coordenação-do-ataque.png');
  });

  it('as recusas deliberadas do serviço continuam explícitas (mascarar tudo seria a outra falha)', async () => {
    // Estas mensagens são escritas pelo próprio serviço, dizem ao cliente o que
    // corrigir e não passam pelo catch. Um "fix" que genericasse a resposta inteira
    // apagaria a informação sem fechar vazamento nenhum.
    const res = await bulk([
      {
        localId: randomUUID(),
        filename: 'mentira.png',
        mimeType: 'image/png',
        data: Buffer.from('isto nao e um png').toString('base64'),
      },
    ]).expect(201);
    assert.equal(res.body.data.failed.length, 1);
    assert.equal(res.body.data.failed[0].error, 'Content does not match declared type');
  });
});
