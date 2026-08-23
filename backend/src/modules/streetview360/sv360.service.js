// Path: src/modules/streetview360/sv360.service.js
// Read-only business logic for the StreetView 360 module (Fase 9, stage 1).
// Metadata lives in Postgres (schema `sv360`); only the WebP BLOBs live in the
// per-project {slug}.db SQLite. This layer:
//   - enforces the read-access policy (enabled = public; disabled = owner/admin
//     only, returning 404 to avoid leaking existence on a hidden project);
//   - maps the DB columns to the FROZEN photoMetadataShape (flat camera fields;
//     targets expose `bearing`/`distance`, mapped from internal bearing_deg/
//     distance_m, with a constant `icon: 'next'`);
//   - builds the O(1) image descriptor (ETag from Postgres *_size_bytes, no BLOB
//     read) consumed by the controller for 304/Range serving.
// All writes/calibration/admin/ingestion are stage 2.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { query } from '../../database/index.js';
import * as Q from './sv360.queries.js';
import * as PQ from './sv360.pyramid.queries.js';
import * as TQ from './sv360.tiles.queries.js';
import * as blobstore from './sv360.blobstore.js';
import { escadaGravada } from './sv360.escada.js';
import { TILES_GEOJSON_MAX_FEATURES } from './sv360.schemas.js';
import config from '../../config.js';
import { NotFoundError } from '../../utils/errors.js';
import { principalUserId, atlasScopeId } from '../../utils/principal.js';

const DEFAULT_NEARBY_RADIUS_M = 500;
const NEARBY_LIMIT = 100;

/**
 * Read-access predicate for a project. `enabled` projects are PUBLIC (anon-
 * visible). A `disabled` project is visible only to a global admin or to the
 * PRODUCING organization (`users.producer_org_id`).
 * @param {Object} project - row with { status, organization_id }
 * @param {Object} [user]  - req.user ({ role, producer_org_id }) or undefined
 * @returns {boolean}
 */
/**
 * O escopo de LEITURA do 360, na ordem que `sv360AccessPredicate` espera.
 *
 * `principalUserId` e nao `user.id`: o visitante de link publico carrega
 * `public-<uuid>`, que num cast `::uuid` levanta 22P02 e volta como HTTP 400 sem
 * relacao aparente com a causa. NULL ali e o valor CORRETO para ele — o ramo de
 * concessao pessoal morre e sobra o de emprestimo, que depende do atlas.
 *
 * A OM SAIU DAQUI. Ela era o segundo termo do predicado e autorizava por LOTAÇÃO
 * auto-declarada; o eixo continua existindo, resolvido no SQL pelo escopo de
 * PRODUÇÃO a partir do mesmo `userId`. Uma tupla a menos é uma renumeração a menos.
 *
 * @param {Object} [user] - req.user
 * @param {string} [atlasId] - `req.query.atlasId`, cru.
 * @returns {[string|null, string|null]} [userId, atlasId]
 */
function readScope(user, atlasId) {
  return [principalUserId(user), atlasScopeId(atlasId)];
}

/**
 * A OM PREFERIDA do chamador, para DESEMPATE de slug/nome colidente entre OMs.
 *
 * NÃO É AUTORIZAÇÃO, e está separada de `readScope` para que continue óbvio que não
 * é: ela só entra em `ORDER BY`. Produção primeiro (é a OM em que o chamador
 * trabalha de fato), lotação depois (que preserva o desempate que todo usuário comum
 * já tinha). Nula para o anônimo, que simplesmente perde a preferência.
 * @param {Object} [user] - req.user
 * @returns {string|null}
 */
function preferredOrgId(user) {
  return user?.producer_org_id ?? user?.organization_id ?? null;
}

export function isProjectReadable(project, user) {
  // OS DOIS EIXOS SAO ORTOGONAIS, e esta funcao cobre UM deles.
  //
  //   `status`        — `disabled` oculta de todo mundo fora da OM PRODUTORA,
  //                     inclusive de quem tem concessao e inclusive do credenciado.
  //                     E o eixo de OCULTACAO, e e este que a funcao decide.
  //   `access_level`  — `private` restringe quem esta de FORA, nunca a OM produtora
  //                     (D6). E o eixo de PRIVACIDADE, e ele NAO e decidido aqui.
  //
  // POR QUE O SEGUNDO EIXO NAO MORA AQUI, e isto e limite declarado e nao
  // esquecimento: decidi-lo exige saber de CONCESSAO e de EMPRESTIMO, que sao
  // duas tabelas e um atlas em foco. Fazer isso no JS custaria uma consulta por
  // chamada nos caminhos mais quentes do modulo (foto, thumbnail, tile) e, pior,
  // criaria uma SEGUNDA definicao da regra — exatamente a divida que
  // `sv360AccessPredicate` acabou de pagar. A garantia de privacidade e do SQL,
  // que e onde o cabecalho de sv360.tiles.queries.js sempre disse que ela mora
  // ("embedded in the SQL, defense in depth").
  //
  // "NENHUMA LINHA CHEGA AQUI SEM TER PASSADO POR ELE" e uma afirmacao que este
  // comentario ja fez enquanto era FALSA, e o custo dela foi o buraco mais fundo do
  // modulo: as QUATRO consultas de foto (GET_PHOTO_BY_ID, GET_PHOTO_BY_NAME,
  // GET_PHOTO_SIZES, NEARBY_PHOTOS) nao carregavam predicado nenhum ate a fase F9,
  // entao um projeto `enabled + private` entregava metadado, imagem e vizinhanca a
  // quem soubesse o uuid — e por coordenada, no `/photos/nearest`. Hoje as quatro
  // carregam, e quem cobra a propriedade e o censo de superficies
  // (`tests/unit/superficies-de-recurso-censo.test.js`), que exige de cada consulta
  // uma classe: uma quinta consulta de foto sem predicado reprova por nome, em vez
  // de ser coberta por esta frase.
  //
  // Consequencia pratica: um projeto `enabled + private` e considerado legivel
  // aqui. Quem o entregou foi o SQL, que so o entrega a quem pode ve-lo.
  //
  // A OM COMPARADA E A DE PRODUCAO, nunca mais a de lotacao: `organization_id` do
  // usuario e auto-declarado no auto-cadastro, entao compara-lo aqui era escolher a
  // OM na tela de cadastro e receber o acervo oculto dela. `producer_org_id` chega
  // pelo token e e RECONCILIADO contra o banco no `auth` estrito; nos caminhos de
  // leitura, que correm sob `flexibleAuth` (que nao reconcilia), quem garante e o
  // SQL — nenhuma linha chega aqui sem ter passado pelo predicado.
  if (project.status === 'enabled') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(user.producer_org_id) && user.producer_org_id === project.organization_id;
}

