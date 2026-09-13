// Path: tests/integration/imagens-idempotentes.repro.test.js
//
// F6, metade do servidor: uma resposta perdida DEPOIS da gravacao nao deixa rastro no cliente,
// entao a retentativa e indistinguivel de um envio novo. Antes de
// 013_imagens_idempotentes.sql as duas rotas respondiam mal a ela, e mal de formas opostas:
//
//   - rota unica: criava uma SEGUNDA linha e um SEGUNDO arquivo em disco, e devolvia um id novo,
//     de modo que a feicao ficava apontando para um blob e o outro virava orfao permanente;
//   - rota bulk: colidia na chave primaria (ela preserva o `localId` como id) e devolvia `failed`
//     para um blob que o servidor JA tinha, o que fazia o cliente desistir de uma figura que
//     estava la, ou reescrever uma referencia valida.
//
// O que este arquivo prende e a DISCRIMINACAO, nao o verde: cada mecanismo tem um caso que o
// exercita e um controle que mostra que sem ele o desfecho e outro. Os dois eixos sao
// independentes de proposito: a chave de tentativa e exata (mesma chave = mesma tentativa, nao
// importa o conteudo) e o hash de conteudo e aproximado (nao distingue retentativa de duas
// figuras iguais), e cada um cobre o que o outro nao alcanca.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join, resolve } from 'path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { contarBlobs } from '../helpers/blobs-em-disco.js';
import config from '../../src/config.js';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * PNG valido de tamanho distinto por `enchimento`: o padding vai DEPOIS do IEND, entao os magic
 * bytes continuam intactos e a dupla validacao de tipo do servidor ainda reconhece image/png.
 *
 * E o que permite pedir "outros bytes" sem sair do formato aceito, que e a unica forma de medir o
 * eixo da CHAVE separado do eixo do CONTEUDO.
 * @param {number} enchimento - Bytes de zero acrescentados ao fim.
 * @returns {Buffer}
 */
function pngComEnchimento(enchimento) {
  return Buffer.concat([PNG_1x1, Buffer.alloc(enchimento, 0x00)]);
}

const base64De = (buffer) => buffer.toString('base64');

