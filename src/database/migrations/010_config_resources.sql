-- Path: src/database/migrations/010_config_resources.sql
-- Backfill the `config` JSONB of the seeded resources with the UI fields the
-- GET /api/v1/config endpoint serves (mirrors the frozen config.js shape).
-- Aditivo + idempotente: only UPDATEs the config column of existing seed rows.

UPDATE resources SET config = jsonb_build_object(
  'enabled', true, 'image', './images/layers/carta-topografica-thumb.png', 'priority', 1
) WHERE id = 'carta-topografica';

UPDATE resources SET config = jsonb_build_object(
  'enabled', true, 'image', './images/layers/carta-ortoimagem-thumb.png', 'priority', 2
) WHERE id = 'carta-ortoimagem';

UPDATE resources SET config = jsonb_build_object(
  'enabled', true, 'image', './images/layers/bdgex-thumb.png', 'priority', 3
) WHERE id = 'bdgex';

UPDATE resources SET config = jsonb_build_object('enabled', false, 'priority', 4) WHERE id = 'osm';

UPDATE resources SET config = jsonb_build_object('enabled', false, 'priority', 5) WHERE id = 'imagens';

-- Tileset PCL: positioning + discovery fields (config.js §tilesets).
UPDATE resources SET config = jsonb_build_object(
  'url', '/3d/PCL/tileset.json', 'heightOffset', 35,
  'description', 'Modelo 3D do Posto de Comando Logístico capturado por drone',
  'keywords', jsonb_build_array('PCL', 'posto comando', 'logística', 'drone'),
  'data_captura', '15/03/2024', 'local', 'Resende, RJ',
  'previewVideo', '/3d/videos/preview.webm', 'previewThumbnail', '/3d/videos/thumbnail.jpg',
  'locate', jsonb_build_object('lon', -44.47332385414955, 'lat', -22.43976556982974, 'height', 1000)
) WHERE id = 'PCL';