/**
 * Throws NotFoundError (NOT Forbidden) when a project is not readable, so a
 * hidden project is indistinguishable from a nonexistent one.
 * @param {Object} project
 * @param {Object} [user]
 * @param {string} [resource='Project']
 */
function enforceProjectReadable(project, user, resource = 'Project') {
  if (!isProjectReadable(project, user)) throw new NotFoundError(resource);
}

/**
 * Lists visible projects for the caller. `enabled` is always public; the SQL
 * already filters disabled projects to admin / owning-org.
 * @param {Object} [user]
 * @returns {Promise<Array>} projects in the frozen public shape
 */
export async function listProjects(user, atlasId = null) {
  const { rows } = await query(Q.LIST_PROJECTS, readScope(user, atlasId));
  return rows.map((r) => publicProjectView(r, user));
}

/**
 * Gets a single project by slug, enforcing the read policy.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Object>} project row
 * @throws {NotFoundError} if missing or hidden from the caller
 */
export async function getProject(slug, user, atlasId = null) {
  const { rows } = await query(Q.GET_PROJECT_BY_SLUG, [slug, ...readScope(user, atlasId), preferredOrgId(user)]);
  const project = rows[0];
  if (!project) throw new NotFoundError('Project');
  enforceProjectReadable(project, user); // belt-and-suspenders (SQL already filtered)
  return publicProjectView(project, user);
}

/**
 * Converts a stored `project_floors.plan_coords` (JSONB: an array of LineStrings,
 * `[[[lon,lat],...],...]`) into the GeoJSON FeatureCollection the client draws,
 * or null when the level has no plan.
 *
 * WHY A FEATURECOLLECTION AND NOT THE RAW ARRAY: the plan is drawn as a MapLibre
 * GeoJSON source, and every feature carries `properties.level` so a single source
 * holding several floors can be filtered by the selector without re-fetching. The
 * storage shape stays the compact array because that is what the
 * origin exports; the API shape is the one the map consumes.
 *
 * A level that EXISTS but has no plan drawn (the Beira-Rio's level 0, outdoors)
 * yields null, never an empty FeatureCollection: null says "there is nothing to
 * draw here", while an empty collection reads as "the plan failed to load".
 * @param {*} planCoords - the JSONB value (array of LineStrings) or null
 * @param {number} level - the floor level, stamped on every feature
 * @returns {Object|null} GeoJSON FeatureCollection of LineString, or null
 */
function floorPlanToGeoJson(planCoords, level) {
  if (!Array.isArray(planCoords)) return null;
  const features = planCoords
    .filter((line) => Array.isArray(line) && line.length >= 2)
    .map((line) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line },
      properties: { level },
    }));
  if (features.length === 0) return null;
  return { type: 'FeatureCollection', features };
}

/**
 * Resolves a project by slug for a READ, applying the module's single access
 * rule, and returns the row.
 *
 * Extracted because every stage-2b calibration read starts the same way and the
 * pattern is load-bearing: the SQL already filters, and enforceProjectReadable
 * re-checks, so a hidden project answers 404 exactly like `getProject` does. A
 * second, looser way in is how a hidden project leaks.
 * O `atlasId` É OBRIGATÓRIO DE REPASSAR, ainda que o parâmetro seja opcional: ele
 * carrega o braço de EMPRÉSTIMO do predicado, e um chamador que o esquece devolve 404
 * para um panorama que o atlas em foco legitimamente empresta. Foi assim que as quatro
 * leituras derivadas (`floors`, `photos`, `map`, `runs`) ficariam para trás enquanto as
 * irmãs diretas aprendiam o eixo.
 * @param {string} slug
 * @param {Object} [user]
 * @param {string|null} [atlasId] - atlas em foco, JÁ confirmado pelo gate de rota
 * @returns {Promise<Object>} the sv360.projects row (NOT the public view)
 * @throws {NotFoundError} if missing or hidden from the caller
 */
async function resolveReadableProject(slug, user, atlasId = null) {
  const { rows } = await query(Q.GET_PROJECT_BY_SLUG, [slug, ...readScope(user, atlasId), preferredOrgId(user)]);
  const project = rows[0];
  if (!project) throw new NotFoundError('Project');
  enforceProjectReadable(project, user); // belt-and-suspenders (SQL already filtered)
  return project;
}

/**
 * Lists the floors of a project, in ascending `level` order.
 *
 * Access is the SAME rule as every other project read: the project is resolved by
 * GET_PROJECT_BY_SLUG (filter embedded in the SQL) and then re-checked by
 * enforceProjectReadable, so a hidden project answers 404 exactly like
 * `getProject` does, with no separate, looser path to the same data.
 *
 * A project with NO floors answers `[]`, never 404: "this project has no floor
 * selector" is a legitimate, successful answer for the 27 flat projects of the
 * corpus, and 404 would make the client unable to tell an unknown slug from a
 * street-level survey.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Array<{level:number, label:string, photoCount:number, plan:Object|null}>>}
 * @throws {NotFoundError} if the project is missing or hidden from the caller
 */
export async function listProjectFloors(slug, user, atlasId = null) {
  const project = await resolveReadableProject(slug, user, atlasId);

  const { rows } = await query(Q.LIST_PROJECT_FLOORS, [project.id]);
  return rows.map((r) => ({
    level: r.level,
    label: r.label,
    photoCount: r.photo_count,
    plan: floorPlanToGeoJson(r.plan_coords, r.level),
  }));
}

/**
 * Path segment of the static thumbnails, RELATIVE to the API base — the client
 * concatenates it with `streetView360.serviceUrl` (which already ends in the
 * module mount), so it must NOT carry the `/api/v1` prefix. Same rule as the
 * photo metadata's `previewThumbnail`.
 */
const THUMBNAILS_SEGMENT = '/thumbnails';

