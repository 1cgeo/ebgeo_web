// Path: tests/integration/forma-do-escritor-atravessa.test.js
//
// F14 — O GUARDA DE FORMA. A borda de escrita é medida contra o ESCRITOR REAL do cliente.
//
// POR QUE ESTE ARQUIVO EXISTE. `free-field.schemas.js` fecha nove colunas JSONB numa forma que foi
// LIDA nos escritores do frontend. Uma forma lida uma vez é uma cópia, e cópia envelhece: basta a
// próxima funcionalidade acrescentar um campo ao escritor para o campo novo passar a ser descartado
// em silêncio na borda (ou, pior, para a coluna voltar a ser livre na prática porque alguém
// afrouxou o esquema em vez de atualizá-lo). O aperto sem este guarda dura uma release.
//
// COMO ELE MEDE, e a escolha é o que dá a ele poder de discriminação:
//
//   1. A FORMA VEM DA FONTE, NUNCA DAQUI. Três módulos do frontend têm ZERO imports e são
//      importados de verdade (precedente: `tests/unit/maplibre-style-validate.test.js`), então o
//      teste usa o REGISTRO e não uma transcrição dele: o esquema de estilo, o modelo de expressão
//      MapLibre e o default temporal. Os escritores que arrastam a store não se importam, e desses
//      as chaves são LIDAS DO TEXTO do arquivo e comparadas com a tabela declarada aqui — é essa
//      comparação que fica VERMELHA quando alguém acrescenta uma chave ao escritor.
//
//   2. A MEDIDA É COMPORTAMENTAL, no fio inteiro, e não uma chamada ao módulo de validação. A
//      carga é empurrada pela rota real de sync e o que se compara é a LINHA DO BANCO com o que
//      saiu do escritor. Isso alcança duas bordas de uma vez, e a segunda não é o Joi: a lista
//      fixa de chaves de `normalizeMapChanges` (`['ativo','unidade','inicio','fim','modo',
//      'origem']`) é tão capaz de comer um campo novo quanto o esquema, e nenhum teste de unidade
//      do Joi a alcançaria.
//
// O TETO DELE, escrito porque é o tipo de coisa que se supõe larga demais: onde o regime é
// SCRUBBED (a entrada de catálogo, as propriedades de feição), uma chave nova de valor ESCALAR
// atravessa sozinha, e o vermelho vem da comparação de chaves do item 1, não do banco. Onde o
// regime é CLOSED (grade, temporal, briefing, slide), uma chave nova de valor OBJETO é descartada e
// o vermelho vem do banco. Os dois caminhos existem de propósito; nenhum deles é o único.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createBriefing, createSlide, loginUser,
} from '../helpers/fixtures.js';

// --- As três fontes IMPORTADAS (módulos puros do frontend, zero imports) -----------------------
import {
  VECTOR_SUBLAYERS, RASTER_SUBLAYER,
} from '../../../frontend/src/js/layers/layer-style/layer-style.schema.js';
import {
  parseCategorized, serializeCategorized, parseGraduated, serializeGraduated,
} from '../../../frontend/src/js/layers/layer-style/style-expression.model.js';
import {
  DEFAULT_TEMPORAL_CONFIG,
} from '../../../frontend/src/js/temporal/temporal.constants.js';

const sufixo = randomUUID().slice(0, 8);
const RECURSO = `f14-forma-${sufixo}`;
const ID_DA_ENTRADA = `analysis-${RECURSO}`;
const URL_DO_RECURSO = `/tiles/${sufixo}/forma/{z}/{x}/{y}.pbf`;

// ==============================================================================================
// LEITURA DE FONTE — para os escritores que arrastam a store e não podem ser importados
// ==============================================================================================

const RAIZ_DO_FRONT = new URL('../../../frontend/src/js/', import.meta.url);

/**
 * @param {string} relativo - Caminho a partir de `frontend/src/js/`.
 * @returns {Promise<string>} O texto do arquivo.
 */
async function lerFonte(relativo) {
  const texto = await readFile(new URL(relativo, RAIZ_DO_FRONT), 'utf8');
  assert.ok(texto.length > 200, `fonte vazia ou não encontrada: ${relativo}`);
  return texto;
}

