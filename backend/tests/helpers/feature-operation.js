// Path: tests/helpers/feature-operation.js

/**
 * Build a v2 test intention from an explicitly observed feature row. This helper
 * never queries the database or refreshes a base during retry; callers choose
 * the observation, including stale observations for conflict tests.
 */
export function featureMutation(observed, operation) {
  const type = operation.operationType ?? operation.type;
  const changes = operation.changes ?? operation.data ?? {};
  const base = { ...operation, protocolVersion: 2, baseVersion: Number(observed.version) };
  if (type === 'delete') return base;
  if (changes.map_id && changes.map_id !== observed.map_id) {
    return { ...base, type: 'create', operationType: 'create', featureIntent: 'move',
      sourceMapId: observed.map_id, mapId: changes.map_id, changes: null,
      data: { feature_type: observed.feature_type, geometry: observed.geometry,
        properties: observed.properties, ...changes } };
  }
  const values = Object.entries(changes.properties ?? {}).filter(([key]) => !['id', 'confirmedVersion', 'version'].includes(key))
    .map(([key, value]) => ({ op: 'set', path: ['properties', key], value }));
  if (Object.hasOwn(changes, 'geometry')) values.push({ op: 'set', path: ['geometry'], value: changes.geometry });
  if (Object.hasOwn(changes, 'layer_id')) values.push({ op: 'set', path: ['properties', 'layerId'], value: changes.layer_id });
  if (Object.hasOwn(changes, 'feature_type')) values.push({ op: 'set', path: ['properties', 'source'], value: changes.feature_type });
  return { ...base, patch: values };
}
