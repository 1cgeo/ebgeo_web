// Path: src/modules/images/imagens-orfas.fontes.js
/**
 * @fileoverview WHERE AN IMAGE CAN BE CITED, for the orphan-image collector: the classified list of
 * tables, the rules of life of each, and the grace periods. ZERO IMPORTS, so the census test and the
 * CLI read it without the pool.
 *
 * THE MATCH IS THE UUID TOKEN, NOT THE FIELD. An image is cited when its id appears as a UUID in the
 * text of ANY text-capable column (`jsonb`, `json`, `text`, `varchar`, `uuid`, arrays) of a live row
 * of a source table, in ANY atlas. The collector does not know WHERE an image is cited, only IF, and
 * that is the conservative choice on three counts:
 *   1. a new location inside a JSON document (a photo held by reference, a cover id, an `<img>` URL
 *      in the HTML of a note or a slide) is covered without anyone remembering to add it;
 *   2. a false positive (a UUID that happens to be an image's) only leaves a blob behind;
 *   3. the match crosses atlases: the atlas clone rewrites image features, custom icons and the 3D/360
 *      `images[]`, but not the feature's `properties.images[]`, so a cloned feature can cite the blob
 *      of the ORIGIN atlas. Deleting that blob is not the answer to that doubt.
 * Base64 has no hyphen, so an inline photo (a data URL) never forges a UUID by accident.
 *
 * The columns of a source table are read from the migrated schema AT RUN TIME, minus the ones named
 * in `colunasIgnoradas`: a column added to a source table tomorrow is scanned without an edit here.
 * A TABLE added tomorrow is caught by the census (`tests/integration/imagens-orfas-censo.test.js`),
 * which reads `information_schema` and fails until the table is classified below.
 *
 * Owner's decision of 2026-09-24 (`docs/decisions/decisions-2026.md`), and the design in
 * `docs/wiki/imagens-atlas.md`.
 */

/** Days an image must be unreferenced, continuously, before it can be deleted. */
export const DIAS_DE_CARENCIA = 30;

/** Days an image must have existed before it can be deleted (the op that cites it may still come). */
export const DIAS_DE_CRIACAO = 30;

/** Days a soft-deleted row still counts as a reference. */
export const DIAS_DE_RETENCAO_DE_EXCLUIDA = 30;

/** Days an applied operation still counts as a reference, by its `created_at`. */
export const DIAS_DA_JANELA_DE_OPERACOES = 30;

/**
 * A UUID in text, in any case. The same pattern is written in the trigger of the migration that
 * brought `images.sem_referencia_desde` (`zerar_marca_de_imagem_citada`), and the census compares
 * the two, because a trigger that matched less than the collector would stop zeroing marks.
 */
export const PADRAO_DE_UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** How long a row of a source table keeps citing. */
export const Vida = Object.freeze({
  /** Every row, forever (the atlas row: the trash has no term in this product). */
  SEMPRE: 'sempre',
  /** Live rows, and rows soft-deleted less than `DIAS_DE_RETENCAO_DE_EXCLUIDA` ago. */
  EXCLUIDA_NA_RETENCAO: 'excluida-na-retencao',
  /** Rows created less than `DIAS_DA_JANELA_DE_OPERACOES` ago (the operations log). */
  JANELA_DE_OPERACOES: 'janela-de-operacoes',
});

/**
 * The source tables. `cita` says what is usually there (the match does not depend on it);
 * `colunasIgnoradas` names the text-capable columns left out, each with its reason.
 * @type {ReadonlyArray<{tabela: string, vida: string, cita: string, colunasIgnoradas?: Object<string, string>}>}
 */
export const FONTES_DE_REFERENCIA = Object.freeze([
  {
    tabela: 'features',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: 'the image feature (its id IS the blob id), the photos of any feature (`properties.images[].id`, '
      + 'inline or by reference), the custom point icon (`markerSymbol = custom:<id>`)',
    colunasIgnoradas: {
      geometry: 'GeoJSON coordinates: numbers only, and the biggest column of the table',
    },
  },
  {
    tabela: 'cesium3d_data',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: '3D markers, measurements and viewsheds with `images[]` at any depth',
  },
  {
    tabela: 'streetview360_data',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: '360 markers with `images[]`',
  },
  {
    tabela: 'atlas',
    vida: Vida.SEMPRE,
    cita: '`settings.customIcons[].id`; an atlas in the trash keeps every image it has (a separate rule)',
  },
  {
    tabela: 'maps',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: 'a picture in the HTML of the map notes (`notes_description`)',
  },
  {
    tabela: 'briefings',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: 'a picture of a briefing (`description`, `settings`)',
  },
  {
    tabela: 'slides',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: 'a picture in the HTML of a slide (`content`)',
  },
  {
    tabela: 'comments',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: 'an attachment of a spatial comment, should it ever exist (`data`)',
  },
  {
    tabela: 'layers',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: 'an icon of a layer style, should it ever exist (`style`)',
  },
  {
    tabela: 'groups',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: 'an icon of a group style, should it ever exist (`style`)',
  },
  {
    tabela: 'catalog_layers',
    vida: Vida.EXCLUIDA_NA_RETENCAO,
    cita: 'the per-map catalog layer document (`data`)',
  },
  {
    tabela: 'operations',
    vida: Vida.JANELA_DE_OPERACOES,
    cita: 'ANY citation made by an operation applied in the window: the belt under the trigger, for '
      + 'everything that arrives by sync',
  },
]);

