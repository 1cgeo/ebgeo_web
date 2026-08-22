// Path: tests/integration/resource-grants-prazo.test.js
//
// O PRAZO DA CONCESSÃO (`resource_grants_expires_at_check`, em `008_acesso_a_recurso.sql`).
//
// Uma concessão de acesso a recurso privado CADUCA: teto de um ano, default de um
// ano, e a morte mora no PREDICADO — não existe varredura que escreva `revoked_at`
// quando o relógio passa. Essa escolha é o assunto central deste arquivo, porque
// ela decide o que "expirado" significa em toda consulta do sistema: uma concessão
// vencida continua com `revoked_at IS NULL`, e revogada e expirada são estados
// DIFERENTES (a primeira tem autor e hora, a segunda é só o relógio).
//
// COMO SE EXPIRA UMA CONCESSÃO NUM TESTE, e por que não basta empurrar `expires_at`
// para o passado: o CHECK da tabela é `expires_at > created_at AND expires_at <=
// created_at + INTERVAL '1 year'`, ancorado no NASCIMENTO e não no relógio, então
// uma linha criada agora não aceita prazo no passado. O helper `expirar()` envelhece
// a linha inteira (dois dias atrás, vencida ontem), que é exatamente a forma que uma
// concessão vencida tem em produção. Ele existir é também a prova de que o CHECK
// impede a "concessão que nasce morta".
//
// NADA AQUI DORME NEM DEPENDE DE JANELA DE TEMPO. Os deslocamentos são francos
// (um dia para trás, um dia para a frente), porque uma medição de algo que depende
// de milissegundos não é medição — é uma corrida que passa numa fração das
// execuções.
//
// Todo negativo vem com o positivo do MESMO par, no mesmo corpo: "não vê" é também
// o que se mede quando a fixture falhou, quando o id está errado e quando a função
// devolve vazio para tudo. O que discrimina é o DELTA.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TIPO = 'tileset';
/** Um ano em milissegundos, o teto da casa (o mesmo do CHECK e do Joi da borda). */
const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

