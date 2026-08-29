// Path: tests/integration/catalogo-video-de-previa.test.js
//
// O VÍDEO DE PRÉVIA VALE PARA QUATRO TIPOS, E O DE-PARA NÃO VAZA A URL.
//
// DUAS COISAS SÃO MEDIDAS AQUI, e elas vão juntas porque entram no mesmo commit:
//
//   1. `previewVideo` deixou de ser só do 3D. Ele vale para TILESET, CAMADA DE DADOS,
//      CAMADA DE ANÁLISE (as três pelo `config` JSONB, com a chave agora DECLARADA no
//      Joi) e PROJETO 360 (por coluna, `sv360.projects.preview_video`, porque aquela
//      tabela não tem `config`).
//
//      O BASEMAP FICA DE FORA, e é decisão registrada, não esquecimento: ele é o único
//      dos cinco que não aparece como cartão de catálogo — a superfície dele é o seletor
//      de camada base, uma lista compacta sem lugar para uma afordância de mídia. Campo
//      de escrita sem superfície de leitura é afordância que mente. Como `config` é livre,
//      um basemap ACEITA a chave como aceita qualquer outra, então não há comportamento a
//      medir deste lado: a metade verificável da decisão é o formulário do painel, e ela
//      está asserida em `frontend/tests/unit/video-de-previa-fiacao.test.js`
//      (`expect(categorias).not.toContain('basemap')`). Este arquivo teve, por uma revisão,
//      um `it` com `assert.ok(true)` no lugar deste parágrafo: ele não podia ficar vermelho
//      por causa nenhuma, e ainda inflava o denominador dos controles negativos abaixo.
//
//   2. A trilha de `CATALOG_UPDATE` passou a gravar um DE-PARA, e a URL do vídeo entra
//      por IMPRESSÃO, nunca literal. O caso do segredo é o CONTROLE que o lote pediu por
//      extenso: procurar a substring do segredo no JSON INTEIRO da linha de trilha, e não
//      só no campo onde se espera que ele estivesse.
//
// CONTROLES NEGATIVOS, EXECUTADOS E RE-MEDIDOS na revisão adversarial. Os números abaixo
// são desta árvore, com os SEIS casos atuais, e eles derrubam conjuntos DIFERENTES, que é o
// que prova que os seis não estão medindo a mesma coisa:
//   - voltar a regra do `data:` para `/^(?!data:)/` e tirar o `.trim()` nos DOIS schemas:
//     1 de 6 vermelho, o caso da borda. Trilha, listagem e alcance seguem verdes;
//   - tirar `preview_video` do SELECT de `LIST_PROJECTS`: 1 de 6 vermelho, e é OUTRO, o
//     caso da listagem. Foi o buraco que a revisão achou: a coluna entrou em DUAS consultas
//     públicas e só o `GET` por slug estava conferido, enquanto é a LISTAGEM que monta o
//     cartão do 360;
//   - apagar a filtragem por allowlist em `diffAuditavel` (todo campo classificado vira
//     VALOR literal): os DOIS casos de trilha ficam vermelhos (2 de 6) e a borda, a
//     listagem e o alcance seguem verdes — o segredo aparece no JSON da linha;
//   - trocar `diffAuditavel(antes, depois)` por `diffAuditavel(depois, depois)` no
//     controller (o de-para deixa de olhar para os valores ANTERIORES): os mesmos DOIS
//     casos de trilha ficam vermelhos, o que prova que a subconsulta `antes` os alimenta;
//   - devolver a LINHA INTEIRA como lado "depois" em vez da projeção de `CAMPOS_EDITAVEIS`:
//     1 de 6, só o caso do segredo, na asserção EXATA de `outros`. É o defeito real
//     que esta onda cometeu e corrigiu, e é a única asserção do arquivo que o pega.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createProducerUser, loginUser } from '../helpers/fixtures.js';

const RID = crypto.randomUUID().slice(0, 8);

/** O vídeo, com um token na query string: a URL É o segredo neste arquivo. */
const VIDEO_COM_SEGREDO = `https://midia.om.example.mil.br/previa.webm?sig=SEGREDONAOVAZAR${RID}`;
const SEGREDO = `SEGREDONAOVAZAR${RID}`;

