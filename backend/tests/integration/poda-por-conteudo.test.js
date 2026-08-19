// Path: tests/integration/poda-por-conteudo.test.js
//
// F13 — A PODA POR CONTEÚDO, medida no fio, contra os DOIS residuais que sobreviveram à F12 por
// serem invisíveis a uma poda chaveada em `op.entityType`.
//
// V2 — O CARIMBO ERRADO, e é o mais grave dos dois porque quem manda é o cliente ATUAL, não um
// legado. Renomear um mapa faz o cliente emitir `logMapOperation(UPDATE, mapId, documento
// inteiro)`, e o documento inteiro inclui `catalogLayers`. A op sai carimbada `map`, a poda antiga
// olhava `op.entityType`, e a definição voltava inteira pelo log e pelo relay. A F12 tinha
// declarado as duas superfícies fechadas.
//
// V3 — A COLUNA IRMÃ. `maps.analysis_layers` foi declarada no MESMO bloco JSONB da coluna que a
// migração 022 derrubou, e continuou publicada crua por QUATRO superfícies (`GET /maps`,
// `GET /maps/:id`, `POST /duplicate` e o snapshot). Ela é um saco JSONB livre: `sync.schemas.js`
// declara `changes` como `Joi.object().unknown(true)`, então qualquer cliente com `write` — ou com
// `comment`, que é o gate da rota de push — escreve uma definição inteira lá dentro, e o visitante
// anônimo de link público a lê de volta. Não estava provado que algum cliente tivesse posto
// definição ali; estava provado que o portador estava aberto, e é o portador que este arquivo
// carrega de propósito.
//
// POR QUE OS DOIS NO MESMO ARQUIVO: eles têm a MESMA causa e são fechados pela MESMA linha de
// código. Perseguir portador a portador não converge (medido: são treze colunas JSONB servidas
// cruas, não uma), e é por isso que a correção não é uma lista de casos e sim um caminhamento por
// conteúdo aplicado na fronteira de serialização — `middleware/prune-resource-payload.js`, que
// embrulha `res.json` antes de qualquer rota ser montada.
//
// AS METADES POSITIVAS, sem as quais todo verde aqui seria o de um servidor que devolve `{}`:
//   - a definição AUTORIZADA continua saindo. O recurso PÚBLICO é reidratado no snapshot e chega
//     com `config.source.url` vivo, para o visitante anônimo inclusive. É o controle que pega uma
//     poda cega, que passaria em todos os negativos.
//   - QUEM TEM A CONCESSÃO continua recebendo, e este é o par mais apertado do arquivo: o MESMO
//     recurso privado, no MESMO mapa, no MESMO snapshot, some para o visitante e chega inteiro
//     para o concessionário. O positivo com o recurso PÚBLICO não tem essa propriedade (é outro
//     recurso), então ele não distingue "a poda respeita a autorização" de "a poda deixa passar o
//     que é público e corta o resto". Este distingue, e ele é o exigido pela casa: filtro de acesso
//     se prova com o par completo, negativo E positivo sobre a MESMA linha.
//   - o HILLSHADE continua saindo inteiro. Ele não é recurso de catálogo (não tem linha em tabela
//     nenhuma e a definição dele é estática); reduzi-lo tira o relevo sombreado do mapa de todo
//     mundo, e essa é a regressão que ficaria quieta no teste e barulhenta na tela.
//   - o CONTRATO CONGELADO do snapshot continua valendo. A fronteira nova é um caminhamento que
//     RECONSTRÓI todo objeto no caminho de um nó podado, e o snapshot é contrato com o documento
//     IndexedDB do cliente: chave perdida, array virado objeto, objeto indexado por id
//     reembaralhado ou subárvore anulada pelo teto de profundidade seriam perda de dado silenciosa,
//     do lado de dentro de uma resposta que continua parecendo certa. O caso mede a resposta HTTP
//     contra a MESMA carga sem a fronteira e cobra que a diferença seja exatamente a definição,
//     nunca a forma.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser, makeAtlasPublic, getPublicToken,
  createFeature, createLayer, createGroup, createCesium3dData, createStreetview360Data,
} from '../helpers/fixtures.js';
import * as syncService from '../../src/modules/sync/sync.service.js';
import { MAX_PRUNE_DEPTH } from '../../src/modules/catalog/resource-payload.prune.js';

const sufixo = randomUUID().slice(0, 8);
const PRIVADA = `f13-priv-${sufixo}`;
const PUBLICA = `f13-pub-${sufixo}`;

// Quatro URLs distintas, para que a busca por substring na resposta INTEIRA discrimine: a privada
// viva (o segredo), a pública viva (o controle de que nada foi apagado em bloco), a cópia
// carimbada pelo cliente (a forma pela qual o segredo saía) e a do relevo.
const URL_PRIVADA_VIVA = `/tiles/${sufixo}/privada-viva/{z}/{x}/{y}.pbf`;
const URL_PUBLICA_VIVA = `/tiles/${sufixo}/publica-viva/{z}/{x}/{y}.pbf`;
const URL_COPIADA = `/tiles/${sufixo}/copia-carimbada/{z}/{x}/{y}.pbf`;
const URL_HILLSHADE = `/tiles/${sufixo}/relevo/{z}/{x}/{y}.png`;

