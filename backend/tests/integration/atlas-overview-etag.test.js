// Path: tests/integration/atlas-overview-etag.test.js
//
// A REVALIDAÇÃO de `GET /atlas/overview`, e o que este arquivo prende é o DISCRIMINADOR, não o 304.
//
// A rota devolve toda capa alcançável como data URI base64, num objeto só, sem paginação. MEDIDO em
// 2026-08-26 pela bancada `tests/bench/overview-capas.bench.mjs`, com capas de 100 kB: 2,7 MB para
// N=20, 13,7 MB para N=100 e 27,4 MB para N=200. Serializar isso não cede o laço de eventos do
// Node, então o processo inteiro para enquanto monta a resposta, WebSockets de colaboração
// inclusos. O sintoma não aparece nesta tela, aparece no mapa de outra pessoa.
//
// O ETag TEM DOIS MODOS DE FALHA, os dois SILENCIOSOS, e nenhum deles dá erro:
//
//   1. Um ETag que NUNCA muda serve 304 para sempre. A tela congela: a capa trocada não aparece, o
//      projeto novo não aparece, o projeto apagado continua no lugar. Ninguém vê exceção nenhuma.
//   2. Um ETag que SEMPRE muda não economiza coisa alguma, e o conserto passa verde sem existir.
//
// Por isso os quatro casos de discriminação abaixo vêm em bloco: três mudanças que TÊM de mexer no
// ETag e um controle que NÃO pode. Cada um sozinho é compatível com um dos dois modos de falha.
//
// O CONTROLE NEGATIVO ESTÁ MEDIDO, e ele desmente a leitura fácil deste arquivo. Rodado em
// 2026-08-26 contra o controller ANTERIOR ao conserto (as três consultas num `Promise.all`, sem
// cabeçalho nenhum): 10 dos 12 casos passaram VERDE. Os quatro de discriminação inclusive, porque
// o `etag` padrão do Express deriva o ETag do CORPO e portanto discrimina tudo que o corpo
// discrimina. Só dois casos reprovam o estado anterior, e são eles que sustentam o conserto:
// «o 200 traz ETag fraco e manda revalidar» (o `Cache-Control` e o `Vary` não existiam) e «o 304
// não vai buscar os BYTES das capas». Quem apagar esse segundo caso apaga a prova.
//
// O CONTRATO DO CORPO É DE OUTRO ARQUIVO. `atlas-cartao-projeto.test.js` é o dono do formato e o
// prende com data URIs literais. Aqui só se confere que o 200 continua trazendo `covers`,
// `atlases` e `presence`, para que uma mudança de cabeçalho não vire mudança de payload.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';
import { overviewETag } from '../../src/modules/atlas/atlas.service.js';
import { installPoolQueryCounter } from '../helpers/query-counter.js';

/** 1x1 PNG e 1x1 WebP de verdade, e os bytes precisam passar pelo número mágico da escrita. */
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const WEBP_1X1 = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';

