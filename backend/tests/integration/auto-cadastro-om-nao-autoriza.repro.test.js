// Path: tests/integration/auto-cadastro-om-nao-autoriza.repro.test.js
//
// REPRO — O AUTO-CADASTRO ERA UMA ESCALAÇÃO DE PRIVILÉGIO, E DEIXOU DE SER.
//
// CAUSA RAIZ, na forma exata em que ela existia:
//
//   1. `POST /auth/register` aceita `organization_id` do CORPO. A validação é de
//      existência e liveness da OM, nunca de pertencimento — a lista de OMs vem do
//      `GET /api/config` ANÔNIMO, para preencher o próprio seletor da tela.
//   2. Conta SEM e-mail nasce ATIVA na hora (o gate de verificação só dispara
//      quando `email IS NOT NULL`), então o ciclo inteiro cabe em duas chamadas.
//   3. `users.organization_id` AUTORIZAVA. O predicado de leitura do 360 tinha o
//      ramo `organization_id = $orgId`, com o `$orgId` vindo daquela coluna, e
//      `isProjectReadable`/`canWriteProject` comparavam a mesma coluna.
//
//   Somados: escolher a OM alheia num `<select>` entregava todo projeto 360 OCULTO
//   (`status='disabled'`) e PRIVADO (`access_level='private'`) daquela OM. Não é um
//   vazamento por bug; era o comportamento projetado, com a premissa errada de que
//   a lotação é atestada por alguém.
//
// O CONSERTO, e é o eixo desta fase: `organization_id` vira LOTAÇÃO e exibição, sem
// poder nenhum. Todo ramo de autorização que a lia passa a ler o ESCOPO DE PRODUÇÃO
// (`users.producer_org_id`), que só um administrador concede. O eixo de OM não
// sumiu — deixou de ser auto-declarado.
//
// POR QUE ESTE ARQUIVO FALHA CONTRA O CÓDIGO ANTIGO. O passo 2 abaixo afirma 404
// onde o código antigo respondia 200 com o projeto oculto no corpo. É a mesma
// asserção que `register-tenant-claim.test.js` fazia ao contrário, e aquele caso foi
// invertido no mesmo commit: a consequência que ele pintava como fato passou a ser
// a regressão que este arquivo impede.
//
// E POR QUE O PASSO 3 EXISTE. Sem o positivo, todo o passo 2 passaria idêntico se a
// fixture estivesse quebrada, se o projeto não tivesse sido criado ou se a rota
// tivesse deixado de existir. O MESMO usuário, promovido a produtor daquela MESMA
// OM, precisa passar a ver e a escrever.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';

