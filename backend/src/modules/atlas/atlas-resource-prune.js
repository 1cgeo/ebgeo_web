// Path: src/modules/atlas/atlas-resource-prune.js
// A PODA DE CLONE E DE IMPORT: tirar de uma CÓPIA as referências a recurso de catálogo que
// o DESTINATÁRIO não enxerga.
//
// POR QUE ELA É DIFERENTE DA PODA DE SAÍDA (a do `.ebgeo` e do "Salvar como local"). Ali o
// atlas deixa o servidor e não há mais ponto de imposição, então a regra é keep-list e o
// privado sai inteiro, dono inclusive. Aqui a cópia FICA no servidor, onde o predicado
// continua valendo a cada leitura — logo a pergunta certa é por destinatário, e quem a
// responde é o SQL (`fn_can_see_resource`, via `classifyResourceRefs`), nunca uma segunda
// cópia da regra em JS. Este arquivo só decide O QUE FAZER com a resposta.
//
// O IMPORT ENTRA PELA MESMA PORTA, e não por simetria estética: `.ebgeo` é ARQUIVO. Ele
// circula por e-mail, pode vir de uma versão anterior e pode ter sido escrito à mão. A
// rota de import deliberadamente não tem gate de atlas (ela CRIA um), então a referência
// do payload é gravada verbatim e volta a sair no snapshot — servido a `read`, nível que um
// visitante de link público segura. O que a referência NÃO entrega é byte: cada tipo tem
// gate próprio nos bytes. O que ela entrega é a IDENTIDADE de um recurso privado, que é a
// mesma classe de vazamento que a poda de definição fechou, um degrau abaixo.
//
// NÃO É 4xx: recusar o arquivo inteiro por uma referência morta tornaria todo `.ebgeo`
// antigo inimportável, e a poda já produz um resultado correto e utilizável.
//
// A LISTA DE SUPERFÍCIES é `resource-reference.registry.js`, espelhada no cliente.

import { catalogLayerReference } from '../catalog/catalog-layer.ref.js';
import { DEFAULT_BASE_LAYER, resourceRefKey } from './resource-reference.registry.js';

/**
 * O tipo de camada de catálogo que a interface ATUAL não cunha e o documento antigo carrega.
 *
 * `claimsCatalogResource` (`catalog-layer.ref.js`) só conhece `analysis_layer` e
 * `data_layer`, e é assim que ele tem de continuar: aquele predicado decide se a DEFINIÇÃO
 * pode viajar no snapshot, e o servidor nunca serviu definição para este ramo. Mas a
 * referência viaja, e o cliente a resolve contra `config.tilesets` até hoje
 * (`resolveCatalogLayerDefinition`, `case MODEL_3D`, com "old documents carry them" escrito
 * ao lado). Então a poda o trata como referência de `tileset` AQUI, sem alargar o predicado
 * de definição — e do mesmo jeito que o cliente: a referência mora em `originalId` ou em
 * `config.id`, nunca no `id` da entrada, porque o tipo não cunha prefixo.
 */
const TIPO_LEGADO_3D = 'model_3d';

/**
 * O par (tipo, id) de uma referência de camada de catálogo, ou null.
 *
 * Delega a `catalogLayerReference`, que é a definição ÚNICA do prefixo e das duas formas
 * legadas. Hillshade e a forma legada sem `type` devolvem null e são deixadas em paz: não
 * há linha de catálogo por trás delas.
 * @param {*} id - `catalog_layers.id`.
 * @param {*} tipo - `data->>'type'`.
 * @param {*} [payload] - O documento inteiro, quando disponível (formas legadas).
 * @returns {{resourceType: string, resourceId: string}|null}
 */
export function catalogLayerRef(id, tipo, payload = null) {
  const entrada = payload ?? { type: tipo, id };
  if (entrada?.type === TIPO_LEGADO_3D) {
    const legado = entrada.originalId || entrada.config?.id;
    if (typeof legado !== 'string' || legado === '') return null;
    return { resourceType: 'tileset', resourceId: legado };
  }
  return catalogLayerReference(entrada, id);
}