/**
 * Absolute FS path of a project's thumbnail, derived from its STORED
 * `db_filename` — the single definition of the rule, shared by the reader
 * (`resolveThumbnailPath`, which serves the bytes) and by the metadata views
 * (which only need to know whether the file is there).
 *
 * The thumbnail is ORG-KEYED ({orgId}__{slug}.webp, parallel to the {orgId}__{slug}.db
 * store), so two orgs sharing a slug never collide on disk nor leak across tenants.
 * The URL is slug-only; the FILE is not, and that asymmetry is exactly why this
 * derivation must not be re-typed at each call site.
 *
 * `path.basename` strips any directory component before the value reaches the
 * filesystem (defense in depth: the name is server-derived at ingestion, never
 * user input, but a second writer of that column would inherit the guard).
 * @param {string} [dbFilename] - sv360.projects.db_filename
 * @returns {string|null} absolute path, or null when the row carries no filename
 */
function thumbnailFilePath(dbFilename) {
  if (!dbFilename) return null;
  const thumbFile = String(dbFilename).replace(/\.db$/i, '.webp');
  return path.resolve(config.sv360.dbDir, path.basename(thumbFile));
}

/**
 * The `previewThumbnail` of a project ALREADY PAST THE READ GATE, or null when
 * the file is absent.
 *
 * WHY THE EXISTENCE CHECK AND NOT A CONSTANT STRING: the writer treats the
 * thumbnail as OPTIONAL (`sv360.admin.service.js` only copies it
 * `if (thumbnailPath && existsSync(thumbnailPath))`, and swallows a failure on
 * purpose), so a project with no thumbnail is a NORMAL case — not an error. An
 * unconditional URL promised an image that answered 404 for every one of them,
 * and the three consumers all have a placeholder branch that could never be
 * reached because the key was never falsy.
 *
 * WHY IT MUST STAY AFTER THE GATE, and this is the whole point: the four layers of
 * `resolveThumbnailPath` (basename, SQL predicate, isProjectReadable, existsSync)
 * collapse into the SAME 404, so "no such project", "private and out of your reach"
 * and "readable but has no file" are indistinguishable to the client. That is a
 * SECURITY PROPERTY. This function is only ever called on a row the SQL predicate
 * already handed the caller, so whoever may see the project learns whether it has a
 * thumbnail, and whoever may not keeps seeing exactly the same nothing. Never
 * compute it for a row the caller has not been cleared for — a `hasThumbnail`
 * column on an unfiltered listing would be a side channel revealing the existence
 * of a private project.
 *
 * CUSTO MEDIDO (2026-08-21, Windows/NTFS, node 24, cache quente): 18 us por
 * `existsSync`, 0,52 ms para os 29 projetos do corpus — abaixo do custo da própria
 * consulta ao Postgres. A curva é linear e sai de graça só nessa ordem de grandeza:
 * 1,9 ms a 100 projetos e 12,2 ms a 500. Se a listagem chegar às centenas, a saída
 * medida é um `readdirSync` do dbDir por requisição (27 us a 29 arquivos, 138 us a
 * 500), que troca o custo POR LINHA por um custo POR DIRETÓRIO. Não vale a
 * complicação hoje, e o número está aqui para que a decisão de trocar seja medida
 * e não intuída.
 * @param {Object} project - row já liberado pelo gate de leitura, com `db_filename` e `slug`
 * @returns {string|null} caminho RELATIVO (sem /api/v1), ou null quando não há arquivo
 */
function previewThumbnailUrl(project) {
  const filePath = thumbnailFilePath(project.db_filename);
  if (!filePath || !existsSync(filePath)) return null;
  return `${THUMBNAILS_SEGMENT}/${project.slug}.webp`;
}

/**
 * Maps a `sv360.projects` row to the FROZEN public project shape.
 *
 * This shape is NOT this module's invention: it is the contract of the legacy
 * service the frontend was written against (`ebgeo_360/src/routes/projects.js`
 * `formatProject`) — camelCase, with the coordinates NESTED under `center`. The
 * row's own column names are snake_case and flat, and returning the row verbatim
 * broke all three consumers at once, silently and only once real data existed:
 * `streetview_markers.js` (TypeError on `p.center.lon`, so the 2D 360 layer never
 * renders), `search-bar.search-providers.js` (360 results lose coordinates) and
 * `atlas-settings.modal.js` (no 360 thumbnails in the catalog). The seed/test
 * fixtures never caught it because no test pinned anything beyond `slug`/`name`.
 *
 * Reshaping (rather than deleting fields from the row) also subsumes the older
 * leak fix: the route is `flexibleAuth`, and the raw row handed anonymous callers
 * `db_filename` + `organization_id` — which together spell out `${orgId}__{slug}.db`,
 * i.e. the owning org's internal UUID and the exact path under SV360_DB_DIR. An
 * allowlist cannot leak a column it does not name.
 *
 * Admin extras are ADDITIVE on top of the same shape, never a different shape: an
 * admin is also an ordinary user of the 2D map, and returning the raw row to them
 * meant the 360 layer broke for admins ONLY — the worst kind of role-dependent bug.
 *
 * `captureDate` IS a real column now: `sv360.projects.capture_date` (TEXT),
 * carrying the legacy campaign date the ETL used to drop. It
 * reaches this view only when the query SELECTS it, and it is read here by its
 * real name, never synthesized. A row from a query that did not select the
 * column yields undefined, which `?? null` normalizes to the same null the
 * frozen shape has always promised, so no consumer sees a missing key.
 *
 * `description` / `location` still have no column in `sv360.projects` (the
 * legacy SQLite carried them, this schema never adopted them); they remain
 * emitted as null. That is a KNOWN GAP, not a shape decision: only the date was
 * authorized for this pass.
 * @param {Object} project - a sv360.projects row
 * @param {Object} [user]
 * @returns {Object} the public project view
 */
