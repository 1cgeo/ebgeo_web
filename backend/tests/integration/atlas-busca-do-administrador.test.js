// Path: tests/integration/atlas-busca-do-administrador.test.js
//
// INVARIANTE PRESA AQUI (achado A1, decisão do dono em 2026-08-24): o administrador ALCANÇA o
// atlas vivo de qualquer dono — e alcança por BUSCA, nunca por lista aberta.
//
// O buraco: `requireAtlasPermission` faz curto-circuito por `req.user.role === 'admin'`, então o
// administrador tem posse em TODO atlas e mesmo assim não conseguia descobrir o UUID de nenhum
// alheio. `LIST_USER_ATLAS` filtra por `owner_id = $1 OR share`, e a metade MORTA já resolvia isso
// direito (`listDeletedUserAtlas(userId, isAdmin)` + `LIST_ALL_DELETED_ATLAS`, cujo comentário
// aponta `LIST_USER_ATLAS` como o erro a não repetir). A metade viva não tinha caminho nenhum.
//
// AS DUAS METADES SÃO INSEPARÁVEIS, e é por isso que elas estão no mesmo arquivo. Um teste que só
// provasse "o administrador acha o atlas de outro" passaria idêntico contra uma rota que devolve o
// acervo inteiro sem termo, ou contra uma que qualquer usuário autenticado chama. Então todo caso
// de alcance vem pareado com um caso de RECUSA: sem termo, com termo curto demais, com curinga, e
// com quem não é administrador.
//
// CONTROLE NEGATIVO (rode ao mexer em `SEARCH_ALL_ATLAS`, no Joi ou no gate — copie os arquivos de
// lado, nunca `git checkout`, porque outros agentes compartilham esta árvore):
//   1. Troque `requireAdmin` por nada na rota: os três casos de recusa por papel ficam vermelhos e
//      os de alcance seguem verdes.
//   2. Tire o `.required()` de `q` no `adminAtlasSearchSchema` (e o piso do serviço): o caso
//      "sem termo" fica vermelho — é ele que prova que não existe caminho de despejo.
//   3. Tire o escape de `%`/`_` em `searchAllAtlas`: o caso do curinga fica vermelho, e ele é o
//      despejo entrando pela porta da busca, com o Joi verde.
//   4. Reponha o filtro `owner_id = $1` na consulta: os casos de alcance ficam vermelhos e todos
//      os de recusa seguem verdes — que é exatamente o estado anterior a esta mudança.
//
// OS QUATRO FORAM RODADOS EM 2026-08-24, e o resultado é a razão de eles estarem escritos: (1)
// derruba os três casos de papel; (3) derruba só o do curinga; (4), aplicado como um recorte da
// consulta aos atlas de administrador, derruba os CINCO de alcance e deixa os oito de recusa
// verdes. Sem essa medição a lista seria intenção, não controle.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, loginUser,
} from '../helpers/fixtures.js';

