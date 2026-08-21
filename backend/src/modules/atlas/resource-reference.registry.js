// Path: src/modules/atlas/resource-reference.registry.js
// O ESPELHO de `frontend/src/js/catalog/resource-reference.registry.js`: as MESMAS
// superfícies em que um id de recurso de catálogo viaja dentro de um atlas, ditas no
// vocabulário do servidor (tipo de `RESOURCE_TYPES`, tabela e coluna).
//
// SEIS DELAS SÃO SÓ DAQUI (`soServidor`), e é a família de `atlas.settings`: as listas de
// allowlist por atlas nunca chegam ao documento do cliente (o snapshot as aplica sobre o
// `config` em MEMÓRIA e nada as persiste), mas o clone as copia verbatim e o import as
// funde. Elas ficam declaradas nas DUAS cópias porque o inventário é da pergunta, não do
// executor; quem as poda é só este lado.
//
// POR QUE DUAS CÓPIAS, E NÃO UM PACOTE COMPARTILHADO. É o precedente exato de
// `catalog-layer.ref.js`, que já vive nos dois pacotes: os dois lados falam linguagens
// diferentes (documento contra tabela) e nenhum dos dois pode importar o outro. O que não
// pode divergir é a LISTA, e quem afirma que ela não divergiu é um teste que importa AS
// DUAS cópias no mesmo processo (`frontend/tests/unit/referencias-de-recurso-espelho.test.js`).
//
// ZERO IMPORTS, pelo mesmo contrato da outra metade: o teste de espelho carrega este
// arquivo em node puro, e um import aqui arrastaria o módulo inteiro para dentro dele.
// Em particular, `RESOURCE_TYPES` NÃO é importado de `resource-access.types.js` de
// propósito; o teste de espelho é quem confere que os tipos usados aqui são daquela lista.
//
// ESTE ARQUIVO NÃO PODA NADA: quem executa é `atlas.service.js` (clone e import),
// alimentado pela classificação em lote de `classifyResourceRefs`.

/**
 * Tipo de recurso (o vocabulário de `RESOURCE_TYPES`) por grupo do cliente.
 *
 * A tradução mora AQUI, e num lugar só, porque é o único ponto em que os dois
 * vocabulários se encostam. `views360` -> `sv360_project` é a que mais engana: o grupo
 * do cliente é plural e descreve a TELA, o tipo do servidor é singular e descreve a
 * LINHA de `sv360.projects`.
 */
export const RESOURCE_TYPE_BY_GROUP = Object.freeze({
  basemaps: 'basemap',
  tilesets: 'tileset',
  dataLayers: 'data_layer',
  analysisLayers: 'analysis_layer',
  views360: 'sv360_project',
});

/** As mesmas ações do registro do cliente. @readonly @enum {string} */
export const REF_ACTION = Object.freeze({
  PADRAO: 'padrao',
  REMOVE_ENTRADA: 'remove-entrada',
  ZERA_E_REBAIXA: 'zera-e-rebaixa',
  FILTRA_LISTA: 'filtra-lista',
  NAO_REFERENCIA: 'nao-referencia',
});

/**
 * O basemap para o qual um mapa volta quando o dele não sobrevive à poda: o
 * `DEFAULT NOT NULL` da própria coluna.
 */
export const DEFAULT_BASE_LAYER = 'carta-topografica';

/**
 * @typedef {Object} ResourceRefSurface
 * @property {string} id - A MESMA identidade da cópia do cliente.
 * @property {string[]} tipos - Tipos de `RESOURCE_TYPES` que a superfície referencia.
 * @property {string} tabela
 * @property {string} coluna - Coluna, ou `data` quando o id mora dentro do JSONB.
 * @property {string} acao - Um `REF_ACTION`.
 * @property {boolean} [soServidor] - O id não viaja no documento do cliente: quem poda é
 *   sempre este lado. Ver o cabeçalho.
 */

