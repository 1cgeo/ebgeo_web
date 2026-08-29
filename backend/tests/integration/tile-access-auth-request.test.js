// Path: tests/integration/tile-access-auth-request.test.js
//
// O ENDPOINT DE `auth_request` DO NGINX PARA AS ROTAS DO MARTIN (cláusula 10.7).
//
// O QUE ESTE ARQUIVO MEDE. Ele mede os QUATRO desfechos do gate: caminho que nenhuma
// linha de catálogo reivindica (401), linha pública (200 sem credencial nenhuma), linha
// privada sem credencial (401) e linha privada com credencial, que passa pelo mesmo
// `fn_can_see_resource` do resto do acervo.
//
// O TETO DESTE ARQUIVO MUDOU EM 2026-08-29, e o cabeçalho anterior está registrado aqui
// porque a diferença é o assunto: até aquela data o gate respondia sobre a CREDENCIAL e
// nunca sobre a CAMADA, e este arquivo declarava não medir privacidade por recurso
// porque ela não existia. Agora existe (secção (f) de PENDENCIA-TILE-PRIVADO.md), e a
// maior parte dos casos abaixo continua sendo sobre a credencial por uma razão de
// desenho: eles rodam contra uma camada privada que o principal ALCANÇA por concessão,
// de modo que o que decide o desfecho continua sendo a chave. Medir credencial contra
// uma camada pública seria vácuo, porque ali a credencial não é consultada.
//
// ELE CONTINUA NÃO MEDINDO NADA SOBRE O NGINX: que o servidor de produção de fato faça a
// subrequisição, e a faça com o cabeçalho do caminho, é sonda com data rodada à mão no
// deploy, pela mesma razão que a 10.1 registra.
//
// A ARMADILHA DESTA MEDIÇÃO, e ela é específica. Quase toda recusa aqui nasce de um
// termo de `FIND_USER_BY_API_KEY` (prazo, revogação, conta ativa, OM ativa, corte de
// sessão): a chave não resolve, `flexibleAuth` deixa o pedido anônimo, e o gate desta
// rota recusa. Ou seja, os desfechos são o MESMO 401, e um caso poderia estar passando
// pelo motivo errado sem nada acusar. Foi exatamente isso que já aconteceu uma vez
// noutro lote: um caso de conta desativada media por rota de `auth` ESTRITO, onde o 401
// vem da reconciliação viva do middleware e não do predicado da chave — apagar o termo
// da consulta deixava a rodada inteira verde.
//
// AS DUAS DEFESAS, e as duas são necessárias:
//
//   1. ESTA ROTA NÃO TEM `auth` ESTRITO. Ela é só-`flexibleAuth` por decisão (o estrito
//      recusa a chave de escopo `tiles`), então não existe reconciliação viva no
//      caminho para produzir um 401 por outro motivo. É o oposto do caso citado acima.
//   2. TODO NEGATIVO VEM COM O PAR SOBRE A MESMA LINHA, e com um CONTROLE que roda o
//      predicado SEM o termo acusado e exige que a linha seja encontrada. O par prova
//      que só aquela coluna decide (a mesma chave passa quando ela vira); o controle
//      prova que a fixture não se desfez, que a conta existe e que "não achou" não está
//      sendo lido como "recusou".
//
// O motivo da recusa também sai em `X-EBGeo-Tile-Denial`, e ele é asserido: sem isso,
// "escopo que não alcança" e "chave que não resolve" seriam o mesmo 401.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';
import { installPoolQueryCounter } from '../helpers/query-counter.js';
import { TILE_ACCESS_DENIAL } from '../../src/modules/auth/tile-access.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';

const SFX = randomUUID().slice(0, 8);
const ROTA = '/api/v1/auth/tile-access';