function publicProjectView(project, user) {
  const view = {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description ?? null, // no column: always null
    // Real column, SELECTed by both LIST_PROJECTS and
    // GET_PROJECT_BY_SLUG. A query that omits it yields undefined, which `?? null`
    // normalizes to the null the frozen shape has always promised.
    captureDate: project.capture_date ?? null,
    location: project.location ?? null, // no column: always null
    center: { lat: project.center_lat, lon: project.center_long },
    entryPhotoId: project.entry_photo_id ?? null,
    // NULL QUANDO NÃO HÁ ARQUIVO, e a chave nunca some: os três consumidores
    // (`catalog.service.js`, `atlas-settings.modal.js`, `streetview_markers.js`)
    // testam a VERDADE do campo antes de montar a URL, então null cai no
    // placeholder que cada um já tem. A chave presente segue a mesma regra de
    // `description`/`location`/`captureDate` acima: a forma congelada não perde
    // chave, ela perde VALOR. A checagem de disco roda AQUI, depois de a linha já
    // ter passado pelo predicado do SQL — ver `previewThumbnailUrl`.
    previewThumbnail: previewThumbnailUrl(project),
    // ACRÉSCIMO ADITIVO (2026-08-21), em camelCase como todo o resto desta forma: a
    // coluna é `preview_video` e ela NÃO pode vazar com esse nome, porque
    // `sv360-contract.test.js` afirma a ausência de snake_case no payload. `?? null`
    // normaliza a consulta que não selecionou a coluna para o mesmo null de "sem vídeo",
    // então nenhum consumidor vê a chave sumir. As duas linhas convivem porque são
    // acréscimos INDEPENDENTES de duas linhas de trabalho: a miniatura ganhou prova de
    // existência, o vídeo ganhou coluna.
    previewVideo: project.preview_video ?? null,
    photoCount: project.photo_count,
    status: project.status,
  };
  if (user?.role === 'admin') {
    // The admin surface manages the on-disk stores by name. `db_filename` now
    // travels in LIST_PROJECTS too (the thumbnail probe derives the ORG-KEYED
    // name from it), so the admin listing carries it; `organization_id` is still
    // only selected by the single-project queries. Undefined when the query did
    // not select the column, and JSON drops undefined.
    view.db_filename = project.db_filename;
    view.organization_id = project.organization_id;
  }
  return view;
}

/**
 * Gets a photo by id and returns the FROZEN photoMetadataShape (camera + targets).
 *
 * `includeHidden` adds the links an operator has hidden, each carrying `hidden:
 * true|false`. It is OPT-IN and defaults to off, so the viewer keeps receiving
 * exactly the array it always did. The calibration workspace needs it because
 * hiding a link is REVERSIBLE and an operator cannot un-hide what the API refuses
 * to show: without this flag a mistaken hide is permanent through the API.
 * @param {string} uuid - photo id (TEXT uuid v5)
 * @param {Object} [user]
 * @param {Object} [opts]
 * @param {boolean} [opts.includeHidden=false] - also return hidden links
 * @param {string|null} [opts.atlasId] - atlas em foco, JÁ confirmado pelo gate de rota
 * @returns {Promise<Object>} frozen photo metadata
 * @throws {NotFoundError} if missing/tombstoned, privado fora do alcance, ou oculto
 */
export async function getPhoto(uuid, user, { includeHidden = false, atlasId = null } = {}) {
  const { rows } = await query(Q.GET_PHOTO_BY_ID, [uuid, ...readScope(user, atlasId)]);
  const photo = rows[0];
  if (!photo) throw new NotFoundError('Photo');
  enforceProjectReadable(photoProject(photo), user, 'Photo');

  const { rows: targets } = await query(
    includeHidden ? Q.GET_ALL_TARGETS_FOR_PHOTO : Q.GET_TARGETS_FOR_PHOTO,
    [photo.id]
  );
  return buildPhotoMetadata(photo, targets, { includeHidden });
}

/**
 * Gets a photo by its original filename and returns the FROZEN photoMetadataShape.
 * A name may collide across projects; an enabled project wins the tie (in SQL).
 * @param {string} nome - original_name
 * @param {Object} [user]
 * @param {string|null} [atlasId] - atlas em foco, JÁ confirmado pelo gate de rota
 * @returns {Promise<Object>} frozen photo metadata
 * @throws {NotFoundError} if missing/tombstoned, privado fora do alcance, ou oculto
 */
export async function photoByName(nome, user, atlasId = null) {
  const { rows } = await query(
    Q.GET_PHOTO_BY_NAME,
    [nome, preferredOrgId(user), ...readScope(user, atlasId)]
  );
  const photo = rows[0];
  if (!photo) throw new NotFoundError('Photo');
  enforceProjectReadable(photoProject(photo), user, 'Photo');

  const { rows: targets } = await query(Q.GET_TARGETS_FOR_PHOTO, [photo.id]);
  return buildPhotoMetadata(photo, targets);
}

/**
 * Builds the O(1) image descriptor for the controller: ETag from Postgres
 * *_size_bytes (NO BLOB read), plus the resolved {slug}.db path. The 304/Range/
 * semaphore handling and the actual BLOB fetch live in the controller.
 * @param {string} uuid - photo id (TEXT uuid v5)
 * @param {'full'|'preview'} quality
 * @param {Object} [user]
 * @param {string|null} [atlasId] - atlas em foco, JÁ confirmado pelo gate de rota
 * @returns {Promise<{dbFile:string, sizeBytes:number, etag:string, photoId:string, contentType:string}>}
 * @throws {NotFoundError} if missing/tombstoned, privado fora do alcance, ou oculto
 */
export async function getPhotoImageMeta(uuid, quality, user, atlasId = null) {
  const { rows } = await query(Q.GET_PHOTO_SIZES, [uuid, ...readScope(user, atlasId)]);
  const row = rows[0];
  if (!row) throw new NotFoundError('Photo');
  enforceProjectReadable(
    { status: row.project_status, organization_id: row.organization_id },
    user,
    'Photo'
  );

  const sizeBytes = Number(
    quality === 'preview' ? row.preview_size_bytes : row.full_size_bytes
  );
  return {
    dbFile: blobstore.resolveDbPath(row.db_filename),
    sizeBytes,
    etag: `"${uuid}-${quality}-${sizeBytes}"`,
    photoId: uuid,
    contentType: 'image/webp',
    // OS DOIS EIXOS dirigem o escopo de cache no controller, e são dois porque um
    // sozinho já errou: `disabled` oculta, `private` restringe, e a imagem de um
    // projeto `enabled + private` viajava marcada `public, immutable` (P6, corrigido
    // na fase F9).
    projectStatus: row.project_status,
    projectAccessLevel: row.access_level,
  };
}

/**
 * Metadado da PIRÂMIDE de uma foto: o descritor que o cliente lê antes de pedir tile.
 *
 * O gate é o MESMO de `getPhotoImageMeta`, e ser o mesmo é o requisito, não o estilo:
 * a pirâmide é uma segunda porta para o mesmo pixel, e um recurso que sai por muitas
 * portas não fica protegido pelo predicado de uma delas. O censo de superfícies dos
 * dois pacotes cobra esta linha.
 *
 * O ETAG NÃO É `immutable`, e a diferença em relação à imagem é de natureza: o WebP de
 * uma foto é imutável enquanto existir, mas a ESCADA se regera. A assinatura junta
 * `built_at` e `total_bytes` justamente porque os dois mudam numa regeração; marcar o
 * descritor como imutável pregaria a escada velha no navegador por um ano.
 * @param {string} uuid - photo id (TEXT uuid v5)
 * @param {Object} [user] - caller
 * @param {string|null} [atlasId] - atlas em foco, JÁ confirmado pelo gate de rota
 * @returns {Promise<Object>} descritor + o que o controller precisa para cache e leitura
 */