/**
 * As CINCO listas de allowlist de `atlas.settings`, com o tipo de recurso de cada uma e a
 * chave de `features` que se desliga quando a lista fica VAZIA depois da poda.
 *
 * A ARMADILHA MORA NESTA ÚLTIMA COLUNA. Lista vazia significa "sem restrição"
 * (`intersectAvailability`, no cliente: `if (allow.length === 0) return [...all]`), então
 * podar uma lista de dois ids até zero ALARGARIA a cópia em vez de estreitá-la — o oposto
 * do que a poda existe para fazer. Quando tudo cai, o honesto é desligar a CATEGORIA.
 *
 * `basemaps` fica de fora desta lista e tem tratamento próprio, sem `feature`: não existe
 * chave de `features` para camada de base, e um mapa sem camada de base não desenha. É a
 * mesma decisão de `mapa.baseLayer`, que volta ao PADRÃO em vez de sumir.
 */
const LISTAS_DE_SETTINGS = Object.freeze([
  Object.freeze({ chave: 'basemaps', tipo: 'basemap', superficie: 'settings.basemaps', feature: null }),
  Object.freeze({ chave: 'available_data_layers', tipo: 'data_layer', superficie: 'settings.available_data_layers', feature: 'data_layers' }),
  Object.freeze({ chave: 'available_analysis_layers', tipo: 'analysis_layer', superficie: 'settings.available_analysis_layers', feature: 'analysis_layers' }),
  Object.freeze({ chave: 'available_3d_models', tipo: 'tileset', superficie: 'settings.available_3d_models', feature: 'map_3d' }),
  Object.freeze({ chave: 'available_360_views', tipo: 'sv360_project', superficie: 'settings.available_360_views', feature: 'panoramic_images' }),
]);

/**
 * `origem` de `COLLECT_ATLAS_RESOURCE_REFS` -> o tipo de recurso, para as pernas em que ele
 * é FIXO (todas menos `mapa.catalogLayers`, cujo tipo depende do `type` da entrada).
 */
const TIPO_POR_ORIGEM = Object.freeze({
  'mapa.baseLayer': 'basemap',
  cesium3d: 'tileset',
  'briefing.slide.modelId': 'tileset',
  sv360: 'sv360_project',
  'briefing.slide.photoId': 'sv360_project',
  'settings.basemaps': 'basemap',
  'settings.default_basemap': 'basemap',
  'settings.available_data_layers': 'data_layer',
  'settings.available_analysis_layers': 'analysis_layer',
  'settings.available_3d_models': 'tileset',
  'settings.available_360_views': 'sv360_project',
});

/**
 * Traduz as linhas de `COLLECT_ATLAS_RESOURCE_REFS` na lista de pares que
 * `classifyResourceRefs` consome.
 *
 * O `payload` da perna de camada de catálogo É LOAD-BEARING, e a ausência dele era um
 * defeito real: `catalogLayerReference` só encontra a referência LEGADA (`originalId`,
 * `config.id`) DENTRO do documento, então colher sem ele devolvia null para toda entrada
 * pré-prefixo — nada era classificado — enquanto `manterCatalogLayer`, que recebe `data`,
 * ACHAVA a referência e perguntava por uma chave que ninguém classificou. Fecha-fechado, e
 * a camada morria no clone MESMO SENDO PÚBLICA: perda de dado silenciosa num caminho
 * irreversível.
 *
 * @param {Array<{origem: string, ref: string, tipo: string|null, payload: Object|null}>} linhas
 * @returns {Array<{type: string, resourceId: string}>}
 */