const ID_PRIVADA = `analysis-${PRIVADA}`;
const ID_PUBLICA = `analysis-${PUBLICA}`;

/**
 * Todo caminho JSON em que as duas cargas discordam.
 *
 * O formato do caminho é o do JavaScript (`snapshot.maps[0].catalogLayers[1].config`) porque ele é
 * o que se cola numa expressão para investigar. Chave presente de um lado só conta como
 * divergência, que é o caso que interessa aqui: a poda TIRA chave, e uma reconstrução desatenta
 * tira as outras junto.
 *
 * @param {*} a
 * @param {*} b
 * @param {string} [caminho]
 * @returns {string[]}
 */
function caminhosQueDiferem(a, b, caminho = '') {
  if (a === b) return [];
  if (Array.isArray(a) !== Array.isArray(b)) return [`${caminho} (array vs objeto)`];

  if (Array.isArray(a)) {
    if (a.length !== b.length) return [`${caminho} (comprimento ${a.length} vs ${b.length})`];
    return a.flatMap((item, i) => caminhosQueDiferem(item, b[i], `${caminho}[${i}]`));
  }

  const objeto = (v) => v !== null && typeof v === 'object';
  if (!objeto(a) || !objeto(b)) return [caminho || '(raiz)'];

  // A ORDEM DAS CHAVES entra na comparação de propósito. Um objeto indexado por id (as
  // orientações do 360) reembaralhado continua sendo o mesmo JSON para um `deepEqual`, e ainda
  // assim é sinal de que o caminhamento reconstruiu o que devia ter devolvido por identidade.
  const chavesA = Object.keys(a);
  const chavesB = Object.keys(b);
  const mesmaOrdem = chavesA.length === chavesB.length && chavesA.every((k, i) => k === chavesB[i]);
  if (!mesmaOrdem) {
    const soEmA = chavesA.filter((k) => !chavesB.includes(k));
    const soEmB = chavesB.filter((k) => !chavesA.includes(k));
    if (soEmA.length === 0 && soEmB.length === 0) return [`${caminho} (ordem das chaves mudou)`];
    return [
      ...soEmA.map((k) => `${caminho}.${k}`),
      ...soEmB.map((k) => `${caminho}.${k} (surgiu)`),
    ];
  }
  return chavesA.flatMap((k) => caminhosQueDiferem(a[k], b[k], `${caminho}.${k}`));
}

/**
 * A carga com as coleções cuja ORDEM o servidor não promete postas em ordem de id.
 *
 * Isto não é conveniência, é não medir o que o código não garante. `GET_ATLAS_CATALOG_LAYERS`,
 * `GET_ATLAS_FEATURES` e `GET_ATLAS_GROUPS` não têm `ORDER BY` (as duas do 3D e do 360 têm, e por
 * um motivo escrito lá), então duas execuções da MESMA consulta podem devolver as linhas em ordens
 * diferentes assim que o planejador mudar de ideia. Comparar a ordem delas seria um vermelho que
 * aparece uma vez em vinte e não diz nada sobre a fronteira.
 *
 * O que NÃO é normalizado é tão deliberado quanto: `maps` (que tem `ORDER BY created_at`) e
 * `layers` (`ORDER BY sort_order`) ficam como vieram, porque ali a ordem É promessa. E a
 * normalização é aplicada aos DOIS lados, então ela some com divergência de ordem, nunca com
 * divergência de conteúdo.
 *
 * @param {*} carga
 * @returns {*} A mesma carga, mutada no lugar (é uma cópia local em ambos os usos).
 */
