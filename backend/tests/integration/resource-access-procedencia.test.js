// Path: tests/integration/resource-access-procedencia.test.js
//
// A PROCEDÊNCIA de cada recurso do payload aditivo (`data.origins`).
//
// O DEFEITO QUE ELA FECHA É DE TELA, e ele estava escrito por extenso no cliente: um selo
// único "Privado" com o título "só quem recebeu acesso enxerga este item", desenhado para
// TRÊS procedências diferentes. A frase é falsa para duas delas — o credenciado e o
// administrador não receberam nada de ninguém, e o produtor tampouco: eles enxergam por
// QUEM SÃO.
//
// A PROPRIEDADE QUE A TELA VAI USAR, e é a única que justifica separar os três valores:
// **só `emprestimo` some sozinho quando a pessoa troca de atlas.** Papel e concessão são
// estáveis. Daí a precedência `papel > concessao > emprestimo`, que este arquivo mede no
// caso que a torna necessária: quem tem concessão própria E empréstimo continua vendo o
// recurso fora daquele atlas, então rotulá-lo `emprestimo` mentiria justamente na
// propriedade afirmada.
//
// O QUE CADA CASO PRECISARIA MEDIR SE O CÓDIGO ESTIVESSE ERRADO (o controle negativo,
// conferido revertendo de fato):
//   - apagar a coluna `por_papel_global` do SELECT faz o administrador cair em
//     `emprestimo` (a derivação é por eliminação), e os dois primeiros casos ficam
//     vermelhos;
//   - passar `$2` (o atlas em foco) no lugar do `NULL::uuid` de `fn_granted_resource_ids`
//     dentro de `originColumns` faz o emprestado virar `concessao`, e o caso do
//     empréstimo puro fica vermelho;
//   - inverter a precedência (concessão antes de papel, ou empréstimo antes de concessão)
//     fica vermelho no caso do acúmulo.
//
// E O CASO ESTRUTURAL, que é o que impede o conjunto de envelhecer: TODO id que aparece
// nos cinco grupos precisa aparecer em `origins`. Um id sem procedência é um selo que o
// cliente degrada para a frase genérica — ou seja, o defeito de volta, num item só e sem
// nada vermelho.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, createShare, loginUser,
  makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

const GRUPOS = ['basemaps', 'tilesets', 'dataLayers', 'analysisLayers', 'views360'];