describe('overview · revalidação por ETag', () => {
  let app, db, dono, donoToken, atlas;

  /** O par (ETag, corpo) de uma resposta cheia. */
  const pedirCheio = async (token = donoToken) => {
    const res = await supertest(app)
      .get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return { etag: res.headers.etag, corpo: res.body.data, res };
  };

  const porCapa = (atlasId, image) => supertest(app)
    .put(`/api/v1/atlas/${atlasId}/cover`)
    .set('Authorization', `Bearer ${donoToken}`)
    .send({ image })
    .expect(200);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const sufixo = randomUUID().slice(0, 8);
    dono = await createUser(db, { username: `etag_dono_${sufixo}`, nome: 'Ana Dona' });
    donoToken = await loginUser(app, dono.username, dono.password);
    atlas = await createAtlas(db, dono.id, { name: `ETag ${sufixo}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ----- o cabeçalho e o 304 -----

  it('o 200 traz ETag fraco e manda revalidar, sem mudar o corpo', async () => {
    const { etag, corpo, res } = await pedirCheio();

    assert.ok(etag, 'a resposta cheia precisa nomear um ETag, senão não há o que revalidar');
    assert.match(etag, /^W\/"/, 'fraco: o corpo carrega `presence`, que difere sem o corpo diferir');
    // "guarde e revalide", e não "não guarde": é isto que faz o navegador mandar `If-None-Match`.
    assert.equal(res.headers['cache-control'], 'private, no-cache');
    // A resposta depende de QUEM pergunta. Sem o `Vary`, a de uma conta seria servida à conta
    // seguinte no mesmo navegador.
    assert.match(res.headers.vary || '', /Authorization/i);

    // O formato do corpo é o de sempre. O dono de verdade deste contrato é
    // `atlas-cartao-projeto.test.js`; aqui só se prova que o cabeçalho não o mexeu.
    assert.deepEqual(Object.keys(corpo).sort(), ['atlases', 'covers', 'presence']);
    assert.ok(Array.isArray(corpo.atlases));
  });

  it('a segunda chamada sem mudança responde 304 com corpo vazio', async () => {
    await porCapa(atlas.id, PNG_1X1);
    const { etag, corpo } = await pedirCheio();
    // Premissa: a resposta cheia é grande o bastante para o 304 significar alguma coisa.
    assert.equal(corpo.covers[atlas.id], PNG_1X1);

    const res = await supertest(app)
      .get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${donoToken}`)
      .set('If-None-Match', etag)
      .expect(304);

    // O critério é binário e está em bytes, não em "é menor". `res.text` é o corpo cru.
    const tamanho = Buffer.byteLength(res.text || '');
    assert.ok(tamanho < 500, `o 304 devolveu ${tamanho} bytes de corpo`);
    assert.equal(res.headers.etag, etag, 'o 304 repete o ETag que validou');
  });

  it('um If-None-Match velho não vale: a resposta volta cheia', async () => {
    const res = await supertest(app)
      .get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${donoToken}`)
      .set('If-None-Match', 'W/"ov-0-naoexisteestehash"')
      .expect(200);
    assert.ok(res.body.data.covers, 'ETag que não casa tem de trazer o corpo inteiro de volta');
  });

  // ----- as quatro provas de discriminação -----
  //
  // Elas valem EM CONJUNTO. Um ETag constante passa nos controles negativos e reprova nos três
  // positivos; um ETag aleatório faz o contrário. Só o bloco inteiro separa o conserto dos dois.

  it('NADA mudar mantém o ETag', async () => {
    const a = await pedirCheio();
    const b = await pedirCheio();
    assert.equal(b.etag, a.etag, 'sem escrita nenhuma, o ETag não pode mexer: senão nunca há 304');
  });

  it('trocar a capa de UM atlas muda o ETag', async () => {
    await porCapa(atlas.id, PNG_1X1);
    const antes = await pedirCheio();
    await porCapa(atlas.id, WEBP_1X1);
    const depois = await pedirCheio();

    assert.notEqual(depois.etag, antes.etag);
    // E a capa nova de fato saiu no corpo: um ETag que muda sobre um corpo que não mudou seria
    // outro jeito de passar verde sem consertar nada.
    assert.equal(depois.corpo.covers[atlas.id], WEBP_1X1);
  });

  it('apagar a capa muda o ETag', async () => {
    await porCapa(atlas.id, PNG_1X1);
    const antes = await pedirCheio();

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoToken}`)
      .expect(204);

    const depois = await pedirCheio();
    assert.notEqual(depois.etag, antes.etag);
    assert.equal(depois.corpo.covers[atlas.id], undefined);
  });

  it('acrescentar um atlas SEM capa muda o ETag', async () => {
    const antes = await pedirCheio();
    const novo = await createAtlas(db, dono.id, { name: `Sem capa ${randomUUID().slice(0, 6)}` });
    const depois = await pedirCheio();

    // O caso que um ETag somado só sobre `cover_updated_at` deixaria passar: o atlas novo não tem
    // capa nenhuma, então nenhum carimbo de tempo mudou, e mesmo assim o cartão novo precisa
    // aparecer. É por isso que a CONTAGEM entra no ETag.
    assert.notEqual(depois.etag, antes.etag, 'o cartão novo nunca apareceria');
    assert.ok(depois.corpo.atlases.some((a) => a.id === novo.id));
  });

  it('excluir um atlas muda o ETag', async () => {
    const alvo = await createAtlas(db, dono.id, { name: `Some ${randomUUID().slice(0, 6)}` });
    const antes = await pedirCheio();

    await supertest(app)
      .delete(`/api/v1/atlas/${alvo.id}`)
      .set('Authorization', `Bearer ${donoToken}`)
      .expect(204);

    const depois = await pedirCheio();
    assert.notEqual(depois.etag, antes.etag);
    assert.ok(!depois.corpo.atlases.some((a) => a.id === alvo.id));
  });

  it('ganhar um participante muda o ETag', async () => {
    // `member_count` e `members` também são payload. Um ETag que só olhasse a capa deixaria o
    // "+N" do cartão congelado sem que ninguém visse erro nenhum.
    const antes = await pedirCheio();
    const leitor = await createUser(db, { username: `etag_leitor_${randomUUID().slice(0, 8)}` });
    await createShare(db, atlas.id, leitor.id, 'read', dono.id);
    const depois = await pedirCheio();
    assert.notEqual(depois.etag, antes.etag);
  });

  // ----- o ETag não vaza escopo -----

  it('duas contas com acervos diferentes não compartilham ETag', async () => {
    const estranho = await createUser(db, { username: `etag_estranho_${randomUUID().slice(0, 8)}` });
    const estranhoToken = await loginUser(app, estranho.username, estranho.password);

    const doDono = await pedirCheio();
    const doEstranho = await pedirCheio(estranhoToken);
    assert.notEqual(doEstranho.etag, doDono.etag);

    // E o ETag do dono servido ao estranho NÃO pode virar 304: seria entregar "nada mudou" sobre
    // um acervo que ele nunca viu, e a tela dele ficaria com a resposta em cache de outra conta.
    await supertest(app)
      .get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${estranhoToken}`)
      .set('If-None-Match', doDono.etag)
      .expect(200);
  });

  // ----- o que separa este conserto do 304 que o Express já dava -----

  it('o 304 não vai buscar os BYTES das capas', async () => {
    // ESTE É O CASO QUE REPROVA O ESTADO ANTERIOR, e sem ele o arquivo inteiro passaria verde
    // sobre o defeito. O `etag` padrão do Express também responde 304 nesta rota, e não adianta
    // nada no servidor: ele deriva o ETag do CORPO PRONTO, ou seja, depois de a consulta das capas
    // ter trazido cada blob e de o base64 e o `JSON.stringify` terem rodado. MEDIDO na bancada,
    // com N=200 e capas de 100 kB: 0,2696 s no 304 contra 0,2928 s no 200. O ganho não está em
    // responder 304, está em DECIDIR o 304 antes de montar o corpo.
    //
    // A prova é o SQL que a requisição emite: `LIST_USER_ATLAS_COVERS` é a única consulta desta
    // rota que projeta `c.bytes`, e no caminho do 304 ela não pode aparecer.
    await porCapa(atlas.id, PNG_1X1);
    const { etag } = await pedirCheio();

    const contador = installPoolQueryCounter();
    try {
      contador.reset();
      await supertest(app)
        .get('/api/v1/atlas/overview')
        .set('Authorization', `Bearer ${donoToken}`)
        .expect(200);
      const noCheio = contador.state.statements.filter((s) => s.includes('c.bytes'));
      assert.equal(noCheio.length, 1, 'premissa: a resposta cheia lê os blobs uma vez');

      contador.reset();
      await supertest(app)
        .get('/api/v1/atlas/overview')
        .set('Authorization', `Bearer ${donoToken}`)
        .set('If-None-Match', etag)
        .expect(304);
      const no304 = contador.state.statements.filter((s) => s.includes('c.bytes'));
      assert.deepEqual(no304, [], 'o 304 ainda está trazendo os blobs do banco');
    } finally {
      contador.restore();
    }
  });

  // ----- a função, sem HTTP -----

  it('a ORDEM das linhas não muda o ETag', async () => {
    // A consulta não tem `ORDER BY`, e a ordem que o Postgres devolve não é promessa. Sem a
    // ordenação de dentro de `overviewETag`, o ETag mudaria sozinho e nunca haveria 304. E o modo
    // de falha "sempre muda", que passa em todos os casos positivos acima.
    const linhas = [
      { id: 'b0000000-0000-0000-0000-000000000002', member_count: 1, members: [], has_cover: true, cover_updated_at: new Date(1000) },
      { id: 'a0000000-0000-0000-0000-000000000001', member_count: 3, members: [{ id: 'x' }], has_cover: false, cover_updated_at: null },
    ];
    assert.equal(overviewETag(linhas), overviewETag([...linhas].reverse()));
  });
});
