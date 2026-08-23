// Path: src/modules/models3d/models3d.queries.js
// Named SQL for the converted-3D-model registry (schema `a3d`). The CATALOG half of a
// model — name, `config` JSONB, and the two access axes — lives in `public.tilesets`
// and is read by the catalog module; here we only touch what production owns.
//
// THE READ IS A WHOLE-TABLE SCAN ON PURPOSE. Its one caller is the in-memory index
// (`models3d.index.js`), which is rebuilt on catalog writes and never per request:
// Cesium fans a tileset out into one request per tile per LOD, and a query on that path
// would put the fan-out on the ten-connection pool, competing with the sync, with the
// collab socket and with `GET /api/config`, whose failure blocks boot. The acquis is 74
// rows; the scan costs less than the round trip.

/** Every registered model, with the catalog flag that decides whether it answers. */
export const LIST_MODELS_3D = `
  SELECT m.model_id, m.db_filename, m.build_token, m.model_type, t.active
    FROM a3d.models m
    JOIN public.tilesets t ON t.id = m.model_id
`;

/** One model's production record (admin/CLI paths, never the tile path). */
export const GET_MODEL_3D = `
  SELECT m.*, t.name, t.active, t.access_level, t.owner_org_id
    FROM a3d.models m
    JOIN public.tilesets t ON t.id = m.model_id
   WHERE m.model_id = $1
`;

/**
 * Upsert of the production record.
 *
 * WHAT IS OVERWRITTEN AND WHAT IS PRESERVED follows the ebgeo_3d rule, which is worth
 * restating because it reads backwards at first: everything MEASURED from the file is
 * overwritten (a re-import that reconverts the geometry must publish the new heights,
 * so `ground_height`/`min_height` carry no COALESCE), while anything an operator typed
 * lives in the catalog `config` and is not touched from here at all.
 */
export const UPSERT_MODEL_3D = `
  INSERT INTO a3d.models (
    model_id, db_filename, model_type, tiles_version, geometry_codec, texture_codec,
    texture_quality, tile_count, json_count, total_bytes, source_bytes, source,
    source_version, captured_at, build_token, built_at, ground_height, min_height
  ) VALUES (
    $<modelId>, $<dbFilename>, $<modelType>, $<tilesVersion>, $<geometryCodec>,
    $<textureCodec>, $<textureQuality>, $<tileCount>, $<jsonCount>, $<totalBytes>,
    $<sourceBytes>, $<source>, $<sourceVersion>, $<capturedAt>, $<buildToken>,
    $<builtAt>, $<groundHeight>, $<minHeight>
  )
  ON CONFLICT (model_id) DO UPDATE SET
    db_filename     = EXCLUDED.db_filename,
    model_type      = EXCLUDED.model_type,
    tiles_version   = EXCLUDED.tiles_version,
    geometry_codec  = EXCLUDED.geometry_codec,
    texture_codec   = EXCLUDED.texture_codec,
    texture_quality = EXCLUDED.texture_quality,
    tile_count      = EXCLUDED.tile_count,
    json_count      = EXCLUDED.json_count,
    total_bytes     = EXCLUDED.total_bytes,
    source_bytes    = EXCLUDED.source_bytes,
    source          = COALESCE(EXCLUDED.source, a3d.models.source),
    source_version  = COALESCE(EXCLUDED.source_version, a3d.models.source_version),
    captured_at     = COALESCE(EXCLUDED.captured_at, a3d.models.captured_at),
    build_token     = EXCLUDED.build_token,
    built_at        = EXCLUDED.built_at,
    ground_height   = EXCLUDED.ground_height,
    min_height      = EXCLUDED.min_height,
    updated_at      = now()
  RETURNING model_id
`;

/** Opens an import record BEFORE the conversion starts (see the migration's note). */
export const OPEN_IMPORT_3D = `
  INSERT INTO a3d.imports (model_id, started_at, status, source_path)
  VALUES ($<modelId>, now(), 'rodando', $<sourcePath>)
  RETURNING id
`;

/** Closes it, successfully or not. */
export const CLOSE_IMPORT_3D = `
  UPDATE a3d.imports
     SET finished_at = now(), status = $<status>, tiles_in = $<tilesIn>,
         tiles_out = $<tilesOut>, textures = $<textures>, failures = $<failures>,
         seconds = $<seconds>, ratio = $<ratio>, notes = $<notes>
   WHERE id = $<id>
`;

