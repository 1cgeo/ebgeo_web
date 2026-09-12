-- Regularize remote maps created before server-owned default layers.
-- Never revive tombstones or change an existing layer's configuration.
DO $$
DECLARE affected UUID[];
DECLARE atlas_id_to_repair UUID;
DECLARE frontier BIGINT;
BEGIN
    SELECT array_agg(DISTINCT m.atlas_id) INTO affected FROM maps m
    WHERE m.deleted_at IS NULL AND (
        NOT EXISTS (SELECT 1 FROM layers l WHERE l.map_id=m.id AND l.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM features f WHERE f.map_id=m.id AND f.deleted_at IS NULL AND f.layer_id IS NULL)
    );
    IF affected IS NULL THEN RETURN; END IF;

    INSERT INTO layers (map_id, name)
    SELECT m.id, 'Padrão' FROM maps m
    WHERE m.atlas_id=ANY(affected) AND m.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM layers l WHERE l.map_id=m.id AND l.deleted_at IS NULL);

    UPDATE features f SET layer_id=l.id,
        properties=jsonb_set(f.properties, '{layerId}', to_jsonb(l.id::text)),
        version=f.version+1, updated_at=NOW()
    FROM maps m, LATERAL (SELECT id FROM layers WHERE map_id=m.id AND deleted_at IS NULL
        ORDER BY sort_order, created_at, id LIMIT 1) l
    WHERE f.map_id=m.id AND m.atlas_id=ANY(affected) AND m.deleted_at IS NULL
      AND f.deleted_at IS NULL AND f.layer_id IS NULL;

    -- Force old clients through a coherent snapshot; old feature bases stay stale.
    FOREACH atlas_id_to_repair IN ARRAY affected LOOP
        frontier := nextval('atlas_version_seq');
        UPDATE atlas SET current_version=frontier, min_version=frontier
        WHERE id=atlas_id_to_repair;
    END LOOP;
END $$;
