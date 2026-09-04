// Path: src/modules/config/config.service.js
// Assembles the runtime app config (frozen config.js shape) from three sources:
//  - data (tables): basemaps/analysisLayers/dataLayers/tilesets from their dedicated catalog tables
//  - env URLs: service/tile/terrain URLs from config.appConfig
//  - static UI: app/features/map2d/map3d defaults from config.static
import config from '../../config.js';
import { createAudit } from '../../utils/audit.js';
import { canDeliverAccountMail } from '../../utils/mailer.js';
import { query, tx } from '../../database/index.js';
import { catalogService } from '../catalog/index.js';
import { readThroughAppConfigCache, invalidateAppConfigCache } from './config.cache.js';
import * as Q from './config.queries.js';
import * as S from './config.static.js';

const C = config.appConfig;

/** The single config_settings row that holds the admin override document. */
const OVERRIDES_KEY = 'app_config';

/**
 * Deep-merges `override` onto `base` (override wins; plain objects merge recursively; arrays and
 * scalars replace). Pure — does not mutate its inputs.
 */
function deepMerge(base, override) {
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/** Reads the admin config override document (partial config; {} when unset). */
export async function getConfigOverrides() {
  const { rows } = await query(Q.GET_CONFIG_OVERRIDES, [OVERRIDES_KEY]);
  return rows[0]?.value ?? {};
}

/**
 * Tira a faixa de zoom da aplicação do documento de OVERRIDE, onde ela deixou de ser
 * configurável (decisão do dono, 2026-08-31): [2, 21] é fixo em `MAP2D_BASE`.
 *
 * ISTO NÃO DUPLICA O `forbidden()` DO SCHEMA, e a diferença é a linha JÁ GRAVADA. O schema
 * (`config.admin.schemas.js`) valida o CORPO da requisição, e `updateConfigOverrides` funde
 * esse corpo sobre o documento persistido: uma linha `app_config` escrita ANTES desta mudança
 * carrega `map2d.minZoom` que nenhum corpo novo menciona, sobrevive a toda fusão seguinte e
 * continua vencendo o valor fixo no deep-merge de `getAppConfig`. Um valor que o banco derruba
 * não é fixo, e a borda de entrada sozinha não alcança o que já está lá dentro.
 *
 * Por isso a poda roda nos DOIS caminhos: aqui, na escrita, para a linha velha CICATRIZAR na
 * primeira gravação seguinte, e outra vez na leitura de `getAppConfig`, para que o documento
 * servido esteja certo mesmo que ninguém nunca mais salve.
 *
 * Substituiu um `assertEffectiveInvariants` que cruzava `minZoom <= maxZoom` sobre o
 * documento efetivo. Ele ficou sem o que cruzar: as duas pontas não entram mais no override,
 * e o par fixo é válido por construção.
 *
 * @param {Object} doc - Documento de override (mutado no lugar).
 * @returns {Object} O mesmo documento.
 */
function podarZoomDeAplicacao(doc) {
  if (doc?.map2d && typeof doc.map2d === 'object') {
    delete doc.map2d.minZoom;
    delete doc.map2d.maxZoom;
  }
  return doc;
}

/**
 * Merges a partial override into the stored override document (so a partial save never wipes
 * untouched sections) and persists it. Returns the merged document.
 *
 * ATOMIC BY CONSTRUCTION. The read, the merge and the write are one transaction that opens by
 * LOCKING the single `app_config` row (`Q.LOCK_CONFIG_OVERRIDES`), because a partial save is a
 * read-modify-write and three loose awaits are exactly the lost-update shape: two admins editing
 * DIFFERENT sections in the same window both read the same base, both merge their own section
 * onto it, and the second write replaces the first. Nothing errors and nothing logs — both see
 * 200 with the echo of their own merge, and one section quietly reverts. The loser now blocks on
 * the row lock and re-reads the committed document, so its merge lands on top of the winner's.
 *
 * `invalidateAppConfigCache()` runs AFTER the commit, on purpose. Inside the transaction the new
 * value is not yet visible to other connections, so a concurrent `GET /api/config` landing in
 * that window would rebuild the memo from the OLD row and re-cache it — reopening, as a stale
 * cache entry, precisely the window the lock just closed.
 *
 * A TRILHA ENTRA DENTRO DA TRANSAÇÃO, com o `t`, e é a mesma lição do lock acima: o
 * payload pode ser recusado por `assertEffectiveInvariants` DEPOIS do UPSERT, e uma
 * auditoria emitida fora registraria uma alteração que o rollback desfez.
 *
 * `details` carrega SÓ AS CHAVES DE TOPO do que foi enviado, nunca os valores: o
 * documento de override guarda URL de serviço (tiles, terreno, imagery 3D) e a
 * trilha é lida por qualquer administrador. Quem precisa do valor efetivo lê
 * `GET /config/admin`, que é a fonte, em vez de uma cópia envelhecida no log.
 *
 * `targetId` é a chave `app_config` — um dos dois sítios que só existem porque
 * `audit_trail.target_id` é TEXT e não UUID (a chave nunca foi UUID).
 *
 * @param {Object} partial - Validated partial config.
 * @param {string|null} userId
 * @param {object} [req] - Express req, para ip/user-agent da trilha.
 */
export async function updateConfigOverrides(partial, userId, req = null) {
  const merged = await tx(async (t) => {
    const current = (await t.one(Q.LOCK_CONFIG_OVERRIDES, [OVERRIDES_KEY])).value ?? {};
    const next = podarZoomDeAplicacao(deepMerge(current, partial));
    const value = (await t.one(Q.UPSERT_CONFIG_OVERRIDES, [
      OVERRIDES_KEY,
      JSON.stringify(next),
      userId ?? null,
    ])).value;
    if (userId) {
      await createAudit(req, {
        action: 'CONFIG_UPDATE',
        actorId: userId,
        targetType: 'CONFIG',
        targetId: OVERRIDES_KEY,
        details: { sections: Object.keys(partial || {}) },
      }, t);
    }
    return value;
  });
  invalidateAppConfigCache();
  return merged;
}

/**
 * Clears ALL config overrides (the revert valve — config reverts to STATIC/ENV on next boot).
 *
 * AÇÃO PRÓPRIA (`CONFIG_CLEAR`) e não um `CONFIG_UPDATE` com corpo vazio: uma edita
 * seções, a outra apaga o documento inteiro de uma vez, e conflatá-las tiraria da
 * trilha a distinção que é o propósito da coluna `action`.
 *
 * Não é transacional porque a escrita é uma query só; a trilha vem DEPOIS do DELETE
 * pelo mesmo motivo, e por isso ela pode registrar as seções que sumiram.
 *
 * @param {string|null} [userId]
 * @param {object} [req]
 */
export async function clearConfigOverrides(userId = null, req = null) {
  const { rows } = await query(Q.CLEAR_CONFIG_OVERRIDES, [OVERRIDES_KEY]);
  invalidateAppConfigCache();
  if (userId) {
    await createAudit(req, {
      action: 'CONFIG_CLEAR',
      actorId: userId,
      targetType: 'CONFIG',
      targetId: OVERRIDES_KEY,
      // `cleared: false` é o registro honesto de uma reversão que não tinha o que
      // reverter: a ação foi pedida e não mudou nada, e isso é diferente de não ter
      // acontecido.
      details: { cleared: rows.length > 0, sections: Object.keys(rows[0]?.value ?? {}) },
    });
  }
  return {};
}

// basemaps is an OBJECT keyed by id (frontend indexes by id), not an array. The MapLibre `style`
// (if an admin set one) is emitted SEPARATELY as basemapStyles — stripped from the metadata here.
export async function listBasemaps() {
  const rows = await catalogService.listCatalog('basemaps');
  return Object.fromEntries(rows.map((r) => {
    const meta = { ...(r.config || {}) };
    delete meta.style;
    return [r.id, { name: r.name, ...meta }];
  }));
}

/**
 * Builds the MapLibre `basemapStyles` map. The STATIC builders (ENV-injected tile/glyph URLs) are
 * the default; a basemap resource's `config.style` OVERRIDES it (admin-edited via the catalog). This
 * keeps the ENV-injection default intact while allowing a per-basemap style override.
 */
export async function listBasemapStyles() {
  const rows = await catalogService.listCatalog('basemaps');
  const out = { ...S.buildBasemapStyles(C) };
  for (const r of rows) {
    if (r.config?.style) out[r.id] = r.config.style;
  }
  return out;
}

export async function listAnalysisLayers() {
  const rows = await catalogService.listCatalog('analysis_layers');
  // The frozen frontend contract requires every analysis layer to carry a valid
  // `bounds` [west, south, east, north] (the frontend zooms-to-layer with it). A
  // seeded layer with an incomplete config (e.g. the placeholder `hillshade` with
  // `{}`) is non-functional and previously broke app boot — never serve an analysis
  // layer that lacks valid bounds, so /api/config can't emit contract-breaking data.
  return rows
    .map((r) => ({ id: r.id, name: r.name, ...r.config }))
    .filter((layer) => Array.isArray(layer.bounds) && layer.bounds.length === 4);
}

export async function listDataLayers() {
  const rows = await catalogService.listCatalog('data_layers');
  return rows.map((r) => ({ id: r.id, name: r.name, ...r.config }));
}

export async function listTilesets() {
  const rows = await catalogService.listCatalog('tilesets');
  return rows.map((r) => ({ id: r.id, name: r.name, ...r.config }));
}

// Personnel domains served to the PUBLIC config so the anonymous signup form can populate its
// dropdowns before login. Postos come from the `ranks` table, OMs from the `organizations` table;
// the option VALUE is the row id (users store rank_id / organization_id FKs).
export async function listPostos() {
  const { rows } = await query(
    'SELECT id, nome, nome_abrev, sort_order FROM ranks WHERE is_active = true ORDER BY sort_order, nome',
  );
  return rows.map((r) => ({ id: r.id, name: r.nome, abrev: r.nome_abrev ?? null, sort_order: r.sort_order }));
}

export async function listOrganizacoesMilitares() {
  const { rows } = await query(
    'SELECT id, nome, sigla FROM organizations WHERE is_active = true ORDER BY nome',
  );
  return rows.map((r) => ({ id: r.id, name: r.nome, sigla: r.sigla ?? null }));
}

/**
 * Builds the full config payload served by GET /api/v1/config.
 *
 * EIGHT queries, and the payload does NOT vary by caller: nothing here reads `req`, a user or
 * an atlas. The per-atlas restriction an admin can set (`atlas.settings`) is applied CLIENT
 * side (`frontend/src/js/store/sync/atlas-settings.service.js` intersects it onto the config
 * singleton after boot), so the server has exactly one document to serve and it is safe to
 * share it between callers — see `getAppConfig` below for the memo.
 * @returns {Promise<Object>}
 */
async function buildAppConfig() {
  const [basemaps, basemapStyles, analysisLayers, dataLayers, tilesets, postos, organizacoesMilitares, overrides] = await Promise.all([
    listBasemaps(),
    listBasemapStyles(),
    listAnalysisLayers(),
    listDataLayers(),
    listTilesets(),
    listPostos(),
    listOrganizacoesMilitares(),
    getConfigOverrides(),
  ]);

  const payload = {
    app: {
      ...S.APP,
      // THE SECONDARY-SERVER NOTICE. `S.APP` holds the UI defaults that never change per
      // deployment; these two are the opposite kind of fact, so they come from env
      // (`config.appConfig`) and are spread in here, exactly as `features` does with
      // `self_registration`. The client opens the notice screen at boot when the boolean is
      // `true` and offers `urlServidorPrincipal` as the way out; on the `main` line the same
      // pair is a literal in the client's versioned config.js, which this branch does not have.
      avisoServidorSecundario: C.avisoServidorSecundario,
      urlServidorPrincipal: C.urlServidorPrincipal,
    },
    // self_registration tells the client whether to show the "Criar conta" affordance. It
    // starts at the ALLOW_SELF_REGISTRATION env default and the admin override (deep-merged
    // below) flips it at runtime. The /auth/register route reads the SAME merged value via
    // `requireSelfRegistrationEnabled`, so the button and the gate never disagree.
    //
    // password_reset_email answers the same kind of question for the recovery panel of the login
    // screen, and it is READ FROM THE SAME PREDICATE that mounts the routes
    // (`canDeliverAccountMail`, src/utils/mailer.js), never from a second copy of the condition:
    // a screen that offers "enviamos um código" against a 404, or hides a working recovery, is
    // exactly what two copies of one fact produce once they drift.
    features: {
      ...S.FEATURES,
      self_registration: config.security.allowSelfRegistration,
      password_reset_email: canDeliverAccountMail(),
    },
    services: { tileServerUrl: C.tileServerUrl },
    // A chave `search` faz parte do SHAPE CONGELADO e permanece — mas VAZIA: não
    // carrega mais `apiUrl`. O gazetteer É este backend (GET /nomes/busca) e o
    // cliente resolve a rota a partir da própria base da API. Havia um
    // SEARCH_API_URL cujo default apontava para um :3001 que nunca existiu: o
    // fetch dava connection-refused e a busca silenciosamente nunca retornava
    // nada. Ligar/desligar continua sendo `features.apisearch`.
    search: {},
    // Fase 4 (Tarefa 6): base URL the frontend resolves relative 3D asset `url`s
    // against (tileset.json/.glb/.terrain). Env-configurable so deployments can
    // point at an internal host; the catalog stores only relative paths.
    assets3dBaseUrl: config.assets3d.baseUrl,
    basemaps,
    analysisLayers: { enabled: true, layers: analysisLayers },
    dataLayers: { enabled: true, layers: dataLayers },
    map2d: {
      ...S.MAP2D_BASE,
      terrainSource: S.rasterDemSource(C.terrainUrl, C.terrainMinzoom, C.terrainMaxzoom),
      hillshadeSource: S.rasterDemSource(C.hillshadeUrl, C.hillshadeMinzoom, C.hillshadeMaxzoom),
    },
    map3d: {
      bounds: S.MAP3D_BOUNDS,
      viewer: S.MAP3D_VIEWER,
      providers: {
        imagery: {
          enabled: true,
          type: 'UrlTemplate',
          url: C.map3dImageryUrl,
          options: { maximumLevel: 18, minimumLevel: 0, tileWidth: 256, tileHeight: 256 },
        },
        terrain: {
          // Só habilita quando há URL configurada — sem terreno o Cesium usa o
          // elipsoide plano, em vez de tentar (e falhar) um provider inexistente.
          enabled: Boolean(C.map3dTerrainUrl),
          type: 'Cesium',
          url: C.map3dTerrainUrl,
          options: { requestVertexNormals: true },
        },
      },
    },
    tilesets,
    // Admin-managed personnel domains (controlled lists) for the signup/account forms.
    postos,
    organizacoesMilitares,
    // Fase 9 (Tarefa 7): the 360 overlay is a server-rendered VECTOR source (PostGIS
    // ST_AsMVT) served by THIS backend at {serviceUrl}/tiles/{z}/{x}/{y}.pbf. One
    // tile carries two layers: 'fotos' (points) and 'fotos_linha' (per-project
    // trajectory lines). {z}/{x}/{y} are MapLibre placeholders (literals). GeoJSON-
    // as-source and PMTiles are discontinued. Both sources point at the SAME tile
    // template; the frontend selects the layer via pointsSourceLayer/linesSourceLayer.
    streetView360: {
      serviceUrl: C.sv360ServiceUrl,
      // O MAPA BASE DO MINI-MAPA do visualizador 360, escolhido pelo administrador (decisão
      // do dono, 2026-08-31). Antes o mini-mapa carregava um estilo OSM ESCRITO À MÃO no
      // cliente (`street-view-mini-map-style.js`), com URL de tile e de glifo próprias: um
      // deploy sem saída para a internet tinha o mapa principal servido pelo tile server
      // interno e o mini-mapa em branco, sem erro nenhum, porque o estilo dele não passava
      // pelo catálogo.
      //
      // A ESCOLHA É SÓ O MAPA BASE, e não uma segunda faixa de zoom: a faixa vem da linha de
      // catálogo do mapa base escolhido, como em qualquer outro mapa do produto.
      //
      // O PADRÃO É `osm` porque é o que o mini-mapa desenhava. A chave guarda um id, e não um
      // estilo: um id que não resolve cai no fallback do cliente, do mesmo jeito que um mapa
      // base removido do catálogo cai no seletor principal.
      miniMapBasemap: S.STREETVIEW360_BASE.miniMapBasemap,
      pointsSource: { type: 'vector', tiles: [`${C.sv360ServiceUrl}/tiles/{z}/{x}/{y}.pbf`] },
      pointsSourceLayer: 'fotos',
      linesSource: { type: 'vector', tiles: [`${C.sv360ServiceUrl}/tiles/{z}/{x}/{y}.pbf`] },
      linesSourceLayer: 'fotos_linha',
    },
    basemapStyles,
  };

  // Admin overrides (app/features/map2d/map3d/service URLs) win over the STATIC/ENV assembly.
  // MENOS a faixa de zoom da aplicação, que não é configurável: a poda roda DEPOIS da fusão
  // para que um documento gravado antes de 2026-08-31 não derrube o valor fixo, e os dois
  // valores voltam de `MAP2D_BASE` logo em seguida. Ver `podarZoomDeAplicacao`.
  const merged = deepMerge(payload, overrides);
  podarZoomDeAplicacao(merged);
  merged.map2d.minZoom = S.MAP2D_BASE.minZoom;
  merged.map2d.maxZoom = S.MAP2D_BASE.maxZoom;

  // Trailing-slash normalization runs AFTER the merge, not before: `optionalBase`
  // in `src/config.js` already cleans the env var, but the admin "Avancado (JSON)"
  // override accepts `streetView360` as a free-form object, so an operator typing
  // `/api/v1/sv360/` there would win over the clean value and every client URL
  // would carry `//`. The client concatenates `${serviceUrl}${path}` with paths
  // that already lead with `/`.
  if (typeof merged.streetView360?.serviceUrl === 'string') {
    merged.streetView360.serviceUrl = merged.streetView360.serviceUrl.replace(/\/+$/, '');
  }
  if (typeof merged.assets3dBaseUrl === 'string') {
    merged.assets3dBaseUrl = merged.assets3dBaseUrl.replace(/\/+$/, '');
  }
  return merged;
}

/**
 * The full config payload served by GET /api/v1/config — memoized in process.
 *
 * The memo is dropped by `invalidateAppConfigCache()` on every write that can change any of
 * the eight reads above (catalog CRUD on the four tables, ranks, organizations, and the two
 * override writers in this file), which is what keeps the route's `Cache-Control: no-cache`
 * promise honest: an admin edit is visible on the very next request, not after a TTL.
 *
 * The returned object is SHARED and shallow-frozen. Callers must not mutate it.
 * @returns {Promise<Object>}
 */
export function getAppConfig() {
  return readThroughAppConfigCache(buildAppConfig);
}
