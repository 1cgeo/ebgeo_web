// Path: tests/integration/flexible-auth-precedence.test.js
//
// Itens 32, 33, 113 (+ 85 e 86) — as cegueiras de `middleware/flexible-auth.js`, todas com a
// mesma raiz: a suíte inteira exercitava o middleware através de `/api/v1/auth/me`, uma
// rota de `auth` ESTRITO. O estrito relê o Bearer sempre que `req.user` está vazio e
// reconcilia contra o banco, então ele MASCARA tudo o que o flexível faz de errado — é
// o padrão C3, o assert passa com e sem o comportamento. A divergência só aparece numa
// rota que tem apenas o flexível, e `GET /sv360/projects` é a família que é
// ao mesmo tempo anônima e sensível a `req.user` (o filtro de acesso embutido em
// `nomes.queries.js` recebe `$5 = req.user?.id`).
//
//   32 — a renovação deslizante re-assinava `req.user`, cujas claims de organização
//        vinham do TOKEN ANTIGO. Enquanto um cliente de cookie continuasse deslizando,
//        uma troca de organização NUNCA propagava: janela não de 15 min, mas infinita.
//        CORRIGIDO aqui: a renovação reconcilia `organization_id` contra o banco QUANDO
//        O TOKEN JÁ CARREGA a claim. Token legado (claim ausente) continua degradando
//        para null, que é o que auth-gaps auth-05 prende.
//        O BLOCO ENCOLHEU EM 2026-08-20 (D7): ele media DOIS eixos de organização, e o de
//        papel dentro dela (`org_role`) saiu do código inteiro. Os casos que mediam a
//        propagação daquele eixo viraram os casos que medem o SILÊNCIO dele — claim
//        legada que chega e não sobrevive à renovação —, porque a pergunta mudou de "a
//        demoção propaga?" para "o eixo morto some?".
//
//   33 — REFUTADO contra o HEAD. O relatório diz que uma conta desativada continuava
//        lendo nome privado por até ~10 min, porque nem o flexível nem o SQL checavam
//        `users.is_active`. O SQL passou a checar (`nomes.queries.js:50`,
//        `EXISTS (SELECT 1 FROM users WHERE id = $5 AND is_active = true)`). O furo está
//        fechado no lugar certo — a query, não o app —, mas nenhum teste o afirmava:
//        remover aquele EXISTS deixava a suíte inteira verde.
//
//  113 — dois curto-circuitos sem fallback: o ramo do api key fazia `return next()`
//        incondicional mesmo com chave lixo, e o ramo do token lê
//        `req.cookies?.token || extractBearerToken(req)` e, se o cookie falhar no
//        verify, faz `return next()` sem tentar o header. Numa rota
//        só-flexível o usuário é silenciosamente rebaixado a anônimo e perde acesso ao
//        PRÓPRIO dado privado.
//
//        A METADE DO API KEY FOI CORRIGIDA em 2026-07-25 (achado 85), e as três asserções
//        que a cobriam foram INVERTIDAS aqui: elas afirmavam `false` (o Bearer válido não
//        via o próprio nome privado) e portanto CONGELAVAM o defeito — um verde que só
//        provava que o rebaixamento continuava acontecendo, e que reprovaria o conserto.
//        "Caracterização" documenta um comportamento; não o torna correto, e o preço de
//        deixá-la no lugar é que a correção passa a parecer regressão. Hoje elas afirmam o
//        contrário: chave inválida é uma TENTATIVA fracassada, e o cookie/Bearer é lido
//        em seguida. A metade do COOKIE segue caracterizada (o caso `token=lixo` abaixo),
//        fora do escopo deste conserto e explicitamente marcada como tal.
//
//   86 — o mesmo `req.user` do flexível, agora pelo outro lado: o principal sintético
//        `public-<uuid>` do visitante de link público chegava ao cast `$5::uuid` da BUSCA e
//        o 22P02 virava 400, ou seja, uma credencial LEGÍTIMA quebrava uma rota que o
//        anônimo usa sem problema. Corrigido em `nomes.controller.js` (normalização do
//        principal), coberto no bloco 86 abaixo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAdminUser,
  createProducerUser,
  createAtlas,
  createMap,
  loginUser,
  makeAtlasPublic,
  getPublicToken,
} from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

