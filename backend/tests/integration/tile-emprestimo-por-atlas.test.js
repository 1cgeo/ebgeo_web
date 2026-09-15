// Path: tests/integration/tile-emprestimo-por-atlas.test.js
//
// O EMPRÉSTIMO POR ATLAS ALCANÇA O TILE (cláusula 6.7, decisão D17 de 2026-09-15).
//
// O DEFEITO QUE ELE FECHA, medido em 2026-08-29 e registrado por quase três semanas como
// cláusula pendente: o ramo de empréstimo de `fn_granted_resource_ids` só existe quando a
// requisição diz QUAL atlas está em foco, e o gate do tile lia esse valor de `req.query`,
// que na subrequisição do `auth_request` é SEMPRE vazia. Ou seja, ele decidia sempre com
// atlas nulo e aquele ramo nunca rodava. Quem alcança uma camada SÓ pelo empréstimo via o
// item no payload aditivo do catálogo e levava 401 nos bytes: a camada aparecia na lista e
// não desenhava.
//
// POR QUE ESTE ARQUIVO É SEPARADO de `tile-access-auth-request.test.js`. Aquele mede os
// quatro desfechos do gate com uma camada que o principal alcança por CONCESSÃO PESSOAL, e
// é a escolha certa lá: ela mantém honestos os casos de credencial, porque o que decide o
// desfecho é a chave. Aqui o sujeito é o oposto e a fixture tem de garanti-lo: NINGUÉM
// destes principais tem concessão própria sobre a camada, então a única coisa capaz de
// abrir os bytes é o empréstimo do atlas. É por isso que o primeiro caso do arquivo é o
// negativo SEM carimbo: sem ele, todo positivo abaixo poderia estar passando por uma
// concessão que ninguém pretendeu criar.
//
// O QUE ELE NÃO MEDE, e é o mesmo teto do arquivo irmão: nada aqui prova o que o nginx do
// host faz. A subrequisição é simulada como o `location` a monta (`X-Original-URI` com a
// URI ORIGINAL, prefixo e query inclusive), e a propriedade de que o host a monta assim é
// sonda com data no deploy.
//
// A COISA QUE SE LÊ AO CONTRÁRIO, e que sustentou o defeito por três semanas: a cláusula
// 6.7 dizia que o conserto precisava de um cabeçalho NOVO no nginx para levar o atlas. Não
// precisava. `X-Original-URI` é `$request_uri`, a URI original com a query inteira, e o
// `?atlasId=` sempre esteve dentro dele — o próprio host já tira a chave de API daquele
// mesmo texto por um `map`. O que faltava era ler.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createShare, loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';
import { TILE_ACCESS_DENIAL } from '../../src/modules/auth/tile-access.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';
import { invalidarAcessoDeAssets3d } from '../../src/modules/nomes/assets3d-acesso.js';

const SFX = randomUUID().slice(0, 8);
const ROTA = '/api/v1/auth/tile-access';

