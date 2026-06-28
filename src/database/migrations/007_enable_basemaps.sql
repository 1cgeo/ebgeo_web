-- Path: src/database/migrations/007_enable_basemaps.sql
-- Make the OSM and Google-imagery basemaps available by default. They ship with working
-- style builders + thumbnails on the frontend but were seeded disabled (003_sync.sql), so
-- they appeared toggleable in atlas-settings yet never rendered in the base-layer selector
-- (which filters by config.enabled). Flip them on so the catalog matches what the UI offers.
UPDATE resources
   SET config = config || '{"enabled": true}'::jsonb,
       updated_at = NOW()
 WHERE category = 'basemap'
   AND id IN ('osm', 'imagens');