/**
 * As três tabelas de catálogo que ganham o campo, pelo NOME DA ROTA.
 *
 * Rota e tabela não coincidem (`data-layers` monta `data_layers`, `app.js`), e é o tipo de
 * detalhe que devolve 404 em vez de erro de teste: a rota que não existe responde igual à
 * que existe e nega.
 */
const COM_VIDEO = ['tilesets', 'data-layers', 'analysis-layers'];

describe('Vídeo de prévia — quatro tipos, e o de-para sem a URL', () => {
  let app, db, orgId, slug360, projeto360;
  let tokenAdmin, tokenProdutor;

  const trilhaDe = async (targetId) => {
    const { rows } = await db.query(
      `SELECT action, target_type, target_org_id, details FROM audit_trail
        WHERE action = 'CATALOG_UPDATE' AND target_id = $1 ORDER BY created_at DESC`,
      [targetId],
    );
    return rows;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgId = (await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM video ${RID}`, `om-vid-${RID}`, `V${RID.slice(0, 3)}`],
    )).rows[0].id;

    const admin = await createAdminUser(db, { username: `vid_admin_${RID}` });
    const produtor = await createProducerUser(db, orgId, { username: `vid_prod_${RID}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenProdutor = await loginUser(app, produtor.username, produtor.password);

    slug360 = `vid-360-${RID}`;
    projeto360 = (await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 0) RETURNING id`,
      [orgId, slug360, `Projeto video ${RID}`, `${orgId}__${slug360}.db`],
    )).rows[0].id;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('piso: as TRÊS tabelas de catálogo aceitam `config.previewVideo` e o devolvem no GET', async () => {
    assert.equal(COM_VIDEO.length, 3, 'guarda: a varredura precisa saber quantas tabelas espera');
    for (const rota of COM_VIDEO) {
      const id = `vid-${rota}-${RID}`;
      await supertest(app).post(`/api/v1/${rota}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ id, name: `Recurso ${rota}`, config: { url: '/x' } })
        .expect(201);

      await supertest(app).put(`/api/v1/${rota}/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ config: { url: '/x', previewVideo: '/3d/videos/previa.webm' } })
        .expect(200);

      const res = await supertest(app).get(`/api/v1/${rota}/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      assert.equal(res.body.data.config.previewVideo, '/3d/videos/previa.webm',
        `${rota}: o vídeo tem de sobreviver ao round-trip`);
    }
  });

  it('o 360 grava o vídeo por rota PRÓPRIA, e ele aparece na forma pública em camelCase', async () => {
    // PISO — antes do ato, a forma pública já traz a chave, com null. Sem esta metade,
    // "a chave existe" depois seria indistinguível de "a chave nasceu agora, por acaso".
    const antes = await supertest(app).get(`/api/v1/sv360/projects/${slug360}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    assert.equal(antes.body.previewVideo, null, 'projeto sem vídeo devolve null, não undefined');

    const res = await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: VIDEO_COM_SEGREDO })
      .expect(200);
    assert.equal(res.body.preview_video, VIDEO_COM_SEGREDO, 'a rota administrativa devolve a linha crua');

    const depois = await supertest(app).get(`/api/v1/sv360/projects/${slug360}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    assert.equal(depois.body.previewVideo, VIDEO_COM_SEGREDO);

    // DISCRIMINAÇÃO — a forma congelada do 360 não ganha snake_case, e o `center`
    // aninhado continua lá. Um acréscimo aditivo que quebrasse a forma seria pior que a
    // ausência do campo, porque o visualizador inteiro lê esta resposta.
    assert.equal('preview_video' in depois.body, false, 'nada de snake_case no payload público');
    assert.deepEqual(Object.keys(depois.body.center).sort(), ['lat', 'lon']);

    // E o vídeo se REMOVE esvaziando o campo, que não pode ser no-op.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: '' })
      .expect(200);
    const limpo = await supertest(app).get(`/api/v1/sv360/projects/${slug360}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    assert.equal(limpo.body.previewVideo, null, 'esvaziar o campo REMOVE o vídeo');
  });

  it('o 360 se RENOMEIA pela mesma rota, e a atualização é PARCIAL (nome e vídeo não se apagam)', async () => {
    const nomeDe = async () => (await db.query(
      'SELECT name, preview_video FROM sv360.projects WHERE id = $1', [projeto360],
    )).rows[0];

    // Grava um vídeo primeiro, para provar que renomear não o apaga.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: '/3d/videos/fica.webm' })
      .expect(200);

    // Renomear manda SÓ o nome: o vídeo tem de sobreviver.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ name: `Renomeado ${RID}` })
      .expect(200);
    let linha = await nomeDe();
    assert.equal(linha.name, `Renomeado ${RID}`, 'o nome mudou');
    assert.equal(linha.preview_video, '/3d/videos/fica.webm', 'e o vídeo NÃO foi apagado pela renomeação');

    // O par: trocar SÓ o vídeo não reescreve o nome.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: '/3d/videos/outro.webm' })
      .expect(200);
    linha = await nomeDe();
    assert.equal(linha.name, `Renomeado ${RID}`, 'o nome sobreviveu à troca de vídeo');
    assert.equal(linha.preview_video, '/3d/videos/outro.webm');

    // Nome vazio é recusado (a coluna é NOT NULL).
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ name: '   ' })
      .expect(422);
    assert.equal((await nomeDe()).name, `Renomeado ${RID}`, 'a recusa não tocou o nome');

    // Limpa o vídeo para não vazar estado para os casos seguintes.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: '' })
      .expect(200);
  });

  it('os campos do cartão do 360 (palavra-chave, local, data, centro) gravam e saem na forma pública', async () => {
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({
        keywords: ['aman', 'auditorio'],
        location: 'Resende, RJ',
        captureDate: '2024-05',
        centerLat: -22.45,
        centerLong: -44.44,
      })
      .expect(200);

    const pub = await supertest(app).get(`/api/v1/sv360/projects/${slug360}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    assert.deepEqual(pub.body.keywords, ['aman', 'auditorio']);
    assert.equal(pub.body.location, 'Resende, RJ');
    assert.equal(pub.body.captureDate, '2024-05');
    assert.equal(pub.body.center.lat, -22.45);
    assert.equal(pub.body.center.lon, -44.44);

    // PARCIAL: mudar só o local não apaga as palavras-chave.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ location: 'Outra Cidade' })
      .expect(200);
    const pub2 = await supertest(app).get(`/api/v1/sv360/projects/${slug360}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    assert.deepEqual(pub2.body.keywords, ['aman', 'auditorio'], 'as palavras-chave sobreviveram');
    assert.equal(pub2.body.location, 'Outra Cidade');
  });

  it('a LISTAGEM traz o vídeo, e é ela que alimenta o cartão do catálogo (não o GET por slug)', async () => {
    // DUAS SUPERFÍCIES PÚBLICAS ganharam a coluna e só uma estava conferida. O cartão do
    // 360 é montado por `_getPanoramic360` (`frontend/src/js/catalog/catalog.service.js`),
    // que lê `p.previewVideo` da LISTAGEM (`GET /sv360/projects` → `LIST_PROJECTS`) e nunca
    // chama o GET por slug. Tirar `preview_video` do SELECT da listagem deixava os seis
    // casos deste arquivo verdes, e o modo de falha é mudo dos dois lados: `publicProjectView`
    // faz `preview_video ?? null`, então a chave continua presente, com null.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: '/3d/videos/da-listagem.webm' })
      .expect(200);

    const lista = await supertest(app).get('/api/v1/sv360/projects')
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    const naLista = lista.body.find((p) => p.slug === slug360);
    // PISO — sem ele, um projeto ausente da lista faria a asserção abaixo LANÇAR em vez de
    // discriminar, e "quebrou" leria como "o campo sumiu".
    assert.ok(naLista, 'piso: o projeto está na listagem que o cartão consome');
    assert.equal(naLista.previewVideo, '/3d/videos/da-listagem.webm',
      'a LISTAGEM é a consulta que alimenta o cartão do catálogo');

    // DISCRIMINAÇÃO — a listagem também não ganha snake_case, como o GET por slug.
    assert.equal('preview_video' in naLista, false, 'nada de snake_case na listagem');

    // E volta ao estado que o caso seguinte espera.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: '' })
      .expect(200);
  });

  it('a borda recusa data URL e endereço gigante, e NÃO fecha o resto do `config`', async () => {
    const id = `vid-borda-${RID}`;
    await supertest(app).post('/api/v1/tilesets')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ id, name: 'Borda', config: { url: '/x' } })
      .expect(201);

    // (a) `data:` — a regra recusa mídia EMBUTIDA, de qualquer tamanho (o teto de tamanho
    // é o `max(2048)` de (b), e ele vale com ou sem esta regra). O `config` sai INTEIRO no
    // /api/config, o documento que todo anônimo recebe no boot.
    //
    // AS TRÊS VARIANTES SÃO O PONTO, e as duas últimas passavam: esquema de URI é
    // insensível a caixa (RFC 3986) e o parser de HTML apara o espaço à esquerda de um
    // atributo, então `DATA:` e `␠data:` viravam data URL de verdade num `<video src>`
    // enquanto o padrão era `/^(?!data:)/`. Exercitar só a forma minúscula é medir
    // exatamente o caso que o regex já pegava.
    for (const bruto of ['data:video/webm;base64,AAAA', 'DATA:video/webm;base64,AAAA', ' data:video/webm;base64,AAAA']) {
      await supertest(app).put(`/api/v1/tilesets/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ config: { previewVideo: bruto } })
        .expect(422);
    }

    // (b) tamanho de endereço.
    await supertest(app).put(`/api/v1/tilesets/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ config: { previewVideo: `https://x.mil.br/${'a'.repeat(3000)}.webm` } })
      .expect(422);

    // (c) A DISCRIMINAÇÃO QUE IMPORTA: o `config` continua LIVRE. Declarar uma chave não
    // pode ter fechado as outras — as quatro categorias guardam shapes diferentes e
    // nenhuma delas jamais foi validada.
    await supertest(app).put(`/api/v1/tilesets/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ config: { chaveInventadaQueNinguemDeclarou: { profunda: [1, 2, 3] } } })
      .expect(200);

    // (d) E a rota do 360 aplica AS MESMAS bordas, as três variantes inclusive. Duas
    // regras para a mesma chave é como um eixo se perde, e a caixa alta é a metade que
    // mais fácil diverge entre duas cópias literais de um schema.
    for (const bruto of ['data:video/webm;base64,AAAA', 'DATA:video/webm;base64,AAAA', ' data:video/webm;base64,AAAA']) {
      await supertest(app)
        .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
        .set('Authorization', `Bearer ${tokenProdutor}`)
        .send({ previewVideo: bruto })
        .expect(422);
    }

    // (e) DISCRIMINAÇÃO do `.trim()`: um endereço com espaço à volta é ACEITO e chega
    // APARADO na coluna. Sem ele, `'   '` viraria um endereço de três espaços e o `<video>`
    // teria um `src` que não é endereço nenhum.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: '  /3d/videos/aparado.webm  ' })
      .expect(200);
    const aparado = await supertest(app).get(`/api/v1/sv360/projects/${slug360}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(200);
    assert.equal(aparado.body.previewVideo, '/3d/videos/aparado.webm');

    // CONTROLE NEGATIVO, EXECUTADO: apagar a regra do `data:` nos dois schemas deixa este
    // caso vermelho (as duas rotas passam a aceitar o data URL) e não toca nenhum dos
    // outros cinco.
  });

  it('a trilha do de-para NÃO contém a URL com segredo, em lugar nenhum do JSON', async () => {
    const id = `vid-trilha-${RID}`;
    await supertest(app).post('/api/v1/tilesets')
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ id, name: 'Trilha v1', config: { url: '/publico/tileset.json' } })
      .expect(201);

    await supertest(app).put(`/api/v1/tilesets/${id}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({
        name: 'Trilha v2',
        config: {
          url: `https://tiles.om.example.mil.br/svc?api_key=${SEGREDO}`,
          previewVideo: VIDEO_COM_SEGREDO,
          previewThumbnail: `data:image/webp;base64,${'QUJD'.repeat(20000)}`,
          heightOffset: 12,
        },
      })
      .expect(200);

    const linhas = await trilhaDe(id);
    // PISO 1 — a linha existe e carimba a OM do produtor.
    assert.equal(linhas.length, 1, 'uma linha de CATALOG_UPDATE');
    assert.equal(linhas[0].target_org_id, orgId);
    // PISO 2 — o de-para EXISTE e registra o que pode registrar. Sem isto, todas as
    // asserções de ausência abaixo passariam num `details` vazio.
    const d = linhas[0].details;
    assert.deepEqual(d.fields.sort(), ['config', 'name'], '`fields` continua presente (aditivo)');
    const porCampo = Object.fromEntries((d.mudou ?? []).map((m) => [m.campo, m]));
    assert.deepEqual(porCampo.name, { campo: 'name', de: 'Trilha v1', para: 'Trilha v2' });
    assert.deepEqual(porCampo['config.heightOffset'],
      { campo: 'config.heightOffset', de: null, para: 12 });
    assert.equal(porCampo['config.url']?.regime, 'impressao');
    assert.equal(porCampo['config.previewVideo']?.regime, 'impressao');
    assert.equal(porCampo['config.previewThumbnail']?.regime, 'impressao');
    assert.equal(d.truncado, false, 'a linha coube: se truncar, os pisos acima mentem');

    // PISO 3 — `outros` é EXATO, e a asserção é absoluta de propósito. Ela pegou um
    // defeito real desta onda: enquanto o lado "depois" era a LINHA INTEIRA e o lado
    // "antes" só as quatro colunas editáveis, `id`, `active`, `created_at` e `updated_at`
    // entravam como "mudou de vazio para alguma coisa" em TODA edição — quatro linhas de
    // ruído por evento, para sempre, numa tabela que não se edita. Um `includes` teria
    // passado verde. Os dois lados saem hoje da MESMA projeção (`CAMPOS_EDITAVEIS`).
    assert.deepEqual(d.outros, [], 'nenhum campo fora das quatro editáveis entra no de-para');

    // A DISCRIMINAÇÃO, e é O CONTROLE que o lote pediu por extenso: a substring do
    // segredo no JSON INTEIRO da linha, não só no campo onde se esperaria achá-la.
    const cru = JSON.stringify(linhas[0]);
    assert.equal(cru.includes(SEGREDO), false, 'o segredo não pode estar em lugar nenhum da linha');
    assert.equal(cru.includes('api_key'), false);
    assert.equal(cru.includes('data:image'), false, 'nem um byte da miniatura embutida');
    assert.ok(Buffer.byteLength(cru, 'utf8') < 4096,
      'a linha inteira cabe no teto mesmo com uma miniatura de ~80 kB no corpo');

    // CONTROLE NEGATIVO, EXECUTADO: apagar a filtragem por allowlist em `diffAuditavel`
    // faz o segredo aparecer no JSON da linha e deixa este caso vermelho (junto com o do
    // 360, que mede o outro emissor); a borda e o alcance dos quatro tipos seguem verdes.
  });

  it('a trilha do 360 grava a MESMA impressão para a MESMA URL, e nunca a URL', async () => {
    // O 360 é a outra metade do eixo, e ele passa por outro emissor (o serviço, não o
    // controller do catálogo). Sem este caso, o de-para estaria provado só para as três
    // tabelas — e é justamente o 360 que guarda o vídeo em coluna, por outro caminho.
    await supertest(app)
      .patch(`/api/v1/sv360/admin/projects/${slug360}?orgId=${orgId}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ previewVideo: VIDEO_COM_SEGREDO })
      .expect(200);

    const linhas = await trilhaDe(projeto360);
    assert.ok(linhas.length >= 1, 'piso: a rota de metadado audita');
    const ultima = linhas[0];
    assert.equal(ultima.target_type, 'SV360_PROJECT');
    assert.equal(ultima.target_org_id, orgId, 'a OM dona vai na coluna, como nos outros emissores');
    const entrada = (ultima.details.mudou ?? []).find((m) => m.campo === 'config.previewVideo');
    assert.equal(entrada?.regime, 'impressao', 'piso: o de-para do 360 registra a troca');
    assert.match(entrada.para, /^[0-9a-f]{12}$/);
    assert.equal(JSON.stringify(ultima).includes(SEGREDO), false);

    // A DISCRIMINAÇÃO QUE DÁ SENTIDO À IMPRESSÃO: a MESMA URL, gravada pelo caminho do
    // CATÁLOGO no caso anterior, produziu a MESMA impressão. É o que faz a trilha
    // responder "é o mesmo endereço?" sem carregar o endereço.
    const doCatalogo = await trilhaDe(`vid-trilha-${RID}`);
    const noCatalogo = doCatalogo[0].details.mudou.find((m) => m.campo === 'config.previewVideo');
    assert.equal(entrada.para, noCatalogo.para,
      'a impressão é do VALOR, não do caminho que o gravou');
  });
});
