// Path: tests/integration/video-de-previa-gateado.test.js
//
// D14 (achado R6): o vídeo de prévia deixa de ser capacidade por URL, e marcar privado
// RE-CUNHA o nome do arquivo.
//
// O QUE ESTAVA ABERTO. `GET /catalog-videos/:file` servia os bytes a quem tivesse o nome do
// arquivo, sem perguntar nada sobre o recurso dono. A justificativa escrita era "a URL só chega
// a quem VÊ o recurso", e ela é verdadeira a cada instante e falsa ao longo do tempo: um recurso
// que já foi PÚBLICO teve a URL servida a todo mundo dentro do `/api/config`, que é o documento
// anônimo e cacheável, e `setResourceVisibility` não movia byte nenhum ao marcá-lo privado. Era
// a única superfície de recurso em que a marca de privacidade não custava nada.
//
// AS DUAS METADES SÃO MEDIDAS SEPARADAS, e precisam ser, porque cada uma fecha um tempo
// diferente: o GATE fecha daqui para a frente, a RE-CUNHAGEM mata a URL que já circulou. Um teste
// só do gate passaria verde com a URL antiga ainda viva, e um só da re-cunhagem passaria verde
// com a URL nova aberta a qualquer um.
//
// OS PARES POSITIVOS SÃO OBRIGATÓRIOS em cada bloco: um gate que negasse TUDO passaria em todo
// caso negativo deste arquivo. Por isso cada recusa tem ao lado quem recebe os bytes, e por dois
// caminhos distintos (PAPEL e CONCESSÃO), que são ramos diferentes do predicado.
//
// O ARQUIVO É ESCRITO DIRETO NO DIRETÓRIO, e não enviado pela rota de upload: o envio valida por
// MAGIC BYTES, então testá-lo aqui exigiria um MP4 sintético cuja detecção é do `file-type` e não
// nossa, e o sujeito deste arquivo é o SERVIR, não o receber. O envio tem cobertura própria em
// `catalogo-video-de-previa.test.js`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';
import config from '../../src/config.js';

const RID = crypto.randomUUID().slice(0, 8);
/** A marca do conteúdo: o que se mede é QUEM recebe bytes, e se eles vazam numa recusa. */
const MARCA = `video-de-previa-${RID}`;
const BYTES = Buffer.from(MARCA);

/**
 * O corpo da resposta como TEXTO, seja ele JSON de erro ou bytes de vídeo.
 *
 * Existe para que a busca pela marca seja UMA asserção e não uma disjunção sobre o tipo do
 * corpo: `assert.ok(A || B)` passa nos dois mundos e não prende nenhum, que é o que a regra de
 * lint `no-disjunctive-assert` deste pacote recusa.
 */
const corpoComoTexto = (res) => {
  if (typeof res.text === 'string') return res.text;
  if (Buffer.isBuffer(res.body)) return res.body.toString('utf8');
  return JSON.stringify(res.body ?? null);
};