export async function getPhotoPyramidMeta(uuid, user, atlasId = null) {
  const { rows } = await query(PQ.GET_PHOTO_PYRAMID, [uuid, ...readScope(user, atlasId)]);
  const row = rows[0];
  if (!row) throw new NotFoundError('Pyramid');
  enforceProjectReadable(
    { status: row.project_status, organization_id: row.organization_id },
    user,
    'Pyramid'
  );

  const builtAt = row.built_at instanceof Date ? row.built_at.toISOString() : String(row.built_at);
  const totalBytes = Number(row.total_bytes);
  return {
    descritor: {
      // O CONTRATO É `schemaVersion`, `levels` e `template`, e não os campos planos.
      // O cliente (`frontend/src/js/street_view_tool/tile-loader.js`) LANÇA quando
      // `schemaVersion !== 1`, itera `levels` e monta a URL do tile por `template`;
      // ele nunca deduz a escada nem monta caminho por conta própria, de propósito
      // (dado gravado manda em descritor calculado). Enquanto este objeto era só a
      // linha do banco achatada, o cliente morria na primeira linha e caía no
      // `image?quality=full` que a origem apagou: tela preta, sem erro de servidor.
      schemaVersion: 1,
      photoId: uuid,
      tileSize: row.tile_size,
      maxLevel: row.max_level,
      width: row.width,
      height: row.height,
      quality: row.quality,
      tileCount: row.tile_count,
      totalBytes,
      builtAt,
      razao: row.razao,
      // A ESCADA SAI DA MESMA FUNÇÃO QUE DECIDE O 404 DO TILE (`escadaGravada`, usada
      // aqui e por `gradeDoNivel` no controller). Publicar `levels` calculado por uma
      // segunda conta faria o cliente pedir exatamente os tiles que a rota recusa, e o
      // sintoma seria buraco na tela com 404 no log, nunca um erro que aponte a causa.
      levels: escadaGravada(row.width, row.height, row.tile_size, row.razao, row.max_level),
      // RELATIVO AO PRÓPRIO `tiles.json`, que é o que o contrato manda e o que faz um
      // prefixo público continuar valendo: o cliente resolve com
      // `new URL(template, urlDoDescritor)`, e o diretório-base de
      // `.../photos/<uuid>/tiles.json` é `.../photos/<uuid>/`. Daí `tiles/{level}/{x}/{y}`
      // cair exatamente em `GET /photos/:uuid/tiles/:level/:x/:y`. SEM `.webp`: a rota
      // real não tem extensão, e o template da origem tinha — copiá-lo daria 404 em
      // todo tile. O `?v=` é o token de geração que quebra o cache imutável do tile
      // numa regeração; o handler o IGNORA de propósito (ver `getPhotoTile`).
      template: `tiles/{level}/{x}/{y}?v=${totalBytes}`,
      // LEGADO, e mantido só enquanto houver `preview_webp` em disco: a estratégia de
      // fundo padrão do cliente é o tile de nível 0 e nunca toca este campo.
      base: 'image?quality=preview',
    },
    tilesDbFile: blobstore.resolveTilesDbPath(row.db_filename),
    etag: `"${uuid}-pyr-${Number(row.total_bytes)}-${builtAt}"`,
    projectStatus: row.project_status,
    projectAccessLevel: row.access_level,
  };
}

/**
 * Photos within `radius` meters of a point (true meters via ::geography),
 * filtered to projects readable by the caller. Defaults: radius 500 m, top 100.
 * @param {number} lon
 * @param {number} lat
 * @param {number} [radius] - meters (default 500)
 * @param {Object} [user]
 * @param {string|null} [atlasId] - atlas em foco, JÁ confirmado pelo gate de rota
 * @returns {Promise<Array>} nearby photo rows (with distance in meters)
 */
export async function nearby(lon, lat, radius, user, atlasId = null) {
  const radiusMeters = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_NEARBY_RADIUS_M;
  const { rows } = await query(
    Q.NEARBY_PHOTOS,
    [lon, lat, radiusMeters, NEARBY_LIMIT, ...readScope(user, atlasId)]
  );
  return rows
    .filter((r) =>
      isProjectReadable({ status: r.project_status, organization_id: r.organization_id }, user)
    )
    .map((r) => ({
      id: r.id,
      img: r.original_name,
      display_name: r.display_name,
      lon: r.lon,
      lat: r.lat,
      ele: r.ele,
      projectSlug: r.project_slug,
      sequence_number: r.sequence_number,
      distance: r.distance_m,
      // ADDITIVE (stage 2b): the floor this photo stands on. `distance` is the
      // distance IN PLAN and it MISLEADS indoors — the photo directly overhead
      // shows up at 0.7 m. The level is what tells the caller which of the stacked
      // photos it just got. Null-safe: a flat project has no label to give.
      floor_level: r.floor_level,
      floor_label: r.floor_label ?? null,
    }));
}

// --- calibration reads (stage 2b) ------------------------------------------

/**
 * Search radii of GET /photos/nearest, in METERS, tried smallest first.
 *
 * Ported from the origin's RAIOS_BUSCA (degrees of latitude: 0.003, 0.02, 0.15, 1)
 * and converted at 111.320 m per degree. 330 m covers a click straight on the
 * line; 111 km covers a click on a 1-pixel trace seen from above the state.
 * Without the last step, clicking a line with the map zoomed out opens nothing.
 * @constant {number[]}
 */
const NEAREST_SEARCH_RADII_M = [330, 2200, 16700, 111000];

/**
 * The photo closest to an arbitrary point, or null.
 *
 * WHY THIS EXISTS: the map used to find the photo nearest to a click with
 * querySourceFeatures over the tiles ALREADY DRAWN, which tied the answer to what
 * was painted — below the source's minimum zoom there is no tile, so the click did
 * nothing. Here the answer comes from the database, so it holds at any zoom and
 * returns the photo REALLY nearest, not the nearest among those that survived the
 * tile's thinning.
 *
 * It REUSES `nearby()`, which already carries the per-project access filter, so
 * there is no second path to a hidden project's photos. That reuse has one bound
 * worth naming: `nearby()` caps at the 100 nearest rows BEFORE the readability
 * filter, so a caller surrounded by 100 unreadable photos would be told there is
 * nothing near. Every project in the corpus is `enabled`, so the cap has no effect
 * today; the alternative is a second query with the filter inlined in SQL.
 * @param {number} lon
 * @param {number} lat
 * @param {Object} [user]
 * @returns {Promise<Object|null>} the nearest readable photo, or null
 */
