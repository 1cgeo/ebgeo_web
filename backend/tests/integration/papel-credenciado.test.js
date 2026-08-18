// Path: tests/integration/papel-credenciado.test.js
//
// O PAPEL CREDENCIADO (sucessor do `curator`; decisão D5, revista nesta fase).
//
// `users.role` tem QUATRO valores e ELES NÃO SÃO UMA ESCADA: `user`, `producer`,
// `credenciado`, `admin`. Nenhum contém o outro, e compará-los por ordem é proibido.
// O `credenciado` LÊ todo recurso privado e NÃO ESCREVE NADA — nem catálogo, nem
// projeto 360, nem administração.
//
// OS NEGATIVOS SÃO O CORAÇÃO DESTA FASE, e não um apêndice dela. O padrão "lista
// fechada de papel" já causou dois bugs reais neste repositório, nos dois pacotes,
// sempre por EXCLUIR o nível de cima. Aqui o risco é o oposto e é pior: alguém
// escreve `if (role !== 'user')` num gate que era de administração, e um papel que
// por definição não escreve nada ganha poder de administrador sem que nada fique
// vermelho. Por isso este arquivo mede, um por um:
//
//   - `requireAdmin` → 403 para o credenciado;
//   - `requireAtlasPermission` → o credenciado NÃO vira dono de atlas alheio;
//   - o CATÁLOGO → ele não cria, não edita e não apaga linha nenhuma;
//   - `toFrontendRole` → o credenciado NÃO vira 'admin' no cliente.
//
// E o positivo que dá sentido a todos: ele VÊ o recurso privado, sem concessão
// nenhuma. Sem esse par, "recebe 403 em tudo" também é o que se mede quando o papel
// não existe.
//
// POR QUE O TERCEIRO NEGATIVO É NOVO. Enquanto a escrita do catálogo era
// `requireAdmin`, "não passa em requireAdmin" e "não edita catálogo" eram a mesma
// asserção. Nesta fase o gate virou "administrador OU produtor", então as duas
// frases se separaram: um papel pode falhar em `requireAdmin` e ainda assim escrever
// catálogo, e é exatamente essa a porta que o credenciado não pode ter.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, loginUser,
} from '../helpers/fixtures.js';
import { toFrontendRole } from '../../src/utils/roles.js';