/** @type {ReadonlyArray<ResourceRefSurface>} */
export const RESOURCE_REF_SURFACES = Object.freeze([
  Object.freeze({
    id: 'mapa.baseLayer',
    tipos: ['basemap'],
    tabela: 'maps',
    coluna: 'base_layer',
    acao: REF_ACTION.PADRAO,
  }),
  Object.freeze({
    id: 'mapa.catalogLayers',
    tipos: ['data_layer', 'analysis_layer', 'tileset'],
    tabela: 'catalog_layers',
    coluna: 'data',
    acao: REF_ACTION.REMOVE_ENTRADA,
  }),
  Object.freeze({
    id: 'cesium3d.cameraPositions',
    tipos: ['tileset'],
    tabela: 'cesium3d_data',
    coluna: 'tileset_id',
    acao: REF_ACTION.REMOVE_ENTRADA,
  }),
  Object.freeze({
    id: 'cesium3d.markers',
    tipos: ['tileset'],
    tabela: 'cesium3d_data',
    coluna: 'tileset_id',
    acao: REF_ACTION.REMOVE_ENTRADA,
  }),
  Object.freeze({
    id: 'cesium3d.measurements',
    tipos: ['tileset'],
    tabela: 'cesium3d_data',
    coluna: 'tileset_id',
    acao: REF_ACTION.REMOVE_ENTRADA,
  }),
  Object.freeze({
    id: 'cesium3d.viewsheds',
    tipos: ['tileset'],
    tabela: 'cesium3d_data',
    coluna: 'tileset_id',
    acao: REF_ACTION.REMOVE_ENTRADA,
  }),
  Object.freeze({
    id: 'sv360.orientations',
    tipos: ['sv360_project'],
    tabela: 'streetview360_data',
    coluna: 'photo_name',
    acao: REF_ACTION.REMOVE_ENTRADA,
  }),
  Object.freeze({
    id: 'sv360.markers',
    tipos: ['sv360_project'],
    tabela: 'streetview360_data',
    coluna: 'photo_name',
    acao: REF_ACTION.REMOVE_ENTRADA,
  }),
  Object.freeze({
    id: 'briefing.slide.modelId',
    tipos: ['tileset'],
    tabela: 'slides',
    coluna: 'model_id',
    acao: REF_ACTION.ZERA_E_REBAIXA,
  }),
  Object.freeze({
    id: 'briefing.slide.photoId',
    tipos: ['sv360_project'],
    tabela: 'slides',
    coluna: 'photo_id',
    acao: REF_ACTION.ZERA_E_REBAIXA,
  }),
  Object.freeze({
    id: 'settings.basemaps',
    tipos: ['basemap'],
    tabela: 'atlas',
    coluna: 'settings',
    acao: REF_ACTION.FILTRA_LISTA,
    soServidor: true,
  }),
  Object.freeze({
    id: 'settings.default_basemap',
    tipos: ['basemap'],
    tabela: 'atlas',
    coluna: 'settings',
    acao: REF_ACTION.PADRAO,
    soServidor: true,
  }),
  Object.freeze({
    id: 'settings.available_data_layers',
    tipos: ['data_layer'],
    tabela: 'atlas',
    coluna: 'settings',
    acao: REF_ACTION.FILTRA_LISTA,
    soServidor: true,
  }),
  Object.freeze({
    id: 'settings.available_analysis_layers',
    tipos: ['analysis_layer'],
    tabela: 'atlas',
    coluna: 'settings',
    acao: REF_ACTION.FILTRA_LISTA,
    soServidor: true,
  }),
  Object.freeze({
    id: 'settings.available_3d_models',
    tipos: ['tileset'],
    tabela: 'atlas',
    coluna: 'settings',
    acao: REF_ACTION.FILTRA_LISTA,
    soServidor: true,
  }),
  Object.freeze({
    id: 'settings.available_360_views',
    tipos: ['sv360_project'],
    tabela: 'atlas',
    coluna: 'settings',
    acao: REF_ACTION.FILTRA_LISTA,
    soServidor: true,
  }),
  Object.freeze({
    id: 'mapa.analysisLayers',
    tipos: [],
    tabela: 'maps',
    coluna: 'analysis_layers',
    acao: REF_ACTION.NAO_REFERENCIA,
  }),
]);

/**
 * A chave de junção de um par (tipo, id) classificado.
 *
 * O separador é NUL, escrito como ESCAPE e nunca como byte cru, pela mesma razão escrita
 * em `catalog-layer.ref.js`: NUL não cabe num tipo nem num id de catálogo, então é o
 * único separador que não faz dois pares diferentes colidirem numa chave só — e um byte
 * NUL cru faria o git classificar o arquivo como binário, que é como um módulo com peso
 * de segurança muda sem diff revisável.
 *
 * EXISTE UMA GÊMEA, e ela está declarada aqui para que a terceira não nasça:
 * `catalogRefKey` (`../catalog/catalog-layer.ref.js`) é a MESMA função, com o mesmo
 * separador e o mesmo racional. As duas não se importam porque este arquivo tem contrato de
 * ZERO IMPORTS (ver o cabeçalho), e é esse contrato — e não descuido — o motivo da cópia.
 * @param {string} type
 * @param {string} resourceId
 * @returns {string}
 */
export function resourceRefKey(type, resourceId) {
  return `${type}\u0000${resourceId}`;
}