describe('Imagens idempotentes (F6)', () => {
  let app, db, owner, token, atlas, atlasDir;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `img_idem_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `Idempotencia ${randomUUID().slice(0, 6)}` });
    atlasDir = resolve(join(config.images.dir, atlas.id));
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const enviar = (bytes, { chave = null, nome = 'foto.png' } = {}) => {
    let pedido = supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${token}`);
    if (chave) pedido = pedido.set('X-Idempotency-Key', chave);
    return pedido.attach('image', bytes, { filename: nome, contentType: 'image/png' });
  };

  const enviarBulk = (itens) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
    .set('Authorization', `Bearer ${token}`)
    .send({ images: itens });

  async function contarLinhas() {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]
    );
    return rows[0].n;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rota unica: a chave de tentativa
  // ───────────────────────────────────────────────────────────────────────────

  it('a MESMA chave devolve 200 com o MESMO recurso: uma linha e um arquivo, nao dois', async () => {
    const chave = randomUUID();
    const bytes = pngComEnchimento(11);
    const linhasAntes = await contarLinhas();
    const arquivosAntes = contarBlobs(atlasDir);

    const primeiro = await enviar(bytes, { chave }).expect(201);
    const segundo = await enviar(bytes, { chave }).expect(200);

    assert.equal(segundo.body.data.id, primeiro.body.data.id,
      'a retentativa tem de devolver o recurso que ja existe, e nao um id novo');
    assert.equal(await contarLinhas(), linhasAntes + 1, 'exatamente UMA linha para as duas tentativas');
    assert.equal(contarBlobs(atlasDir), arquivosAntes + 1,
      'o blob da retentativa nao pode sobrar em disco: ele foi removido ao reusar a linha');

    const { rows } = await db.query(
      'SELECT attempt_key, content_hash FROM images WHERE id = $1', [primeiro.body.data.id]
    );
    assert.equal(rows[0].attempt_key, chave, 'a chave fica gravada na linha');
    assert.match(rows[0].content_hash, /^[0-9a-f]{64}$/, 'e o hash do conteudo tambem');
  });

  it('a chave vence o CONTEUDO: bytes diferentes sob a mesma chave nao criam linha nova', async () => {
    // E a diferenca que justifica os dois eixos existirem. Uma retentativa pode nao carregar bytes
    // identicos (uma re-codificacao, um redimensionamento refeito), e nesse caso o hash nao a
    // reconhece. A chave reconhece, porque ela nomeia a TENTATIVA e nao o arquivo.
    const chave = randomUUID();
    const linhasAntes = await contarLinhas();

    const primeiro = await enviar(pngComEnchimento(21), { chave }).expect(201);
    const segundo = await enviar(pngComEnchimento(22), { chave }).expect(200);

    assert.equal(segundo.body.data.id, primeiro.body.data.id);
    assert.equal(await contarLinhas(), linhasAntes + 1);
  });

  it('CONTROLE NEGATIVO: sem a chave, dois envios de conteudos DIFERENTES criam duas linhas', async () => {
    // O par do caso acima, com a chave retirada e nada mais mudado. Sem ela o servidor nao tem
    // como saber que a segunda requisicao e a mesma intencao, e cria o segundo recurso: e isso
    // que a chave compra, e sem este caso o verde do caso anterior nao provaria nada.
    const linhasAntes = await contarLinhas();

    const primeiro = await enviar(pngComEnchimento(31)).expect(201);
    const segundo = await enviar(pngComEnchimento(32)).expect(201);

    assert.notEqual(segundo.body.data.id, primeiro.body.data.id);
    assert.equal(await contarLinhas(), linhasAntes + 2, 'duas linhas: o retry sem chave duplica');
  });

  it('sem chave, o MESMO conteudo reusa a linha existente (200) e nao grava blob novo', async () => {
    const bytes = pngComEnchimento(41);
    const primeiro = await enviar(bytes).expect(201);

    const linhasAntes = await contarLinhas();
    const arquivosAntes = contarBlobs(atlasDir);
    const segundo = await enviar(bytes).expect(200);

    assert.equal(segundo.body.data.id, primeiro.body.data.id);
    assert.equal(await contarLinhas(), linhasAntes, 'nenhuma linha nova');
    assert.equal(contarBlobs(atlasDir), arquivosAntes, 'nenhum arquivo novo');
  });

  it('chave malformada e recusada ANTES de o blob ser gravado', async () => {
    const arquivosAntes = contarBlobs(atlasDir);
    const linhasAntes = await contarLinhas();

    const res = await enviar(pngComEnchimento(51), { chave: 'nao-e-uuid' }).expect(422);

    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(contarBlobs(atlasDir), arquivosAntes,
      'a recusa acontece antes do multer, entao nao ha blob para limpar depois');
    assert.equal(await contarLinhas(), linhasAntes);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Rota bulk: o id e do cliente, entao quem decide e o conteudo
  // ───────────────────────────────────────────────────────────────────────────

  it('bulk: mesmo id e mesmo conteudo e ACEITO no retry, nao `failed`', async () => {
    const localId = randomUUID();
    const bytes = pngComEnchimento(61);
    const item = { localId, filename: `${localId}.png`, mimeType: 'image/png', data: base64De(bytes) };

    const primeiro = await enviarBulk([item]).expect(201);
    assert.equal(primeiro.body.data.failed.length, 0);
    assert.equal(primeiro.body.data.mapping[localId], localId, 'a bulk preserva o localId como id');

    const linhasAntes = await contarLinhas();
    const segundo = await enviarBulk([item]).expect(201);

    assert.deepEqual(segundo.body.data.failed, [],
      'uma retentativa do MESMO blob nao e falha: o servidor ja o tem');
    assert.equal(segundo.body.data.uploaded.length, 1);
    assert.equal(segundo.body.data.uploaded[0].reused, true, 'e ela se declara reuso');
    assert.equal(segundo.body.data.mapping[localId], localId, 'e o mapeamento continua valido');
    assert.equal(await contarLinhas(), linhasAntes, 'sem linha nova');
  });

  it('bulk: mesmo id com conteudo DIFERENTE continua recusado, com motivo', async () => {
    const localId = randomUUID();
    const item = (enchimento) => ({
      localId, filename: `${localId}.png`, mimeType: 'image/png',
      data: base64De(pngComEnchimento(enchimento)),
    });

    await enviarBulk([item(71)]).expect(201);
    const linhasAntes = await contarLinhas();
    const res = await enviarBulk([item(72)]).expect(201);

    assert.equal(res.body.data.uploaded.length, 0);
    assert.equal(res.body.data.failed.length, 1);
    assert.equal(res.body.data.failed[0].localId, localId);
    assert.match(res.body.data.failed[0].error, /outro conteúdo/,
      'o motivo nomeia o que aconteceu, em vez do texto do driver');
    assert.equal(res.body.data.mapping[localId], undefined, 'e nao mapeia id nenhum');
    assert.equal(await contarLinhas(), linhasAntes, 'a linha existente fica intacta');
  });

  it('bulk: id que pertence a OUTRO atlas e recusado nomeando isso', async () => {
    // A PK de `images` e global, entao a colisao pode vir de fora deste atlas. Aceitar seria
    // devolver ao cliente um id cujo blob ele nao pode nem ler (`FIND_IMAGE_BY_ID` filtra atlas).
    const outro = await createAtlas(db, owner.id, { name: `Vizinho ${randomUUID().slice(0, 6)}` });
    const localId = randomUUID();
    const bytes = pngComEnchimento(81);
    const item = { localId, filename: `${localId}.png`, mimeType: 'image/png', data: base64De(bytes) };

    await supertest(app)
      .post(`/api/v1/atlas/${outro.id}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({ images: [item] })
      .expect(201);

    const res = await enviarBulk([item]).expect(201);
    assert.equal(res.body.data.uploaded.length, 0);
    assert.equal(res.body.data.failed.length, 1);
    assert.match(res.body.data.failed[0].error, /outro atlas/);
  });

  it('bulk: linha SEM hash (clone de atlas, linha antiga) adota o hash do disco e aceita o retry', async () => {
    // O clone de atlas copia os bytes e cunha linha nova sem hash, entao NULL e estado alcancavel
    // numa instalacao limpa. Recusar por NULL transformaria "nao sei" em "conteudo diferente"
    // sobre uma linha cujo arquivo esta ali para ser lido.
    const localId = randomUUID();
    const bytes = pngComEnchimento(91);
    const item = { localId, filename: `${localId}.png`, mimeType: 'image/png', data: base64De(bytes) };

    await enviarBulk([item]).expect(201);
    await db.query('UPDATE images SET content_hash = NULL WHERE id = $1', [localId]);

    const res = await enviarBulk([item]).expect(201);
    assert.deepEqual(res.body.data.failed, []);
    assert.equal(res.body.data.uploaded[0].reused, true);

    const { rows } = await db.query('SELECT content_hash FROM images WHERE id = $1', [localId]);
    assert.match(rows[0].content_hash, /^[0-9a-f]{64}$/,
      'o hash foi adotado a partir do arquivo, para que a proxima conferencia nao releia o disco');
  });
});