function ordenarOQueNaoTemOrdem(carga) {
  const porId = (a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  for (const mapa of carga?.snapshot?.maps ?? []) {
    mapa.catalogLayers?.sort(porId);
    mapa.groups?.sort(porId);
    for (const colecao of Object.values(mapa.features ?? {})) {
      if (Array.isArray(colecao)) colecao.sort((a, b) => porId(a?.properties, b?.properties));
    }
  }
  return carga;
}

/**
 * A profundidade do nó mais fundo da carga, contada como o caminhamento conta.
 * @param {*} node
 * @param {number} [nivel]
 * @returns {number}
 */
function profundidadeMaxima(node, nivel = 0) {
  if (node === null || typeof node !== 'object') return nivel;
  const filhos = Array.isArray(node) ? node : Object.values(node);
  return filhos.reduce((maior, filho) => Math.max(maior, profundidadeMaxima(filho, nivel + 1)), nivel);
}

/** A entrada que o cliente carimba: referência, estado por atlas e a CÓPIA da linha de catálogo. */
const entradaComCopia = (id, resourceId, url = URL_COPIADA) => ({
  id,
  type: 'analysis_layer',
  name: 'Nome copiado no dia da adição',
  visible: true,
  opacity: 0.6,
  status: 'active',
  styleOverrides: { raster: { 'raster-opacity': 0.3 } },
  config: { id: resourceId, source: { type: 'vector', url } },
});

const entradaDoRelevo = () => ({
  id: 'hillshade',
  type: 'hillshade',
  name: 'Sombreamento do Relevo',
  visible: true,
  config: { source: { type: 'raster-dem', url: URL_HILLSHADE } },
});

describe('F13 — a poda por conteúdo alcança o carimbo errado e a coluna irmã', () => {
  let app, db;
  let dono, membro, concessionario;
  let tokenDono, tokenMembro, tokenVisitante, tokenConcessionario;
  let atlas, mapa;
  let versaoAntesDoRename;
  let subDoVisitante;

  // --- helpers ---------------------------------------------------------------

  const pedirItem = (token) => supertest(app)
    .get(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const pedirListagem = (token) => supertest(app)
    .get(`/api/v1/atlas/${atlas.id}/maps`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const snapshot = async (token) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot;
  };

  const log = async (token, desde) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/${desde}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data;
  };

  const push = async (token, operations) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);
    return res.body.data;
  };

  const camada = (snap, id) => snap.maps
    .find((m) => m.id === mapa.id).catalogLayers
    .find((c) => c.id === id);

  /**
   * O PAR COMPLETO de uma resposta que carrega mapa: ela É o mapa (positivo) e não carrega
   * definição de recurso nenhuma (negativo). Sem a metade positiva, uma rota que respondesse
   * `{}` — ou uma poda que zerasse tudo — passaria.
   */
  const conferirMapa = (corpo, quem) => {
    assert.ok(corpo, `${quem}: a rota respondeu`);
    assert.equal(corpo.id, mapa.id, `${quem}: é o mapa pedido`);
    assert.ok(corpo.name, `${quem}: com o nome dele`);
    assert.ok('analysis_layers' in corpo, `${quem}: a coluna do domínio de grade segue publicada`);

    // O ESTADO POR ATLAS sobrevive à poda: só a definição sai. Se esta asserção cair junto com as
    // de baixo, a poda virou uma tesoura cega.
    const dentro = corpo.analysis_layers?.camadas?.[0];
    assert.ok(dentro, `${quem}: a carga da coluna irmã continua chegando`);
    assert.equal(dentro.id, ID_PRIVADA, `${quem}: com a referência`);
    assert.equal(dentro.type, 'analysis_layer', `${quem}: e o tipo`);
    assert.equal(dentro.visible, true, `${quem}: e o estado por atlas`);
    assert.equal(dentro.name, undefined, `${quem}: sem o nome copiado`);
    assert.equal(dentro.config, undefined, `${quem}: e sem a definição`);

    // A URL vem ANTES da chave de propósito: quando este par fica vermelho, a primeira linha do
    // relatório precisa dizer que VAZOU.
    const texto = JSON.stringify(corpo);
    assert.ok(!texto.includes(URL_COPIADA), `${quem}: a cópia carimbada pelo cliente VAZOU`);
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), `${quem}: a URL viva do recurso privado VAZOU`);
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `f13_dono_${sufixo}` });
    membro = await createUser(db, { username: `f13_membro_${sufixo}` });
    concessionario = await createUser(db, { username: `f13_conc_${sufixo}` });
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);
    tokenConcessionario = await loginUser(app, concessionario.username, concessionario.password);

    atlas = await createAtlas(db, dono.id, { name: `F13 conteúdo ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: `Mapa da sonda ${sufixo}` });
    // `read` PURO: o nível mais baixo da hierarquia, que é o que o gate destas rotas cobra.
    await createShare(db, atlas.id, membro.id, 'read', dono.id);
    // O CONCESSIONÁRIO tem o MESMO `read` do membro, e nada mais no eixo do atlas. A única coisa
    // que o distingue é a concessão sobre o recurso, inserida logo abaixo: se o positivo dele
    // passasse por qualquer outra via (papel global, produção, atlas público), o par mediria outra
    // coisa.
    await createShare(db, atlas.id, concessionario.id, 'read', dono.id);

    for (const [id, nivel, url] of [
      [PRIVADA, 'private', URL_PRIVADA_VIVA], [PUBLICA, 'public', URL_PUBLICA_VIVA],
    ]) {
      await db.query(
        `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
         VALUES ($1, $2, $3::jsonb, 0, $4)`,
        [id, `Camada ${id} (nome vivo)`, JSON.stringify({
          source: { type: 'vector', url },
          bounds: [-50, -25, -40, -15],
        }), nivel],
      );
    }

    // A CONCESSÃO, e ela é a única diferença entre o concessionário e o membro. `view` é o nível
    // mais baixo do CHECK da 017 (`view` ou `view_share`): ver sem poder repassar já basta para
    // receber a definição, e cobrar mais que isso testaria o repasse, que é outro assunto.
    await db.query(
      `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
       VALUES ('analysis_layer', $1, $2, 'view', $3)`,
      [PRIVADA, concessionario.id, dono.id],
    );

    // O MAPA PRECISA TER CONTEÚDO DE VERDADE, e não por realismo: o caso do contrato congelado
    // compara a resposta com e sem a fronteira, e uma comparação sobre um mapa vazio passaria
    // verde por não ter o que perder. Cada peça abaixo é uma FORMA que o caminhamento poderia
    // estragar sem derrubar nada: a geometria multipolígono é a subárvore mais funda que este
    // servidor produz (é ela que aproxima o teto de profundidade), o 360 é um objeto INDEXADO POR
    // CHAVE (não um array, e reembaralhá-lo perde a foto), e camada e grupo carregam o `null` e o
    // booleano que uma reconstrução desatenta converte.
    await createFeature(db, mapa.id, {
      feature_type: 'polygon',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[-45, -20], [-44, -20], [-44, -19], [-45, -19], [-45, -20]]]],
      },
      properties: { nome: 'Área de responsabilidade', descricao: null, visivel: true },
    });
    await createLayer(db, mapa.id, { name: `Camada de feições ${sufixo}` });
    await createGroup(db, mapa.id, { name: `Grupo ${sufixo}` });
    await createCesium3dData(db, mapa.id, {});
    await createStreetview360Data(db, mapa.id, { photo_name: `foto-${sufixo}` });

    // As três entradas na tabela canônica, com a cópia velha dentro (o estado real do banco: nada
    // foi migrado, por decisão registrada).
    for (const entrada of [
      entradaComCopia(ID_PRIVADA, PRIVADA), entradaComCopia(ID_PUBLICA, PUBLICA), entradaDoRelevo(),
    ]) {
      await db.query(
        'INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)',
        [entrada.id, mapa.id, JSON.stringify(entrada)],
      );
    }

    // UMA OP DE AQUECIMENTO, e ela não é ruído. `pullOperations` devolve o SNAPSHOT quando a
    // versão pedida é 0, então medir o LOG a partir da versão zero mediria o snapshot outra vez e
    // o caso passaria verde sobre a superfície errada. A op abaixo levanta `current_version` para
    // que a versão capturada em seguida seja um ponto de partida legítimo do pull incremental.
    await push(tokenDono, [{
      id: randomUUID(),
      entityType: 'map',
      operationType: 'update',
      entityId: mapa.id,
      mapId: mapa.id,
      changes: { zoom: 11 },
      timestamp: Date.now(),
      clientId: `c-f13-${sufixo}`,
    }]);

    const { rows } = await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]);
    versaoAntesDoRename = Number(rows[0].current_version);
    assert.ok(versaoAntesDoRename >= 1, 'a versão de partida do pull incremental precisa ser >= 1');

    // O GESTO QUE FECHA OS DOIS RESIDUAIS DE UMA VEZ, e ele é o gesto real do cliente: renomear o
    // mapa manda uma op carimbada `map` com o DOCUMENTO INTEIRO. Aqui o documento leva as duas
    // cargas de uma vez — `catalogLayers` (V2) e `analysis_layers` (V3, o saco JSONB livre que
    // nenhum schema valida por dentro). A op é aceita: o servidor não recusa a carga, ele a
    // guarda, e é na SAÍDA que a definição some.
    await push(tokenDono, [{
      id: randomUUID(),
      entityType: 'map',
      operationType: 'update',
      entityId: mapa.id,
      mapId: mapa.id,
      changes: {
        name: `Mapa renomeado ${sufixo}`,
        catalogLayers: [entradaComCopia(ID_PRIVADA, PRIVADA), entradaDoRelevo()],
        analysis_layers: { camadas: [entradaComCopia(ID_PRIVADA, PRIVADA)] },
      },
      timestamp: Date.now(),
      clientId: `c-f13-${sufixo}`,
    }]);

    tokenVisitante = await getPublicToken(app, await makeAtlasPublic(db, atlas.id));

    // O PRINCIPAL DO VISITANTE, lido do próprio token. O caso do contrato congelado precisa pedir
    // ao serviço a MESMA carga que a rota pede, e o visitante de link público carrega um `sub`
    // sintético (`public-<uuid>`) que nenhuma fixture conhece. Lê-lo do token é o que impede o
    // caso de comparar duas cargas de principais diferentes, que divergiriam por motivo legítimo
    // e acusariam a fronteira por um crime que não é dela.
    subDoVisitante = JSON.parse(
      Buffer.from(tokenVisitante.split('.')[1], 'base64url').toString('utf8'),
    ).sub;
    assert.ok(subDoVisitante, 'o token de visitante precisa carregar um `sub`');
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await db.query('DELETE FROM analysis_layers WHERE id = ANY($1::text[])', [[PRIVADA, PUBLICA]]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // PISO — sem isto, todo verde abaixo é o de um banco que nunca teve o segredo
  // ==========================================================================

  it('piso: o recurso é privado e a definição está DE FATO nos três portadores', async () => {
    const { rows: recurso } = await db.query(
      'SELECT access_level, active FROM analysis_layers WHERE id = $1', [PRIVADA],
    );
    assert.equal(recurso.length, 1, 'a linha de catálogo precisa existir');
    assert.equal(recurso[0].access_level, 'private', 'e estar marcada privada');
    assert.equal(recurso[0].active, true, 'e ativa, senão a ausência não diria nada');

    // Portador 1: a tabela canônica.
    const { rows: tabela } = await db.query(
      'SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL ORDER BY id', [mapa.id],
    );
    assert.deepEqual(tabela.map((r) => r.id).sort(), [ID_PRIVADA, ID_PUBLICA, 'hillshade'].sort());
    assert.ok(
      JSON.stringify(tabela.find((r) => r.id === ID_PRIVADA).data).includes(URL_COPIADA),
      'a linha da camada privada precisa carregar a cópia',
    );

    // Portador 2: a COLUNA IRMÃ, escrita pela op carimbada `map`. É a prova de que o saco JSONB
    // aceita definição vinda de cliente sem validação nenhuma — o V3 em pessoa.
    const { rows: colunas } = await db.query(
      'SELECT name, analysis_layers FROM maps WHERE id = $1', [mapa.id],
    );
    assert.match(colunas[0].name, /^Mapa renomeado/, 'o rename foi aplicado');
    assert.ok(
      JSON.stringify(colunas[0].analysis_layers).includes(URL_COPIADA),
      'a coluna irmã precisa estar carregada com a definição: é o portador que a F12 deixou aberto',
    );

    // Portador 3: o LOG, com a op carimbada `map` carregando o documento inteiro. É o V2.
    const { rows: ops } = await db.query(
      `SELECT entity_type, changes FROM operations
       WHERE atlas_id = $1 AND entity_type = 'map' ORDER BY server_version DESC LIMIT 1`, [atlas.id],
    );
    assert.equal(ops.length, 1, 'a op de rename precisa estar no log');
    assert.ok(
      JSON.stringify(ops[0].changes).includes(URL_COPIADA),
      'e precisa carregar a definição dentro, carimbada `map`: era o que a poda antiga não via',
    );

    assert.ok(tokenVisitante, 'e o token de visitante de link público precisa existir');
  });

  // ==========================================================================
  // V3 — A COLUNA IRMÃ, nas quatro superfícies que a publicavam crua
  // ==========================================================================

  it('V3/ITEM — `GET /maps/:id` não serve a definição, para o visitante nem para o membro `read`', async () => {
    conferirMapa((await pedirItem(tokenVisitante)).body.data, 'visitante anônimo');
    conferirMapa((await pedirItem(tokenMembro)).body.data, 'membro com read');
  });

  it('V3/LISTAGEM — `GET /maps` tampouco: filtrar só o singular é o defeito conhecido', async () => {
    for (const [quem, token] of [['visitante anônimo', tokenVisitante], ['membro com read', tokenMembro]]) {
      const lista = (await pedirListagem(token)).body.data;
      assert.ok(Array.isArray(lista) && lista.length >= 1, `${quem}: a listagem responde os mapas`);
      conferirMapa(lista.find((m) => m.id === mapa.id), `${quem} (listagem)`);
    }
  });

  it('V3/DUPLICAÇÃO — `POST /duplicate` devolve 201 com a linha nova, e sem a definição', async () => {
    // A SAÍDA QUE NENHUM CENSO ANTERIOR ENXERGAVA, porque varria `router.get(`. Ela exige `write`,
    // então quem dispara é o dono; o vazamento aqui alcança quem já tem o atlas, e continua sendo
    // definição de recurso que ele pode não ter.
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}/duplicate`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ name: `Cópia ${sufixo}` })
      .expect(201);

    const novo = res.body.data;
    assert.ok(novo?.id && novo.id !== mapa.id, 'a rota devolve a linha do mapa NOVO');
    assert.match(novo.name, /\(cópia\)$/, 'com o nome derivado pelo servidor');
    assert.ok('analysis_layers' in novo, 'com a coluna publicada, como o contrato promete');
    const texto = JSON.stringify(novo);
    assert.ok(!texto.includes(URL_COPIADA), 'a cópia carimbada VAZOU pela duplicação');
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), 'a URL viva do recurso privado VAZOU pela duplicação');
  });

  // ==========================================================================
  // V2 — O CARIMBO ERRADO, nas duas superfícies que a F12 declarou fechadas
  // ==========================================================================

  it('V2/LOG — o pull incremental devolve a op `map` sem a definição, e COM o resto', async () => {
    const dados = await log(tokenVisitante, versaoAntesDoRename);
    assert.equal(dados.isSnapshot, false, 'a versão pedida devolve o LOG, não o snapshot');
    const opDoRename = dados.operations.find((o) => o.entityType === 'map');
    assert.ok(opDoRename, 'a op de rename precisa estar na resposta');

    // POSITIVO: o gesto continua chegando ao par, com o nome novo e a lista de camadas.
    assert.match(opDoRename.changes.name, /^Mapa renomeado/, 'o rename chega ao par');
    assert.equal(opDoRename.changes.catalogLayers.length, 2, 'as duas entradas chegam');
    const daPrivada = opDoRename.changes.catalogLayers.find((c) => c.id === ID_PRIVADA);
    assert.equal(daPrivada.visible, true, 'com o estado por atlas');

    // NEGATIVO: sem a definição, em NENHUM dos dois portadores da mesma op.
    assert.equal(daPrivada.config, undefined, 'a definição saiu de `catalogLayers`');
    assert.equal(daPrivada.name, undefined, 'e o nome copiado também');
    assert.equal(opDoRename.changes.analysis_layers.camadas[0].config, undefined, 'e da coluna irmã');
    const texto = JSON.stringify(dados);
    assert.ok(!texto.includes(URL_COPIADA), 'o log VAZOU a cópia carimbada');
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), 'o log VAZOU a URL viva');
  });

  it('V2/SNAPSHOT — o snapshot do visitante anônimo não carrega definição privada em lugar nenhum', async () => {
    const snap = await snapshot(tokenVisitante);
    const texto = JSON.stringify(snap);
    assert.ok(!texto.includes(URL_COPIADA), 'o snapshot VAZOU a cópia carimbada');
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), 'o snapshot VAZOU a URL viva do recurso privado');

    const privada = camada(snap, ID_PRIVADA);
    assert.ok(privada, 'a camada privada continua no snapshot (some a definição, não a camada)');
    assert.equal(privada.visible, true, 'com o estado por atlas');
    assert.equal(privada.config, undefined, 'e sem a definição');

    // E a coluna irmã dentro do MESMO snapshot: é a superfície que a reidratação não olha.
    const mapaDoSnap = snap.maps.find((m) => m.id === mapa.id);
    assert.ok(mapaDoSnap.analysis_layers?.camadas?.[0], 'a coluna irmã continua no snapshot');
    assert.equal(mapaDoSnap.analysis_layers.camadas[0].config, undefined, 'sem a definição dentro');
  });

  // ==========================================================================
  // AS DUAS METADES POSITIVAS — sem elas, uma tesoura cega passaria em tudo acima
  // ==========================================================================

  it('POSITIVO — a definição AUTORIZADA continua saindo: o recurso público chega reidratado', async () => {
    // O CONTROLE QUE PEGA UMA PODA CEGA. A reidratação do snapshot resolve a definição pelo
    // predicado de quem lê, e a fronteira precisa deixá-la passar: ela é marcada por IDENTIDADE
    // (WeakSet), nunca por um campo no fio, que qualquer cliente poderia forjar.
    const snap = await snapshot(tokenVisitante);
    const publica = camada(snap, ID_PUBLICA);
    assert.ok(publica, 'a camada pública está no snapshot');
    assert.ok(publica.config, 'e chega COM definição: a autorização sobreviveu à fronteira');
    assert.equal(publica.config.source.url, URL_PUBLICA_VIVA, 'e é a URL VIVA, não a cópia velha');
    assert.equal(publica.name, `Camada ${PUBLICA} (nome vivo)`, 'com o nome vivo do catálogo');
    assert.ok(
      JSON.stringify(snap).includes(URL_PUBLICA_VIVA),
      'e a URL pública aparece no corpo: sem esta linha, os negativos acima seriam satisfeitos por '
      + 'uma poda que apagasse tudo',
    );
  });

  it('POSITIVO — o CATÁLOGO em si atravessa a fronteira intacto', async () => {
    // A REGRESSÃO MAIS CARA QUE ESTA FASE PODIA CAUSAR, e ela seria silenciosa: o embrulho de
    // `res.json` é GLOBAL, então ele também passa por `GET /api/config`, que é o documento de BOOT
    // e existe justamente para SERVIR definição de catálogo. Se a poda o alcançasse, o app inteiro
    // subiria sem camada nenhuma.
    //
    // Ela não alcança, e a razão é estrutural e não uma isenção: a linha de catálogo não tem
    // coluna `type` (`COLS` em `catalog.service.js` lista oito colunas, e `type` não é uma delas),
    // e `/api/config` a reprojeta como `{ id, name, ...config }`. O discriminador que a poda lê é
    // vocabulário do DOCUMENTO DO CLIENTE, nunca da linha do catálogo. Esta linha mede isso em vez
    // de assumir.
    const config = await supertest(app).get('/api/config').expect(200);
    const texto = JSON.stringify(config.body);
    assert.ok(texto.includes(URL_PUBLICA_VIVA), 'o `/api/config` anônimo precisa servir a camada pública INTEIRA');
    assert.ok(!texto.includes(URL_PRIVADA_VIVA), 'e continuar sem a privada, que é o recorte do próprio endpoint');

    const daConfig = (config.body.data ?? config.body).analysisLayers.layers.find((l) => l.id === PUBLICA);
    assert.ok(daConfig, 'a camada pública está na lista');
    assert.equal(daConfig.name, `Camada ${PUBLICA} (nome vivo)`, 'com nome');
    assert.equal(daConfig.source.url, URL_PUBLICA_VIVA, 'e com a definição, que é a razão de o endpoint existir');
  });

  it('POSITIVO/CONCESSÃO — quem TEM a concessão recebe a definição que o visitante não recebe', async () => {
    // O PAR COMPLETO SOBRE A MESMA LINHA, que é o que a casa cobra de todo filtro de acesso. Os
    // dois pedidos abaixo são o MESMO recurso, no MESMO mapa, pelo MESMO caminho, e diferem só no
    // principal. O positivo com o recurso público (o caso acima) não fecha este par: ele deixaria
    // passar uma fronteira que servisse o público e cortasse todo o resto, concessão inclusive, e
    // o sintoma disso é "camada indisponível" na tela de quem tem direito a ela.
    const doConcessionario = camada(await snapshot(tokenConcessionario), ID_PRIVADA);
    assert.ok(doConcessionario, 'a camada privada está no snapshot do concessionário');
    assert.ok(doConcessionario.config, 'e chega COM definição: a concessão foi respeitada');
    assert.equal(
      doConcessionario.config.source.url, URL_PRIVADA_VIVA,
      'e é a URL VIVA do catálogo, não a cópia velha que o cliente carimbou',
    );
    assert.equal(
      doConcessionario.name, `Camada ${PRIVADA} (nome vivo)`,
      'com o nome vivo, que é o que a reidratação existe para entregar',
    );

    const doVisitante = camada(await snapshot(tokenVisitante), ID_PRIVADA);
    assert.ok(doVisitante, 'a mesma camada está no snapshot do visitante');
    assert.equal(doVisitante.config, undefined, 'e para ele a definição não vai');
    assert.equal(doVisitante.name, undefined, 'nem o nome');
    assert.equal(doVisitante.visible, doConcessionario.visible, 'o estado por atlas é o mesmo dos dois lados');

    // E A CÓPIA VELHA CONTINUA SEM SAIR, nem para quem tem a concessão. A definição chega pelo
    // caminho LEGÍTIMO (a reidratação, que resolve a linha viva) e por nenhum outro: `GET /maps`
    // não reidrata nada, então o que ele carrega é a cópia carimbada pelo cliente, e ela é podada
    // para todo mundo. Sem esta metade, "o concessionário recebe" poderia estar sendo satisfeito
    // pelo vazamento em vez de pela autorização.
    const linhaDoMapa = (await pedirItem(tokenConcessionario)).body.data;
    assert.equal(linhaDoMapa.id, mapa.id, 'a rota respondeu o mapa ao concessionário');
    assert.ok(
      !JSON.stringify(linhaDoMapa).includes(URL_COPIADA),
      'a cópia carimbada não sai nem para o concessionário: a rota de mapas não reidrata, e o que '
      + 'ela carregava era a cópia velha, que não é definição autorizada de ninguém',
    );
  });

  it('POSITIVO — o HILLSHADE não é tocado, no snapshot e no log', async () => {
    // Ele não é recurso de catálogo: não tem linha em tabela nenhuma e a definição dele é
    // estática. Reduzi-lo tira o relevo sombreado do mapa de todo mundo.
    const snap = await snapshot(tokenVisitante);
    const relevo = camada(snap, 'hillshade');
    assert.ok(relevo, 'a entrada do relevo está no snapshot');
    assert.equal(relevo.name, 'Sombreamento do Relevo', 'com o nome');
    assert.equal(relevo.config.source.url, URL_HILLSHADE, 'e com a definição estática intacta');

    const dados = await log(tokenVisitante, versaoAntesDoRename);
    const noLog = dados.operations
      .find((o) => o.entityType === 'map').changes.catalogLayers
      .find((c) => c.id === 'hillshade');
    assert.equal(noLog.config.source.url, URL_HILLSHADE, 'e a op relayada o entrega inteiro');
  });

  // ==========================================================================
  // O CONTRATO CONGELADO — a fronteira tira definição, não forma
  // ==========================================================================

  it('CONTRATO CONGELADO — a fronteira muda EXATAMENTE a definição, e nada mais da forma', async () => {
    // A COMPARAÇÃO É COM A MESMA CARGA SEM A FRONTEIRA, e é isso que faz o caso valer: o serviço é
    // chamado direto (nenhum `res.json`, nenhum middleware) com o MESMO principal e a MESMA versão
    // que a rota usa, e o resultado passa por um round-trip de JSON só para igualar o que a
    // serialização já faria (`Date` vira ISO dos dois lados). O que sobrar de diferença é obra da
    // fronteira, de mais nada.
    //
    // As duas passam por `ordenarOQueNaoTemOrdem` antes de serem comparadas, e o motivo está lá:
    // três coleções do snapshot não têm `ORDER BY`, então a ordem delas não é promessa e cobrá-la
    // seria comprar um vermelho intermitente que não fala da fronteira.
    const semFronteira = ordenarOQueNaoTemOrdem(JSON.parse(JSON.stringify(
      await syncService.pullOperations(atlas.id, 0, 'read', subDoVisitante),
    )));
    const comFronteira = ordenarOQueNaoTemOrdem((await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${tokenVisitante}`)
      .expect(200)).body.data);

    // PISO, e sem ele o caso é uma comparação de dois vazios. As duas cargas precisam ser o mesmo
    // atlas, com o mesmo mapa, e o mapa precisa ter dentro as formas que o caminhamento poderia
    // estragar.
    assert.equal(semFronteira.isSnapshot, true, 'a versão 0 devolve o snapshot dos dois lados');
    assert.equal(comFronteira.isSnapshot, true);
    const cru = semFronteira.snapshot.maps.find((m) => m.id === mapa.id);
    const servido = comFronteira.snapshot.maps.find((m) => m.id === mapa.id);
    assert.ok(cru && servido, 'o mapa da sonda está nas duas cargas');
    // `features` NÃO é um array: é um objeto de vinte coleções por tipo, uma forma que só existe
    // porque o documento IndexedDB do cliente é assim. Errar isto aqui seria pedir a propriedade
    // errada e receber `undefined`, que é como este caso reprovou na primeira execução.
    assert.equal(cru.features.polygons.length, 1, 'com a feição de geometria funda');
    assert.equal(cru.layers.length, 1, 'com a camada');
    assert.equal(cru.groups.length, 1, 'com o grupo');
    assert.ok(Object.keys(cru.streetview360.orientations).length >= 1, 'e com o 360 indexado por chave');

    const diferencas = caminhosQueDiferem(semFronteira, comFronteira);

    // A DIREÇÃO QUE INTERESSA: toda diferença precisa ser uma DEFINIÇÃO retirada. `analysis_layers`
    // é a coluna irmã, que a reidratação não olha e portanto chega crua ao `res.json`; as entradas
    // de `catalogLayers` já saem podadas do serviço (a reidratação as poda antes), então elas não
    // aparecem aqui, e é correto que não apareçam.
    const inesperadas = diferencas.filter(
      (c) => !/\.analysis_layers\.camadas\[\d+\]\.(name|config)$/.test(c),
    );
    assert.deepEqual(
      inesperadas, [],
      'a fronteira mexeu em algo que não é definição de recurso. Cada caminho abaixo é uma chave '
      + `que o cliente esperava receber e não recebeu:\n${inesperadas.join('\n')}`,
    );

    // E O CONTROLE DE COBERTURA VAZIA: a lista precisa ter conteúdo. Zero diferenças significaria
    // que a fronteira não fez nada, e todas as asserções acima seriam satisfeitas por um
    // middleware desligado.
    assert.ok(
      diferencas.length >= 2,
      `esperava a definição da coluna irmã sendo retirada; diferenças: ${diferencas.join(' | ')}`,
    );

    // A FORMA, medida onde o contrato é com o documento IndexedDB do cliente: as chaves do
    // snapshot, as do mapa e as do 360 indexado por chave, na mesma ordem.
    assert.deepEqual(
      Object.keys(comFronteira.snapshot), Object.keys(semFronteira.snapshot),
      'as chaves do snapshot são contrato congelado com o documento local do cliente',
    );
    assert.deepEqual(Object.keys(servido), Object.keys(cru), 'e as do mapa');
    assert.deepEqual(
      Object.keys(servido.streetview360.orientations),
      Object.keys(cru.streetview360.orientations),
      'o 360 é indexado POR CHAVE, e uma chave perdida aqui é uma foto que some da tela',
    );
    assert.deepEqual(
      Object.keys(servido.features), Object.keys(cru.features),
      'as vinte coleções de feição por tipo continuam todas lá, vazias inclusive',
    );
    assert.deepEqual(
      servido.features.polygons[0].geometry, cru.features.polygons[0].geometry,
      'a geometria multipolígono atravessa idêntica, anéis e sinais inclusive',
    );
    assert.equal(
      servido.features.polygons[0].properties.descricao, null,
      '`null` continua `null`: uma reconstrução que o trocasse por `undefined` sumiria com a chave',
    );
  });

  it('CONTRATO CONGELADO — o teto de profundidade tem folga sobre a carga real', async () => {
    // O TETO É UMA TESOURA SILENCIOSA: acima dele a subárvore vira `null`, sem erro e sem log, e o
    // sintoma seria dado que some do meio de uma resposta que continua parecendo certa. O
    // cabeçalho do módulo afirma que 64 está muito acima de qualquer carga real; esta linha MEDE
    // em vez de acreditar, sobre o snapshot mais fundo que este servidor monta.
    const corpo = (await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${tokenVisitante}`)
      .expect(200)).body;

    const fundura = profundidadeMaxima(corpo);
    assert.ok(fundura >= 8, `a carga precisa ser funda o bastante para a medida valer; deu ${fundura}`);
    assert.ok(
      fundura * 2 < MAX_PRUNE_DEPTH,
      `a carga real chega a ${fundura} e o teto é ${MAX_PRUNE_DEPTH}: a folga encolheu, e um dia `
      + 'de uso normal passa a ser anulado em silêncio',
    );

    // E o `null` que o teto produziria NÃO está lá: nenhuma folha nula fora das que o dado tem.
    assert.ok(
      !JSON.stringify(corpo).includes('"coordinates":null'),
      'nenhuma geometria foi anulada pelo teto',
    );
  });
});