/** The last N imports of a model, newest first. */
export const LAST_IMPORTS_3D = `
  SELECT * FROM a3d.imports WHERE model_id = $1 ORDER BY started_at DESC LIMIT $2
`;

/**
 * A linha de CATÁLOGO de um modelo, escrita pela adoção.
 *
 * POR QUE ESTE UPSERT E NÃO `catalogService.createCatalogItem`. O serviço é a borda de
 * escrita de um OPERADOR AUTENTICADO: ele resolve `owner_org_id` a partir do ator, e a
 * leitura que ele faz antes (`getCatalogItem`) passa pelo predicado de visibilidade. Um
 * script de linha de comando não tem ator, e medido: readotar um modelo marcado PRIVADO
 * fazia a leitura devolver 404 (o anônimo não o vê), o create seguinte batia no id
 * existente, e o operador via "Já existe um item de catálogo com este ID" ao republicar
 * um modelo seu.
 *
 * OS DOIS EIXOS DE ACESSO FICAM DE FORA DO SET, e é a propriedade que importa aqui:
 * `access_level` e `owner_org_id` são decisão de administrador, e uma reimportação não
 * pode devolver ao público um modelo que alguém fechou.
 *
 * O `config` é MESCLADO (`||`), com o lado novo vencendo: o que o operador acrescentou
 * pela tela (uma descrição, um `maximumScreenSpaceError`) sobrevive, e o que deriva do
 * arquivo (url, medidas, token) é republicado.
 *
 * `active` VEM DO CABEÇALHO, e é o único campo do arquivo que decide visibilidade. Uma
 * importação PARCIAL (`--limite`, usada para reconhecimento) grava `published = 0`, e sem
 * este fio ela entraria no catálogo publicada: um modelo com um punhado de tiles, que
 * abre em tela com buracos e sem erro. Adotar um arquivo completo republica (`true`), que
 * é o que faz um modelo desativado e readotado deliberadamente reaparecer.
 */
export const UPSERT_TILESET_3D = `
  INSERT INTO tilesets (id, name, description, config, sort_order, active)
  VALUES ($<id>, $<name>, $<description>, $<config>::jsonb, 0, $<ativo>)
  ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    description = COALESCE(EXCLUDED.description, tilesets.description),
    config      = tilesets.config || EXCLUDED.config,
    active      = EXCLUDED.active,
    updated_at  = NOW()
`;

/** Existe linha de catálogo com este id? Sem predicado de visibilidade: é administração local. */
export const CATALOG_ROW_EXISTS = 'SELECT id, active FROM tilesets WHERE id = $1';

/**
 * A REMEDIÇÃO de um modelo já publicado: as duas medidas do envelope geodésico.
 *
 * Ela existe porque reconverter um modelo inteiro para consertar um metadado custa horas,
 * e os `tileset.json` já gravados são os mesmos. O caso que a motivou é real: enquanto o
 * importador só sabia ler o ponto de `properties` ou de `boundingVolume.region` (que o DJI
 * Terra não publica), o operador preenchia à mão e o Silo Oreste Ceretta entrou 3.657 m ao
 * sul do lugar dele.
 */
export const REMEDIR_MODEL_3D = `
  UPDATE a3d.models
     SET ground_height = $<groundHeight>, min_height = $<minHeight>, updated_at = now()
   WHERE model_id = $<modelId>
`;

/**
 * O lado do catálogo da mesma remedição: o ponto de navegação e as duas medidas que o
 * cliente lê. MESCLA (`||`) em vez de sobrescrever, para não apagar o que um operador
 * ajustou pela tela.
 */
export const REMEDIR_TILESET_3D = `
  UPDATE tilesets
     SET config = config || $<patch>::jsonb, updated_at = NOW()
   WHERE id = $<id>
`;

/** Todo modelo registrado, com o que a remedição precisa comparar. */
export const LIST_MODELS_3D_COM_PONTO = `
  SELECT m.model_id, m.db_filename, m.ground_height, m.min_height,
         t.config->'locate' AS locate
    FROM a3d.models m
    JOIN public.tilesets t ON t.id = m.model_id
   ORDER BY m.model_id
`;