/**
 * O texto do literal de objeto que começa na âncora, com as chaves externas.
 *
 * A âncora precisa TERMINAR no `{` de abertura, para que o casamento de chaves não dependa de
 * adivinhar onde o literal começa.
 *
 * @param {string} texto
 * @param {string} ancora
 * @returns {string} O corpo do literal, sem as chaves externas.
 */
function corpoDoLiteral(texto, ancora) {
  const inicio = texto.indexOf(ancora);
  assert.notEqual(inicio, -1, `âncora não encontrada na fonte: ${ancora}`);
  const abre = inicio + ancora.length - 1;
  assert.equal(texto[abre], '{', 'a âncora precisa terminar no `{` de abertura do literal');

  let profundidade = 0;
  for (let i = abre; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === '{') profundidade += 1;
    else if (c === '}') {
      profundidade -= 1;
      if (profundidade === 0) return texto.slice(abre + 1, i);
    }
  }
  assert.fail(`literal não fechado a partir da âncora: ${ancora}`);
}

/**
 * As chaves do PRIMEIRO nível de um literal de objeto.
 *
 * Comentário de linha é removido antes da varredura; se a remoção ferir um literal (uma URL numa
 * string, por exemplo), a comparação com a tabela declarada é o que denuncia, e a mensagem dela
 * manda conferir a extração. Um extrator silencioso é que seria o problema.
 *
 * @param {string} texto
 * @param {string} ancora
 * @returns {string[]}
 */
function chavesDoLiteral(texto, ancora) {
  const corpo = corpoDoLiteral(texto, ancora)
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');

  const chaves = [];
  let profundidade = 0;
  let palavra = '';
  for (const c of corpo) {
    if (c === '{' || c === '[' || c === '(') profundidade += 1;
    else if (c === '}' || c === ']' || c === ')') profundidade -= 1;
    else if (/[\w$]/.test(c)) { palavra += c; continue; }
    else if (c === ':' && profundidade === 0 && palavra) { chaves.push(palavra); }
    palavra = '';
  }
  return chaves;
}

/**
 * Os nomes de `@property` de um bloco `@typedef`.
 * @param {string} texto
 * @param {string} nome - Nome do typedef.
 * @returns {string[]}
 */
function propriedadesDoTypedef(texto, nome) {
  const inicio = texto.indexOf(`@typedef {Object} ${nome}`);
  assert.notEqual(inicio, -1, `typedef não encontrado: ${nome}`);
  const fim = texto.indexOf('*/', inicio);
  assert.notEqual(fim, -1, `typedef ${nome} não fechado`);
  const bloco = texto.slice(inicio, fim);
  return [...bloco.matchAll(/@property\s+\{[^}]*\}\s+\[?([\w$]+)/g)].map((m) => m[1]);
}

// ==============================================================================================
// AS FORMAS DECLARADAS — uma por escritor que não se importa
//
// Cada tabela é chave -> valor de exemplo. As CHAVES são cobradas contra a fonte (é o vermelho do
// item 1); os VALORES são o que atravessa o fio (é o vermelho do item 2).
// ==============================================================================================

/**
 * `CatalogLayerState` (`store/catalog.operations.js`), a forma da entrada de catálogo.
 *
 * `name` e `config` estão aqui e são LEGADO declarado no próprio typedef ("never written" pelo
 * cliente pós-F11). Eles entram na tabela porque a sobrevivência deles na ESCRITA é o teto
 * declarado da F14, cobrado por dois testes de contrato: o hillshade É `{name, config}`, e todo
 * documento pré-F11 também.
 */
const ENTRADA_DE_CATALOGO = {
  id: ID_DA_ENTRADA,
  type: 'analysis_layer',
  visible: true,
  opacity: 0.75,
  status: 'active',
  originalId: RECURSO,
  name: 'Cópia legada do nome',
  config: { id: RECURSO, source: { type: 'vector', url: '/copia-legada-do-cliente' } },
  styleOverrides: null, // preenchido pelo registro de estilo (ver `estiloDoPainel`)
};

/** `grid.control.js`, o único escritor de `maps.grid_style`. */
const ESTILO_DE_GRADE = { format: 'utm', visible: true };