export function refsFromCollectedRows(linhas) {
  const refs = [];
  for (const linha of linhas || []) {
    if (linha?.ref == null || linha.ref === '') continue;
    if (linha.origem === 'mapa.catalogLayers') {
      const ref = catalogLayerRef(linha.ref, linha.tipo, linha.payload ?? null);
      if (ref) refs.push({ type: ref.resourceType, resourceId: ref.resourceId });
      continue;
    }
    const type = TIPO_POR_ORIGEM[linha.origem];
    if (type) refs.push({ type, resourceId: String(linha.ref) });
  }
  return refs;
}

/**
 * O id de tileset que uma linha de `cesium3d_data` REALMENTE carrega.
 *
 * A coluna e o JSONB são lidos juntos, e não é redundância: o snapshot monta
 * `{tilesetId: item.tileset_id, ...item.data}` (`sync.service.js`), então um `tilesetId`
 * dentro de `data` VENCE a coluna na hora de sair. No caminho normal do app os dois são
 * escritos com o mesmo valor (`local-atlas-to-server.js`), mas o `.ebgeo` pode ter sido
 * escrito à mão — que é textualmente o modelo de ameaça declarado no cabeçalho.
 * @param {Object|null} linha
 * @returns {string|null}
 */
export function tilesetDaLinha3d(linha) {
  const alvo = linha?.tileset_id ?? linha?.data?.tilesetId;
  return typeof alvo === 'string' && alvo !== '' ? alvo : null;
}

/**
 * O nome de foto que uma linha de `streetview360_data` REALMENTE carrega. Gêmeo do anterior.
 * @param {Object|null} linha
 * @returns {string|null}
 */
export function fotoDaLinhaSv360(linha) {
  const alvo = linha?.photo_name ?? linha?.data?.photoName;
  return typeof alvo === 'string' && alvo !== '' ? alvo : null;
}

/**
 * As referências que vivem nas seis entradas de `atlas.settings`.
 *
 * UMA definição, consumida pelas DUAS coletas (a do clone lê a coluna do banco, a do import
 * lê o payload), porque é o mesmo documento nas duas pontas.
 * @param {Object|null} settings
 * @returns {Array<{type: string, resourceId: string}>}
 */
export function refsFromSettings(settings) {
  const refs = [];
  if (!settings || typeof settings !== 'object') return refs;
  for (const lista of LISTAS_DE_SETTINGS) {
    const valores = Array.isArray(settings[lista.chave]) ? settings[lista.chave] : [];
    for (const id of valores) {
      if (typeof id === 'string' && id !== '') refs.push({ type: lista.tipo, resourceId: id });
    }
  }
  const padrao = settings.default_basemap;
  if (typeof padrao === 'string' && padrao !== '') {
    refs.push({ type: 'basemap', resourceId: padrao });
  }
  return refs;
}

/**
 * As mesmas referências, colhidas do PAYLOAD de import em vez das tabelas.
 *
 * Duas coletas e não uma porque as fontes são de naturezas diferentes (linhas contra
 * JSON), mas as duas produzem exatamente a mesma lista de pares e alimentam o mesmo
 * classificador, que é onde a regra mora. As DUAS entram por `refsFromSettings`,
 * `tilesetDaLinha3d` e `fotoDaLinhaSv360`, que é o que impede a assimetria de voltar.
 * @param {Object} data - `{atlas, maps, briefings}`.
 * @returns {Array<{type: string, resourceId: string}>}
 */
export function refsFromImportPayload(data) {
  const refs = refsFromSettings(data?.atlas?.settings);
  for (const map of (data?.maps || [])) {
    if (map?.base_layer) refs.push({ type: 'basemap', resourceId: String(map.base_layer) });
    for (const c3d of (map?.cesium3dData || [])) {
      const alvo = tilesetDaLinha3d(c3d);
      if (alvo) refs.push({ type: 'tileset', resourceId: alvo });
    }
    for (const sv of (map?.streetview360Data || [])) {
      const alvo = fotoDaLinhaSv360(sv);
      if (alvo) refs.push({ type: 'sv360_project', resourceId: alvo });
    }
    for (const camada of (map?.catalog_layers || [])) {
      const ref = catalogLayerRef(camada?.id, camada?.type, camada);
      if (ref) refs.push({ type: ref.resourceType, resourceId: ref.resourceId });
    }
  }
  for (const briefing of (data?.briefings || [])) {
    for (const slide of (briefing?.slides || [])) {
      if (slide?.model_id) refs.push({ type: 'tileset', resourceId: String(slide.model_id) });
      if (slide?.photo_id) refs.push({ type: 'sv360_project', resourceId: String(slide.photo_id) });
    }
  }
  return refs;
}