/**
 * The tables that do NOT cite an image of `images`, each with its reason. The census demands that
 * every table of the migrated schema be here or in `FONTES_DE_REFERENCIA`.
 * @type {Readonly<Object<string, string>>}
 */
export const TABELAS_QUE_NAO_CITAM = Object.freeze({
  'public.images': 'the collected table itself',
  'public.group_features': 'cites the FEATURE by id and outlives it: it would keep the blob of a deleted '
    + 'image feature forever, and the feature row is already the source',
  'public.sync_entity_fields': 'per-entity field versions of the sync: bookkeeping that outlives the entity',
  'public.sync_receipts': 'delivery receipts of the sync: history, not a live reference',
  'public.atlas_import_attempts': 'an import in progress cites images that are NOT in `images` yet: the '
    + 'bytes live in `atlas_import_images`, and the publication creates the rows in the same transaction '
    + 'as the features that cite them, born inside the creation grace',
  'public.atlas_import_images': 'the staged bytes of an import in progress, outside `images`',
  'public.atlas_covers': 'the atlas cover is its own bytes (`bytea`), not an image of `images`',
  'public.atlas_resources': 'catalog resources lent by the atlas (slugs and sv360 ids), not images',
  'public.atlas_shares': 'access, not content',
  'public.audit_trail': 'history: a row about an image is not a reference to it',
  'public.defeitos': 'error reports: history, not a live reference',
  'public.defeito_ocorrencias': 'error reports: history, not a live reference',
  'public.access_groups': 'access groups, not content',
  'public.access_group_members': 'access groups, not content',
  'public.resource_grants': 'catalog grants, not content',
  'public.api_keys': 'credentials',
  'public.api_key_history': 'credentials',
  'public.refresh_tokens': 'credentials',
  'public.email_verification_tokens': 'credentials',
  'public.users': 'accounts',
  'public.organizations': 'organizations',
  'public.ranks': 'ranks',
  'public.config_settings': 'system configuration, not atlas content',
  'public.basemaps': 'catalog',
  'public.data_layers': 'catalog',
  'public.analysis_layers': 'catalog',
  'public.tilesets': 'catalog',
  'public.uso_diario': 'usage telemetry',
  'public.uso_eventos_dia': 'usage telemetry',
  'public.uso_lotes': 'usage telemetry',
  'public.uso_presenca': 'usage telemetry',
  'public.uso_sessoes': 'usage telemetry',
  'public._migrations': 'migration bookkeeping',
  'public.spatial_ref_sys': 'PostGIS system table',
  'public.geometry_columns': 'PostGIS system view',
  'public.geography_columns': 'PostGIS system view',
  'ng.nomes_geograficos': 'geographic names gazetteer',
  'sv360.capture_runs': '360 catalog (its photos are not in `images`)',
  'sv360.deleted_photos': '360 catalog',
  'sv360.photo_pyramids': '360 catalog',
  'sv360.photos': '360 catalog',
  'sv360.project_floors': '360 catalog',
  'sv360.projects': '360 catalog',
  'sv360.targets': '360 catalog',
  'sv360.tracks': '360 catalog',
  'a3d.imports': '3D catalog',
  'a3d.models': '3D catalog',
  'a3d.scenes': '3D catalog',
});

/** The three modes of a run (here, and not in the service, so the Joi of the route reads it without the pool). */
export const ModoDaColeta = Object.freeze({
  SIMULACAO: 'simulacao',
  MARCAR: 'marcar',
  APAGAR: 'apagar',
});

/** Why an unreferenced image is not deletable yet. */
export const MotivoDeCarencia = Object.freeze({
  SEM_MARCA: 'sem-marca',
  MARCA_RECENTE: 'marca-recente',
  JOVEM: 'jovem',
});

/** The schemas the census inventories (PostGIS support schemas are out: they are the extension's). */
export const ESQUEMAS_DO_CENSO = Object.freeze(['public', 'ng', 'sv360', 'a3d']);

/** Column types that can hold a UUID as text. */
export const TIPOS_QUE_CITAM = Object.freeze(['jsonb', 'json', 'text', 'character varying', 'character', 'uuid', 'ARRAY']);