const SFX = randomUUID().slice(0, 8);
// Nome único por execução: o gazetteer é global e outros arquivos semeiam nele.
const PRIVADO = `Base Flex ${SFX}`;
const PUBLICO = `Praca Flex ${SFX}`;

// Zona quadrada em torno de (-43.2, -22.9), igual à de nomes-access.test.js.

/** Reads the `token` value out of a Set-Cookie header (array or string). */
function tokenFromSetCookie(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  for (const c of Array.isArray(raw) ? raw : [raw]) {
    const m = /(?:^|;\s*)token=([^;]+)/.exec(c);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

describe('flexibleAuth — reconciliation and credential precedence (32, 33, 113, 85, 86)', () => {
  let app, db, zoneUser, zoneTok, admin;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    zoneUser = await createUser(db, { username: `fx_zone_${SFX}` });
    admin = await createAdminUser(db, { username: `fx_admin_${SFX}` });
    zoneTok = await loginUser(app, zoneUser.username, zoneUser.password);

    // O OBSERVÁVEL MUDOU EM 2026-08-19, e a troca é o que mantém este arquivo vivo.
    // Ele media precedência de credencial contando se um NOME PRIVADO do gazetteer
    // aparecia; o eixo de privacidade do gazetteer foi removido (era sistema antigo,
    // com API de admin e nenhuma tela), então aquele observável deixou de existir.
    //
    // O substituto precisa de duas propriedades, e um recurso de catálogo comum não
    // tem a primeira: a rota tem de ser SÓ FLEXÍVEL (para o anônimo receber 200 e não
    // 401, senão os casos de precedência medem o middleware errado) e o corpo tem de
    // VARIAR por principal. O 360 é a única família que tem as duas.
    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM Flex ${SFX}`, `omflex-${SFX}`, `F${SFX.slice(0, 4)}`]
    );
    const orgId = orgs[0].id;

    const { rows: priv } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'private', -22.9, -43.2, 0) RETURNING id`,
      [orgId, `flex-priv-${SFX}`, PRIVADO, `${orgId}__flex-priv-${SFX}.db`]
    );
    await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'public', -22.9, -43.2, 0)`,
      [orgId, `flex-pub-${SFX}`, PUBLICO, `${orgId}__flex-pub-${SFX}.db`]
    );

    // A concessão pessoal, que é o que o principal reconciliado precisa carregar.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('sv360_project', $1, $2, 'view', $3)`,
      [priv[0].id, zoneUser.id, admin.id]
    );
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** GET /sv360/projects com os headers que o chamador quiser (rota SÓ flexível). */
  function listar(headers = {}) {
    let req = supertest(app).get('/api/v1/sv360/projects');
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req;
  }

  /** true quando o projeto PRIVADO aparece na listagem. */
  async function vePrivado(headers) {
    const res = await listar(headers).expect(200);
    const lista = Array.isArray(res.body) ? res.body : (res.body.data ?? []);
    return lista.some((p) => p.name === PRIVADO);
  }

  // ==========================================================================
  // Linha de base — sem ela, todo "não vê o nome privado" abaixo seria vacuous
  // ==========================================================================
  describe('baseline: the fixture really is visible to the right principal', () => {
    it('the zone user sees the private name with a plain Bearer', async () => {
      assert.equal(await vePrivado({ Authorization: `Bearer ${zoneTok}` }), true);
    });

    it('an anonymous request sees the PUBLIC name but never the private one', async () => {
      const pub = await listar().expect(200);
      assert.ok((Array.isArray(pub.body) ? pub.body : pub.body.data).some((p) => p.name === PUBLICO), 'o gazetteer precisa responder de fato');
      assert.equal(await vePrivado({}), false);
    });
  });

  // ==========================================================================
  // 33 — conta desativada não pode continuar lendo nome PRIVADO na rota anônima
  // ==========================================================================
  describe('33 — a deactivated account loses the private gazetteer immediately', () => {
    let deadUser, deadTok;

    before(async () => {
      deadUser = await createUser(db, { username: `fx_dead_${SFX}` });
      deadTok = await loginUser(app, deadUser.username, deadUser.password);
      const { rows } = await db.query(
        `SELECT id FROM sv360.projects WHERE name = $1`, [PRIVADO]
      );
      await db.query(
        `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
         VALUES ('sv360_project', $1, $2, 'view', $3)`,
        [rows[0].id, deadUser.id, admin.id]
      );
    });

    it('baseline: while active, the account reads the private name', async () => {
      assert.equal(await vePrivado({ Authorization: `Bearer ${deadTok}` }), true);
    });

    it('after `UPDATE users SET is_active=false` the SAME token stops seeing it', async () => {
      // O token continua válido e não expirado; flexibleAuth NÃO reconcilia fora da
      // janela de renovação. Quem barra é o filtro de acesso EMBUTIDO na query.
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [deadUser.id]);
      assert.equal(await vePrivado({ Authorization: `Bearer ${deadTok}` }), false);
    });

    it('the deactivated token still resolves as a principal — the block comes from the SQL, not from a 401', async () => {
      // Se o middleware tivesse rejeitado o token, o teste acima passaria pelo motivo
      // errado. A rota responde 200 e devolve o nome PÚBLICO: o principal chegou ao
      // SQL, e foi o SQL que recusou o privado.
      const res = await listar({ Authorization: `Bearer ${deadTok}` }).expect(200);
      assert.ok((Array.isArray(res.body) ? res.body : res.body.data).some((p) => p.name === PUBLICO));
    });

    it('parity: the same token on a STRICT route is 401 (a divergência é por família de rota)', async () => {
      await supertest(app)
        .get('/api/v1/atlas')
        .set('Authorization', `Bearer ${deadTok}`)
        .expect(401);
    });

    it('control: reactivating restores the private read (não é over-blocking permanente)', async () => {
      await db.query('UPDATE users SET is_active = true WHERE id = $1', [deadUser.id]);
      assert.equal(await vePrivado({ Authorization: `Bearer ${deadTok}` }), true);
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [deadUser.id]);
    });

    it('an admin who is deactivated also loses the admin shortcut inside the query', async () => {
      // O ramo `role='admin'` do SQL tem o seu próprio `is_active = true`; sem ele um
      // admin desativado continuaria vendo TUDO, que é estritamente pior.
      const deadAdmin = await createAdminUser(db, { username: `fx_dadm_${SFX}` });
      const tok = await loginUser(app, deadAdmin.username, deadAdmin.password);
      assert.equal(await vePrivado({ Authorization: `Bearer ${tok}` }), true);
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [deadAdmin.id]);
      assert.equal(await vePrivado({ Authorization: `Bearer ${tok}` }), false);
    });
  });

  // ==========================================================================
  // 113 — precedência de credencial: cookie/api-key inválidos SUPRIMEM o Bearer
  // ==========================================================================
  describe('113 — credential precedence: an api key that fails must NOT suppress the Bearer', () => {
    it('control: só o Bearer -> o nome privado aparece', async () => {
      assert.equal(await vePrivado({ Authorization: `Bearer ${zoneTok}` }), true);
    });

    it('control: só o cookie válido -> o nome privado aparece', async () => {
      assert.equal(await vePrivado({ Cookie: `token=${zoneTok}` }), true);
    });

    it('AINDA CARACTERIZAÇÃO (metade do cookie, fora do escopo do achado 85): cookie LIXO + Bearer válido -> anônima', async () => {
      // `req.cookies?.token || extractBearerToken(req)` escolhe o cookie e, no catch do
      // verify, faz `return next()` sem fallback. Diferente do api key, este ramo NÃO é
      // acionável por link (cookie não viaja na query string), e o conserto é de outro lote.
      assert.equal(
        await vePrivado({ Cookie: 'token=lixo.jwt.valor', Authorization: `Bearer ${zoneTok}` }),
        false
      );
    });

    it('achado 85: x-api-key MALFORMADA + Bearer válido -> o Bearer vale, o privado aparece', async () => {
      // Antes: `if (apiKey) { ...; return next(); }` saía sem nunca ler cookie/Bearer.
      assert.equal(
        await vePrivado({ 'x-api-key': 'not-a-uuid', Authorization: `Bearer ${zoneTok}` }),
        true
      );
    });

    it('achado 85: x-api-key com FORMA de UUID mas INEXISTENTE -> o Bearer também vale', async () => {
      // O outro braço do mesmo curto-circuito: passa no UUID_RE, não acha linha em `users`.
      assert.equal(
        await vePrivado({ 'x-api-key': randomUUID(), Authorization: `Bearer ${zoneTok}` }),
        true
      );
    });

    it('achado 85: `?api_key=` na query (o vetor embutível em link) tem o mesmo fallback do header', async () => {
      // Este é o caso que importa: a chave lixo vem da URL, então bastava fazer a vítima
      // abrir um link para transformar a sessão dela em anônima.
      const res = await supertest(app)
        .get('/api/v1/sv360/projects')
        .query({ api_key: 'not-a-uuid' })
        .set('Authorization', `Bearer ${zoneTok}`)
        .expect(200);
      assert.ok((Array.isArray(res.body) ? res.body : res.body.data).some((p) => p.name === PRIVADO), 'o Bearer sobrevive à chave inválida');
    });

    it('não-super-corrigir: uma api key VÁLIDA continua ganhando do Bearer (a precedência não inverteu)', async () => {
      // O fallback só existe quando a chave falha. Se a chave resolve, ela é o principal —
      // sem esta asserção, "sempre ler o Bearer" passaria pelos três testes acima.
      const outro = await createUser(db, { username: `fx_key_${SFX}` });
      const key = randomUUID();
      await db.query('UPDATE users SET api_key = $1 WHERE id = $2', [key, outro.id]);

      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('x-api-key', key)
        .set('Authorization', `Bearer ${zoneTok}`)
        .expect(200);
      assert.equal(res.body.data.id, outro.id, 'a chave que RESOLVE é quem autentica');
      assert.notEqual(res.body.data.id, zoneUser.id);
    });

    it('a chave válida também não perde para o cookie, e o principal do api key chega ao SQL', async () => {
      // Fecha o outro lado: a chave resolvida não pode cair no ramo cookie/Bearer, e o
      // `req.user` que ela produz precisa continuar servindo o filtro de acesso do gazetteer
      // (o usuário da zona vê o próprio nome privado autenticando SÓ por chave).
      const key = randomUUID();
      await db.query('UPDATE users SET api_key = $1 WHERE id = $2', [key, zoneUser.id]);
      assert.equal(await vePrivado({ 'x-api-key': key }), true);
    });

    it('contraste: as MESMAS três combinações em /auth/me respondem 200', async () => {
      // O `auth` estrito relê o Bearer quando req.user está vazio, então a divergência é
      // por FAMÍLIA DE ROTA, não por credencial. É exatamente isto que impedia a suíte
      // atual (que testa tudo em /auth/me) de enxergar o problema.
      for (const headers of [
        { Cookie: 'token=lixo.jwt.valor', Authorization: `Bearer ${zoneTok}` },
        { 'x-api-key': 'not-a-uuid', Authorization: `Bearer ${zoneTok}` },
        { Authorization: `Bearer ${zoneTok}` },
      ]) {
        let req = supertest(app).get('/api/v1/auth/me');
        for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
        const res = await req;
        assert.equal(res.status, 200, `combinação ${JSON.stringify(headers)} deveria autenticar`);
        assert.equal(res.body.data.id, zoneUser.id);
      }
    });

    it('sem NENHUMA credencial /auth/me é 401 (o 200 acima vem do Bearer, não de um gate aberto)', async () => {
      await supertest(app).get('/api/v1/auth/me').expect(401);
    });
  });

  // ==========================================================================
  // 86 — o principal sintético `public-<uuid>` não pode chegar a um cast ::uuid
  //
  // `flexibleAuth` grava `req.user = mapPayload(payload)` para QUALQUER token válido,
  // inclusive o de visitante de link público, cujo `sub` é `public-<uuid>` por decisão.
  // as rotas de leitura do 360 são as que são ao mesmo tempo anônimas e sensíveis
  // a `req.user` (o filtro de acesso embutido recebe `$5 = req.user?.id`), então o sub
  // sintético alcançava `$5::uuid`, o Postgres levantava 22P02 e o errorHandler devolvia
  // 400. A inversão é o que denuncia o defeito: SEM credencial nenhuma dava 200, e uma
  // credencial LEGÍTIMA dava 400. A irmã `/feicoes` para antes, no 403
  // do confineVisitorPrincipal (`auth` estrito), e por isso o furo vivia só aqui.
  // ==========================================================================
  describe('86 — a public-link visitor token is anonymous to the gazetteer, never a 400', () => {
    let publicToken;

    before(async () => {
      const atlas = await createAtlas(db, zoneUser.id, { name: `Atlas Flex ${SFX}` });
      await createMap(db, atlas.id);
      const link = await makeAtlasPublic(db, atlas.id);
      publicToken = await getPublicToken(app, link);
      assert.ok(
        jwt.decode(publicToken).sub.startsWith('public-'),
        'o fixture precisa de fato emitir o principal sintético, senão o teste é vacuous'
      );
    });

    it('a leitura flexível com o token público responde 200 (era 400 por 22P02)', async () => {
      const res = await listar({ Authorization: `Bearer ${publicToken}` }).expect(200);
      assert.ok((Array.isArray(res.body) ? res.body : res.body.data).some((p) => p.name === PUBLICO));
    });

    it('e devolve exatamente o mesmo conjunto do anônimo — nem menos, nem o privado', async () => {
      const anon = await listar().expect(200);
      const visitante = await listar({ Authorization: `Bearer ${publicToken}` }).expect(200);
      assert.deepEqual(
        visitante.body.map((r) => r.nome),
        anon.body.map((r) => r.nome),
        'o visitante é equivalente a anônimo, não um principal reduzido'
      );
      assert.equal(await vePrivado({ Authorization: `Bearer ${publicToken}` }), false);
    });

    it('não-super-corrigir: um Bearer de usuário REAL continua chegando ao filtro de acesso', async () => {
      // Normalizar demais (mandar sempre null) também daria 200 nos dois testes acima,
      // enquanto arrancava o acesso privado de todo mundo. Este é o controle que separa
      // "normalizei o principal sintético" de "apaguei o principal".
      assert.equal(await vePrivado({ Authorization: `Bearer ${zoneTok}` }), true);
    });
  });

  // ==========================================================================
  // 32 — a renovação deslizante reconcilia organization_id
  // ==========================================================================
  describe('32 — the sliding renewal propagates an org demotion', () => {
    /**
     * Mints a token 4 minutes from expiry (inside SLIDING_THRESHOLD_MS) carrying the
     * given org claims, so the very next request triggers the re-mint.
     */
    function nearExpiryToken(user, claims) {
      return jwt.sign(
        { sub: user.id, username: user.username, role: 'user', ...claims },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '4m' }
      );
    }

    /** Drives one renewal through /auth/me and returns the decoded renewed token. */
    async function renew(token) {
      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Cookie', `token=${token}`)
        .expect(200);
      const renewed = tokenFromSetCookie(res);
      assert.ok(renewed, 'a near-expiry token must be re-minted');
      return jwt.verify(renewed, JWT_SECRET, { algorithms: ['HS256'] });
    }

    it('uma claim LEGADA de papel dentro da OM não sobrevive à renovação', async () => {
      // ESTE CASO MEDIA A PROPAGAÇÃO DE `org_role` e passou a medir o silêncio dele. O
      // eixo saiu do banco e do emissor em 2026-08-20 (D7); o que não sai de circulação
      // é o token já assinado, que continua chegando com a claim por até 15 min (e por
      // muito mais, num cookie que desliza). A regra é ignorar o desconhecido: a claim
      // entra, não vira campo de `req.user`, e o token re-emitido nasce sem ela.
      const u = await createUser(db, { username: `fx_dem_${SFX}` });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, u.id]);

      // Sanity: o token nasce COM a claim, senão o assert final seria trivial.
      const stale = nearExpiryToken(u, { organization_id: DEFAULT_ORG, org_role: 'editor' });
      assert.equal(jwt.decode(stale).org_role, 'editor');

      const decoded = await renew(stale);
      assert.equal(decoded.org_role, undefined, 'a claim morta não pode ser re-emitida');
      // DISCRIMINAÇÃO: a renovação não parou de carregar organização. Sem esta linha, um
      // re-emissor quebrado (que perdesse TODAS as claims de org) passaria verde acima.
      assert.equal(decoded.organization_id, DEFAULT_ORG);
      assert.equal(decoded.sub, u.id);
    });

    it('consequência observável: revogar o CRACHÁ DE PRODUÇÃO fecha o upload sv360', async () => {
      // ESTE CASO FOI INVERTIDO NESTA FASE, e a inversão é o produto dela. Ele dizia
      // "um editor tem de passar da capability": um `org_role: 'editor'` sobre uma
      // LOTAÇÃO auto-declarada no auto-cadastro abria a ingestão de 360 daquela OM.
      // Era a escalação de privilégio que a fase fecha, e a asserção que a chamava de
      // contrato. Quem abre o upload agora é `producer_org_id`, concedido por
      // administrador; o que continua sendo medido aqui é o MESMO fato observável —
      // que a revogação vale na requisição seguinte, sem esperar o token expirar.
      const u = await createProducerUser(db, DEFAULT_ORG, { username: `fx_up_${SFX}` });
      const stale = nearExpiryToken(u, {
        organization_id: DEFAULT_ORG, producer_org_id: DEFAULT_ORG,
      });

      // Enquanto produtor: passa do requireUploadCapability (o 4xx que vem depois é do
      // multer/serviço, não do gate — o que importa é NÃO ser 403).
      // O TOKEN VAI NO CABEÇALHO, E NÃO NO COOKIE, desde 2026-08-29: o `auth` estrito
      // recusa principal vindo de cookie nos métodos que ESCREVEM, porque cookie é
      // ambiente do navegador e portanto postável cross-site. O sujeito deste caso é a
      // reconciliação viva do papel, que vale igual nas duas origens; medir por cookie
      // aqui daria 401 pelo transporte e esconderia o 403 que se quer ver.
      const antes = await supertest(app)
        .post('/api/v1/sv360/admin/projects/upload')
        .set('Authorization', `Bearer ${stale}`);
      assert.notEqual(antes.status, 403, 'um produtor tem de passar da capability');

      await db.query(
        `UPDATE users SET role = 'user', producer_org_id = NULL WHERE id = $1`, [u.id]
      );

      const depois = await supertest(app)
        .post('/api/v1/sv360/admin/projects/upload')
        .set('Authorization', `Bearer ${stale}`)
        .expect(403);
      assert.equal(depois.body.error?.code ?? 'FORBIDDEN', 'FORBIDDEN');
    });

    it('e o LOTADO com a claim legada `org_role: editor` NÃO abre o upload (o furo, escrito ao contrário)', async () => {
      // O par negativo do caso acima, e o repro em miniatura da fase: esta conta se
      // declarou desta OM no cadastro e carregava o papel interno mais alto que a borda
      // de escrita de perfil aceitava. Antes, isso bastava para ingerir 360 no acervo
      // dela; hoje ela é indistinguível de qualquer visitante autenticado.
      //
      // A CLAIM CONTINUA NO TOKEN DE PROPÓSITO, agora forjada (o emissor não a escreve
      // mais desde D7): o caso mede que nem uma claim legada, nem uma inventada, abre a
      // porta. Um token já sem ela mediria a ausência do campo, não a indiferença a ele.
      const u = await createUser(db, { username: `fx_lot_${SFX}` });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, u.id]);
      const tok = nearExpiryToken(u, { organization_id: DEFAULT_ORG, org_role: 'editor' });

      await supertest(app)
        .post('/api/v1/sv360/admin/projects/upload')
        .set('Authorization', `Bearer ${tok}`)
        .expect(403);
    });

    it('controle positivo (não super-corrigir): GANHAR uma lotação também propaga', async () => {
      // A reconciliação tem de valer nas duas direções. Este caso media a promoção no
      // eixo `org_role` (removido em D7) e passou a medir a direção que sobrou e que a
      // troca de OM abaixo não cobre: sair de "sem lotação" para uma OM. Um ramo que só
      // aceitasse valor não-nulo vindo do token passaria no caso de troca e falharia aqui.
      const u = await createUser(db, { username: `fx_pro_${SFX}` });
      await db.query(`UPDATE users SET organization_id = NULL WHERE id = $1`, [u.id]);
      const stale = nearExpiryToken(u, { organization_id: null });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, u.id]);

      const decoded = await renew(stale);
      assert.equal(decoded.organization_id, DEFAULT_ORG);
      assert.equal(decoded.org, DEFAULT_ORG, 'o alias congelado acompanha a promoção');
    });

    it('a mudança de organização também propaga (organization_id e o alias org)', async () => {
      const u = await createUser(db, { username: `fx_org_${SFX}` });
      const { rows } = await db.query(
        `INSERT INTO organizations (nome, sigla, slug, is_active) VALUES ($1, $2, $3, true) RETURNING id`,
        [`Org Flex ${SFX}`, `OF${SFX.slice(0, 4)}`, `org-flex-${SFX}`]
      );
      const novaOrg = rows[0].id;
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, u.id]);
      const stale = nearExpiryToken(u, { organization_id: DEFAULT_ORG });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [novaOrg, u.id]);

      const decoded = await renew(stale);
      assert.equal(decoded.organization_id, novaOrg);
      assert.equal(decoded.org, novaOrg, 'o alias congelado do ebgeo_360 acompanha');
    });

    it('NÃO-REGRESSÃO de auth-gaps auth-05: token LEGADO continua degradando para null', async () => {
      // A distinção que o fix introduz: claim AUSENTE degrada (mapeamento), claim
      // PRESENTE reconcilia (banco). Sem esta separação, "reconciliar sempre"
      // promoveria o token legado e quebraria a regra de degradação.
      const u = await createUser(db, { username: `fx_leg_${SFX}` });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, u.id]);
      const legacy = nearExpiryToken(u, {}); // sem organization_id

      const decoded = await renew(legacy);
      assert.equal(decoded.organization_id, null);
      assert.equal(decoded.org, null);
    });

    it('e o legado que traz SÓ `org_role` também degrada: a condição perdeu esse disjunto', async () => {
      // O CASO QUE A REMOÇÃO DE D7 EXIGIU, e ele é a razão de a poda não ser cosmética.
      // A condição de reconciliação era `org_role !== undefined || organization_id !==
      // undefined`. Com o primeiro disjunto de pé, um token legado que carregasse apenas
      // a claim morta entraria no ramo e faria a LOTAÇÃO ser promovida do banco — o
      // oposto exato do que auth-05 prende, e por um campo que nem existe mais. Deixar o
      // disjunto seria "não mexer no que funciona" produzindo um furo novo.
      const u = await createUser(db, { username: `fx_leg2_${SFX}` });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, u.id]);
      const legacy = nearExpiryToken(u, { org_role: 'owner' }); // a claim morta, e só ela

      const decoded = await renew(legacy);
      assert.equal(decoded.organization_id, null, 'a lotação continua degradando, não é promovida');
      assert.equal(decoded.org, null);
      assert.equal(decoded.org_role, undefined, 'e a claim morta não é re-emitida');
    });

    it('a demoção do papel GLOBAL continua propagando (o fix não desfez o P1 anterior)', async () => {
      const u = await createAdminUser(db, { username: `fx_glb_${SFX}` });
      const stale = jwt.sign(
        { sub: u.id, username: u.username, role: 'admin', organization_id: DEFAULT_ORG },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '4m' }
      );
      await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [u.id]);

      const decoded = await renew(stale);
      assert.equal(decoded.role, 'user');
    });
  });
});