describe('F6 — o prazo da concessão vive dentro do predicado', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const RECURSO = `prazo-${sufixo}`;
  const EMPRESTADO = `prazo-emprestado-${sufixo}`;
  const atores = {};
  const tokens = {};
  let atlas;

  /** POST /grants como `quem`. Devolve o corpo desembrulhado (ou o erro, se `esperado` != 201). */
  async function conceder(quem, granteeId, grantLevel = 'view', extra = {}, esperado = 201) {
    const res = await supertest(app)
      .post(`/api/v1/resource-access/${TIPO}/${extra.recurso ?? RECURSO}/grants`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .send({ granteeId, grantLevel, ...(extra.expiresAt ? { expiresAt: extra.expiresAt } : {}) })
      .expect(esperado);
    return res.body.data;
  }

  /** O payload aditivo de `quem`: ids de tileset privados que ele enxerga. */
  async function visiveis(quem, atlasId = null) {
    const res = await supertest(app)
      .get(`/api/v1/resource-access/visible${atlasId ? `?atlasId=${atlasId}` : ''}`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.tilesets.map((t) => t.id);
  }

  /** Os ids que `quem` pode REPASSAR (o campo `shareable` do mesmo payload). */
  async function repassaveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.shareable.tilesets;
  }

  /** fn_granted_resource_ids: o predicado cru, sem passar por rota nenhuma. */
  async function idsConcedidos(userId, atlasId = null) {
    const { rows } = await db.query(
      'SELECT resource_id FROM fn_granted_resource_ids($1::uuid, $2::uuid, $3::text) ORDER BY resource_id',
      [userId, atlasId, TIPO]
    );
    return rows.map((r) => r.resource_id);
  }

  /**
   * Envelhece a concessão e a vence ONTEM. Os dois campos mudam juntos porque o
   * CHECK ancora o prazo no nascimento: vencer sem envelhecer é um estado que a
   * tabela recusa (e é o que o caso do CHECK afirma logo abaixo).
   */
  async function expirar(grantId) {
    await db.query(
      `UPDATE resource_grants
          SET created_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day'
        WHERE id = $1`,
      [grantId]
    );
  }

  /** Renova por mais um dia (o controle da reversão: prova que o sumiço foi o prazo). */
  async function renovar(grantId) {
    await db.query(
      `UPDATE resource_grants SET expires_at = NOW() + INTERVAL '1 day' WHERE id = $1`,
      [grantId]
    );
  }

  async function linhaDoGrant(grantId) {
    const { rows } = await db.query(
      'SELECT id, created_at, expires_at, revoked_at FROM resource_grants WHERE id = $1',
      [grantId]
    );
    assert.equal(rows.length, 1, 'a concessão precisa existir para ser inspecionada');
    return rows[0];
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    for (const nome of ['admin', 'a', 'b', 'c', 'd', 'dono', 'estranho']) {
      atores[nome] = nome === 'admin'
        ? await createAdminUser(db, { username: `prazo_admin_${sufixo}` })
        : await createUser(db, { username: `prazo_${nome}_${sufixo}` });
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    for (const id of [RECURSO, EMPRESTADO]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
        [id, `Tileset ${id}`]
      );
    }

    atlas = await createAtlas(db, atores.dono.id, { name: `Atlas prazo ${sufixo}` });
    // O ESTRANHO E MEMBRO DO ATLAS, e a palavra so vale para a CONCESSAO: ele nao tem
    // concessao nenhuma sobre o recurso, e e disso que o caso D4 trata. O share existe
    // porque desde a fase F9 `GET /resource-access/visible` roda
    // `requireAtlasScopeWhenPresent`: o UUID do atlas nao autoriza sozinho, entao um
    // nao-membro leva 404 do GATE e nunca chega ao predicado que este arquivo mede.
    await createShare(db, atlas.id, atores.estranho.id, 'read', atores.dono.id);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[RECURSO, EMPRESTADO]]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[RECURSO, EMPRESTADO]]);
    await db.query('DELETE FROM atlas WHERE id = $1', [atlas.id]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[RECURSO, EMPRESTADO]]);
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // O schema: a coluna existe de um lado e NÃO existe do outro
  // ---------------------------------------------------------------------------
  it('`resource_grants` tem prazo obrigatório com default, e `atlas_resources` NÃO ganhou relógio próprio', async () => {
    const { rows } = await db.query(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'resource_grants' AND column_name = 'expires_at'`
    );
    assert.equal(rows.length, 1, 'a coluna `expires_at` precisa existir em resource_grants');
    assert.equal(rows[0].is_nullable, 'NO', 'prazo opcional seria prazo que não existe');
    assert.match(
      String(rows[0].column_default), /1 year/,
      'o default é um ano; sem ele toda concessão nasceria sem prazo pelo caminho do INSERT cru'
    );

    // O PAR QUE DÁ SENTIDO AO NEGATIVO ABAIXO. Sem ele, "atlas_resources não tem
    // coluna de prazo" também é o que se mede numa tabela que não existe ou cujo
    // nome foi digitado errado.
    const { rows: doEmprestimo } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'atlas_resources' ORDER BY column_name`
    );
    assert.ok(doEmprestimo.length >= 6, `esperava a tabela de empréstimo com colunas, achei ${doEmprestimo.length}`);
    const comPrazo = doEmprestimo.map((r) => r.column_name).filter((c) => /expir/i.test(c));
    assert.deepEqual(
      comPrazo, [],
      'o empréstimo por atlas não tem relógio próprio de propósito: ele morre junto com a '
      + 'concessão do DONO (D4), e uma segunda data seria mais um estado para manter coerente'
    );
  });

  // ---------------------------------------------------------------------------
  // O par central: viva aparece, vencida some, renovada volta
  // ---------------------------------------------------------------------------
  it('a concessão viva aparece nos dois caminhos, a vencida some dos dois, e renovar devolve', async () => {
    assert.deepEqual(await idsConcedidos(atores.a.id), [], 'piso: parte de vazio');

    const g = await conceder('admin', atores.a.id, 'view');
    assert.deepEqual(await idsConcedidos(atores.a.id), [RECURSO], 'viva: o predicado devolve');
    assert.deepEqual(await visiveis('a'), [RECURSO], 'viva: o payload aditivo entrega');

    await expirar(g.id);
    assert.deepEqual(await idsConcedidos(atores.a.id), [], 'vencida: some do predicado');
    assert.deepEqual(await visiveis('a'), [], 'vencida: some do payload');

    // EXPIRADA NÃO É REVOGADA, e a distinção é o que faz toda consulta que define
    // "viva" como `revoked_at IS NULL` estar definindo errado desde que o prazo existe.
    const linha = await linhaDoGrant(g.id);
    assert.equal(linha.revoked_at, null, 'a linha continua NÃO revogada: só o relógio passou');

    await renovar(g.id);
    assert.deepEqual(await idsConcedidos(atores.a.id), [RECURSO], 'renovada: volta (controle da reversão)');
    assert.deepEqual(await visiveis('a'), [RECURSO]);

    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = $1', [g.id]);
  });

  // ---------------------------------------------------------------------------
  // D4: o empréstimo por atlas morre junto com a concessão do DONO
  // ---------------------------------------------------------------------------
  it('D4: a expiração da concessão do DONO derruba o empréstimo, inclusive para o visitante anônimo', async () => {
    const gDono = await conceder('admin', atores.dono.id, 'view_share', { recurso: EMPRESTADO });
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, $2, $3, $4)`,
      [atlas.id, TIPO, EMPRESTADO, atores.dono.id]
    );

    // O ESTRANHO NÃO TEM CONCESSÃO NENHUMA: tudo o que ele vê vem do empréstimo, e
    // sem esta linha o caso mediria o braço direto do predicado, não o D4.
    assert.deepEqual(await idsConcedidos(atores.estranho.id), [], 'piso: o estranho não tem concessão direta');
    assert.deepEqual(
      await idsConcedidos(atores.estranho.id, atlas.id), [EMPRESTADO],
      'com o atlas em foco, o empréstimo entrega'
    );
    assert.deepEqual(
      await idsConcedidos(null, atlas.id), [EMPRESTADO],
      'o visitante de link público (sem linha em users) herda o empréstimo'
    );
    assert.deepEqual(await visiveis('estranho', atlas.id), [EMPRESTADO], 'e o payload aditivo concorda');

    // O PONTO DESTE CASO. `fn_granted_resource_ids` consulta `resource_grants` em
    // DOIS sítios (o braço direto e o EXISTS do D4). Pôr o prazo só no primeiro
    // deixaria o empréstimo vivo com a concessão do dono já vencida — o vazamento
    // ficaria no braço que ninguém olha, e o caso acima continuaria verde.
    await expirar(gDono.id);
    assert.deepEqual(await idsConcedidos(atores.estranho.id, atlas.id), [], 'dono vencido, empréstimo cai');
    assert.deepEqual(await idsConcedidos(null, atlas.id), [], 'inclusive para o visitante anônimo');
    assert.deepEqual(await visiveis('estranho', atlas.id), [], 'e o payload aditivo cai junto');

    await renovar(gDono.id);
    assert.deepEqual(
      await idsConcedidos(atores.estranho.id, atlas.id), [EMPRESTADO],
      'renovar a concessão do dono devolve o empréstimo (controle da reversão)'
    );
  });

  // ---------------------------------------------------------------------------
  // VER e REPASSAR morrem juntos
  // ---------------------------------------------------------------------------
  it('com o prazo vencido o titular não vê, some de `shareable` e não repassa mais', async () => {
    const g = await conceder('admin', atores.b.id, 'view_share');

    assert.deepEqual(await visiveis('b'), [RECURSO], 'piso: vivo, ele vê');
    assert.ok(
      (await repassaveis('b')).includes(RECURSO),
      'piso: vivo, a interface pode oferecer o botão de compartilhar'
    );
    const filho = await conceder('b', atores.c.id, 'view');
    assert.equal(filho.parent_grant_id, g.id, 'piso: o filho pendura no pai vivo');

    await expirar(g.id);
    assert.deepEqual(await visiveis('b'), [], 'vencido: não vê');
    assert.deepEqual(
      await repassaveis('b'), [],
      'vencido: some de `shareable` — oferecer o botão seria oferecer um formulário que responde 403'
    );
    // O QUE ESTE 403 IMPEDE: sem o prazo em `LIVE_GRANTS_OF_ACTOR`, quem já não VÊ o
    // recurso continuaria podendo REPASSÁ-LO, e a concessão nova nasceria pendurada
    // num pai morto. É escalação, não cosmética.
    await conceder('b', atores.d.id, 'view', {}, 403);

    await renovar(g.id);
    const depois = await conceder('b', atores.d.id, 'view');
    assert.equal(depois.parent_grant_id, g.id, 'renovado: volta a repassar, e o pai é o mesmo');

    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = ANY($1::uuid[])',
      [[g.id, filho.id, depois.id]]);
  });

  // ---------------------------------------------------------------------------
  // O CHECK da tabela: teto, piso e o valor que passa
  // ---------------------------------------------------------------------------
  it('o CHECK recusa o prazo de dois anos E a concessão que nasce morta, e aceita 364 dias', async () => {
    const inserir = (expr) => db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by, expires_at)
       VALUES ($1, $2, $3, 'view', $4, ${expr}) RETURNING id, expires_at`,
      [TIPO, RECURSO, atores.c.id, atores.admin.id]
    );

    await assert.rejects(
      () => inserir("NOW() + INTERVAL '2 years'"),
      /resource_grants_expires_at_check/,
      'o teto de um ano precisa ser cobrado pela TABELA, não só pela borda: o INSERT cru existe'
    );
    await assert.rejects(
      () => inserir("NOW() - INTERVAL '1 second'"),
      /resource_grants_expires_at_check/,
      'o piso recusa a concessão que nasce morta, que só pode ser erro de chamador'
    );

    // O TERCEIRO, QUE É O QUE DISCRIMINA: sem ele, "rejeita" também é o que se mede
    // num CHECK que rejeita tudo.
    const { rows } = await inserir("NOW() + INTERVAL '364 days'");
    assert.equal(rows.length, 1, 'o prazo dentro do teto precisa ser aceito');
    const dias = (new Date(rows[0].expires_at).getTime() - Date.now()) / DIA_MS;
    assert.ok(dias > 363 && dias < 365, `esperava ~364 dias, gravou ${dias}`);
    await db.query('DELETE FROM resource_grants WHERE id = $1', [rows[0].id]);
  });

  // ---------------------------------------------------------------------------
  // A borda HTTP
  // ---------------------------------------------------------------------------
  it('a borda recusa o pedido acima de um ano com 422 e nome de campo, e honra o pedido menor', async () => {
    const alem = new Date(Date.now() + UM_ANO_MS + 30 * DIA_MS).toISOString();
    const res = await supertest(app)
      .post(`/api/v1/resource-access/${TIPO}/${RECURSO}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.c.id, grantLevel: 'view', expiresAt: alem })
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.match(
      JSON.stringify(res.body), /expiresAt/,
      'o 422 precisa nomear o campo: o CHECK da tabela só sabe dizer "Value violates a constraint"'
    );

    // NADA FOI GRAVADO, e afirmar isso separa "recusou" de "recusou depois de escrever".
    const { rows: nenhuma } = await db.query(
      `SELECT id FROM resource_grants WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [RECURSO, atores.c.id]
    );
    assert.deepEqual(nenhuma, [], 'o pedido recusado não pode ter deixado linha');

    const trintaDias = new Date(Date.now() + 30 * DIA_MS).toISOString();
    const ok = await conceder('admin', atores.c.id, 'view', { expiresAt: trintaDias });
    const dias = (new Date(ok.expires_at).getTime() - Date.now()) / DIA_MS;
    assert.ok(dias > 29 && dias < 31, `o pedido menor é honrado; esperava ~30 dias, gravou ${dias}`);

    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = $1', [ok.id]);
  });

  it('sem pedido, a concessão de RAIZ nasce com o teto de um ano', async () => {
    const g = await conceder('admin', atores.d.id, 'view');
    assert.equal(g.parent_grant_id, null, 'papel global concede de raiz: não há pai de quem herdar prazo');
    const dias = (new Date(g.expires_at).getTime() - Date.now()) / DIA_MS;
    assert.ok(dias > 364 && dias < 366, `esperava ~365 dias, gravou ${dias}`);
    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = $1', [g.id]);
  });

  // ---------------------------------------------------------------------------
  // Filho nunca expira depois do pai
  // ---------------------------------------------------------------------------
  it('filho nunca expira depois do pai: o teto do pai poda o pedido maior, e o pedido menor é honrado', async () => {
    const pai = await conceder('admin', atores.a.id, 'view_share');
    await db.query(
      `UPDATE resource_grants SET expires_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
      [pai.id]
    );
    const prazoDoPai = (await linhaDoGrant(pai.id)).expires_at;

    // O filho PEDE um ano e recebe o prazo do pai. Recusar seria pior: transformaria
    // um pedido razoável em erro só porque o pai vence antes.
    const grande = new Date(Date.now() + 360 * DIA_MS).toISOString();
    const filho = await conceder('a', atores.b.id, 'view', { expiresAt: grande });
    assert.equal(
      new Date(filho.expires_at).getTime(), new Date(prazoDoPai).getTime(),
      'o filho recebeu EXATAMENTE o prazo do pai, não o que pediu'
    );

    // O PAR: um pedido MENOR que o teto do pai é honrado como pedido. Sem ele, o
    // caso acima passaria idêntico numa implementação que ignorasse o pedido e
    // sempre copiasse o pai.
    const pequeno = new Date(Date.now() + 10 * DIA_MS).toISOString();
    const neto = await conceder('a', atores.c.id, 'view', { expiresAt: pequeno });
    const diasDoNeto = (new Date(neto.expires_at).getTime() - Date.now()) / DIA_MS;
    assert.ok(diasDoNeto > 9 && diasDoNeto < 11, `esperava ~10 dias, gravou ${diasDoNeto}`);

    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = ANY($1::uuid[])',
      [[pai.id, filho.id, neto.id]]);
  });

  it('pai já vencido não gera filho: 403 na borda, e o par vivo em 201', async () => {
    const pai = await conceder('admin', atores.a.id, 'view_share');
    await expirar(pai.id);

    await conceder('a', atores.d.id, 'view', {}, 403);
    const { rows: nada } = await db.query(
      `SELECT id FROM resource_grants WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [RECURSO, atores.d.id]
    );
    assert.deepEqual(nada, [], 'o 403 precisa ser sem efeito: nenhum filho pendurado num pai morto');

    await renovar(pai.id);
    const filho = await conceder('a', atores.d.id, 'view');
    assert.equal(filho.parent_grant_id, pai.id, 'com o pai vivo, o mesmo pedido passa');

    await db.query('UPDATE resource_grants SET revoked_at = NOW() WHERE id = ANY($1::uuid[])',
      [[pai.id, filho.id]]);
  });

  // ---------------------------------------------------------------------------
  // A MORTE MORA NO PREDICADO: leitura das fontes, sem banco
  // ---------------------------------------------------------------------------
  //
  // Estes dois casos são ESTRUTURAIS de propósito. O comportamento acima prova que
  // o prazo funciona HOJE; estes dois prendem o DESENHO, que é o que uma manutenção
  // futura pode desfazer sem quebrar nada dos casos anteriores: acrescentar um
  // sweeper (que passaria verde e criaria um segundo verificador, quebrando calado
  // no dia em que o cron não rodar) ou esquecer o prazo numa das consultas que
  // definem "concessão viva".

  it('as consultas de "concessão viva" cobram o prazo, e a função VIVA o cobra nos DOIS sítios', async () => {
    const queries = fs.readFileSync(
      path.join(RAIZ, 'src/modules/resource-access/resource-access.queries.js'), 'utf8'
    );
    // As quatro que definem "viva" fora da função de resolução. Duas delas decidem
    // quem pode REPASSAR, e é por isso que esquecer o prazo aqui é escalação, não
    // cosmética.
    const VIVAS = [
      'LIST_SHAREABLE_OF_ACTOR', 'LIST_GRANTS_FOR_RESOURCE',
      'LIVE_GRANTS_OF_ACTOR', 'LIVE_GRANT_FROM_ACTOR_TO_GRANTEE',
    ];
    const semPrazo = VIVAS.filter((nome) => {
      const i = queries.indexOf(`export const ${nome} = \``);
      const corpo = i === -1 ? '' : queries.slice(i, queries.indexOf('`;', i));
      return !/revoked_at IS NULL/.test(corpo) || !/expires_at > NOW\(\)/.test(corpo);
    });
    assert.deepEqual(
      semPrazo, [],
      'consulta que define "concessão viva" só por `revoked_at IS NULL` está definindo errado'
    );

    // A DEFINIÇÃO VIVA, POR INTROSPECÇÃO, e não o texto do arquivo de migração — esta é a
    // re-ancoragem de 2026-08-20 e ela É o fix, não higiene. O bloco anterior lia a baseline
    // do disco e contava as ocorrências ali, e naquele momento havia uma migração posterior
    // que redefinia `fn_granted_resource_ids` com `CREATE OR REPLACE`: o texto lido descrevia
    // uma definição MORTA. Reverter o termo de produção do braço D4 deixava o teste VERDE,
    // porque o arquivo continuava lá com três ocorrências — o empréstimo do produtor voltava
    // a não resolver para ninguém e nada ficava vermelho. Verificação-fantasma de manual.
    //
    // A migração que motivou isto foi absorvida pela baseline em 2026-08-22, e hoje há UMA
    // definição só. A introspecção fica assim mesmo: ela é a única leitura que continua certa
    // no dia em que alguém acrescentar o próximo degrau.
    const { rows } = await db.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'fn_granted_resource_ids'"
    );
    assert.equal(
      rows.length, 1,
      'esperava EXATAMENTE uma definição viva. Duas é o modo de falha de quem "redefine" '
      + 'acrescentando parâmetro: cria uma SOBRECARGA e deixa todo chamador antigo resolvendo '
      + 'para o texto velho, em silêncio'
    );
    const ocorrencias = rows[0].def.match(/expires_at > NOW\(\)/g) ?? [];
    assert.equal(
      ocorrencias.length, 3,
      'o prazo entra no braço DIRETO, no braço de GRUPO e no EXISTS do D4. Só no primeiro, o '
      + 'empréstimo de atlas '
      + 'sobrevive à expiração da concessão do dono — a morte moraria em metade do predicado'
    );
    // E a contagem continua sendo TRÊS, e não quatro, porque o termo de produção que a
    // migração nova acrescentou ao braço D4 NÃO carrega prazo: escopo de produção não vence
    // sozinho (só sai por ato de administrador), ao contrário da concessão. A
    // assimetria é deliberada e está registrada.
    assert.match(
      rows[0].def, /fn_can_produce_resource\(a\.owner_id/,
      'o braço D4 precisa reconhecer a PRODUÇÃO do dono do atlas'
    );

    // A PROPRIEDADE DA BASELINE, QUE A RE-ANCORAGEM ACIMA TINHA DEIXADO CAIR. O bloco
    // antigo lia a migração do disco e, junto com a contagem que envelheceu, asseria que
    // a baseline usa `CREATE FUNCTION` e NÃO `CREATE OR REPLACE`: numa baseline nada está
    // sendo substituído, e o plano tem de falhar ALTO numa colisão de nome em vez de
    // sobrescrever calado uma função que outra migração criou. Trocar a introspecção pela
    // leitura de arquivo foi o fix certo para o defeito medido, e apagou esta propriedade
    // de passagem: ela não é asserida em nenhum outro lugar do repositório.
    //
    // Repare que as duas asserções olham para ALVOS DIFERENTES: a de cima, para a
    // definição VIVA no banco; estas, para o TEXTO da baseline no disco. Uma não substitui
    // a outra.
    const baseline = fs.readFileSync(
      path.join(RAIZ, 'src/database/migrations/008_acesso_a_recurso.sql'), 'utf8'
    );
    assert.match(
      baseline, /^CREATE FUNCTION fn_granted_resource_ids\(/m,
      'a baseline cria a função, e é ela quem falha alto se o nome já existir'
    );
    assert.doesNotMatch(
      baseline, /CREATE OR REPLACE FUNCTION fn_granted_resource_ids\(/,
      'na baseline não há nada a substituir: `OR REPLACE` ali sobrescreveria em silêncio'
    );
    // A DISCRIMINAÇÃO MUDOU DE ALVO com a consolidação do schema. Ela era sobre um PAR (a
    // baseline cria, o degrau seguinte redefine com `CREATE OR REPLACE`), e o degrau foi
    // absorvido: sem ele, aquela metade mediria um arquivo que não existe.
    //
    // O QUE ESTA ASSERÇÃO PEGA, E SÓ ELA: a SOBRECARGA. Medido, não suposto. Duplicar uma
    // função com a MESMA assinatura já é pego duas vezes antes daqui — o Postgres recusa
    // ("já existe com os mesmos tipos de argumento"), e a asserção de cima exige que a
    // baseline use `CREATE FUNCTION` sem `OR REPLACE`, que é o que faz o banco falhar alto em
    // vez de sobrescrever calado. Já duas definições com assinaturas DIFERENTES o Postgres
    // ACEITA, e o que sobra é um leitor achando duas definições da mesma função e descrevendo
    // a que o chamador não usa.
    const migracoes = fs.readdirSync(path.join(RAIZ, 'src/database/migrations'))
      .filter((f) => f.endsWith('.sql'));
    assert.ok(migracoes.length >= 5, `esperava >= 5 migrações, achei ${migracoes.length}`);
    const definicoes = migracoes.flatMap((f) => {
      const texto = fs.readFileSync(path.join(RAIZ, 'src/database/migrations', f), 'utf8');
      return [...texto.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION\s+([\w.]+)\s*\(/gm)]
        .map((m) => `${f} -> ${m[1]}`);
    });
    assert.ok(definicoes.length >= 10, `esperava >= 10 funções declaradas, achei ${definicoes.length}`);
    const porNome = new Map();
    for (const d of definicoes) {
      const nome = d.split(' -> ')[1];
      porNome.set(nome, (porNome.get(nome) ?? 0) + 1);
    }
    const duplicadas = [...porNome.entries()].filter(([, n]) => n > 1).map(([nome]) => nome);
    assert.deepEqual(
      duplicadas, [],
      'função declarada em MAIS DE UM lugar entre as migrações: a última vence sem erro, e o '
      + 'Postgres ACEITA a sobrecarga, e o leitor passa a achar duas definições da mesma função'
    );
  });

  it('não existe varredura que aplique a expiração escrevendo `revoked_at`', () => {
    const versionados = execFileSync('git', ['ls-files', 'src'], { cwd: RAIZ, encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.js'));
    assert.ok(versionados.length >= 100, `esperava >= 100 arquivos versionados, achei ${versionados.length}`);

    const fontes = versionados.map((a) => ({ arquivo: a, texto: fs.readFileSync(path.join(RAIZ, a), 'utf8') }));
    const falamDaTabela = fontes.filter((f) => /resource_grants/.test(f.texto)).map((f) => f.arquivo);
    // Discriminação: a varredura precisa estar OLHANDO para a tabela certa. Sem
    // este piso, "nenhum sweeper" é o que se mede quando o nome da tabela mudou.
    assert.ok(falamDaTabela.length >= 2, `esperava >= 2 arquivos falando de resource_grants, achei ${falamDaTabela.length}`);

    // A VARREDURA É FILTRADA PELA TABELA, e não pelo nome da coluna: `revoked_at`
    // também é coluna de `refresh_tokens`, e o logout de sessão escreve nela em dois
    // outros módulos. Sem o filtro, este caso reprovaria por um mecanismo que não
    // tem nada a ver com concessão de recurso.
    const escrevemRevogacao = fontes
      .filter((f) => /resource_grants/.test(f.texto) && /revoked_at\s*=\s*NOW\(\)/i.test(f.texto))
      .map((f) => f.arquivo);
    assert.deepEqual(
      escrevemRevogacao, ['src/modules/resource-access/resource-access.queries.js'],
      'só a REVOGAÇÃO escreve `revoked_at`. Um sweeper que traduzisse prazo vencido em revogação '
      + 'seria mais um verificador, e verificador quebra calado: no dia em que ele não roda, o '
      + 'acesso expirado continua vivo e nada fica vermelho'
    );

    // E DENTRO DAQUELE ARQUIVO, UMA ESCRITA SÓ (a poda da subárvore). Sem esta
    // contagem, um `UPDATE ... SET revoked_at = NOW() WHERE expires_at < NOW()`
    // acrescentado ao MESMO arquivo passaria verde na lista acima.
    const noArquivoDaPoda = fontes.find((f) => f.arquivo.endsWith('resource-access.queries.js'));
    assert.ok(noArquivoDaPoda, 'o arquivo de consultas de concessão precisa existir');
    const escritas = noArquivoDaPoda.texto.match(/revoked_at\s*=\s*NOW\(\)/gi) ?? [];
    assert.equal(escritas.length, 1, 'a única escrita de `revoked_at` é a poda da subárvore');

    const agendados = fontes
      .filter((f) => /resource_grants/.test(f.texto) && /setInterval|node-cron|cron\.schedule/.test(f.texto))
      .map((f) => f.arquivo);
    assert.deepEqual(agendados, [], 'nenhum agendamento periódico pode tocar as concessões');
  });
});