/** `DEFAULT_BRIEFING_SETTINGS` (`store/briefing.operations.js`). */
const AJUSTES_DE_BRIEFING = {
  panelPosition: 'right',
  panelWidth: 420,
  panelBackgroundColor: 'rgba(255, 255, 255, 0.95)',
};

/** `createEmptySlide().position` (`store/briefing.operations.js`). */
const POSICAO_DE_SLIDE = { longitude: -45.5, latitude: -20.25, zoom: 11, altitude: 1500 };

/** `createEmptySlide().orientation` (`store/briefing.operations.js`). */
const ORIENTACAO_DE_SLIDE = { bearing: 33, pitch: -25, heading: 90, lon: -45.5, lat: -20.25, fov: 60 };

// ==============================================================================================
// O ESTILO DO PAINEL — derivado do registro, não transcrito
// ==============================================================================================

/**
 * Duas expressões MapLibre reais, das que o catálogo traz na `config` e o painel devolve depois de
 * editar. Elas passam por parse+serialize do modelo do próprio painel, então o que vai ao fio é a
 * SAÍDA do escritor e não um array escrito à mão que se parece com ela.
 */
const EXPRESSAO_CATEGORIZADA = ['match', ['get', 'tipo'], 'rio', '#0044ff', 'lago', '#00ccff', '#cccccc'];
const EXPRESSAO_GRADUADA = ['interpolate', ['linear'], ['get', 'populacao'], 0, 1, 1000, 8];

/**
 * O `styleOverrides` que o painel de estilo escreve: sub-camada, propriedade, valor.
 * Derivado de `VECTOR_SUBLAYERS` + `RASTER_SUBLAYER`, então uma propriedade nova no registro do
 * frontend entra aqui sozinha e é medida na próxima execução.
 *
 * @returns {Object}
 */
function estiloDoPainel() {
  const overrides = {};
  for (const sub of [...VECTOR_SUBLAYERS, RASTER_SUBLAYER]) {
    overrides[sub.key] = {};
    for (const { prop, outputType } of sub.props) {
      overrides[sub.key][prop] = outputType === 'color' ? '#3388ff' : 0.5;
    }
  }
  // Os dois valores DIRIGIDOS POR DADO, na posição em que o painel os escreve. O contrabando da
  // revisão da F13 foi plantado exatamente aqui, um nível abaixo, então esta é a folha que a borda
  // proíbe de ser objeto — e um array precisa continuar atravessando inteiro.
  overrides.fill['fill-color'] = serializeCategorized(parseCategorized(EXPRESSAO_CATEGORIZADA));
  overrides.border['line-width'] = serializeGraduated(parseGraduated(EXPRESSAO_GRADUADA));
  return overrides;
}

// ==============================================================================================