/**
 * O aplicador da poda: o `Map` de visibilidade mais as decisões por superfície.
 *
 * Contagem POR SUPERFÍCIE, e nunca ids nem nomes: o relatório vai para a resposta e para a
 * trilha de auditoria, que é lida por administrador do sistema, e o nome de um recurso
 * privado é metadado do recurso.
 */
export class ResourcePruner {
  /**
   * @param {Map<string, boolean>} visiveis - Saída de `classifyResourceRefs`.
   */
  constructor(visiveis) {
    this._visiveis = visiveis instanceof Map ? visiveis : new Map();
    this.report = {};
  }

  /** @private Anota uma perda numa superfície. */
  _perdeu(superficie) {
    this.report[superficie] = (this.report[superficie] || 0) + 1;
    return false;
  }

  /** @private O veredito cru de um par. Ausente = NÃO visível (fecha fechado). */
  _ve(type, resourceId) {
    return this._visiveis.get(resourceRefKey(type, resourceId)) === true;
  }

  /** Nada foi podado? @returns {boolean} */
  get vazio() {
    return Object.keys(this.report).length === 0;
  }

  /**
   * A camada de base que a cópia deve receber: a original, ou o padrão da coluna.
   * @param {*} baseLayer
   * @returns {string}
   */
  baseLayer(baseLayer) {
    if (!baseLayer) return DEFAULT_BASE_LAYER;
    if (this._ve('basemap', String(baseLayer))) return String(baseLayer);
    this._perdeu('mapa.baseLayer');
    return DEFAULT_BASE_LAYER;
  }

  /**
   * Esta entrada de camada de catálogo sobrevive?
   * @param {Object} entrada - `{id, data}` (clone) ou o payload cru (import).
   * @returns {boolean}
   */
  manterCatalogLayer(entrada) {
    const payload = entrada?.data ?? entrada;
    const ref = catalogLayerRef(entrada?.id ?? payload?.id, payload?.type, payload);
    if (!ref) return true;
    if (this._ve(ref.resourceType, ref.resourceId)) return true;
    return this._perdeu('mapa.catalogLayers');
  }

  /**
   * Esta linha de `cesium3d_data` sobrevive?
   *
   * A superfície declarada é a do `data_type`: as quatro do registro
   * (`cameraPositions`, `markers`, `measurements`, `viewsheds`) são coletores distintos
   * do mesmo documento no cliente e a mesma tabela no servidor, e o relatório precisa
   * distinguir os quatro para que o aviso e a trilha digam a mesma coisa.
   * @param {{data_type: string, tileset_id: string|null}} linha
   * @returns {boolean}
   */
  manterCesium3d(linha) {
    const alvo = tilesetDaLinha3d(linha);
    if (!alvo) return true;
    if (this._ve('tileset', alvo)) return true;
    return this._perdeu(SUPERFICIE_POR_TIPO_3D[linha.data_type] ?? 'cesium3d.markers');
  }

  /**
   * Esta linha de `streetview360_data` sobrevive?
   * @param {{data_type: string, photo_name: string|null}} linha
   * @returns {boolean}
   */
  manterSv360(linha) {
    const alvo = fotoDaLinhaSv360(linha);
    if (!alvo) return true;
    if (this._ve('sv360_project', alvo)) return true;
    return this._perdeu(linha.data_type === 'orientation' ? 'sv360.orientations' : 'sv360.markers');
  }

