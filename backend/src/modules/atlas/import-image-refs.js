// Path: src/modules/atlas/import-image-refs.js
/** Original images required by the import. Generated symbol caches are not originals. */
export function importImageIds(payload) {
  const ids = new Set();
  const attached = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.images)) for (const image of value.images) {
      const id = typeof image === 'string' ? image : image?.id;
      if (id) ids.add(id);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') attached(child);
  };
  for (const map of payload.maps || []) {
    for (const feature of map.features || []) {
      if (feature.feature_type === 'image') ids.add(feature.id);
      const marker = feature.properties?.markerSymbol;
      if (typeof marker === 'string' && marker.startsWith('custom:')) ids.add(marker.slice(7));
    }
    attached(map.cesium3dData);
    attached(map.streetview360Data);
  }
  const icons = payload.atlas?.settings?.customIcons;
  if (Array.isArray(icons)) for (const icon of icons) if (icon?.id) ids.add(icon.id);
  return ids;
}
