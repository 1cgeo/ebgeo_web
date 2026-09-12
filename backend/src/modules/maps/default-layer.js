/** Every remote map has a persisted layer. Call inside the structural write transaction. */
export async function ensureMapLayers(t, atlasId, mapIds = null) {
  const created = await t.any(`INSERT INTO layers (map_id, name)
    SELECT m.id, 'Padrão' FROM maps m
    WHERE m.atlas_id=$1 AND m.deleted_at IS NULL
      AND ($2::uuid[] IS NULL OR m.id=ANY($2::uuid[]))
      AND NOT EXISTS (SELECT 1 FROM layers l WHERE l.map_id=m.id AND l.deleted_at IS NULL)
    RETURNING id`,
  [atlasId, mapIds]);
  // Imports may represent the default layer as NULL. Preserve the features,
  // attaching them to the first real layer of their OWN map.
  await t.none(`UPDATE features f SET layer_id=l.id,
      properties=jsonb_set(f.properties, '{layerId}', to_jsonb(l.id::text))
    FROM maps m, LATERAL (SELECT id FROM layers WHERE map_id=m.id AND deleted_at IS NULL
      ORDER BY sort_order, created_at, id LIMIT 1) l
    WHERE f.map_id=m.id AND m.atlas_id=$1 AND m.deleted_at IS NULL
      AND ($2::uuid[] IS NULL OR m.id=ANY($2::uuid[]))
      AND f.deleted_at IS NULL AND f.layer_id IS NULL`, [atlasId, mapIds]);
  return created.map((layer) => layer.id);
}

export async function readMapLayers(t, atlasId, mapId) {
  return t.any(`SELECT l.id, l.name, l.visible, l.locked, l.opacity,
      l.sort_order AS "order", l.style, l.version,
      l.created_at AS "createdAt", l.updated_at AS "updatedAt"
    FROM layers l JOIN maps m ON m.id=l.map_id
    WHERE m.atlas_id=$1 AND m.id=$2 AND m.deleted_at IS NULL AND l.deleted_at IS NULL
    ORDER BY l.sort_order, l.created_at, l.id`, [atlasId, mapId]);
}

/** Resolve only the legacy sentinel; an explicit stale layer must never be redirected. */
export async function resolveDefaultFeatureLayer(t, atlasId, op) {
  if (op.target !== 'feature' || op.type === 'delete') return;
  const payload = op.type === 'update' ? op.changes : op.data;
  if (!payload || (op.type === 'update' && !Object.hasOwn(payload, 'layer_id'))) return;
  const destinationMapId = payload.map_id ?? op.mapId;
  if (payload.layer_id) {
    const destination = await t.oneOrNone(`SELECT l.id FROM layers l JOIN maps m ON m.id=l.map_id
      WHERE l.id=$1 AND m.id=$2 AND m.atlas_id=$3 AND m.deleted_at IS NULL AND l.deleted_at IS NULL`,
    [payload.layer_id, destinationMapId, atlasId]);
    if (!destination) return 'A camada de destino foi excluída ou não pertence a este mapa. Atualize o atlas antes de tentar novamente.';
    return;
  }
  const layer = await t.oneOrNone(`SELECT l.id FROM layers l JOIN maps m ON m.id=l.map_id
    WHERE m.atlas_id=$1 AND m.id=$2 AND m.deleted_at IS NULL AND l.deleted_at IS NULL
    ORDER BY l.sort_order, l.created_at, l.id LIMIT 1`, [atlasId, destinationMapId]);
  if (!layer) return;
  // normalizeOperation may retain references to the received body. Its bytes are
  // the receipt's identity: resolving an alias must never mutate that envelope.
  const resolved = { ...payload, layer_id: layer.id };
  if (payload.properties) resolved.properties = { ...payload.properties, layerId: layer.id };
  if (op.data === payload) op.data = resolved;
  if (op.changes === payload) op.changes = resolved;
}
