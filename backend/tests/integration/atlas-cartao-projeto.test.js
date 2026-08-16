// Path: tests/integration/atlas-cartao-projeto.test.js
//
// O que a tela "Seus atlas" desenha em cada cartão de projeto além do nome: quem participa, quem
// está conectado agora, e a capa. Três fatos com três modos de falhar em silêncio, e é por isso
// que eles são cobrados aqui e não pela tela:
//
// 1. ESCOPO. `GET /atlas/overview` e `GET /atlas/presence` não passam por
//    `requireAtlasPermission` (não falam de UM atlas), então o filtro mora dentro da consulta.
//    Um filtro que se perde não dá erro: devolve os projetos alheios com cara de resposta certa.
// 2. NÚMERO MÁGICO. O mime da capa é texto que o cliente escolhe. Sem conferir os bytes, `image/webp`
//    é um rótulo sobre qualquer coisa, e a mesma allowlist que `images.routes.js` aplica no upload
//    (png/jpeg/webp, SEM svg) valeria zero neste caminho.
// 3. DEDUPE DE PRESENÇA. Uma pessoa com duas abas são dois sockets. O cartão que dissesse
//    "2 conectados" para uma pessoa só estaria mentindo com dado verdadeiro.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';
import { joinRoom, leaveRoom } from '../../src/modules/collab/collab.rooms.js';

/** 1x1 PNG e 1x1 WebP de verdade — os bytes precisam passar pelo número mágico. */
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const WEBP_1X1 = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
/** Os MESMOS bytes de PNG anunciados como WebP: o caso que só o número mágico pega. */
const PNG_BYTES_CALLED_WEBP = PNG_1X1.replace('image/png', 'image/webp');