export async function nearestPhoto(lon, lat, user, atlasId = null) {
  for (const radius of NEAREST_SEARCH_RADII_M) {
    const rows = await nearby(lon, lat, radius, user, atlasId);
    // `nearby` orders by distance ascending, so the head IS the nearest one.
    if (rows.length > 0) return rows[0];
  }
  return null;
}

/**
 * Photos of the same project near a source photo and not yet linked to it.
 *
 * FLOOR: absent `floor` keeps the SOURCE photo's own level, which is the safe
 * default (the index is 2D and indoor photos stack). `'all'` drops the filter,
 * which is what the stairwells and the tunnels need: of the Beira-Rio's 894 links,
 * 84 do cross a level. An explicit integer pins one level.
 *
 * RADIUS: CLAMPED into [1, 1000] m, never rejected — the origin clamps, and a
 * negative radius would otherwise return an empty list that reads as "no
 * neighbours" instead of "bad input", while a huge one would scan the project.
 * @param {string} uuid - source photo id
 * @param {Object} [opts]
 * @param {number} [opts.radius=100] - meters, clamped to [1, 1000]
 * @param {string|number} [opts.floor] - 'all', a level, or undefined
 * @param {Object} [user]
 * @returns {Promise<Array>} candidate photos, nearest first
 * @throws {NotFoundError} if the source photo is missing/tombstoned or hidden
 */
export async function nearbyUnlinkedPhotos(uuid, { radius, floor } = {}, user, atlasId = null) {
  const { rows } = await query(Q.GET_PHOTO_BY_ID, [uuid, ...readScope(user, atlasId)]);
  const source = rows[0];
  if (!source) throw new NotFoundError('Photo');
  enforceProjectReadable(photoProject(source), user, 'Photo');

  const parsed = Number(radius);
  const radiusMeters = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 1000) : 100;

  let floorFilter;
  if (floor === 'all') floorFilter = null;
  else if (floor === undefined) floorFilter = source.floor_level;
  else floorFilter = Number(floor);

  const { rows: candidates } = await query(Q.NEARBY_UNLINKED_PHOTOS, [
    uuid,
    radiusMeters,
    floorFilter,
  ]);

  return candidates.map((c) => ({
    id: c.id,
    img: c.original_name,
    display_name: c.display_name,
    sequence_number: c.sequence_number,
    lon: c.lon,
    lat: c.lat,
    ele: c.ele,
    // The floor goes out so the filter is AUDITABLE from outside: a floor leak
    // would otherwise be invisible without opening the database, and under
    // `floor=all` this is the only thing stopping an operator from linking across
    // the building without noticing.
    floor_level: c.floor_level,
    floor_label: c.floor_label ?? null,
    // Distance IN PLAN, the same measure as the radius, rounded to the centimeter.
    distance: Math.round(c.distance_m * 100) / 100,
    // Adds the height difference. It only means something where `ele` is
    // populated: measured on the Beira-Rio, 207 of 350 photos carry ele = 0 and
    // what exists does not follow the floor. Where the data is poor the two
    // distances simply coincide, and the LABEL is what separates the floors.
    distance3d:
      Math.round(Math.hypot(c.distance_m, (c.ele ?? 0) - (source.ele ?? 0)) * 100) / 100,
    bearing: Math.round(c.bearing_deg * 100) / 100,
  }));
}

/**
 * Every photo of a project as the calibration LIST needs it, plus the review
 * counters.
 *
 * A project with NO photos answers an EMPTY list, never 404 — same rule as
 * `listProjectFloors`. 404 here is reserved for a slug that does not exist or that
 * the caller may not see. The origin 404s an empty project because it had no
 * concept of a hidden one, so there the two cases were indistinguishable anyway.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<{photos: Array, reviewStats: {total: number, reviewed: number}}>}
 * @throws {NotFoundError} if the project is missing or hidden from the caller
 */
export async function projectCalibrationPhotos(slug, user, atlasId = null) {
  const project = await resolveReadableProject(slug, user, atlasId);

  const { rows } = await query(Q.PROJECT_CALIBRATION_PHOTOS, [project.id]);
  const { rows: stats } = await query(Q.REVIEW_STATS_BY_PROJECT, [project.id]);

  return {
    photos: rows.map((p) => ({
      id: p.id,
      img: p.original_name,
      display_name: p.display_name,
      sequence_number: p.sequence_number,
      reviewed: Boolean(p.calibration_reviewed),
      // NULL until scripts/sv360-derive-runs.js has run over this project, which
      // ingestion does not do. The client reads a null runId as "this project has
      // no runs" and falls back to the flat list, which is the pre-run behaviour.
      runId: p.run_id,
      runPosition: p.run_position,
      // 'sol', 'imu', 'manual' or null (no measurement over this photo).
      calibrationSource: p.calibration_source ?? null,
      // The origin calls this column `captured_at`; this house stores the SAME
      // parameter in sv360.photos.capture_date (`007_sv360.sql` says so explicitly).
      capturedAt: p.capture_date ?? null,
      floor_level: p.floor_level,
      floor_label: p.floor_label ?? null,
    })),
    reviewStats: { total: stats[0].total, reviewed: stats[0].reviewed },
  };
}

/**
 * Review counters of every project the caller can see, keyed by slug.
 * @param {Object} [user]
 * @returns {Promise<Object>} { <slug>: { total, reviewed } }
 */
export async function reviewStatsAllProjects(user, atlasId = null) {
  const { rows } = await query(Q.REVIEW_STATS_ALL_PROJECTS, readScope(user, atlasId));
  const stats = {};
  for (const row of rows) {
    stats[row.slug] = { total: row.total, reviewed: row.reviewed };
  }
  return stats;
}

/**
 * Everything the calibration MAP draws for ONE project: the photos with their
 * three angles, the driven track, the bounding box and the review counters.
 *
 * ONE project, always: the map exists to review ONE survey, and merging projects
 * would only inflate the payload without serving anyone.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Object>} { slug, photos, track, bounds, reviewStats }
 * @throws {NotFoundError} if the project is missing or hidden from the caller
 */