  /**
   * O slide da cópia: as duas referências conferidas e o modo rebaixado quando a que ele
   * exige não sobreviveu.
   *
   * REBAIXA, NÃO APAGA: título e prosa são escritos à mão e não existem em lugar nenhum
   * além do slide. `createEmptySlide` nasce exatamente no estado resultante (modo 2D,
   * `map_id` nulo), o que é a evidência de que ele é legítimo.
   * @param {{mode: string, model_id: string|null, photo_id: string|null}} slide
   * @returns {{mode: string, model_id: string|null, photo_id: string|null}}
   */
  slide(slide) {
    let mode = slide?.mode || '2d';
    let modelId = slide?.model_id || null;
    let photoId = slide?.photo_id || null;

    if (modelId && !this._ve('tileset', String(modelId))) {
      this._perdeu('briefing.slide.modelId');
      modelId = null;
      if (mode === '3d') mode = '2d';
    }
    if (photoId && !this._ve('sv360_project', String(photoId))) {
      this._perdeu('briefing.slide.photoId');
      photoId = null;
      if (mode === '360') mode = '2d';
    }
    return { mode, model_id: modelId, photo_id: photoId };
  }

  /**
   * O documento `atlas.settings` que a cópia deve receber.
   *
   * A FAMÍLIA QUE O INVENTÁRIO POR NOME DE CAMPO NÃO ENXERGAVA. `settings` carrega SEIS
   * referências de catálogo (`basemaps`, `default_basemap` e quatro `available_*`) e o clone
   * a copiava verbatim: o id de um tileset privado saia por `GET /atlas/:id` e por
   * `GET /atlas/:id/settings` para um destinatário sem concessão nenhuma, no MESMO objeto em
   * que o `pruneReport` dizia que nada tinha sido podado. É a lição do MVT do 360 na forma
   * nova: o predicado numa consulta não protege as outras portas.
   *
   * ESVAZIAR UMA LISTA NÃO É O MESMO QUE PODAR TUDO DELA. Lista vazia significa SEM
   * restrição, então escrever `[]` entregaria à cópia MAIS catálogo do que a origem tinha.
   * Quando a poda leva a lista a zero, o que se desliga é a categoria (`features.*`) —
   * exceto para `basemaps`, que não tem categoria e cujo alargamento é aceito pelo mesmo
   * motivo de `mapa.baseLayer` voltar ao padrão: um mapa sem camada de base não desenha.
   *
   * @param {Object|null} settings
   * @returns {Object|null} Cópia rasa podada, ou a entrada quando não há o que podar.
   */
  settings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;

    const saida = { ...settings };
    let features = null;

    for (const lista of LISTAS_DE_SETTINGS) {
      const original = saida[lista.chave];
      if (!Array.isArray(original) || original.length === 0) continue;
      const mantidos = original.filter((id) => {
        if (this._ve(lista.tipo, String(id))) return true;
        this._perdeu(lista.superficie);
        return false;
      });
      if (mantidos.length === original.length) continue;
      saida[lista.chave] = mantidos;
      if (mantidos.length === 0 && lista.feature) {
        features = features ?? { ...(saida.features || {}) };
        features[lista.feature] = false;
      }
    }
    if (features) saida.features = features;

    const padrao = saida.default_basemap;
    if (typeof padrao === 'string' && padrao !== '' && !this._ve('basemap', padrao)) {
      this._perdeu('settings.default_basemap');
      saida.default_basemap = null;
    }
    return saida;
  }
}

/** `cesium3d_data.data_type` -> a superfície do registro. */
const SUPERFICIE_POR_TIPO_3D = Object.freeze({
  camera_position: 'cesium3d.cameraPositions',
  marker: 'cesium3d.markers',
  measurement: 'cesium3d.measurements',
  viewshed: 'cesium3d.viewsheds',
});