describe('tile: o empréstimo por atlas decide os bytes (D17)', () => {
  let app, db;
  let dono, donoToken, membro, membroToken, forasteiro, forasteiroToken;
  let atlasQueEmpresta, atlasAlheio, atlasPublico, tokenPublico;

  const fonte = `fonte-emp-${SFX}`;
  const idCamada = `t-emp-${SFX}`;
  const caminho = `/tiles/${fonte}/10/385/577`;

  /**
   * A subrequisição do `auth_request`, como o `location` do host a monta.
   *
   * O ATLAS VAI NA URI ORIGINAL e não na query DESTA requisição, e a diferença é o assunto
   * inteiro do arquivo: escrever `?atlasId=` na URL do endpoint mediria um caminho que o
   * nginx nunca produz (a subrequisição chega com a query vazia).
   */
  const pedir = ({ token, atlasId } = {}) => {
    const uri = atlasId ? `${caminho}?atlasId=${atlasId}` : caminho;
    const req = supertest(app).get(ROTA).set('X-Original-URI', uri);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `emp_dono_${SFX}` });
    membro = await createUser(db, { username: `emp_membro_${SFX}` });
    forasteiro = await createUser(db, { username: `emp_fora_${SFX}` });
    donoToken = await loginUser(app, dono.username, dono.password);
    membroToken = await loginUser(app, membro.username, membro.password);
    forasteiroToken = await loginUser(app, forasteiro.username, forasteiro.password);

    // A CAMADA PRIVADA. Sem a linha de catálogo o caminho seria "não reivindicado" e todo
    // caso responderia 401 pelo motivo errado; sem `private` ele cairia na decisão 5 e
    // abriria para qualquer um, o que faria os positivos passarem por vacuidade.
    await db.query(
      `INSERT INTO data_layers (id, name, access_level, config)
       VALUES ($1, $2, 'private',
               jsonb_build_object('source', jsonb_build_object('url', $3::text, 'type', 'vector')))`,
      [idCamada, `Camada emprestada ${SFX}`, `/tiles/${fonte}`]
    );

    // O DONO enxerga a camada por concessão de REPASSE, que é o que anexar exige: emprestar
    // É repassar. Direto no banco porque a rota de concessão de raiz exige papel global, e
    // quem este arquivo mede não é ela.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('data_layer', $1, $2, 'view_share', $2)`,
      [idCamada, dono.id]
    );

    // TRÊS ATLAS, e a separação entre o primeiro e o terceiro é o que o primeiro rascunho
    // deste arquivo errou. Um atlas `is_public` dá `read` a QUALQUER chamador, então pôr o
    // link público no mesmo atlas que empresta faz o caso do forasteiro responder 200 — e
    // ele responderia CERTO, porque ali o empréstimo de fato o alcança. Medido, e o
    // resultado é a fixture abaixo: o atlas que empresta é fechado, e o público é um
    // terceiro que empresta a mesma camada.
    atlasQueEmpresta = await createAtlas(db, dono.id, { name: `Atlas empresta ${SFX}` });
    atlasAlheio = await createAtlas(db, dono.id, { name: `Atlas alheio ${SFX}` });
    atlasPublico = await createAtlas(db, dono.id, { name: `Atlas publico ${SFX}` });
    // O MEMBRO entra nos DOIS primeiros, e é isso que torna o caso do carimbo de outro atlas
    // uma discriminação: ele não é recusado por "não alcança o atlas", e sim porque AQUELE
    // atlas não empresta a camada. Sem isso o negativo passaria pelo gate de permissão de
    // atlas, que é outro assunto e já tem teste próprio.
    await createShare(db, atlasQueEmpresta.id, membro.id, 'read', dono.id);
    await createShare(db, atlasAlheio.id, membro.id, 'read', dono.id);

    tokenPublico = await getPublicToken(app, await makeAtlasPublic(db, atlasPublico.id));

    for (const alvo of [atlasQueEmpresta.id, atlasPublico.id]) {
      await supertest(app)
        .post(`/api/v1/atlas/${alvo}/resources`)
        .set('Authorization', `Bearer ${donoToken}`)
        .send({ resourceType: 'data_layer', resourceId: idCamada })
        .expect(201);
    }

    // O índice de regime é memoizado e foi construído antes da linha de catálogo acima.
    invalidateAppConfigCache();
  });

  after(async () => {
    const ids = [dono.id, membro.id, forasteiro.id];
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [idCamada]);
    await db.query('DELETE FROM audit_trail WHERE actor_id = ANY($1::uuid[])', [ids]);
    // As concessões ANTES das contas: `grantee_id` e `granted_by` são FK sem `ON DELETE`.
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [idCamada]);
    await db.query('DELETE FROM data_layers WHERE id = $1', [idCamada]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])',
      [[atlasQueEmpresta.id, atlasAlheio.id, atlasPublico.id]]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    await teardownTestEnv(db);
  });

  // =========================================================================
  // O PISO: sem carimbo, ninguém aqui alcança a camada
  // =========================================================================
  it('PISO: SEM `?atlasId=`, o membro é recusado — nenhum deles tem concessão própria', async () => {
    // Este caso é o que dá sentido a todos os outros. Se ele passasse com 200, os positivos
    // abaixo estariam medindo uma concessão pessoal acidental em vez do empréstimo, e o
    // arquivo inteiro seria cobertura vazia com cara de aprovação.
    const res = await pedir({ token: membroToken });
    assert.equal(res.status, 401);
    assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.RECURSO_NAO_ALCANCADO);
  });

  it('PISO: a linha É privada no índice de regime, e não cai no ramo público', async () => {
    // A recusa acima também sairia de uma linha PÚBLICA? Não: ali o gate libera sem
    // consultar credencial nenhuma. Mas ela sairia de um caminho NÃO REIVINDICADO, e essa
    // confusão é barata de cometer, porque o endereço de catálogo é texto livre. O motivo
    // em cabeçalho é o que separa os dois, e o anônimo é quem o mede sem ruído.
    const res = await supertest(app).get(ROTA).set('X-Original-URI', caminho);
    assert.equal(res.status, 401);
    assert.equal(
      res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.SEM_CREDENCIAL,
      'a recusa precisa ser a da credencial ausente: se fosse `caminho-nao-reivindicado`, '
      + 'o índice não teria a camada e o arquivo mediria outra coisa'
    );
  });

  // =========================================================================
  // OS QUATRO CAMINHOS DO EMPRÉSTIMO
  // =========================================================================
  it('1. o MEMBRO com o carimbo do atlas que empresta recebe os bytes', async () => {
    const res = await pedir({ token: membroToken, atlasId: atlasQueEmpresta.id });
    assert.equal(res.status, 200, 'o empréstimo precisa abrir o tile para o membro');
    assert.equal(res.text, '', 'o SIM continua sem corpo');
  });

  it('2. o carimbo de OUTRO atlas não serve, mesmo sendo membro dos dois', async () => {
    // O UUID do atlas não é senha, e este caso é a outra metade da mesma frase: o carimbo
    // diz qual empréstimo o chamador quer usar, e o atlas alheio não empresta nada.
    const res = await pedir({ token: membroToken, atlasId: atlasAlheio.id });
    assert.equal(res.status, 401);
    assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.RECURSO_NAO_ALCANCADO);
  });

  it('2b. quem NÃO alcança o atlas não compra o empréstimo carimbando o UUID dele', async () => {
    // O UUID do atlas viaja em toda URL de compartilhamento, então ele é público de fato.
    // Quem autoriza é `requireAtlasPermission('read')`, rodado dentro do predicado — e é por
    // isso que este caso corre contra o atlas FECHADO: contra o `is_public` ele responderia
    // 200, e responderia certo, porque ali o empréstimo alcança qualquer um.
    const res = await pedir({ token: forasteiroToken, atlasId: atlasQueEmpresta.id });
    assert.equal(res.status, 401);
    assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.RECURSO_NAO_ALCANCADO);

    // O PAR que impede a leitura "o forasteiro nunca alcança nada": no atlas PÚBLICO, que
    // empresta a MESMA camada, a MESMA conta passa. Quem decide é o atlas, não a pessoa.
    const noPublico = await pedir({ token: forasteiroToken, atlasId: atlasPublico.id });
    assert.equal(noPublico.status, 200);
  });

  it('3. o VISITANTE de link público do atlas recebe os bytes (cláusula 6.3)', async () => {
    // É o caso em que a 6.3 mais importa: o token do visitante é efêmero, não vira cookie, e
    // o `?atlasId=` é a única autorização que ele tem. Enquanto o gate decidia com atlas
    // nulo, a cláusula estava escrita e não valia na tela.
    const res = await pedir({ token: tokenPublico, atlasId: atlasPublico.id });
    assert.equal(res.status, 200);
  });

  it('3c. o token de link público de um atlas NÃO alcança o empréstimo de outro', async () => {
    // O confinamento do visitante, que mora dentro de `requireAtlasPermission`: sem ele o
    // token público de qualquer atlas seria uma chave universal para todo empréstimo.
    const res = await pedir({ token: tokenPublico, atlasId: atlasQueEmpresta.id });
    assert.equal(res.status, 401);
    assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.RECURSO_NAO_ALCANCADO);
  });

  it('3b. o visitante SEM o carimbo é recusado: o empréstimo é de ESCOPO', async () => {
    // Sem atlas em foco, o ramo de empréstimo morre e o de concessão pessoal já estava
    // morto (o principal dele não tem linha em `users`). O par existe para que o caso
    // acima não possa ser lido como "token público abre tudo".
    const res = await pedir({ token: tokenPublico });
    assert.equal(res.status, 401);
  });

  it('4. desfeito o empréstimo, os MESMOS bytes voltam a 401', async () => {
    // A propriedade que separa um empréstimo de uma cópia: ele é reavaliado a cada leitura,
    // sem varredura. O memo de decisão tem 30 s de teto, e é por isso que ele é limpo aqui:
    // sem isso o caso mediria o relógio e não a regra.
    await supertest(app)
      .delete(`/api/v1/atlas/${atlasQueEmpresta.id}/resources/data_layer/${idCamada}`)
      .set('Authorization', `Bearer ${donoToken}`)
      .expect(200);
    invalidarAcessoDeAssets3d();

    const res = await pedir({ token: membroToken, atlasId: atlasQueEmpresta.id });
    assert.equal(res.status, 401);
    assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.RECURSO_NAO_ALCANCADO);

    // E o PAR sobre a MESMA linha: reanexado, volta a abrir. Sem ele, o 401 acima seria
    // indistinguível de uma fixture que se desfez no caminho.
    await supertest(app)
      .post(`/api/v1/atlas/${atlasQueEmpresta.id}/resources`)
      .set('Authorization', `Bearer ${donoToken}`)
      .send({ resourceType: 'data_layer', resourceId: idCamada })
      .expect(201);
    invalidarAcessoDeAssets3d();
    const devolta = await pedir({ token: membroToken, atlasId: atlasQueEmpresta.id });
    assert.equal(devolta.status, 200, 'reanexado, o MESMO membro volta a alcançar o tile');
  });

  // =========================================================================
  // O REGIME DE CACHE (a terceira ponta de D17)
  // =========================================================================
  describe('o regime de cache: tile emprestado não é publicamente cacheável', () => {
    it('o SIM do empréstimo sai `private, no-cache`, com `Vary`', async () => {
      // A resposta dependeu de QUEM pediu, então um cache compartilhado que a guardasse
      // entregaria o tile emprestado a quem não tem o empréstimo. O `?atlasId=` separa as
      // URLs e NÃO separa pessoas: dois chamadores pedem a mesma URL e só um alcança o atlas.
      const res = await pedir({ token: membroToken, atlasId: atlasQueEmpresta.id });
      assert.equal(res.status, 200);
      assert.equal(res.headers['cache-control'], 'private, no-cache');
      // `Vary` é ESCRITO e não acrescentado, o que apaga o `Vary: Origin` que o CORS põe.
      // É a mesma forma de `marcarEscopoJson`, que toda rota JSON escopada já usa, e na
      // resposta real ela não apaga nada: o nginx ACRESCENTA este valor ao do tile.
      assert.equal(res.headers.vary, 'Authorization, Cookie');
    });

    it('o tile PÚBLICO continua sem cabeçalho nosso: o caminho quente não regrediu', async () => {
      // A discriminação que impede a leitura "agora todo tile é privado". O `add_header` do
      // host não acrescenta nada quando a variável vem vazia, então o público sai com o
      // regime que o servidor de tiles já lhe dá — que é o de antes de D17.
      const idPublico = `t-emp-pub-${SFX}`;
      const fontePublica = `fonte-emp-pub-${SFX}`;
      await db.query(
        `INSERT INTO data_layers (id, name, access_level, config)
         VALUES ($1, $2, 'public',
                 jsonb_build_object('source', jsonb_build_object('url', $3::text, 'type', 'vector')))`,
        [idPublico, `Camada pública ${SFX}`, `/tiles/${fontePublica}`]
      );
      invalidateAppConfigCache();
      try {
        const res = await supertest(app).get(ROTA)
          .set('X-Original-URI', `/tiles/${fontePublica}/10/385/577?atlasId=${atlasQueEmpresta.id}`)
          .set('Authorization', `Bearer ${membroToken}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers['cache-control'], undefined);
        // O `Vary: Origin` que sobra é do CORS, global, e existia antes de D17. O que o
        // caso afirma é que o NOSSO não está lá.
        assert.equal(res.headers.vary, 'Origin');
      } finally {
        await db.query('DELETE FROM data_layers WHERE id = $1', [idPublico]);
        invalidateAppConfigCache();
      }
    });

    it('a RECUSA também não carrega regime: não há bytes a governar', async () => {
      const res = await pedir({ token: forasteiroToken, atlasId: atlasQueEmpresta.id });
      assert.equal(res.status, 401);
      assert.equal(res.headers['cache-control'], undefined);
    });
  });

  // =========================================================================
  // A BORDA DO CARIMBO
  // =========================================================================
  describe('a borda: o carimbo chega de um cabeçalho que nenhum schema valida', () => {
    it('`atlasId` que não é UUID é tratado como AUSENTE, e não vira 500', async () => {
      // Nas outras superfícies o valor passa por `validate` e um torto morre como 422 na
      // borda; aqui ele vem de `X-Original-URI`, que nenhum schema olha. Sem a peneira de
      // UUID, ele desceria para um cast `::uuid` e viraria um 500 POR TILE.
      const res = await supertest(app).get(ROTA)
        .set('X-Original-URI', `${caminho}?atlasId=nao-e-uuid`)
        .set('Authorization', `Bearer ${membroToken}`);
      assert.equal(res.status, 401);
      assert.equal(res.headers['x-ebgeo-tile-denial'], TILE_ACCESS_DENIAL.RECURSO_NAO_ALCANCADO);
    });

    it('outros parâmetros na query não confundem a leitura do atlas', async () => {
      // A query real de um tile carrega o que o estilo puser nela, e a chave de API quando
      // a integração é de fora do navegador.
      const res = await supertest(app).get(ROTA)
        .set('X-Original-URI', `${caminho}?api_key=x&atlasId=${atlasQueEmpresta.id}&rev=7`)
        .set('Authorization', `Bearer ${membroToken}`);
      assert.equal(res.status, 200);
    });
  });
});