export async function projectMap(slug, user, atlasId = null) {
  const project = await resolveReadableProject(slug, user, atlasId);

  const { rows } = await query(Q.MAP_PHOTOS_BY_PROJECT, [project.id]);
  const { rows: trackRows } = await query(Q.TRACKS_BY_PROJECT, [project.id]);
  const { rows: stats } = await query(Q.REVIEW_STATS_BY_PROJECT, [project.id]);

  const photos = rows.map((p) => ({
    id: p.id,
    display_name: p.display_name,
    sequence_number: p.sequence_number,
    lon: p.lon,
    lat: p.lat,
    heading: p.heading,
    mesh_rotation_y: p.mesh_rotation_y,
    mesh_rotation_x: p.mesh_rotation_x,
    mesh_rotation_z: p.mesh_rotation_z,
    reviewed: Boolean(p.calibration_reviewed),
    floor_level: p.floor_level,
    floor_label: p.floor_label ?? null,
  }));

  // Accumulated in ONE pass instead of Math.min(...lons): the biggest project has
  // 17.590 photos, and spreading an array that long into a call is what blows the
  // argument limit — a crash that only appears on the largest survey.
  let bounds = null;
  for (const p of rows) {
    if (p.lon === null || p.lat === null) continue;
    if (!bounds) bounds = [p.lon, p.lat, p.lon, p.lat];
    else {
      if (p.lon < bounds[0]) bounds[0] = p.lon;
      if (p.lat < bounds[1]) bounds[1] = p.lat;
      if (p.lon > bounds[2]) bounds[2] = p.lon;
      if (p.lat > bounds[3]) bounds[3] = p.lat;
    }
  }

  return {
    slug: project.slug,
    photos,
    // One array of [lon, lat] per stretch. Empty for a project whose track was
    // never imported, which is most of them: 3.236 stretches cover 17 of the 29
    // projects. An empty array draws no line; it does not break the map.
    track: trackRows.map((t) => t.coords),
    bounds,
    reviewStats: { total: stats[0].total, reviewed: stats[0].reviewed },
  };
}

/**
 * The capture runs of a project, with per-run review progress.
 *
 * Answers an EMPTY list (never 404) for a project that exists but has no runs: the
 * interface treats "no runs" as the pre-run mode, and a 404 here would make the
 * panel look broken. That is the answer until scripts/sv360-derive-runs.js is run
 * over the project: the derivation is an offline ETL (`npm run sv360:derive-runs`)
 * and is not part of ingestion.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Array>} runs in ordinal order
 * @throws {NotFoundError} if the project is missing or hidden from the caller
 */
export async function projectRuns(slug, user, atlasId = null) {
  const project = await resolveReadableProject(slug, user, atlasId);

  const { rows } = await query(Q.RUNS_BY_PROJECT, [project.id]);
  return rows.map((r) => ({
    id: r.id,
    sessionKey: r.session_key,
    label: r.label,
    ordinal: r.ordinal,
    startedAt: r.started_at,
    total: r.total,
    reviewed: r.reviewed,
    // RECORD of the last default applied, so the interface can say "run calibrated
    // at 337 degrees". Never inheritance: sv360.photos stays the only truth.
    applied: {
      mesh_rotation_y: r.applied_rotation_y,
      mesh_rotation_x: r.applied_rotation_x,
      mesh_rotation_z: r.applied_rotation_z,
    },
  }));
}

/**
 * Builds a GeoJSON FeatureCollection of the photos READABLE by the caller. The
 * read-access rule (enabled = public; disabled = admin/owning-org) is EMBEDDED IN
 * THE SQL (defense in depth), so a hidden project's photos never leak even with an
 * app-layer bug. Tombstoned photos are excluded. Each Feature is a Point [lon, lat]
 * with the photo's identifying properties.
 *
 * ALWAYS BOUNDED (achado 65): `limit` is capped by the route schema
 * (TILES_GEOJSON_MAX_FEATURES) and an optional `bbox` scopes the scan spatially.
 * This endpoint is legacy — the live contract is the bbox-native MVT route — so a
 * caller wanting everything must page by moving the bbox.
 * @param {Object} [user]
 * @param {Object} [opts]
 * @param {number[]} [opts.bbox] - [minLon, minLat, maxLon, maxLat] (already validated)
 * @param {number} [opts.limit] - row ceiling (already capped by the schema)
 * @returns {Promise<Object>} GeoJSON FeatureCollection
 */
export async function tilesFeatureCollection(user, { bbox, limit, atlasId } = {}) {
  const box = Array.isArray(bbox) && bbox.length === 4 ? bbox : [null, null, null, null];
  const cap = Number.isInteger(limit) && limit > 0 ? limit : TILES_GEOJSON_MAX_FEATURES;
  const [userId, atlas] = readScope(user, atlasId);
  const { rows } = await query(Q.TILES_PHOTOS, [userId, ...box, cap, atlas]);
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: {
        id: r.id,
        projectSlug: r.project_slug,
        img: r.original_name,
        display_name: r.display_name,
        sequence_number: r.sequence_number,
        heading: r.heading,
        ele: r.ele,
      },
    })),
  };
}

/**
 * Renders a single Mapbox Vector Tile (MVT) for the StreetView 360 layers at
 * z/x/y, READABLE by the caller. The tile carries two layers ('fotos' points +
 * 'fotos_linha' per-project trajectory lines). The read-access rule (enabled =
 * public; disabled = admin/owning-org) is EMBEDDED IN THE SQL (defense in depth),
 * so a hidden project never leaks even with an app-layer bug; tombstoned photos
 * are excluded. An empty tile (no features in the bbox) returns an empty Buffer —
 * a valid MVT response (the controller answers 200).
 * @param {number} z - tile zoom
 * @param {number} x - tile column
 * @param {number} y - tile row
 * @param {Object} [user] - req.user (only the principal id reaches the SQL) or undefined
 * @returns {Promise<Buffer>} the MVT protobuf (possibly empty)
 */
export async function mvtTile(z, x, y, user, atlasId = null) {
  const { rows } = await query(TQ.MVT_TILE, [z, x, y, ...readScope(user, atlasId)]);
  const tile = rows[0]?.tile;
  // pg returns bytea as a Node Buffer; normalize null/undefined to an empty tile.
  return Buffer.isBuffer(tile) ? tile : Buffer.alloc(0);
}