describe('REPRO — auto-cadastrar-se numa OM alheia não compra acesso nenhum', () => {
  let app, db, orgAlheia, invasor, token;
  const sufixo = randomUUID().slice(0, 8);
  const USUARIO = `autocad_${sufixo}`;
  const SENHA = 'Claim@1234';
  const SLUG_OCULTO = `autocad-oculto-${sufixo}`;
  const SLUG_PRIVADO = `autocad-privado-${sufixo}`;
  const CAMADA_PRIVADA = `autocad-camada-${sufixo}`;

  const lista360 = async (t) => {
    const req = supertest(app).get('/api/v1/sv360/projects');
    if (t) req.set('Authorization', `Bearer ${t}`);
    const res = await req.expect(200);
    return (res.body.projects ?? res.body).map((p) => p.slug);
  };

  const projeto = (slug, t) => {
    const req = supertest(app).get(`/api/v1/sv360/projects/${slug}`);
    if (t) req.set('Authorization', `Bearer ${t}`);
    return req;
  };

  const visiveis = async (t) => (await supertest(app)
    .get('/api/v1/resource-access/visible')
    .set('Authorization', `Bearer ${t}`)
    .expect(200)).body.data;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    assert.equal(
      config.security.allowSelfRegistration, true,
      'fixture: o auto-cadastro está ligado em NODE_ENV=test, senão a rota nem é montada'
    );

    const { rows } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM Alheia ${sufixo}`, `om-alheia-${sufixo}`, `A${sufixo.slice(0, 4)}`]
    );
    orgAlheia = rows[0].id;

    // O ACERVO DA OM ALHEIA: um projeto OCULTO, um PRIVADO e uma camada de análise
    // privada. Os dois eixos do 360 são ortogonais e a fase mexe nos dois, então os
    // dois entram — medir só `disabled` deixaria `private` sem guarda.
    for (const [slug, status, nivel] of [
      [SLUG_OCULTO, 'disabled', 'public'],
      [SLUG_PRIVADO, 'enabled', 'private'],
    ]) {
      await db.query(
        `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                     center_lat, center_long, photo_count)
         VALUES ($1, $2, $3, $4, $5, $6, -30.0, -51.0, 0)`,
        [orgAlheia, slug, `Projeto ${slug}`, `${orgAlheia}__${slug}.db`, status, nivel]
      );
    }
    await db.query(
      `INSERT INTO analysis_layers (id, name, config, sort_order, owner_org_id, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid, 'private')`,
      [CAMADA_PRIVADA, `Camada ${sufixo}`, orgAlheia]
    );
  });

  after(async () => {
    await db.query('DELETE FROM analysis_layers WHERE id = $1', [CAMADA_PRIVADA]);
    await db.query('DELETE FROM sv360.projects WHERE organization_id = $1', [orgAlheia]);
    await db.query('DELETE FROM users WHERE username = $1', [USUARIO]);
    await db.query('DELETE FROM organizations WHERE id = $1', [orgAlheia]);
    await teardownTestEnv(db);
  });

  it('PASSO 1 (o piso, que continua verdadeiro) — a conta nasce ATIVA dentro da OM escolhida', async () => {
    // O FURO DE ENTRADA NÃO FOI FECHADO, e isso é deliberado: fechá-lo pede um
    // fluxo de aprovação. O que a fase fez foi tirar o PODER da declaração. Se
    // alguém um dia acrescentar a aprovação, este passo fica vermelho e a decisão
    // volta à mesa em vez de ser contradita em silêncio.
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username: USUARIO, password: SENHA, nome: 'Não Membro', organization_id: orgAlheia })
      .expect(201);

    const { rows } = await db.query(
      'SELECT id, organization_id, producer_org_id, role, is_active FROM users WHERE username = $1',
      [USUARIO]
    );
    invasor = rows[0];
    assert.equal(invasor.organization_id, orgAlheia, 'a lotação auto-declarada é aceita como sempre');
    assert.equal(invasor.is_active, true, 'e sem e-mail a conta já nasce utilizável');
    assert.equal(invasor.role, 'user', 'o auto-cadastro nunca cunha papel global');
    assert.equal(
      invasor.producer_org_id, null,
      'E O CRACHÁ DE PRODUÇÃO NÃO ACOMPANHA A LOTAÇÃO: é ele que autoriza, e só administrador o concede'
    );

    token = (await supertest(app)
      .post('/api/v1/auth/login').send({ username: USUARIO, password: SENHA })
      .expect(200)).body.data.accessToken;
  });

  it('PASSO 2 (a regressão que a fase impede) — a declaração não compra 360 oculto nem privado', async () => {
    // CONTROLE PRIMEIRO: o anônimo também não vê. Sem ele, "o invasor não vê" seria
    // indistinguível de "o projeto não existe".
    const anonimos = await lista360(null);
    assert.ok(!anonimos.includes(SLUG_OCULTO), 'controle: oculto é invisível para o anônimo');
    assert.ok(!anonimos.includes(SLUG_PRIVADO), 'controle: privado também');

    const dele = await lista360(token);
    assert.ok(
      !dele.includes(SLUG_OCULTO),
      'O CORAÇÃO DO REPRO: escolher a OM no cadastro NÃO entrega o projeto OCULTO dela'
    );
    assert.ok(!dele.includes(SLUG_PRIVADO), 'nem o PRIVADO');

    await projeto(SLUG_OCULTO, token).expect(404);
    await projeto(SLUG_PRIVADO, token).expect(404);
  });

  it('PASSO 2b — nem a camada privada daquela OM, no payload aditivo', async () => {
    const dados = await visiveis(token);
    const ids = dados.analysisLayers.map((r) => r.id);
    assert.ok(
      !ids.includes(CAMADA_PRIVADA),
      'o eixo de produção também gateia o catálogo: lotação não enxerga acervo privado'
    );
    // E pela rota crua do catálogo, que é o caminho por id que já vazou uma vez.
    await supertest(app)
      .get(`/api/v1/analysis-layers/${CAMADA_PRIVADA}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('PASSO 2c — e não escreve nada em nome daquela OM', async () => {
    // Catálogo: recusado na porta, porque a conta não produz para OM nenhuma.
    await supertest(app)
      .put(`/api/v1/analysis-layers/${CAMADA_PRIVADA}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'renomeado pelo invasor' })
      .expect(403);
    await supertest(app)
      .post('/api/v1/analysis-layers')
      .set('Authorization', `Bearer ${token}`)
      .send({ id: `autocad-nova-${sufixo}`, name: 'nova' })
      .expect(403);

    const { rows } = await db.query('SELECT name FROM analysis_layers WHERE id = $1', [CAMADA_PRIVADA]);
    assert.equal(rows[0].name, `Camada ${sufixo}`, 'e a recusa é sem efeito');

    // 360: o pré-filtro de ingestão (`requireUploadCapability`) recusa antes de o
    // multer streamar o pacote, que pode ter gigabytes.
    await supertest(app)
      .post('/api/v1/sv360/admin/projects/upload')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    // E a superfície administrativa do 360 tampouco: ela devolve `db_filename`.
    await supertest(app)
      .get('/api/v1/sv360/admin/projects')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('PASSO 3 (o positivo discriminante) — o MESMO usuário, agora PRODUTOR, vê e escreve', async () => {
    // Sem este passo o arquivo inteiro passaria idêntico contra uma fixture quebrada,
    // um projeto inexistente ou uma rota removida. O crachá é a ÚNICA coisa que muda
    // entre o bloco anterior e este: mesma conta, mesma OM, mesmo token.
    await db.query(
      "UPDATE users SET role = 'producer', producer_org_id = $2::uuid WHERE id = $1",
      [invasor.id, orgAlheia]
    );
    // TOKEN NOVO PARA A PROMOÇÃO, E O MOTIVO É UMA ASSIMETRIA REAL, medida aqui e
    // digna de estar escrita. A garantia mora no SQL, que resolve o crachá pelo UUID e
    // já entregaria o projeto; mas o 360 tem um cinto de segurança em JS
    // (`isProjectReadable`, o eixo de `status`) que lê `req.user.producer_org_id` do
    // TOKEN, e as rotas de leitura correm sob `flexibleAuth`, que NÃO reconcilia. O
    // efeito é conservador nos dois sentidos e não é buraco: PROMOVER só vale para o
    // projeto OCULTO depois de um token novo (o SQL diz sim e o JS ainda diz não, e o
    // mais restritivo vence), enquanto REVOGAR vale na hora, porque aí é o SQL que
    // recusa e nenhum cinto de segurança reabre. A reversão no fim deste caso mede
    // exatamente isso, com o token JÁ renovado.
    const tokenPromovido = (await supertest(app)
      .post('/api/v1/auth/login').send({ username: USUARIO, password: SENHA })
      .expect(200)).body.data.accessToken;
    try {
      const dele = await lista360(tokenPromovido);
      assert.ok(dele.includes(SLUG_OCULTO), 'o produtor da OM vê o projeto oculto dela');
      assert.ok(dele.includes(SLUG_PRIVADO), 'e o privado');
      await projeto(SLUG_OCULTO, tokenPromovido).expect(200);
      await projeto(SLUG_PRIVADO, tokenPromovido).expect(200);

      // O PRIVADO JÁ VALE COM O TOKEN VELHO, e o par com o novo é o que separa os dois
      // eixos: `access_level` é decidido só no SQL, `status` tem o cinto em JS.
      await projeto(SLUG_PRIVADO, token).expect(200);

      const ids = (await visiveis(token)).analysisLayers.map((r) => r.id);
      assert.ok(ids.includes(CAMADA_PRIVADA), 'e a camada privada da OM aparece no payload aditivo');

      // A ESCRITA DE CATÁLOGO VALE COM O TOKEN VELHO: o gate resolve papel e escopo no
      // BANCO, nunca na claim.
      await supertest(app)
        .put(`/api/v1/analysis-layers/${CAMADA_PRIVADA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Mantida pelo produtor ${sufixo}` })
        .expect(200);
      const { rows } = await db.query('SELECT name FROM analysis_layers WHERE id = $1', [CAMADA_PRIVADA]);
      assert.equal(rows[0].name, `Mantida pelo produtor ${sufixo}`);
    } finally {
      await db.query(
        "UPDATE users SET role = 'user', producer_org_id = NULL WHERE id = $1", [invasor.id]
      );
    }

    // E A REVERSÃO É O CONTROLE DO CONTROLE: revogado o crachá, o token RENOVADO —
    // aquele que acabou de abrir tudo — volta a não enxergar, na requisição seguinte.
    // Se o passo 3 tivesse passado por cache, por sessão ou por qualquer coisa que não
    // fosse o crachá, estas duas linhas não voltariam a 404.
    await projeto(SLUG_OCULTO, tokenPromovido).expect(404);
    await projeto(SLUG_PRIVADO, tokenPromovido).expect(404);
    await supertest(app)
      .put(`/api/v1/analysis-layers/${CAMADA_PRIVADA}`)
      .set('Authorization', `Bearer ${tokenPromovido}`)
      .send({ name: 'depois da revogação' })
      .expect(403);
  });
});
