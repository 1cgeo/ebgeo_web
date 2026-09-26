// Path: src/modules/atlas/import-image-refs.js

import { idsDeFigurasNoHtml } from '../../utils/figura-de-slide.js';

/**
 * The image id an attached photo makes the import require, or null.
 *
 * A PHOTO CARRYING ITS BYTES INLINE (`data`, a data URL) REQUIRES NOTHING: it travels inside its
 * entity and there is no blob to wait for. Until phase 2c of the attached photos (2026-09-24) the
 * 3D/360 walk cited its id anyway, so the client had to declare a photo that was in the payload as
 * a MISSING original. From phase 2c on the client turns an inline photo into a blob with a
 * reference at this boundary whenever it can (`buildServerImportPayload`, frontend
 * `import_export/local-atlas-to-server.js`); the ones it keeps inline (no id, a type outside the
 * allowlist, above the image cap) are exactly the ones this answers null for.
 *
 * A bare string is the legacy reference shape of a 3D/360 photo.
 *
 * @param {*} image - An item of an `images` array
 * @returns {string|null}
 */
function photoRef(image) {
  if (typeof image === 'string') return image || null;
  if (!image || typeof image !== 'object') return null;
  if (typeof image.data === 'string' && image.data.length > 0) return null;
  return typeof image.id === 'string' && image.id ? image.id : null;
}

/**
 * Original images required by the import. Generated symbol caches are not originals.
 *
 * The photos attached to a FEATURE (`properties.images`) are cited since phase 2c: a photo attached
 * after phase 2b is a blob with a reference, and an import that did not require it would publish a
 * feature pointing at a picture the atlas never received.
 *
 * @param {Object} payload - The bulk-import payload
 * @returns {Set<string>}
 */
export function importImageIds(payload) {
  const ids = new Set();
  const photos = images => {
    if (!Array.isArray(images)) return;
    for (const image of images) {
      const id = photoRef(image);
      if (id) ids.add(id);
    }
  };
  const attached = value => {
    if (!value || typeof value !== 'object') return;
    photos(value.images);
    for (const child of Object.values(value)) if (child && typeof child === 'object') attached(child);
  };
  for (const map of payload.maps || []) {
    for (const feature of map.features || []) {
      if (feature.feature_type === 'image') ids.add(feature.id);
      const marker = feature.properties?.markerSymbol;
      if (typeof marker === 'string' && marker.startsWith('custom:')) ids.add(marker.slice(7));
      photos(feature.properties?.images);
    }
    attached(map.cesium3dData);
    attached(map.streetview360Data);
  }
  const icons = payload.atlas?.settings?.customIcons;
  if (Array.isArray(icons)) for (const icon of icons) if (icon?.id) ids.add(icon.id);
  // THE SLIDE FIGURES HELD BY REFERENCE (owner's decision of 2026-09-26, `utils/figura-de-slide.js`):
  // a slide's HTML, and the notes of a map where one was pasted, cite a blob like a photo does.
  for (const map of payload.maps || []) for (const id of idsDeFigurasNoHtml(map.notes_description)) ids.add(id);
  for (const briefing of payload.briefings || []) {
    for (const slide of briefing?.slides || []) for (const id of idsDeFigurasNoHtml(slide?.content)) ids.add(id);
  }
  return ids;
}