/**
 * Resolves the absolute FS path of a project's thumbnail, enforcing
 * the project read policy. The slug is sanitized with path.basename (traversal
 * guard) AND the readability check runs against the matching project row; a hidden
 * (disabled) project is 404 for anon. Returns null when the project does not exist
 * OR the thumbnail file is absent (the controller maps null → 404).
 * @param {string} slug - project slug (from the :slug.webp route param)
 * @param {Object} [user]
 * @returns {Promise<{filePath: string, projectStatus: string, projectAccessLevel: string}|null>} `filePath` is the
 *   absolute path to the ORG-KEYED {orgId}__{slug}.webp on disk (the URL is slug-only; the
 *   file is not), and `projectStatus` is what the caller uses to decide the CACHE SCOPE
 *   (`enabled` may be publicly cached; anything else must not be). Null when the project
 *   does not exist or the thumbnail file is absent.
 *
 *   Este `@returns` declarou `Promise<string|null>` até 2026-07-25, omitindo justamente o
 *   campo que decide escopo de cache: quem programasse contra o JSDoc trataria o retorno
 *   como caminho e publicaria um thumbnail de projeto desabilitado.
 */
export async function resolveThumbnailPath(slug, user, atlasId = null) {
  // basename strips any directory component (../, absolute) before it ever hits
  // the DB lookup or the filesystem — defense in depth on top of the route param.
  const safeSlug = path.basename(String(slug));
  const { rows } = await query(Q.GET_PROJECT_BY_SLUG, [safeSlug, ...readScope(user, atlasId), preferredOrgId(user)]);
  const project = rows[0];
  // Project missing OR hidden from the caller → indistinguishable 404 (no leak).
  if (!project || !isProjectReadable(project, user)) return null;

  // A derivação do nome ORG-KEYED mora em `thumbnailFilePath`, e é a MESMA que
  // `previewThumbnailUrl` usa para decidir se anuncia a miniatura: duas cópias da
  // regra fariam o catálogo prometer um arquivo que esta rota procura noutro nome.
  const filePath = thumbnailFilePath(project.db_filename);
  if (!filePath || !existsSync(filePath)) return null;

  // OS DOIS EIXOS viajam com o caminho, porque é com os dois que o controller decide
  // o escopo de cache: só um projeto `enabled` E `public` pode ir para um cache
  // COMPARTILHADO. Até a fase F9 só o `status` viajava, e a miniatura de um projeto
  // `enabled + private` saía pública por um ano. See P6.
  return {
    filePath,
    projectStatus: project.status,
    projectAccessLevel: project.access_level,
  };
}

// --- internal -------------------------------------------------------------

// Extracts the project-readability shape from a joined photo row.
function photoProject(photo) {
  return { status: photo.project_status, organization_id: photo.organization_id };
}

/**
 * Maps a joined photo row + its target rows to the FROZEN photoMetadataShape.
 * Camera fields are FLAT (never nested). Targets expose `bearing`/`distance`
 * (from internal bearing_deg/distance_m), `icon` is the constant string 'next',
 * and `next` mirrors the is_next column. Internal column names (bearing_deg /
 * distance_m) are NEVER emitted.
 * @param {Object} photo - row from GET_PHOTO_BY_ID / GET_PHOTO_BY_NAME
 * @param {Array}  targets - rows from GET_TARGETS_FOR_PHOTO
 * @returns {Object} frozen photoMetadataShape (bare object, not wrapped in {data})
 */
export function buildPhotoMetadata(photo, targets, { includeHidden = false } = {}) {
  return {
    camera: {
      id: photo.id,
      img: photo.original_name,
      display_name: photo.display_name,
      lon: photo.lon,
      lat: photo.lat,
      ele: photo.ele,
      heading: photo.heading,
      height: photo.camera_height,
      mesh_rotation_y: photo.mesh_rotation_y,
      mesh_rotation_x: photo.mesh_rotation_x,
      mesh_rotation_z: photo.mesh_rotation_z,
      distance_scale: photo.distance_scale,
      marker_scale: photo.marker_scale,
      floor_level: photo.floor_level,
      // The NAME this photo's floor carries on screen. Nullable by construction:
      // a flat project has no floor to name (`?? null` normalizes the undefined a
      // query that did not SELECT the column yields, so the key is never missing).
      floor_label: photo.floor_label ?? null,
      calibration_reviewed: photo.calibration_reviewed,
    },
    projectSlug: photo.project_slug,
    captureDate: photo.capture_date,
    // FROZEN contract (99-referencia §6.1/§6.2 ponto 2): RELATIVE path WITHOUT the
    // /api/v1 prefix. The client concatenates it with streetView360.serviceUrl
    // (= <backend>/api/v1/sv360), yielding /api/v1/sv360/thumbnails/{slug}.webp.
    // The URL is slug-only, but the FILE on disk is org-keyed
    // ({orgId}__{slug}.webp, derived from db_filename at ingestion); the route
    // GET /sv360/thumbnails/:slug.webp resolves one to the other.
    //
    // NULL when the project has no thumbnail on disk: the writer treats it as
    // optional, so promising the URL unconditionally made the viewer request an
    // image that 404s. Every row reaching here already passed the read gate (the
    // four photo queries carry sv360AccessPredicate), so the check leaks nothing.
    previewThumbnail: previewThumbnailUrl({
      db_filename: photo.db_filename,
      slug: photo.project_slug,
    }),
    targets: targets.map((t) => ({
      id: t.target_id,
      img: t.target_name,
      lon: t.target_lon,
      lat: t.target_lat,
      ele: t.target_ele,
      display_name: t.target_display_name,
      icon: 'next',
      next: t.is_next,
      is_original: t.is_original,
      // The TARGET's floor, and the reason the floor-change marker exists at all:
      // the client compares this level with the current photo's and draws the
      // staircase instead of the arrow when they differ. Without the field it
      // falls back to `return 0` and the marker never draws, with nothing on
      // screen saying so. `?? null` keeps the key present when the query did not
      // bring the column.
      floor_level: t.target_floor_level ?? null,
      floor_label: t.target_floor_label ?? null,
      distance: t.distance_m,
      bearing: t.bearing_deg,
      override_bearing: t.override_bearing,
      override_distance: t.override_distance,
      override_height: t.override_height,
      // Present ONLY under include_hidden. The default read never carries the key,
      // because there the array is hidden-free by construction and a constant
      // `hidden: false` on every target would be noise the viewer has to ignore.
      ...(includeHidden ? { hidden: Boolean(t.hidden) } : {}),
    })),
  };
}