describe('cartão de projeto · participantes, capa e presença', () => {
  let app, db, dono, donoToken, leitor, leitorToken, estranho, estranhoToken, atlas;

  const get = async (path, token) => supertest(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .expect(200)
    .then((res) => res.body.data);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const sufixo = randomUUID().slice(0, 8);
    dono = await createUser(db, { username: `card_dono_${sufixo}`, nome: 'Ana Dona' });
    leitor = await createUser(db, { username: `card_leitor_${sufixo}`, nome: 'Beto Leitor' });
    estranho = await createUser(db, { username: `card_estranho_${sufixo}`, nome: 'Caio Estranho' });
    donoToken = await loginUser(app, dono.username, dono.password);
    leitorToken = await loginUser(app, leitor.username, leitor.password);
    estranhoToken = await loginUser(app, estranho.username, estranho.password);

    atlas = await createAtlas(db, dono.id, { name: `Cartão ${sufixo}` });
    await createShare(db, atlas.id, leitor.id, 'read', dono.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  beforeEach(async () => {
    await db.query('DELETE FROM atlas_covers WHERE atlas_id = $1', [atlas.id]);
  });

  // ----- participantes -----

  it('lista o dono em primeiro lugar e conta todo mundo', async () => {
    const { atlases } = await get('/api/v1/atlas/overview', donoToken);
    const cartao = atlases.find((a) => a.id === atlas.id);
    assert.ok(cartao, 'o atlas do próprio dono precisa aparecer');
    assert.equal(cartao.member_count, 2, 'dono + um compartilhamento');
    assert.equal(cartao.members.length, 2);
    // O dono NÃO tem linha em atlas_shares: ele entra pela outra metade da união, e sempre à frente.
    assert.equal(cartao.members[0].id, dono.id);
    assert.equal(cartao.members[0].nome, 'Ana Dona');
    assert.equal(cartao.members[1].id, leitor.id);
    // Posto vem do JOIN com `ranks`, como em toda identidade exibida no produto.
    assert.equal(typeof cartao.members[0].posto_graduacao, 'string');
    assert.equal(cartao.has_cover, false);
  });

  it('o membro de leitura vê a mesma lista de participantes', async () => {
    // Decisão deliberada, mais frouxa que `GET /sharing` (que exige manage): saber COM QUEM se
    // divide o projeto é o que o mapa já mostra no primeiro instante de colaboração. Se isto virar
    // um vazamento, o lugar de apertar é aqui, e este caso fica vermelho de propósito.
    const { atlases } = await get('/api/v1/atlas/overview', leitorToken);
    const cartao = atlases.find((a) => a.id === atlas.id);
    assert.ok(cartao);
    assert.equal(cartao.member_count, 2);
    assert.deepEqual(cartao.members.map((m) => m.id).sort(), [dono.id, leitor.id].sort());
    // E nada de identidade de login: nome e posto bastam para desenhar um avatar.
    assert.deepEqual(Object.keys(cartao.members[0]).sort(), ['id', 'nome', 'posto_graduacao']);
  });

  it('quem não tem acesso não vê o projeto no overview', async () => {
    // A capa PRECISA existir para este caso significar alguma coisa. Sem ela os três `undefined`
    // abaixo seriam verdadeiros com o filtro de escopo removido, e o caso passaria verde provando
    // nada: foi o que aconteceu na primeira escrita deste arquivo, pego pelo controle negativo.
    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoToken}`)
      .send({ image: PNG_1X1 })
      .expect(200);
    const doDono = await get('/api/v1/atlas/overview', donoToken);
    assert.equal(doDono.covers[atlas.id], PNG_1X1, 'premissa: a capa existe e o dono a recebe');

    const { atlases, covers, presence } = await get('/api/v1/atlas/overview', estranhoToken);
    assert.equal(atlases.find((a) => a.id === atlas.id), undefined);
    assert.equal(covers[atlas.id], undefined);
    assert.equal(presence[atlas.id], undefined);
  });

  // ----- capa -----

  it('grava a capa, devolve-a no overview e a apaga', async () => {
    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoToken}`)
      .send({ image: WEBP_1X1, width: 1, height: 1 })
      .expect(200);

    const depoisDeGravar = await get('/api/v1/atlas/overview', donoToken);
    assert.equal(depoisDeGravar.atlases.find((a) => a.id === atlas.id).has_cover, true);
    // Volta como data URI, byte a byte: é assim que o `<img>` da tela a consome, sem uma segunda
    // viagem por cartão.
    assert.equal(depoisDeGravar.covers[atlas.id], WEBP_1X1);

    // O membro de leitura também vê a capa (ela é a identidade do projeto, não um privilégio).
    const paraOLeitor = await get('/api/v1/atlas/overview', leitorToken);
    assert.equal(paraOLeitor.covers[atlas.id], WEBP_1X1);

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoToken}`)
      .expect(204);

    const depoisDeApagar = await get('/api/v1/atlas/overview', donoToken);
    assert.equal(depoisDeApagar.atlases.find((a) => a.id === atlas.id).has_cover, false);
    assert.equal(depoisDeApagar.covers[atlas.id], undefined);
  });

  it('trocar a capa substitui a anterior, sem criar uma segunda linha', async () => {
    const put = (image) => supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoToken}`)
      .send({ image })
      .expect(200);

    await put(PNG_1X1);
    await put(WEBP_1X1);

    const { rows } = await db.query('SELECT mime_type FROM atlas_covers WHERE atlas_id = $1', [atlas.id]);
    assert.equal(rows.length, 1, 'a chave primária é o atlas: uma capa por projeto');
    assert.equal(rows[0].mime_type, 'image/webp');
  });

  it('recusa bytes que não são do formato anunciado', async () => {
    const res = await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoToken}`)
      .send({ image: PNG_BYTES_CALLED_WEBP })
      .expect(400);
    assert.match(res.body.error?.message || '', /image\/webp/);

    const { rows } = await db.query('SELECT 1 FROM atlas_covers WHERE atlas_id = $1', [atlas.id]);
    assert.equal(rows.length, 0, 'nada pode ter sido gravado');
  });

  it('recusa um formato fora da allowlist (svg incluso) antes de decodificar', async () => {
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoToken}`)
      .send({ image: svg })
      .expect(422); // barrado pelo Joi da borda, que é o guarda mais externo
  });

  it('um membro de LEITURA não pode trocar nem apagar a capa', async () => {
    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${leitorToken}`)
      .send({ image: PNG_1X1 })
      .expect(403);

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${leitorToken}`)
      .expect(403);
  });

  it('apagar uma capa que não existe é sucesso, não 404', async () => {
    // O chamador pediu um ESTADO ("sem capa"), não a morte de uma linha. Um 404 aqui faria a tela
    // mostrar erro depois de fazer exatamente o que o usuário pediu.
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/cover`)
      .set('Authorization', `Bearer ${donoToken}`)
      .expect(204);
  });

  // ----- presença -----

  it('conta a PESSOA, não o socket, e some quando ela sai', async () => {
    const fakeSocket = (clientId, extra = {}) => ({
      readyState: 1,
      userId: dono.id,
      clientId,
      userName: 'Ana Dona',
      userPosto: 'Capitão',
      ...extra,
    });
    const abaA = fakeSocket('aba-a');
    const abaB = fakeSocket('aba-b', { away: true });
    const outraPessoa = { ...fakeSocket('aba-c'), userId: leitor.id, userName: 'Beto Leitor' };

    const vazio = await get('/api/v1/atlas/presence', donoToken);
    assert.equal(vazio[atlas.id], undefined, 'sala vazia não aparece no mapa de presença');

    joinRoom(atlas.id, abaA);
    joinRoom(atlas.id, abaB);
    joinRoom(atlas.id, outraPessoa);
    try {
      const online = await get('/api/v1/atlas/presence', donoToken);
      const pessoas = online[atlas.id];
      assert.equal(pessoas.length, 2, 'três sockets, duas pessoas');
      const ana = pessoas.find((p) => p.id === dono.id);
      assert.equal(ana.status, 'online', 'uma aba viva vence a aba em carência');
      assert.equal(ana.nome, 'Ana Dona');
      assert.equal(pessoas.find((p) => p.id === leitor.id).nome, 'Beto Leitor');

      // E o estranho continua sem enxergar a sala.
      const paraOEstranho = await get('/api/v1/atlas/presence', estranhoToken);
      assert.equal(paraOEstranho[atlas.id], undefined);
    } finally {
      leaveRoom(atlas.id, abaA);
      leaveRoom(atlas.id, abaB);
      leaveRoom(atlas.id, outraPessoa);
    }

    const depois = await get('/api/v1/atlas/presence', donoToken);
    assert.equal(depois[atlas.id], undefined, 'a sala esvaziou');
  });
});