describe('D14 — o vídeo de prévia é gateado, e marcar privado re-cunha o nome', () => {
  let app, db, orgId, tilesetId;
  const tokens = {};
  let forasteiro;
  const escritos = [];

  /** O nome do arquivo dentro de uma URL hospedada aqui. */
  const nomeDe = (url) => String(url).slice(`${config.catalogVideo.baseUrl}/`.length);

  /** Cria um arquivo de vídeo com token novo e devolve a URL servida. */
  function semearVideo() {
    const nome = `${crypto.randomBytes(16).toString('hex')}.mp4`;
    const dir = path.resolve(config.catalogVideo.dir);
    mkdirSync(dir, { recursive: true });
    const alvo = path.resolve(dir, nome);
    writeFileSync(alvo, BYTES);
    escritos.push(alvo);
    return `${config.catalogVideo.baseUrl}/${nome}`;
  }

  /** O endereço servido do vídeo, como está HOJE no banco. */
  const urlNoBanco = async () => (await db.query(
    "SELECT config->>'previewVideo' AS url FROM tilesets WHERE id = $1", [tilesetId],
  )).rows[0].url;

  /** `GET` do vídeo, opcionalmente como alguém. */
  const pegar = (url, quem) => {
    const req = supertest(app).get(`/api/v1${url.slice('/api/v1'.length)}`);
    return quem ? req.set('Authorization', `Bearer ${tokens[quem]}`) : req;
  };

  const marcar = (quem, accessLevel) => supertest(app)
    .patch(`/api/v1/resource-access/tileset/${tilesetId}/visibility`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send({ accessLevel })
    .expect(200);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgId = (await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM gate video ${RID}`, `om-gv-${RID}`, `G${RID.slice(0, 3)}`],
    )).rows[0].id;

    const admin = await createAdminUser(db, { username: `gv_admin_${RID}` });
    const produtor = await createProducerUser(db, orgId, { username: `gv_prod_${RID}` });
    const credenciado = await createUser(db, { username: `gv_cred_${RID}`, role: 'credenciado' });
    forasteiro = await createUser(db, { username: `gv_fora_${RID}` });
    const beneficiario = await createUser(db, { username: `gv_benef_${RID}` });

    tokens.admin = await loginUser(app, admin.username, admin.password);
    tokens.produtor = await loginUser(app, produtor.username, produtor.password);
    tokens.credenciado = await loginUser(app, credenciado.username, credenciado.password);
    tokens.forasteiro = await loginUser(app, forasteiro.username, forasteiro.password);
    tokens.beneficiario = await loginUser(app, beneficiario.username, beneficiario.password);
    tokens.benefId = beneficiario.id;

    tilesetId = `gv-tileset-${RID}`;
    await supertest(app).post('/api/v1/tilesets')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ id: tilesetId, name: `Modelo ${RID}`, config: { url: '/x' } })
      .expect(201);
    await db.query('UPDATE tilesets SET owner_org_id = $2 WHERE id = $1', [tilesetId, orgId]);
    await db.query(
      "UPDATE tilesets SET config = jsonb_set(config, '{previewVideo}', to_jsonb($2::text)) WHERE id = $1",
      [tilesetId, semearVideo()],
    );
  });

  after(async () => {
    for (const arquivo of escritos) {
      if (existsSync(arquivo)) rmSync(arquivo, { force: true });
    }
    await teardownTestEnv(db);
  });

  it('recurso PÚBLICO: o anônimo recebe os bytes, e o cabeçalho é `public`', async () => {
    const url = await urlNoBanco();
    const res = await pegar(url).expect(200);

    assert.equal(res.body.length, BYTES.length, 'os bytes do vídeo público saem inteiros');
    assert.match(res.headers['cache-control'], /^public,/, 'vídeo público é publicamente cacheável');
  });

  it('marcar PRIVADO re-cunha o nome: a URL antiga morre e o arquivo mudou de lugar', async () => {
    const antiga = await urlNoBanco();
    const antigoNoDisco = path.resolve(config.catalogVideo.dir, nomeDe(antiga));
    assert.ok(existsSync(antigoNoDisco), 'guarda: o arquivo existe antes da virada');

    await marcar('produtor', 'private');
    const nova = await urlNoBanco();
    escritos.push(path.resolve(config.catalogVideo.dir, nomeDe(nova)));

    assert.notEqual(nova, antiga, 'a virada para privado tem de cunhar um nome NOVO');
    assert.ok(
      !existsSync(antigoNoDisco),
      'o arquivo tem de ter sido MOVIDO: um nome velho vivo em disco é a capacidade sobrevivendo',
    );

    // A URL ANTIGA É 404 ATÉ PARA QUEM PODE VER O RECURSO, porque recurso nenhum a nomeia mais.
    // Este é o caso que o achado pedia: a capacidade que circulou enquanto o recurso era público.
    for (const quem of [undefined, 'forasteiro', 'produtor']) {
      const res = await pegar(antiga, quem).expect(404);
      assert.equal(res.body.data, undefined, 'nenhum byte pode acompanhar a recusa');
    }
  });

  it('recurso PRIVADO: anônimo e conta sem concessão levam 404 e zero bytes', async () => {
    const url = await urlNoBanco();

    for (const quem of [undefined, 'forasteiro']) {
      const res = await pegar(url, quem).expect(404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
      // ZERO BYTES, e não só o status: um 404 que já escreveu corpo passa idêntico num teste
      // que mede só o código. A marca é o conteúdo do arquivo, procurada no corpo INTEIRO.
      assert.ok(
        !corpoComoTexto(res).includes(MARCA),
        'o conteúdo do vídeo não pode viajar dentro de uma recusa',
      );
    }
  });

  it('recurso PRIVADO: PAPEL e PRODUÇÃO recebem os bytes, com cabeçalho `private`', async () => {
    const url = await urlNoBanco();

    for (const quem of ['produtor', 'credenciado', 'admin']) {
      const res = await pegar(url, quem).expect(200);
      assert.equal(res.body.length, BYTES.length, `${quem} tem de receber o vídeo inteiro`);
      assert.match(
        res.headers['cache-control'], /^private,/,
        'resposta que dependeu do chamador nunca é publicamente cacheável',
      );
      assert.match(res.headers.vary || '', /Authorization/i);
    }
  });

  it('recurso PRIVADO: a CONCESSÃO abre, e abrir é o par do 404 do forasteiro', async () => {
    const url = await urlNoBanco();
    await pegar(url, 'beneficiario').expect(404);

    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${tilesetId}/grants`)
      .set('Authorization', `Bearer ${tokens.produtor}`)
      .send({ granteeId: tokens.benefId, grantLevel: 'view' })
      .expect(201);

    const res = await pegar(url, 'beneficiario').expect(200);
    assert.equal(res.body.length, BYTES.length, 'a concessão é um ramo do predicado, e ele vale aqui');
  });

  it('a URL NOVA é a que os dois payloads publicam, e ninguém a monta a partir do nome velho', async () => {
    const url = await urlNoBanco();

    // O PAYLOAD ADITIVO (o privado). Sem esta asserção, a re-cunhagem poderia gravar um nome
    // que a tela nunca recebe, e o cartão mostraria um botão de prévia apontando para o 404.
    const visivel = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens.produtor}`)
      .expect(200);
    const item = visivel.body.data.tilesets.find((t) => t.id === tilesetId);
    assert.ok(item, 'o produtor enxerga o próprio recurso privado no payload aditivo');
    // O item do payload e `{ id, name, ...config }`: `previewVideo` sai no TOPO, nao dentro
    // de um `config` aninhado. Mesma forma do `/api/config`, e e por isso que o cliente pode
    // despejar um no outro.
    assert.equal(item.previewVideo, url, 'o payload aditivo publica a URL NOVA');

    // E O DOCUMENTO DE BOOT, do outro lado da virada: público de novo, o `/api/config` publica a
    // mesma URL nova. As duas metades juntas são o que prova que o endereço servido é UM só.
    await marcar('produtor', 'public');
    const depois = await urlNoBanco();
    assert.equal(
      depois, url,
      'voltar a público NÃO re-cunha: a URL que circulou enquanto era privado só chegou a quem via',
    );

    const cfg = await supertest(app).get('/api/config').expect(200);
    const noConfig = (cfg.body.data.tilesets || []).find((t) => t.id === tilesetId);
    assert.ok(noConfig, 'de volta ao público, o recurso reaparece no documento de boot');
    assert.equal(noConfig.previewVideo, url, 'o documento de boot publica a MESMA URL nova');
  });

  it('de volta a PÚBLICO, o anônimo recebe os bytes de novo', async () => {
    // O par positivo do arquivo inteiro: sem ele, um gate que passasse a negar tudo depois da
    // primeira virada deixaria todos os casos acima verdes.
    const url = await urlNoBanco();
    const res = await pegar(url).expect(200);
    assert.equal(res.body.length, BYTES.length);
  });

  it('arquivo que recurso NENHUM referencia é 404, mesmo existindo em disco', async () => {
    // O ÓRFÃO, que é o estado normal depois de uma troca de vídeo: o arquivo fica, e nenhuma
    // linha o nomeia. Antes do gate ele era servido a quem tivesse o nome.
    const orfa = semearVideo();
    const res = await pegar(orfa, 'admin').expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});