describe('F14 — a forma que o escritor do cliente produz atravessa a borda inteira', () => {
  let app, db, token, atlas, mapa, briefing, slide;

  const push = async (operations, esperado = 200) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(esperado);
    return res.body.data;
  };

  const op = (extra) => ({
    id: randomUUID(),
    timestamp: Date.now(),
    clientId: `c-forma-${sufixo}`,
    ...extra,
  });

  /**
   * Empurra UMA op e cobra que ela não tenha sido recusada. Toda medida abaixo depende disso:
   * uma op recusada deixaria a coluna com o valor antigo, e a comparação seguinte estaria medindo
   * a fixture do banco em vez do fio.
   * @param {Object} operacao
   * @returns {Promise<void>}
   */
  async function empurrarAceita(operacao) {
    const { acks } = await push([operacao]);
    assert.equal(acks.length, 1, 'a op precisa ser acked');
    assert.equal(acks[0].rejected, undefined, `op recusada: ${acks[0].reason}`);
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const dono = await createUser(db, { username: `f14_forma_${sufixo}` });
    token = await loginUser(app, dono.username, dono.password);
    atlas = await createAtlas(db, dono.id, { name: `F14 forma ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: `Mapa forma ${sufixo}` });
    briefing = await createBriefing(db, atlas.id, { name: `Briefing forma ${sufixo}` });
    slide = await createSlide(db, briefing.id, { title: `Slide forma ${sufixo}` });

    // O recurso PÚBLICO por trás da entrada de catálogo. Sem ele a op de catálogo é recusada por
    // `unseenCatalogResourceDenialReason` e o arquivo mediria uma recusa em vez de uma escrita.
    await db.query(
      `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, $3::jsonb, 0, 'public')`,
      [RECURSO, `Camada ${RECURSO} (nome vivo)`, JSON.stringify({
        source: { type: 'vector', url: URL_DO_RECURSO },
      })],
    );
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [RECURSO]);
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [RECURSO]);
    await db.query('DELETE FROM analysis_layers WHERE id = $1', [RECURSO]);
    await teardownTestEnv(db);
  });

  // ============================================================================================
  // ITEM 1 — AS CHAVES VÊM DA FONTE
  // ============================================================================================

  it('as chaves declaradas aqui são EXATAMENTE as do escritor do frontend', async () => {
    const casos = [
      {
        fonte: 'store/catalog.operations.js',
        esperadas: Object.keys(ENTRADA_DE_CATALOGO),
        lidas: propriedadesDoTypedef(
          await lerFonte('store/catalog.operations.js'), 'CatalogLayerState',
        ),
      },
      {
        fonte: 'grid/grid.control.js',
        esperadas: Object.keys(ESTILO_DE_GRADE),
        lidas: chavesDoLiteral(await lerFonte('grid/grid.control.js'), 'setGridStyle(mapName, {'),
      },
      {
        fonte: 'store/briefing.operations.js (DEFAULT_BRIEFING_SETTINGS)',
        esperadas: Object.keys(AJUSTES_DE_BRIEFING),
        lidas: chavesDoLiteral(
          await lerFonte('store/briefing.operations.js'),
          'export const DEFAULT_BRIEFING_SETTINGS = {',
        ),
      },
    ];

    const fonteDoSlide = corpoDoLiteral(
      await lerFonte('store/briefing.operations.js'), 'export function createEmptySlide(order = 0) {',
    );
    casos.push(
      {
        fonte: 'store/briefing.operations.js (createEmptySlide.position)',
        esperadas: Object.keys(POSICAO_DE_SLIDE),
        lidas: chavesDoLiteral(fonteDoSlide, 'position: {'),
      },
      {
        fonte: 'store/briefing.operations.js (createEmptySlide.orientation)',
        esperadas: Object.keys(ORIENTACAO_DE_SLIDE),
        lidas: chavesDoLiteral(fonteDoSlide, 'orientation: {'),
      },
    );

    // PISO: sem ele, um extrator que devolvesse lista vazia deixaria os dois lados iguais só nos
    // casos em que a tabela também estivesse vazia, e o laço abaixo passaria sobre nada.
    assert.equal(casos.length, 5, 'os cinco escritores lidos por texto');
    for (const { fonte, esperadas, lidas } of casos) {
      assert.ok(lidas.length >= 2, `${fonte}: a extração não achou chaves (${lidas.length})`);
      assert.deepEqual(
        [...lidas].sort(), [...esperadas].sort(),
        `${fonte}: o escritor do frontend mudou de forma. Acrescente a chave à tabela deste `
        + 'arquivo COM um valor de exemplo e confirme, no caso correspondente abaixo, que ela '
        + 'sobrevive à borda de escrita (src/modules/sync/free-field.schemas.js).',
      );
    }
  });

  it('o registro de estilo importado tem conteúdo, e o modelo de expressão devolve o que recebeu', () => {
    // As fontes IMPORTADAS não precisam de tabela declarada, mas precisam de piso: um registro
    // vazio faria o caso do estilo, abaixo, passar sobre um `styleOverrides` de zero propriedades.
    const subCamadas = [...VECTOR_SUBLAYERS, RASTER_SUBLAYER];
    assert.equal(subCamadas.length, 4, 'quatro sub-camadas: fill, border, label, raster');
    // QUINZE, e o número está aqui porque foi MEDIDO contra o registro: o levantamento desta fase
    // escreveu "13, exaustivo" ao lado de uma lista com quinze nomes. Contagem à mão é a única
    // afirmação que nenhum guarda do repositório pega, e é por isso que esta vem do registro.
    const props = subCamadas.flatMap((s) => s.props.map((p) => p.prop));
    assert.equal(props.length, 15, 'quinze propriedades editáveis (2 fill + 3 border + 4 label + 6 raster)');
    assert.equal(new Set(props).size, 15, 'e sem repetição');

    // O ROUND-TRIP prova que as duas expressões do fixture são a SAÍDA do escritor, e não um array
    // parecido com ela. Se o modelo mudar de forma, isto fica vermelho antes da borda.
    assert.deepEqual(
      serializeCategorized(parseCategorized(EXPRESSAO_CATEGORIZADA)), EXPRESSAO_CATEGORIZADA,
    );
    assert.deepEqual(
      serializeGraduated(parseGraduated(EXPRESSAO_GRADUADA)), EXPRESSAO_GRADUADA,
    );

    assert.ok(Object.keys(DEFAULT_TEMPORAL_CONFIG).length >= 6, 'o default temporal tem conteúdo');
  });

  // ============================================================================================
  // ITEM 2 — A FORMA ATRAVESSA O FIO INTEIRO
  // ============================================================================================

  it('a entrada de catálogo, com o estilo que o painel escreve, é GRAVADA sem perder um campo', async () => {
    const enviado = { ...ENTRADA_DE_CATALOGO, styleOverrides: estiloDoPainel() };

    await empurrarAceita(op({
      entityType: 'catalogLayer',
      operationType: 'create',
      entityId: ID_DA_ENTRADA,
      mapId: mapa.id,
      data: enviado,
    }));

    const { rows } = await db.query(
      'SELECT data FROM catalog_layers WHERE map_id = $1 AND id = $2', [mapa.id, ID_DA_ENTRADA],
    );
    assert.equal(rows.length, 1, 'a entrada foi criada');
    assert.deepEqual(
      rows[0].data, enviado,
      'a borda de escrita não pode perder nem alterar um campo da forma legítima',
    );

    // As duas afirmações que o `deepEqual` acima já contém, ditas por extenso porque são as que
    // um aperto futuro quebraria primeiro: a expressão MapLibre é ARRAY e precisa atravessar
    // inteira, e a folha escalar precisa manter o tipo.
    assert.deepEqual(rows[0].data.styleOverrides.fill['fill-color'], EXPRESSAO_CATEGORIZADA);
    assert.deepEqual(rows[0].data.styleOverrides.border['line-width'], EXPRESSAO_GRADUADA);
    assert.equal(rows[0].data.styleOverrides.raster['raster-opacity'], 0.5);
  });

  it('e chega ao cliente pelo snapshot com o estilo intacto e a definição VIVA do catálogo', async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const entrada = res.body.data.snapshot.maps
      .find((m) => m.id === mapa.id).catalogLayers
      .find((c) => c.id === ID_DA_ENTRADA);
    assert.ok(entrada, 'a entrada está no snapshot');
    assert.deepEqual(
      entrada.styleOverrides, estiloDoPainel(),
      'o estado do painel de estilo é contrato com o documento IndexedDB do cliente',
    );
    assert.equal(entrada.visible, true);
    assert.equal(entrada.opacity, 0.75);
    // A reidratação substitui a cópia legada pela linha viva: é o positivo do V-A.
    assert.equal(entrada.config.source.url, URL_DO_RECURSO, 'a definição vem do catálogo');
    assert.match(entrada.name, /nome vivo/, 'com o nome vivo, não a cópia guardada');
  });

  it('`maps.grid_style` guarda a forma do `grid.control.js`, campo por campo', async () => {
    await empurrarAceita(op({
      entityType: 'gridStyle',
      operationType: 'update',
      entityId: mapa.id,
      mapId: mapa.id,
      data: { ...ESTILO_DE_GRADE },
    }));

    const { rows } = await db.query('SELECT grid_style FROM maps WHERE id = $1', [mapa.id]);
    assert.deepEqual(rows[0].grid_style, ESTILO_DE_GRADE);
  });

  it('`maps.temporal_config` guarda o DEFAULT_TEMPORAL_CONFIG inteiro, chave por chave', async () => {
    // A carga é o próprio default do frontend, com as bordas nulas preenchidas para que o caso
    // meça VALOR e não só presença de chave. Uma chave nova em `DEFAULT_TEMPORAL_CONFIG` entra
    // aqui sozinha, e se `normalizeMapChanges` não a conhecer a coluna volta sem ela: vermelho.
    const enviado = {
      ...DEFAULT_TEMPORAL_CONFIG,
      ativo: true,
      inicio: 1700000000000,
      fim: 1700003600000,
      origem: 1699999999000,
    };

    await empurrarAceita(op({
      entityType: 'mapTemporal',
      operationType: 'update',
      entityId: mapa.id,
      mapId: mapa.id,
      data: enviado,
    }));

    const { rows } = await db.query('SELECT temporal_config FROM maps WHERE id = $1', [mapa.id]);
    assert.deepEqual(
      rows[0].temporal_config, enviado,
      'o servidor monta `temporal_config` a partir de uma lista FIXA de chaves '
      + '(`normalizeMapChanges`); uma chave nova no default do frontend precisa entrar lá também.',
    );
  });

  it('`briefings.settings` guarda o DEFAULT_BRIEFING_SETTINGS inteiro', async () => {
    await empurrarAceita(op({
      entityType: 'briefing',
      operationType: 'update',
      entityId: briefing.id,
      mapId: null,
      changes: { settings: { ...AJUSTES_DE_BRIEFING } },
    }));

    const { rows } = await db.query('SELECT settings FROM briefings WHERE id = $1', [briefing.id]);
    assert.deepEqual(rows[0].settings, AJUSTES_DE_BRIEFING);
  });

  it('`slides.position` e `slides.orientation` guardam a forma do `createEmptySlide`', async () => {
    await empurrarAceita(op({
      entityType: 'slide',
      operationType: 'update',
      entityId: slide.id,
      mapId: null,
      changes: {
        position: { ...POSICAO_DE_SLIDE },
        orientation: { ...ORIENTACAO_DE_SLIDE },
      },
    }));

    const { rows } = await db.query(
      'SELECT position, orientation FROM slides WHERE id = $1', [slide.id],
    );
    assert.deepEqual(rows[0].position, POSICAO_DE_SLIDE);
    assert.deepEqual(rows[0].orientation, ORIENTACAO_DE_SLIDE);
  });

  // ============================================================================================
  // O CONTROLE NEGATIVO — sem ele, tudo acima passaria numa borda que não faz nada
  // ============================================================================================

  it('CONTROLE — a MESMA forma, com um objeto plantado na folha, perde o objeto e nada mais', async () => {
    // O par exigido: os casos acima mostram que a forma legítima passa; este mostra que a borda
    // está ligada. Sem ele, um `free-field.schemas.js` que devolvesse a carga intocada ficaria
    // verde do começo ao fim deste arquivo.
    const idSujo = `analysis-${RECURSO}-sujo`;
    const estilo = estiloDoPainel();
    estilo.raster.contrabando = { name: 'X', config: { source: { url: '/segredo-plantado' } } };

    await empurrarAceita(op({
      entityType: 'catalogLayer',
      operationType: 'create',
      entityId: idSujo,
      mapId: mapa.id,
      // `type` ausente e id sem recurso vivo: a entrada não reclama recurso nenhum, então nada
      // além da borda de forma pode explicar o descarte.
      data: { id: idSujo, visible: true, styleOverrides: estilo },
    }));

    const { rows } = await db.query(
      'SELECT data FROM catalog_layers WHERE map_id = $1 AND id = $2', [mapa.id, idSujo],
    );
    assert.equal(rows.length, 1, 'a entrada foi gravada: o descarte é de campo, não de op');
    assert.ok(
      !JSON.stringify(rows[0].data).includes('/segredo-plantado'),
      'o objeto plantado na folha do estilo não pode ser armazenado',
    );
    assert.deepEqual(
      rows[0].data.styleOverrides.raster['raster-opacity'], 0.5,
      'e a propriedade legítima ao lado dele fica',
    );
    assert.deepEqual(
      rows[0].data.styleOverrides.fill['fill-color'], EXPRESSAO_CATEGORIZADA,
      'assim como a expressão de outra sub-camada',
    );
  });
});