describe('O Credenciado vê o privado, não administra e não escreve', () => {
  let app, db, credenciado, comum, admin, produtor, atlasDoAdmin, orgProdutora;
  let tokenCredenciado, tokenComum, tokenAdmin, tokenProdutor;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `cred-${sufixo}`;
  const TILESET_DO_PRODUTOR = `cred-prod-${sufixo}`;

  const visiveis = async (token) => (await supertest(app)
    .get('/api/v1/resource-access/visible')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)).body.data;

  const veTileset = async (token) => (await visiveis(token)).tilesets.map((t) => t.id).includes(TILESET);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM Produtora ${sufixo}`, `om-prod-${sufixo}`, `P${sufixo.slice(0, 4)}`]
    );
    orgProdutora = orgs[0].id;

    admin = await createAdminUser(db, { username: `cred_admin_${sufixo}` });
    comum = await createUser(db, { username: `cred_comum_${sufixo}` });
    credenciado = await createUser(db, { username: `cred_cred_${sufixo}`, role: 'credenciado' });
    produtor = await createProducerUser(db, orgProdutora, { username: `cred_prod_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenComum = await loginUser(app, comum.username, comum.password);
    tokenCredenciado = await loginUser(app, credenciado.username, credenciado.password);
    tokenProdutor = await loginUser(app, produtor.username, produtor.password);
    atlasDoAdmin = await createAtlas(db, admin.id, { name: `Atlas do admin ${sufixo}` });

    // Recurso INSTITUCIONAL (owner_org_id NULL) e privado: é o que o credenciado
    // precisa enxergar sem concessão e o que ninguém além do administrador escreve.
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset ${sufixo}`]
    );
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])',
      [[TILESET, TILESET_DO_PRODUTOR]]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[TILESET, TILESET_DO_PRODUTOR]]);
    await db.query('DELETE FROM atlas WHERE id = $1', [atlasDoAdmin.id]);
    await db.query('DELETE FROM users WHERE producer_org_id = $1', [orgProdutora]);
    await db.query('DELETE FROM organizations WHERE id = $1', [orgProdutora]);
    await teardownTestEnv(db);
  });

  it('o CHECK de `users.role` aceita os QUATRO e nada além — e `curator` MORREU', async () => {
    const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [credenciado.id]);
    assert.equal(rows[0].role, 'credenciado');

    // Os quatro passam. Sem este laço, "recusa o resto" também é o que se mede num
    // CHECK que recusa tudo.
    for (const papel of ['user', 'producer', 'credenciado', 'admin']) {
      // `producer` só passa com escopo — o bicondicional tem arquivo próprio
      // (escopo-de-producao-bicondicional.test.js); aqui ele entra pelo par completo.
      const escopo = papel === 'producer' ? orgProdutora : null;
      await db.query(
        'UPDATE users SET role = $1, producer_org_id = $3::uuid WHERE id = $2',
        [papel, comum.id, escopo]
      );
    }
    await db.query("UPDATE users SET role = 'user', producer_org_id = NULL WHERE id = $1", [comum.id]);

    // Um quinto valor continua recusado, senão o CHECK teria sido ALARGADO (ou
    // removido) e este arquivo mediria a ausência de guarda.
    await assert.rejects(
      () => db.query('UPDATE users SET role = $1 WHERE id = $2', ['superuser', comum.id]),
      /users_role_check/
    );
    // E O VALOR ANTIGO PRECISA ESTAR MORTO. Esta é a asserção que separa SUBSTITUIR
    // de ALARGAR: uma migração que acrescentasse `credenciado` e deixasse `curator`
    // de pé passaria em todo o resto deste arquivo, e o sistema ficaria com dois
    // papéis para a mesma coisa, um deles fora do vocabulário da UI.
    await assert.rejects(
      () => db.query('UPDATE users SET role = $1 WHERE id = $2', ['curator', comum.id]),
      /users_role_check/,
      'o papel `curator` foi SUBSTITUÍDO por `credenciado`, não acompanhado dele'
    );
  });

  it('POSITIVO — o credenciado enxerga o privado SEM concessão nenhuma', async () => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM resource_grants WHERE grantee_id = $1', [credenciado.id]
    );
    assert.equal(rows[0].n, 0, 'piso: o credenciado não pode ter concessão — o que ele tem é o papel');

    assert.ok(await veTileset(tokenCredenciado));
    // O par: o usuário comum, no mesmo instante, não vê.
    assert.ok(!(await veTileset(tokenComum)));
  });

  it('BURACO CONHECIDO — o credenciado ainda CONCEDE de raiz, e isso é escrita', async () => {
    // MARCADOR, NÃO ENDOSSO, E JÁ PELA METADE. `requireResourceShare` continua passando
    // por `fn_has_global_data_access`, que inclui o credenciado — então o papel definido
    // como "lê tudo e não escreve nada" CONCEDE acesso de terceiros. Fechar isso exige
    // um predicado próprio (`fn_can_grant_resource`) e é decisão de produto, não
    // arrumação. Fica escrito como expectativa explícita: se o predicado nascer, ESTE
    // caso fica vermelho, que é o ponto — a decisão volta à mesa em vez de ser
    // contradita em silêncio.
    //
    // A METADE QUE FECHOU (fase F9): REVOGAR não passa mais pelo papel de dado.
    // `requireGrantRevoker` pergunta por ADMINISTRAÇÃO no ramo largo e por AUTORIA no
    // estreito, então o credenciado deixou de derrubar a concessão (e a subárvore) de
    // outra pessoa. Ele continua revogando a que ele mesmo deu, que é o que a linha
    // final deste caso exercita — e é por isso que ela continua verde.
    // O par negativo mora em `resource-grants-revogação-credenciado.test.js`.
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokenCredenciado}`)
      .send({ granteeId: comum.id, grantLevel: 'view' })
      .expect(201);
    assert.equal(res.body.data.parent_grant_id, null, 'papel global concede de RAIZ');
    assert.ok(await veTileset(tokenComum), 'e o beneficiário passa a ver');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${res.body.data.id}`)
      .set('Authorization', `Bearer ${tokenCredenciado}`)
      .expect(200);
    assert.ok(!(await veTileset(tokenComum)), 'e a revogação desfaz');
  });

  it('NEGATIVO 1 — o credenciado NÃO passa em `requireAdmin`', async () => {
    // A rota de visibilidade é `auth` + `requireAdmin`: marcar privado é ato de
    // ADMINISTRAÇÃO do catálogo, e o credenciado repassa acesso sem decidir que o
    // recurso deixou de ser público para todo mundo.
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET}/visibility`)
      .set('Authorization', `Bearer ${tokenCredenciado}`)
      .send({ accessLevel: 'public' })
      .expect(403);
    // E o mesmo corpo, com o admin, passa.
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET}/visibility`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ accessLevel: 'public' })
      .expect(200);
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET}/visibility`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ accessLevel: 'private' })
      .expect(200);

    // Outro gate de administração, para não medir uma rota só: a lista de usuários.
    await supertest(app).get('/api/v1/users').set('Authorization', `Bearer ${tokenCredenciado}`).expect(403);
    await supertest(app).get('/api/v1/users').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);

    // E a trilha de auditoria, que é a superfície onde o poder se lê inteiro.
    await supertest(app).get('/api/v1/audit').set('Authorization', `Bearer ${tokenCredenciado}`).expect(403);
    await supertest(app).get('/api/v1/audit').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
  });

  it('NEGATIVO 2 — o credenciado NÃO vira dono em `requireAtlasPermission`', async () => {
    // Admin global é tratado como dono de QUALQUER atlas. O credenciado não: ele vê
    // recurso de catálogo, não o conteúdo de projeto alheio.
    await supertest(app)
      .get(`/api/v1/atlas/${atlasDoAdmin.id}`)
      .set('Authorization', `Bearer ${tokenCredenciado}`)
      .expect(404);
    // Discriminação: o admin abre o mesmo atlas.
    await supertest(app)
      .get(`/api/v1/atlas/${atlasDoAdmin.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
  });

  it('NEGATIVO 3 — o credenciado NÃO ESCREVE CATÁLOGO, e o par prova que a rota funciona', async () => {
    // O NEGATIVO QUE NASCEU NESTA FASE. A escrita de catálogo deixou de ser
    // `requireAdmin` e passou a ser "administrador OU produtor": as duas frases
    // "não passa em requireAdmin" e "não escreve catálogo" deixaram de ser a mesma
    // asserção, e sem este caso a segunda ficaria sem medição.
    const antes = (await db.query('SELECT name FROM tilesets WHERE id = $1', [TILESET])).rows[0].name;

    await supertest(app)
      .post('/api/v1/tilesets')
      .set('Authorization', `Bearer ${tokenCredenciado}`)
      .send({ id: `cred-tentou-${sufixo}`, name: 'Não deveria nascer' })
      .expect(403);
    await supertest(app)
      .put(`/api/v1/tilesets/${TILESET}`)
      .set('Authorization', `Bearer ${tokenCredenciado}`)
      .send({ name: 'Renomeado pelo credenciado' })
      .expect(403);
    await supertest(app)
      .delete(`/api/v1/tilesets/${TILESET}`)
      .set('Authorization', `Bearer ${tokenCredenciado}`)
      .expect(403);

    // UM 403 QUE JÁ ESCREVEU PASSA EM TESTE DE STATUS: a asserção que vale é sobre a
    // LINHA. Ela precisa estar intacta e ainda viva depois das três tentativas.
    const { rows } = await db.query('SELECT name, active FROM tilesets WHERE id = $1', [TILESET]);
    assert.equal(rows[0].name, antes, 'nada foi renomeado');
    assert.equal(rows[0].active, true, 'e nada foi apagado');
    const { rows: naoNasceu } = await db.query(
      'SELECT id FROM tilesets WHERE id = $1', [`cred-tentou-${sufixo}`]
    );
    assert.equal(naoNasceu.length, 0, 'e a linha recusada não existe');

    // OS DOIS PARES, porque "403 para o credenciado" também é o que se mede numa rota
    // quebrada para todo mundo. O administrador escreve o acervo institucional…
    await supertest(app)
      .put(`/api/v1/tilesets/${TILESET}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ name: `Tileset ${sufixo}` })
      .expect(200);
    // …e o PRODUTOR escreve o acervo da OM dele, pela MESMA rota.
    await supertest(app)
      .post('/api/v1/tilesets')
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ id: TILESET_DO_PRODUTOR, name: 'Do produtor' })
      .expect(201);
    await supertest(app)
      .put(`/api/v1/tilesets/${TILESET_DO_PRODUTOR}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ name: 'Do produtor, editado' })
      .expect(200);
  });

  it('NEGATIVO 4 — `toFrontendRole` não devolve `admin` para o credenciado', () => {
    // O sítio mais perigoso do censo inteiro: mapear credenciado para 'admin' aqui
    // lhe daria a INTERFACE de administrador sem passar por gate nenhum de servidor.
    assert.equal(toFrontendRole(null, 'credenciado'), 'viewer');
    assert.equal(toFrontendRole('read', 'credenciado'), 'viewer');
    assert.equal(toFrontendRole('write', 'credenciado'), 'editor', 'a permissão POR ATLAS continua valendo');
    // O produtor tampouco: ele mantém acervo, não administra o sistema.
    assert.equal(toFrontendRole(null, 'producer'), 'viewer');
    // Discriminação: o admin global continua curto-circuitando.
    assert.equal(toFrontendRole(null, 'admin'), 'admin');
  });

  it('o papel é resolvido no BANCO: rebaixar o credenciado vale na hora, sem novo token', async () => {
    // `fn_has_global_data_access` consulta `users`, e não recebe booleano do JS.
    // É o que elimina a janela de até 15 min do token — `flexibleAuth` é global,
    // não-bloqueante e NÃO reconcilia.
    assert.ok(await veTileset(tokenCredenciado));

    await db.query('UPDATE users SET role = $1 WHERE id = $2', ['user', credenciado.id]);
    try {
      assert.ok(
        !(await veTileset(tokenCredenciado)),
        'o MESMO token, depois do rebaixamento, já não enxerga'
      );
    } finally {
      await db.query('UPDATE users SET role = $1 WHERE id = $2', ['credenciado', credenciado.id]);
    }
    assert.ok(await veTileset(tokenCredenciado), 'e volta ao repromover');
  });

  it('credenciado DESATIVADO não enxerga nada (a função cobra `is_active`)', async () => {
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [credenciado.id]);
    try {
      // O caminho estrito derruba a sessão inteira em 401 — o que já é a resposta
      // certa. A asserção é sobre a FUNÇÃO, que é quem carrega a garantia mesmo se
      // a camada de aplicação errar.
      const { rows } = await db.query('SELECT fn_has_global_data_access($1::uuid) AS ok', [credenciado.id]);
      assert.equal(rows[0].ok, false);
    } finally {
      await db.query('UPDATE users SET is_active = true WHERE id = $1', [credenciado.id]);
    }
    const { rows } = await db.query('SELECT fn_has_global_data_access($1::uuid) AS ok', [credenciado.id]);
    assert.equal(rows[0].ok, true, 'e volta ao reativar');
  });

  it('os DOIS eixos globais não se confundem: produtor não lê o privado alheio', async () => {
    // O par que separa `credenciado` de `producer`, e que é a razão de os quatro
    // papéis NÃO serem uma escada. O tileset acima é INSTITUCIONAL (`owner_org_id`
    // nulo): nenhum produtor o mantém, então nenhum produtor o enxerga.
    const { rows } = await db.query('SELECT fn_has_global_data_access($1::uuid) AS ok', [produtor.id]);
    assert.equal(rows[0].ok, false, 'produzir não é ler tudo');
    assert.ok(!(await veTileset(tokenProdutor)), 'e o privado institucional continua fora do alcance dele');
    // Discriminação, no mesmo corpo: o credenciado vê o mesmo id no mesmo instante.
    assert.ok(await veTileset(tokenCredenciado));
  });
});