describe('tile-access: o `auth_request` do nginx para as rotas do Martin', () => {
  let app, db;
  let dono, donoToken;
  let orgId, lotado, estranho;

  // AS FIXTURES DE CATÁLOGO. O gate resolve o caminho contra o índice, então sem linha de
  // catálogo TODO caminho é "não reivindicado" e todo caso responderia 401 pelo motivo
  // errado — verde por vacuidade no lado negativo e vermelho inexplicável no positivo.
  const fontePrivada = `fonte-priv-${SFX}`;
  const fontePublica = `fonte-pub-${SFX}`;
  const caminhoPrivado = `/tiles/${fontePrivada}/10/385/577`;
  const caminhoPublico = `/tiles/${fontePublica}/10/385/577`;
  const idPrivado = `t-auth-priv-${SFX}`;
  const idPublico = `t-auth-pub-${SFX}`;

  /**
   * O pedido do nginx: a chave viaja na QUERY (como o MapLibre a carrega) e o caminho
   * pedido no cabeçalho `X-Original-URI`, que é o que o `location` do host repassa.
   *
   * O CAMINHO PADRÃO É O DA CAMADA PRIVADA que o `dono` ALCANÇA por concessão, e essa
   * escolha é o que mantém os casos de credencial honestos: contra uma camada pública o
   * gate nem consulta a credencial (decisão 5), então todo caso negativo passaria por
   * vacuidade.
   */
  const pedir = (chave, caminho = caminhoPrivado) => {
    const url = chave === undefined ? ROTA : `${ROTA}?api_key=${chave}`;
    return supertest(app).get(url).set('X-Original-URI', caminho);
  };

  /**
   * Insere uma chave nomeada direto no banco.
   *
   * DIRETO, e não pela rota de emissão, porque cada caso negativo precisa controlar UMA
   * coluna e só ela (prazo, revogação, escopo). A rota de emissão é exercida à parte,
   * num caso próprio, para que a cadeia inteira também fique medida.
   */
  async function inserirChave(userId, { scope = 'tiles', vencida = false, revogada = false } = {}) {
    const chave = randomUUID();
    const { rows } = await db.query(
      `INSERT INTO api_keys (user_id, api_key, label, scope, created_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4,
               CASE WHEN $5 THEN NOW() - INTERVAL '2 days' ELSE NOW() END,
               CASE WHEN $5 THEN NOW() - INTERVAL '1 day' ELSE NOW() + INTERVAL '30 days' END,
               CASE WHEN $6 THEN NOW() ELSE NULL END)
       RETURNING id`,
      [userId, chave, `tile ${SFX}`, scope, vencida, revogada]
    );
    return { id: rows[0].id, apiKey: chave };
  }

  /**
   * O CONTROLE DE CADA TERMO: o predicado de autenticação SEM a cláusula acusada.
   *
   * Se ele achar a linha, "não achou" está descartado e a recusa é do termo. Se ele NÃO
   * achar, o caso negativo estaria passando por acidente, e é isso que este helper
   * existe para tornar impossível.
   */
  const acharSemTermo = async (chave, sql, params = []) => (await db.query(sql, [chave, ...params])).rows;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `tile_dono_${SFX}` });
    donoToken = await loginUser(app, dono.username, dono.password);

    const { rows } = await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM tile ${SFX}`, `om-tile-${SFX}`, `OMT${SFX.slice(0, 3)}`]
    );
    orgId = rows[0].id;
    lotado = await createUser(db, { username: `tile_lotado_${SFX}`, organization_id: orgId });
    // Um terceiro, SEM concessão nenhuma: ele é o par negativo do predicado de recurso, e
    // precisa ser uma conta própria porque as outras duas alcançam a camada de propósito.
    estranho = await createUser(db, { username: `tile_estranho_${SFX}` });

    // Uma linha PRIVADA e uma PÚBLICA, endereçando fontes sob o prefixo de tiles.
    for (const [id, fonte, nivel] of [[idPrivado, fontePrivada, 'private'], [idPublico, fontePublica, 'public']]) {
      await db.query(
        `INSERT INTO data_layers (id, name, access_level, config)
         VALUES ($1, $2, $3, jsonb_build_object('source', jsonb_build_object('url', $4::text, 'type', 'vector')))`,
        [id, `Camada ${id}`, nivel, `/tiles/${fonte}`]
      );
    }
    // O `dono` ALCANÇA a privada por concessão. Sem isto, todo caso de credencial abaixo
    // responderia 401 por não alcançar o recurso, e o arnês de termos mediria outra coisa.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('data_layer', $1, $2, 'view', $2)`,
      [idPrivado, dono.id]
    );
    // E o `lotado` também, pela mesma razão: o caso da OM inativa usa a chave DELE, e o par
    // positivo (com a OM ativa, a chave abre) mediria "não alcança o recurso" em vez de
    // "a OM está ativa" se ele não tivesse acesso à camada.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('data_layer', $1, $2, 'view', $3)`,
      [idPrivado, lotado.id, dono.id]
    );
    // O índice é memoizado; sem invalidar, ele foi construído antes destas linhas.
    invalidateAppConfigCache();
  });

  after(async () => {
    await db.query('DELETE FROM api_keys WHERE user_id = ANY($1::uuid[])', [[dono.id, lotado.id, estranho.id]]);
    await db.query('DELETE FROM audit_trail WHERE actor_id = ANY($1::uuid[])', [[dono.id, lotado.id, estranho.id]]);
    // AS CONCESSÕES ANTES DOS USUÁRIOS: `resource_grants.grantee_id` e `granted_by` são FK
    // sem `ON DELETE`, então apagar a conta primeiro derruba a limpeza inteira com uma
    // violação de chave estrangeira no `after` — que aparece como o describe PAI vermelho
    // com todos os casos verdes, e não se parece nada com o assunto do arquivo.
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[idPrivado, idPublico]]);
    await db.query('DELETE FROM data_layers WHERE id = ANY($1::text[])', [[idPrivado, idPublico]]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[dono.id, lotado.id, estranho.id]]);
    await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await teardownTestEnv(db);
  });

  // =========================================================================
  // O SIM
  // =========================================================================
  describe('o SIM: chave viva de escopo que alcança tile', () => {
    it('a chave de escopo `tiles` responde 200, e SEM CORPO', async () => {
      const chave = await inserirChave(dono.id, { scope: 'tiles' });
      const res = await pedir(chave.apiKey);

      assert.equal(res.status, 200);
      // O corpo vazio não é detalhe de estilo: o `auth_request` do nginx descarta o
      // corpo e só olha o status, então qualquer byte aqui é banda gasta POR TILE.
      assert.equal(res.text, '', 'a resposta precisa sair sem corpo');
      assert.equal(res.headers['content-type'], undefined, 'e sem Content-Type de payload');
    });

    it('DISCRIMINAÇÃO: essa MESMA chave é recusada na rota estrita, com 403', async () => {
      // Sem este par, "esta rota aceita a chave de tile" seria indistinguível de "todas
      // aceitam", e a razão de a rota ser só-flexível ficaria sem prova. 403 (e não 401)
      // diz que lá a chave RESOLVEU e o escopo a barrou, que é a amarra 2 de pé.
      const chave = await inserirChave(dono.id, { scope: 'tiles' });
      const estrita = await supertest(app).get('/api/v1/auth/me').set('x-api-key', chave.apiKey);
      assert.equal(estrita.status, 403, 'a rota estrita recusa a chave de tile');

      const aqui = await pedir(chave.apiKey);
      assert.equal(aqui.status, 200, 'e esta rota, que existe para ela, aceita');
    });

    it('o escopo `full` também alcança o tile: o vocabulário inteiro passa', async () => {
      // A tabela de alcance declara que as superfícies SÓ-FLEXÍVEIS são alcançadas por
      // toda chave que resolve. Sem este caso, o gate poderia estar comparando por
      // igualdade com `tiles` e ninguém saberia até um integrador reclamar.
      const chave = await inserirChave(dono.id, { scope: 'full' });
      const res = await pedir(chave.apiKey);
      assert.equal(res.status, 200);
    });

    it('o SLOT LEGADO (`users.api_key`) também abre o tile', async () => {
      const rot = await supertest(app)
        .post('/api/v1/users/me/api-key/rotate')
        .set('Authorization', `Bearer ${donoToken}`)
        .expect(200);
      const res = await pedir(rot.body.data.apiKey);
      assert.equal(res.status, 200, 'a chave que os integradores carregam hoje precisa continuar valendo');
    });

    it('a chave EMITIDA pela rota de auto-serviço abre o tile: a cadeia inteira fecha', async () => {
      const emissao = await supertest(app)
        .post('/api/v1/users/me/api-keys')
        .set('Authorization', `Bearer ${donoToken}`)
        .send({ label: `emitida ${SFX}`, scope: 'tiles' })
        .expect(201);

      const res = await pedir(emissao.body.data.apiKey);
      assert.equal(res.status, 200);
    });
  });

  // =========================================================================
  // O NÃO, um termo por caso
  // =========================================================================
  describe('o NÃO: cada recusa pelo termo que se acha que ela vem', () => {
    it('SEM credencial nenhuma: 401, e o motivo é `sem-credencial`', async () => {
      const res = await pedir(undefined);
      assert.equal(res.status, 401);
      assert.equal(res.text, '', 'o NÃO também sai sem corpo');
      assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CREDENCIAL);
    });

    it('SEM o cabeçalho do caminho: 401, e o motivo é o do CATÁLOGO', async () => {
      // Um nginx configurado sem `X-Original-URI` não pode receber "sim" para todo
      // caminho, que seria falha aberta operada por esquecimento de configuração. O motivo
      // é `caminho-nao-reivindicado` de propósito: do ponto de vista do gate, um pedido
      // sem caminho é indistinguível de um caminho que ninguém reivindica, e inventar um
      // terceiro motivo faria o log do host sugerir um problema de credencial.
      const res = await supertest(app).get(ROTA);
      assert.equal(res.status, 401);
      assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.CAMINHO_NAO_REIVINDICADO);
    });

    it('caminho que NENHUMA linha reivindica: 401, mesmo com credencial boa', async () => {
      // A decisão 4, e o par que a torna uma afirmação: a MESMA credencial que abre a
      // camada cadastrada é recusada num caminho que o catálogo não descreve.
      const chave = await inserirChave(dono.id);
      const orfa = await pedir(chave.apiKey, `/tiles/fonte-que-ninguem-cadastrou-${SFX}/1/2/3`);
      assert.equal(orfa.status, 401);
      assert.equal(orfa.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.CAMINHO_NAO_REIVINDICADO);

      const conhecida = await pedir(chave.apiKey);
      assert.equal(conhecida.status, 200, 'a mesma chave abre a camada que ESTÁ no catálogo');
    });

    it('a linha PÚBLICA abre sem credencial nenhuma — decisão 5', async () => {
      // É o passo que devolve o produto: o visitante anônimo volta a ver camada de dados.
      const res = await supertest(app).get(ROTA).set('X-Original-URI', caminhoPublico);
      assert.equal(res.status, 200);
      assert.equal(res.text, '');
    });

    it('chave VENCIDA: 401, e a MESMA linha passa quando o prazo volta', async () => {
      const chave = await inserirChave(dono.id, { vencida: true });

      const vencida = await pedir(chave.apiKey);
      assert.equal(vencida.status, 401);
      assert.equal(vencida.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CREDENCIAL);

      // CONTROLE DO TERMO: o predicado sem `expires_at > NOW()` acha a linha. Logo a
      // recusa é do prazo, e não de a chave não existir ou de a conta ter sumido.
      const semPrazo = await acharSemTermo(
        chave.apiKey,
        'SELECT id FROM api_keys WHERE api_key = $1 AND revoked_at IS NULL'
      );
      assert.equal(semPrazo.length, 1, 'a linha existe e não está revogada: só o prazo a exclui');

      // O PAR SOBRE A MESMA LINHA.
      await db.query(
        `UPDATE api_keys SET created_at = NOW(), expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
        [chave.id]
      );
      const viva = await pedir(chave.apiKey);
      assert.equal(viva.status, 200, 'restaurado o prazo, a MESMA chave abre o tile');
    });

    it('chave REVOGADA: 401, e a MESMA linha passa quando a revogação sai', async () => {
      const chave = await inserirChave(dono.id, { revogada: true });

      const revogada = await pedir(chave.apiKey);
      assert.equal(revogada.status, 401);
      assert.equal(revogada.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CREDENCIAL);

      // CONTROLE DO TERMO: sem `revoked_at IS NULL` a linha aparece, viva e no prazo.
      const semRevogacao = await acharSemTermo(
        chave.apiKey,
        'SELECT id FROM api_keys WHERE api_key = $1 AND expires_at > NOW()'
      );
      assert.equal(semRevogacao.length, 1, 'a linha existe e está no prazo: só a revogação a exclui');

      await db.query('UPDATE api_keys SET revoked_at = NULL WHERE id = $1', [chave.id]);
      const viva = await pedir(chave.apiKey);
      assert.equal(viva.status, 200, 'desfeita a revogação, a MESMA chave abre o tile');
    });

    it('chave de conta DESATIVADA: 401, e a MESMA chave passa quando a conta volta', async () => {
      const chave = await inserirChave(dono.id);
      const antes = await pedir(chave.apiKey);
      assert.equal(antes.status, 200, 'com a conta ativa, a chave abre o tile');

      await db.query('UPDATE users SET is_active = false WHERE id = $1', [dono.id]);
      const depois = await pedir(chave.apiKey);
      assert.equal(depois.status, 401);
      assert.equal(depois.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CREDENCIAL);

      // CONTROLE DO TERMO: a chave continua viva, no prazo e não revogada; quem a exclui
      // é `u.is_active = true` do JOIN, e não um gate de sessão — esta rota não tem `auth`
      // estrito, então a reconciliação viva não roda aqui.
      const semConta = await acharSemTermo(
        chave.apiKey,
        'SELECT id FROM api_keys WHERE api_key = $1 AND revoked_at IS NULL AND expires_at > NOW()'
      );
      assert.equal(semConta.length, 1, 'a chave está viva: quem recusa é a conta');

      await db.query('UPDATE users SET is_active = true WHERE id = $1', [dono.id]);
      const devolta = await pedir(chave.apiKey);
      assert.equal(devolta.status, 200, 'reativada a conta, a MESMA chave abre o tile');
    });

    it('chave de OM INATIVA: 401, e a MESMA chave passa quando a OM volta', async () => {
      const chave = await inserirChave(lotado.id);
      const antes = await pedir(chave.apiKey);
      assert.equal(antes.status, 200, 'com a OM ativa, a chave abre o tile');

      await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgId]);
      const depois = await pedir(chave.apiKey);
      assert.equal(depois.status, 401);
      assert.equal(depois.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CREDENCIAL);

      // CONTROLE DO TERMO: a conta segue ativa e a chave viva; quem exclui é o
      // `COALESCE(o.is_active, true)` que viaja dentro de `FIND_USER_BY_API_KEY`.
      const semOm = await acharSemTermo(
        chave.apiKey,
        `SELECT k.id FROM api_keys k JOIN users u ON u.id = k.user_id
          WHERE k.api_key = $1 AND k.revoked_at IS NULL AND k.expires_at > NOW() AND u.is_active = true`
      );
      assert.equal(semOm.length, 1, 'a chave está viva e a conta ativa: quem recusa é a OM');

      await db.query('UPDATE organizations SET is_active = true WHERE id = $1', [orgId]);
      const devolta = await pedir(chave.apiKey);
      assert.equal(devolta.status, 200, 'reativada a OM, a MESMA chave abre o tile');
    });

    it('a sessão JWT TAMBÉM é credencial válida aqui — e isso INVERTEU em 2026-08-29', async () => {
      // O caso anterior afirmava o oposto: que uma sessão JWT chegando aqui NÃO podia
      // passar, porque a rota validava a credencial que o TILE carrega e "o MapLibre não
      // põe cabeçalho num pedido de tile". As duas metades caíram. A segunda era falsa
      // (`transformRequest` é consultado no `loadTile`, e o valor transformado É o pedido
      // de rede), e a primeira deixou de ser desejável: a decisão 3 tira a chave de API do
      // caminho do navegador justamente porque ela é portadora e aparece no log de acesso,
      // e põe no lugar o token de sessão. Recusar o JWT aqui manteria a chave como único
      // transporte possível.
      const res = await supertest(app).get(ROTA)
        .set('X-Original-URI', caminhoPrivado)
        .set('Authorization', `Bearer ${donoToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.text, '', 'o SIM continua sem corpo');
    });

    it('a sessão de quem NÃO alcança o recurso é recusada, e pelo termo do RECURSO', async () => {
      // O par do caso acima, e ele é o que impede a leitura "JWT abre tudo": o mesmo tipo
      // de credencial, sobre a MESMA camada, recusado porque o principal não a alcança. Sem
      // este caso, aceitar o JWT teria trocado um buraco por outro.
      const outroToken = await loginUser(app, estranho.username, estranho.password);
      const res = await supertest(app).get(ROTA)
        .set('X-Original-URI', caminhoPrivado)
        .set('Authorization', `Bearer ${outroToken}`);
      assert.equal(res.status, 401);
      assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.RECURSO_NAO_ALCANCADO);
    });
  });

  // =========================================================================
  // O CUSTO POR TILE
  // =========================================================================
  describe('o custo: é uma subrequisição POR TILE', () => {
    it('LIXO na query não consulta o banco: zero statements', async () => {
      const contador = installPoolQueryCounter();
      try {
        contador.reset();
        const res = await pedir('nao-e-um-uuid');
        assert.equal(res.status, 401);
        assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CREDENCIAL);
        assert.equal(
          contador.state.count, 0,
          `a peneira de UUID de flexibleAuth precisa devolver o passante ANTES do banco; `
          + `statements: ${contador.state.statements.join(' | ')}`
        );
      } finally {
        contador.restore();
      }
    });

    it('a chave viva custa UMA consulta, e o handler não faz I/O nenhum', async () => {
      // O NÚMERO É O ASSUNTO DESTE CASO, não um detalhe: são milhares de tiles por
      // sessão, e uma consulta a mais aqui multiplica por esse fator. Sem este caso, um
      // gate futuro que resolvesse o recurso entraria sem nada acusar.
      const chave = await inserirChave(dono.id);
      const contador = installPoolQueryCounter();
      try {
        contador.reset();
        const res = await pedir(chave.apiKey);
        assert.equal(res.status, 200);
        assert.equal(
          contador.state.count, 1,
          `esperava UMA consulta (a de flexibleAuth); statements: ${contador.state.statements.join(' | ')}`
        );
        // O contador guarda os 70 primeiros caracteres do statement, então a âncora é o
        // CABEÇALHO de `FIND_USER_BY_API_KEY` e não o corpo dele.
        assert.match(
          contador.state.statements[0], /api_key_id/,
          `e a consulta precisa ser a de autenticação da chave; achei: ${contador.state.statements[0]}`
        );
      } finally {
        contador.restore();
      }
    });
  });
});