describe('busca de atlas do administrador: alcança o alheio, e nunca despeja o acervo', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgProdutora;
  let atlasDoDono, atlasNaLixeira;
  // Um nome que só existe nesta rodada. O banco é compartilhado pela suíte inteira, então um termo
  // genérico casaria com atlas de outros arquivos e as contagens virariam ruído.
  const marca = `zz${sufixo}`;

  const buscar = (query, token) => supertest(app)
    .get(`/api/v1/atlas/admin/search${query}`)
    .set('Authorization', `Bearer ${token}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgProdutora = (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM busca ${sufixo}`, `om-busca-${sufixo}`, `bs${sufixo.slice(0, 3)}`],
    )).rows[0].id;

    atores.admin = await createAdminUser(db, { username: `bs_admin_${sufixo}` });
    atores.dono = await createUser(db, {
      username: `bs_dono_${sufixo}`, nome: `Fulano de Tal ${sufixo}`,
    });
    atores.estranho = await createUser(db, { username: `bs_estranho_${sufixo}` });
    atores.credenciado = await createUser(db, {
      username: `bs_cred_${sufixo}`, role: 'credenciado',
    });
    atores.produtor = await createProducerUser(db, orgProdutora, {
      username: `bs_prod_${sufixo}`,
    });
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    atlasDoDono = await createAtlas(db, atores.dono.id, { name: `Operacao ${marca} Alfa` });
    // Um segundo atlas do mesmo dono, para o caso de truncamento.
    await createAtlas(db, atores.dono.id, { name: `Operacao ${marca} Bravo` });
    atlasNaLixeira = await createAtlas(db, atores.dono.id, { name: `Operacao ${marca} Morta` });
    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlasNaLixeira.id]);
  });

  after(async () => {
    await db.query('DELETE FROM atlas WHERE owner_id = $1', [atores.dono.id]);
    await db.query('DELETE FROM users WHERE username LIKE $1', [`bs_%${sufixo}`]);
    await db.query('DELETE FROM organizations WHERE id = $1::uuid', [orgProdutora]);
    await teardownTestEnv(db);
  });

  // ── o alcance que nasce ────────────────────────────────────────────────────
  it('o administrador acha, pelo NOME, um atlas vivo de que não é dono nem membro', async () => {
    const res = await buscar(`?q=${marca}`, tokens.admin).expect(200);

    const achado = res.body.data.results.find((a) => a.id === atlasDoDono.id);
    assert.ok(achado, 'o atlas de outro dono aparece na busca do administrador');
    assert.equal(res.body.data.term, marca, 'a resposta ecoa o termo que a produziu');
    assert.equal(res.body.data.truncated, false, 'dois resultados cabem no limite padrão');
  });

  it('a linha IDENTIFICA o dono e não declara menos acesso do que o gate já dá', async () => {
    const res = await buscar(`?q=${marca}`, tokens.admin).expect(200);
    const achado = res.body.data.results.find((a) => a.id === atlasDoDono.id);

    assert.ok(achado, 'a linha existe para ser inspecionada');
    assert.equal(achado.owner_username, atores.dono.username, 'o login do dono vem junto');
    assert.equal(achado.owner_nome, atores.dono.nome, 'e o nome, que é o que a tela mostra');
    assert.equal(
      achado.user_permission, 'owner',
      'requireAtlasPermission já concede posse ao administrador em qualquer atlas',
    );
  });

  it('acha também pelo DONO (nome e login), que é o caso de uso da conta desativada', async () => {
    const porLogin = await buscar(`?q=${atores.dono.username}`, tokens.admin).expect(200);
    assert.ok(
      porLogin.body.data.results.some((a) => a.id === atlasDoDono.id),
      'buscar pelo login do dono devolve os atlas dele',
    );

    const porNome = await buscar(`?q=Fulano de Tal ${sufixo}`, tokens.admin).expect(200);
    assert.ok(
      porNome.body.data.results.some((a) => a.id === atlasDoDono.id),
      'e pelo nome dele também',
    );
  });

  it('acha pelo UUID EXATO, e um termo que não é UUID não derruba a rota', async () => {
    const porId = await buscar(`?q=${atlasDoDono.id}`, tokens.admin).expect(200);
    assert.equal(porId.body.data.results.length, 1, 'o UUID casa exatamente um atlas');
    assert.equal(porId.body.data.results[0].id, atlasDoDono.id);

    // Se o termo fosse convertido para uuid, isto seria 22P02 → 500 sobre uma busca legítima.
    await buscar('?q=nao-e-uuid-nenhum', tokens.admin).expect(200);
  });

  it('a lixeira NÃO entra na busca: ela tem rota própria', async () => {
    const res = await buscar(`?q=${marca}`, tokens.admin).expect(200);
    assert.equal(
      res.body.data.results.some((a) => a.id === atlasNaLixeira.id), false,
      'atlas soft-deletado fica fora; GET /atlas/trash é quem o mostra',
    );
  });

  it('`truncated` distingue "bateu o teto" de "bateu o teto e há mais"', async () => {
    const cheio = await buscar(`?q=${marca}&limit=1`, tokens.admin).expect(200);
    assert.equal(cheio.body.data.results.length, 1, 'o limite é respeitado');
    assert.equal(cheio.body.data.truncated, true, 'e a resposta avisa que há mais');

    const folgado = await buscar(`?q=${marca}&limit=10`, tokens.admin).expect(200);
    assert.equal(folgado.body.data.truncated, false, 'com folga, nada foi cortado');
  });

  // ── o que NÃO pode existir: um caminho que devolva tudo ─────────────────────
  it('SEM TERMO a rota recusa (422), em vez de devolver o acervo', async () => {
    const res = await supertest(app)
      .get('/api/v1/atlas/admin/search')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(422);
    assert.equal(res.body.data, undefined, 'nenhuma linha viaja numa recusa');
  });

  it('termo curto demais recusa (422): um caractere é uma lista aberta disfarçada', async () => {
    await buscar('?q=a', tokens.admin).expect(422);
    await buscar('?q=', tokens.admin).expect(422);
  });

  it('CURINGA não vira despejo: `%` e `_` são escapados antes do ILIKE', async () => {
    // A asserção é sobre o atlas CONHECIDO, não sobre o total: o banco é compartilhado pela
    // suíte, e "zero linhas" seria refém do que outro arquivo tenha semeado. Sem escape, os dois
    // termos casariam com todo nome — inclusive este.
    const curinga = await buscar('?q=%25%25', tokens.admin).expect(200);
    assert.equal(
      curinga.body.data.results.some((a) => a.id === atlasDoDono.id), false,
      'o termo "%%" passa no piso de tamanho e não pode casar com todo nome do banco',
    );

    const sublinhado = await buscar('?q=__', tokens.admin).expect(200);
    assert.equal(
      sublinhado.body.data.results.some((a) => a.id === atlasDoDono.id), false,
      'idem para o curinga de um caractere',
    );
  });

  // ── o gate de papel ────────────────────────────────────────────────────────
  it('usuário comum leva 403, mesmo com termo válido', async () => {
    await buscar(`?q=${marca}`, tokens.estranho).expect(403);
  });

  it('CREDENCIADO leva 403: ler todo recurso privado não é enumerar atlas alheio', async () => {
    await buscar(`?q=${marca}`, tokens.credenciado).expect(403);
  });

  it('PRODUTOR leva 403: manter o acervo da OM não é administrar o sistema', async () => {
    await buscar(`?q=${marca}`, tokens.produtor).expect(403);
  });

  it('sem credencial é 401, não 403', async () => {
    await supertest(app).get(`/api/v1/atlas/admin/search?q=${marca}`).expect(401);
  });

});