describe('procedência: por que este chamador enxerga este recurso privado', () => {
  let app, db, orgId;
  let admin, credenciado, produtor, beneficiario, membroDoAtlas, acumulador, forasteiro;
  const token = {};
  let atlasQueEmpresta, atlasPublico, tokenVisitante;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `proc-inst-${sufixo}`;      // institucional (owner_org_id NULL)
  const TILESET_OM = `proc-om-${sufixo}`;     // mantido pela OM do produtor
  const SLUG_360 = `proc360-${sufixo}`;
  let projeto360Id;

  /** O payload aditivo inteiro, com ou sem atlas em foco. */
  const visiveis = async (quem, atlasId = null) => {
    const req = supertest(app).get(
      `/api/v1/resource-access/visible${atlasId ? `?atlasId=${atlasId}` : ''}`
    );
    if (quem) req.set('Authorization', `Bearer ${token[quem]}`);
    return (await req.expect(200)).body.data;
  };

  const conceder = (type, resourceId, granteeId, grantLevel = 'view') => supertest(app)
    .post(`/api/v1/resource-access/${type}/${resourceId}/grants`)
    .set('Authorization', `Bearer ${token.admin}`)
    .send({ granteeId, grantLevel })
    .expect(201);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: orgs } = await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM proc ${sufixo}`, `omproc-${sufixo}`, `P${sufixo.slice(0, 4)}`]
    );
    orgId = orgs[0].id;

    admin = await createAdminUser(db, { username: `proc_admin_${sufixo}` });
    // O CREDENCIADO É O SUJEITO CENTRAL DESTE ARQUIVO, e não um caso a mais: ele é a
    // pessoa para quem a frase antiga do selo ("só quem recebeu acesso enxerga este item")
    // é literalmente falsa. Ele também é o ÚNICO que discrimina a coluna
    // `fn_has_global_data_access` das outras duas — medido: apagando aquela coluna, o
    // administrador continua verde, porque `fn_can_produce_resource` tem ramo de admin, e
    // só o credenciado fica vermelho.
    credenciado = await createUser(db, { username: `proc_cred_${sufixo}`, role: 'credenciado' });
    produtor = await createProducerUser(db, orgId, { username: `proc_prod_${sufixo}` });
    beneficiario = await createUser(db, { username: `proc_ben_${sufixo}` });
    membroDoAtlas = await createUser(db, { username: `proc_membro_${sufixo}` });
    acumulador = await createUser(db, { username: `proc_acum_${sufixo}` });
    forasteiro = await createUser(db, { username: `proc_fora_${sufixo}` });
    for (const [nome, u] of Object.entries({
      admin, credenciado, produtor, beneficiario, membroDoAtlas, acumulador, forasteiro,
    })) {
      token[nome] = await loginUser(app, u.username, u.password);
    }

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset institucional ${sufixo}`]
    );
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level, owner_org_id)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private', $3)`,
      [TILESET_OM, `Tileset da OM ${sufixo}`, orgId]
    );
    const { rows: p360 } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, access_level)
       VALUES ($1, $2, $3, $4, 'private') RETURNING id::text AS id`,
      [orgId, SLUG_360, `Projeto 360 ${sufixo}`, `${orgId}__${SLUG_360}.db`]
    );
    projeto360Id = p360[0].id;

    // O ATLAS QUE EMPRESTA é do ADMINISTRADOR de propósito: D4 diz que o empréstimo vive
    // enquanto o DONO do atlas vir o recurso, e o papel global é a forma mais estável de
    // isso ser verdade durante o arquivo inteiro.
    atlasQueEmpresta = await createAtlas(db, admin.id, { name: `Atlas empresta ${sufixo}` });
    atlasPublico = await createAtlas(db, admin.id, { name: `Atlas publico ${sufixo}` });
    // TODO MUNDO QUE VAI PASSAR `?atlasId=` PRECISA ALCANÇAR O ATLAS. `requireAtlasScopeWhenPresent`
    // roda `requireAtlasPermission('read')` de verdade: sem share, o UUID do atlas responde 404, e
    // esse 404 é a propriedade certa (o UUID não é senha) — só não é o assunto DESTE arquivo.
    for (const u of [membroDoAtlas, acumulador, beneficiario, produtor]) {
      await createShare(db, atlasQueEmpresta.id, u.id, 'read', admin.id);
    }

    for (const atlas of [atlasQueEmpresta, atlasPublico]) {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/resources`)
        .set('Authorization', `Bearer ${token.admin}`)
        .send({ resourceType: 'tileset', resourceId: TILESET })
        .expect(201);
    }
    tokenVisitante = await getPublicToken(app, await makeAtlasPublic(db, atlasPublico.id));

    await conceder('tileset', TILESET, beneficiario.id);
    // O ACUMULADOR tem os DOIS caminhos ao mesmo tempo: concessão pessoal e o empréstimo
    // do atlas de que ele participa. É o caso que a precedência existe para resolver.
    await conceder('tileset', TILESET, acumulador.id);
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id IN ($1, $2, $3)',
      [TILESET, TILESET_OM, projeto360Id]);
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id IN ($1, $2)', [TILESET, TILESET_OM]);
    await db.query('DELETE FROM sv360.projects WHERE id = $1::uuid', [projeto360Id]);
    await teardownTestEnv(db);
  });

  it('as CINCO chaves de `origins` existem sempre, mesmo para quem não enxerga nada', async () => {
    // O SHAPE ESTÁVEL É METADE DO CONTRATO: o cliente nunca deve precisar distinguir "sem
    // procedência" de "o servidor não respondeu essa parte", e a única forma de garantir
    // isso é a chave existir vazia. O forasteiro é o caso em que todas ficam vazias.
    const dele = await visiveis('forasteiro');
    assert.deepEqual(Object.keys(dele.origins).sort(), [...GRUPOS].sort());
    for (const g of GRUPOS) {
      assert.deepEqual(dele.origins[g], {}, `${g}: o forasteiro não tem procedência nenhuma`);
    }
    // E O POSITIVO DO MESMO PAR, sem o qual "tudo vazio" seria também o que se mede se a
    // rota tivesse parado de responder o payload: o administrador enxerga o mesmo tileset.
    const doAdmin = await visiveis('admin');
    assert.ok(doAdmin.tilesets.map((t) => t.id).includes(TILESET));
  });

  it('papel GLOBAL e PRODUÇÃO são `papel`: quem enxerga por quem é, não por ter recebido', async () => {
    const doAdmin = await visiveis('admin');
    assert.equal(doAdmin.origins.tilesets[TILESET], 'papel');
    assert.equal(doAdmin.origins.tilesets[TILESET_OM], 'papel');

    // O PRODUTOR enxerga SÓ o da própria OM, e pelo mesmo motivo estrutural: é fato de
    // quem ele é. Se a produção caísse em `concessao`, a tela prometeria a ele que o
    // acesso veio de alguém e pode ser revogado por essa pessoa.
    const doProdutor = await visiveis('produtor');
    assert.equal(doProdutor.origins.tilesets[TILESET_OM], 'papel');
    assert.equal(doProdutor.origins.tilesets[TILESET], undefined,
      'discriminação: o produtor NÃO enxerga o institucional, então ele não pode ter procedência');
  });

  it('o CREDENCIADO é `papel`, e é ele que discrimina o braço de papel global', async () => {
    // A FRASE ANTIGA DO SELO ("só quem recebeu acesso enxerga este item") é falsa
    // exatamente aqui: o credenciado não recebeu nada de ninguém, não produz nada e não
    // está em atlas nenhum. Ele enxerga por LER TODO RECURSO PRIVADO, que é o papel dele.
    const dele = await visiveis('credenciado');
    assert.equal(dele.origins.tilesets[TILESET], 'papel');
    assert.equal(dele.origins.tilesets[TILESET_OM], 'papel');
    assert.equal(dele.origins.views360[projeto360Id], 'papel');

    // E O QUE ISTO DISCRIMINA, medido revertendo: trocar `fn_has_global_data_access` por
    // um `false` nas colunas de procedência deixa o ADMINISTRADOR verde (porque
    // `fn_can_produce_resource` tem ramo de admin) e derruba SÓ este caso. Sem ele, o
    // conserto do braço de papel global não teria vermelho nenhum a produzir.
    assert.ok(dele.tilesets.map((t) => t.id).includes(TILESET),
      'piso: o credenciado precisa RECEBER o recurso, senão a procedência acima mede o vazio');
  });

  it('concessão pessoal é `concessao`, e ela NÃO depende do atlas em foco', async () => {
    const semAtlas = await visiveis('beneficiario');
    assert.equal(semAtlas.origins.tilesets[TILESET], 'concessao');

    // A ESTABILIDADE É A AFIRMAÇÃO, e não um detalhe: é ela que separa este valor do
    // empréstimo. Com um atlas em foco que TAMBÉM empresta, o rótulo não muda.
    const comAtlas = await visiveis('beneficiario', atlasQueEmpresta.id);
    assert.equal(comAtlas.origins.tilesets[TILESET], 'concessao');
  });

  it('empréstimo é `emprestimo`, e ele DESAPARECE quando o atlas sai de foco', async () => {
    const dentro = await visiveis('membroDoAtlas', atlasQueEmpresta.id);
    assert.equal(dentro.origins.tilesets[TILESET], 'emprestimo');
    assert.ok(dentro.tilesets.map((t) => t.id).includes(TILESET));

    // O PAR NEGATIVO, que é a propriedade inteira: sem o atlas em foco o recurso some, e
    // com ele a procedência. Um `emprestimo` que sobrevivesse à troca de atlas seria a
    // mentira que o selo único já contava.
    const fora = await visiveis('membroDoAtlas');
    assert.ok(!fora.tilesets.map((t) => t.id).includes(TILESET));
    assert.equal(fora.origins.tilesets[TILESET], undefined);
  });

  it('acumulando os dois, vale `concessao` — é a que sobrevive à troca de atlas', async () => {
    const dentro = await visiveis('acumulador', atlasQueEmpresta.id);
    assert.equal(dentro.origins.tilesets[TILESET], 'concessao',
      'quem tem concessão própria E empréstimo continua vendo o recurso fora do atlas: '
      + 'rotulá-lo `emprestimo` mentiria na propriedade que a tela vai afirmar');

    // A PROVA DA AFIRMAÇÃO ACIMA, medida e não deduzida: fora do atlas ele continua vendo.
    const fora = await visiveis('acumulador');
    assert.ok(fora.tilesets.map((t) => t.id).includes(TILESET));
    assert.equal(fora.origins.tilesets[TILESET], 'concessao');
  });

  it('o visitante ANÔNIMO de link público cai em `emprestimo`, nunca em indefinido', async () => {
    // Ele não tem linha em `users` e chega com `userId` NULO: as duas funções de papel
    // respondem falso e `fn_granted_resource_ids` sai vazia. O empréstimo é o único
    // caminho que ele tem, e é o valor que a tela precisa receber — um `undefined` aqui
    // devolveria o selo genérico justamente a quem a frase menos descreve.
    const { body } = await supertest(app)
      .get(`/api/v1/resource-access/visible?atlasId=${atlasPublico.id}`)
      .set('Authorization', `Bearer ${tokenVisitante}`)
      .expect(200);
    const dados = body.data;
    assert.ok(dados.tilesets.map((t) => t.id).includes(TILESET),
      'piso: o visitante precisa RECEBER o recurso emprestado, senão a linha seguinte mede o vazio');
    assert.equal(dados.origins.tilesets[TILESET], 'emprestimo');
    assert.deepEqual(Object.keys(dados.origins).sort(), [...GRUPOS].sort());
  });

  it('o 360 carrega procedência pelo MESMO caminho, e sem contaminar o item', async () => {
    await conceder('sv360_project', projeto360Id, beneficiario.id);

    const doProdutor = await visiveis('produtor');
    assert.equal(doProdutor.origins.views360[projeto360Id], 'papel');
    const doBeneficiario = await visiveis('beneficiario');
    assert.equal(doBeneficiario.origins.views360[projeto360Id], 'concessao');

    // AS COLUNAS DE PROCEDÊNCIA NÃO PODEM VAZAR PARA DENTRO DO ITEM. A consulta do 360
    // devolvia a linha CRUA, então acrescentar colunas ao SELECT mudaria o shape de cada
    // item de `views360` — um payload que o cliente despeja em arrays de configuração.
    const item = doBeneficiario.views360.find((v) => v.id === projeto360Id);
    assert.ok(item, 'piso: o item precisa estar na lista');
    assert.deepEqual(
      Object.keys(item).sort(),
      ['capture_date', 'center_lat', 'center_long', 'entry_photo_id', 'id', 'name',
        'photo_count', 'slug', 'status'],
      'o item do 360 mantém exatamente os campos de antes das colunas de procedência'
    );
  });

  it('TODO id dos cinco grupos tem procedência — um sem ela é o selo genérico de volta', async () => {
    // O CASO ESTRUTURAL. Ele não mede um valor, mede a COBERTURA: os casos acima
    // conferem os três rótulos em ids escolhidos à mão, e envelheceriam calados se um
    // grupo novo (ou um caminho novo) passasse a devolver item sem entrada em `origins`.
    const VALIDAS = new Set(['papel', 'concessao', 'emprestimo']);
    const semProcedencia = [];
    let medidos = 0;
    for (const quem of ['admin', 'produtor', 'beneficiario', 'acumulador']) {
      for (const atlasId of [null, atlasQueEmpresta.id]) {
        const dados = await visiveis(quem, atlasId);
        for (const grupo of GRUPOS) {
          for (const item of dados[grupo]) {
            medidos += 1;
            const origem = dados.origins[grupo][item.id];
            if (!VALIDAS.has(origem)) {
              semProcedencia.push(
                `${quem}/${atlasId ?? 'sem atlas'}: ${grupo}/${item.id} -> ${String(origem)}`
              );
            }
          }
        }
      }
    }
    assert.ok(medidos >= 8, `guarda: a varredura precisa ter medido itens de verdade, mediu ${medidos}`);
    assert.deepEqual(
      semProcedencia, [],
      'item entregue no payload aditivo sem entrada em `origins`: o cliente degrada esse selo '
      + 'para a frase genérica, que é o defeito que este arquivo inteiro existe para fechar'
    );
  });
});
