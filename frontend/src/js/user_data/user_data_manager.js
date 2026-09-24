// Path: js/user_data/user_data_manager.js

/**
 * @fileoverview User Data Manager for custom attributes and images on features.
 * Provides CRUD operations for user-defined data that persists with features.
 *
 * Architecture:
 * - Uses repository.js for persistence via getMapData/updateMapData
 * - Emits FEATURE_UPDATED events via EventBus for reactive UI updates
 * - Handles image compression and thumbnail generation client-side
 * - Extracts custom attributes from imported GeoJSON properties
 */

import { getMapData, updateFeature, getCurrentMapNameSync, getStorageTypeFromSource, getEventBus } from '@store';
import { IDUtils } from '@utils';
import { EventTypes, FeatureUpdateProperty } from '@events';
import {
    IMAGE_CONFIG,
    validateImageFile,
    processImageFile
} from '@utils/image_utils.js';
import { showWarning } from '@utils/toast_service.js';
import { sanitizeHtml } from '@sidebar/panels/notes-panel.js';
// By FILE, not through `@js/temporal` — the barrel there would drag the whole
// module in. The file itself reaches only temporal.constants (no imports),
// temporal.utils and temporal-model (which reaches geometry-utils, no imports),
// so nothing new and nothing circular: `temporal/` never imports `user_data/`.
import { TEMPORAL_SOURCE_KEYS } from '@js/temporal/temporal-import.js';

/**
 * System properties that should NOT be extracted as user attributes during import.
 * This list must be comprehensive to avoid polluting user attributes with internal data.
 * @constant {Set<string>}
 */
/**
 * Property keys that map to the feature description field (descricao).
 * Checked case-insensitively during import.
 * @constant {Set<string>}
 */
const DESCRIPTION_PROPERTY_KEYS = new Set([
    'descricao', 'descrição', 'description', 'desc',
]);

/**
 * Property keys that carry the feature's NAME in an imported file (KML `<name>`, a `nome` or
 * `name` column), checked case-insensitively. The first non-empty one becomes the feature's
 * `nome`; until 2026-09-23 all of them were dropped as system names and the feature was born
 * "Ponto #N", with the file's name nowhere.
 * @constant {Set<string>}
 */
const NAME_PROPERTY_KEYS = new Set(['nome', 'name']);

/**
 * Reserved names that an import reader CONSUMES into the feature (the validity window, the
 * trajectory), lowercase. Every OTHER reserved name found in a file is kept as a user attribute
 * under `<key>_importado` instead of being dropped (see `extractAttributesFromImport`).
 * @constant {Set<string>}
 */
const CONSUMED_ON_IMPORT_LOWER = new Set([
    ...TEMPORAL_SOURCE_KEYS,
    'temporalinicio', 'temporalfim', 'trajetoria', 'timespan',
]);

/** Suffix of a reserved imported key kept as a user attribute. */
const IMPORTED_KEY_SUFFIX = '_importado';

/** Description keys in the order they are tried: Portuguese (our own field) first. */
const DESCRIPTION_KEY_PRIORITY = Object.freeze([
    new Set(['descricao', 'descrição']),
    new Set(['description', 'desc']),
]);

/** Name keys in the order they are tried: `nome` (our own field) before `name`. */
const NAME_KEY_PRIORITY = Object.freeze([new Set(['nome']), new Set(['name'])]);

/** The marker our KMZ export puts on the balloon it GENERATES (`kml-balloon.js`). */
const BALAO_GERADO = 'data-ebgeo="balao"';

/**
 * The text of an imported description, or '' when it has none worth keeping.
 *
 * `@tmcw/togeojson` returns a CDATA description (every Google Earth file, and every KMZ this
 * product exports) as an OBJECT, `{ '@type': 'html', value }`, and `String()` of it is
 * "[object Object]", which is what every such feature got as its description until 2026-09-23.
 * A balloon our own export generated is not a description: the real one travels in the
 * ExtendedData `descricao`, and the balloon only repeats it with the name and the attributes.
 * @param {*} value
 * @returns {string}
 */
function textoDeDescricaoImportada(value) {
    let texto = value;
    if (texto && typeof texto === 'object') {
        texto = typeof texto.value === 'string' ? texto.value : '';
    }
    if (texto === null || texto === undefined) return '';
    texto = String(texto);
    return texto.includes(BALAO_GERADO) ? '' : texto;
}

const SYSTEM_PROPERTIES = new Set([
    // Core identifiers
    'id', 'nome', 'name', 'source', 'layerId', 'groupId',

    // Description variants (extracted separately during import)
    'descricao', 'descrição', 'description', 'desc',

    // Visual properties - common
    'color', 'outlinecolor', 'outlineColor', 'opacity', 'size', 'lineStyle',
    'fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth',

    // Visual properties - text
    'text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textAlign',
    'textColor', 'textOpacity', 'textHaloColor', 'textHaloWidth',
    'letterSpacing', 'lineHeight', 'textTransform',

    // Hatch pattern
    'hatchEnabled', 'hatchPattern', 'hatchColor', 'hatchAngle', 'hatchSpacing',
    'hatchLineWidth', 'hatchOpacity',

    // Measurement
    'measure', 'showMeasurement', 'measurementUnit',

    // Geometry data
    'baseCoordinates', 'coordinates', 'center', 'radius', 'radiusX', 'radiusY',
    'rotation', 'bearing', 'startAngle', 'endAngle',

    // Line/Arrow specific
    'profileData', 'elevationProfile', 'arrowType', 'arrowSize', 'arrowPosition',
    'startArrow', 'endArrow', 'lineType', 'dashArray',

    // Military symbols
    'symbolCode', 'sidc', 'symbolOptions', 'affiliation', 'echelon',
    'symbolModifiers', 'symbolSize', 'reinforced', 'reduced',

    // Coordination measures
    'measureType', 'measureCategory', 'measureSubtype',

    // Image features
    'imageUrl', 'imageData', 'imageBounds', 'imageOpacity', 'imageRotation',

    // LOS/Visibility
    'observerHeight', 'targetHeight', 'analysisRadius', 'processed',

    // Boundary/Front
    'boundaryType', 'frontType', 'frontStyle',

    // Circle/Ellipse
    'radiusMeters', 'semiMajor', 'semiMinor',

    // User data fields (to avoid recursion)
    'attributes', 'images',

    // Temporal module — the canonical fields and the containers the readers
    // flatten. The import-SOURCE attribute names are added below, DERIVED from
    // the importer, because a hand-copied excerpt knew 8 of the 26 names it was
    // supposed to mirror: the other 18 columns became the validity window AND
    // stayed on the feature as a duplicate user attribute.
    'temporalInicio', 'temporalFim', 'trajetoria', 'timespan',

    // GeoJSON standard
    'type', 'geometry', 'properties', 'features', 'bbox',

    // Mapbox/MapLibre internal
    'layer', 'state', 'extent', '_vectorTileFeature', '_pbf', '_geometry',
    '_keys', '_values', '_z', '_x', '_y',

    // Every attribute name the temporal importer consumes into the validity
    // window, DERIVED from `temporal/temporal-import.js` so the two lists cannot
    // drift again. A name added there is reserved here in the same commit.
    ...TEMPORAL_SOURCE_KEYS,
]);

/**
 * Case-folded index of `SYSTEM_PROPERTIES`, DERIVED so the two cannot drift.
 *
 * `validateAttributeKey` lowercases the key before looking it up, and the set it
 * looked into stores most names in camelCase, so the lookup could only ever hit
 * the handful of entries already spelled lowercase. A second hand-written list
 * would reintroduce exactly that gap the next time a name is added.
 * @constant {Set<string>}
 */
const SYSTEM_PROPERTIES_LOWER = new Set(
    [...SYSTEM_PROPERTIES].map(name => name.toLowerCase())
);

// IMAGE_CONFIG is imported from utilities/image_utils.js

/**
 * User Data Manager - Singleton instance for managing custom attributes and images.
 */
const userDataManager = {
    /**
     * Retrieves a feature from the current map's data.
     * @private
     * @param {string} featureId - Unique feature identifier
     * @param {string} featureType - Feature type in singular form ('polygon', 'point', etc.)
     * @returns {Promise<Object|null>} Feature object or null if not found
     */
    async _getFeature(featureId, featureType) {
        const mapName = getCurrentMapNameSync();
        if (!mapName) {
            console.warn('UserDataManager: No map currently loaded');
            return null;
        }

        const storageType = getStorageTypeFromSource(featureType);
        if (!storageType) {
            console.warn(`UserDataManager: Unknown feature type "${featureType}"`);
            return null;
        }

        const mapData = await getMapData(mapName);
        if (!mapData?.features?.[storageType]) {
            return null;
        }

        return mapData.features[storageType].find(f => f.properties?.id === featureId) || null;
    },

    /**
     * Updates a feature in the current map's data.
     * @private
     * @param {string} featureId - Unique feature identifier
     * @param {string} featureType - Feature type in singular form
     * @param {Function} updateFn - Function that receives feature and returns updated feature
     * @returns {Promise<Object|null>} Updated feature or null on failure
     */
    async _updateFeature(featureId, featureType, updateFn) {
        const mapName = getCurrentMapNameSync();
        if (!mapName) {
            console.warn('UserDataManager: No map currently loaded');
            return null;
        }

        const storageType = getStorageTypeFromSource(featureType);
        if (!storageType) {
            console.warn(`UserDataManager: Unknown feature type "${featureType}"`);
            return null;
        }

        const mapData = await getMapData(mapName);
        if (!mapData?.features?.[storageType]) {
            return null;
        }

        const featureIndex = mapData.features[storageType].findIndex(
            f => f.properties?.id === featureId
        );

        if (featureIndex === -1) {
            console.warn(`UserDataManager: Feature not found - ${featureType}:${featureId}`);
            return null;
        }

        // THE CHANGE IS APPLIED UNDER THE DOCUMENT LOCK, to the feature as stored THEN
        // (`transform`), never to the copy read above. That read happens outside the lock, and the
        // inbound path takes the same lock: a colleague's op applied in between was reverted by the
        // whole-feature write, and the patch carried the old value with an up-to-date base, so the
        // server accepted it and the colleague's edit vanished everywhere
        // (`frontend/tests/store/atributo-le-o-documento-sob-a-trava.repro.test.js`). The read above
        // only answers "does it exist". updateFn still runs exactly once, on a deep clone, so the
        // store keeps the OLD feature for `isFeatureEqual`.
        //
        // Persist AND log a sync op via the canonical update path (a direct updateMapData write
        // emitted only a LOCAL event, so attributes/photos never reached collaborators). Pass
        // preserveUserData:false so an intentionally-emptied attributes/images collection (removing
        // the last attribute/photo) is persisted instead of being restored from the old value.
        let updatedFeature = null;
        await updateFeature(storageType, mapData.features[storageType][featureIndex], mapName, {
            preserveUserData: false,
            transform: (current) => (updatedFeature = updateFn(current)),
        });
        return updatedFeature;
    },

    /**
     * Emits a FEATURE_UPDATED event via EventBus.
     * @private
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} property - FeatureUpdateProperty value
     * @param {Object} payload - Additional event payload
     */
    _emitUpdate(featureId, featureType, property, payload = {}) {
        try {
            const eventBus = getEventBus();
            eventBus.emit(EventTypes.FEATURE_UPDATED, {
                featureType,
                featureId,
                property,
                ...payload,
            });
        } catch (e) {
            // EventBus may not be initialized in some contexts (e.g., import before app ready)
            console.debug('UserDataManager: EventBus not ready -', e.message);
        }
    },

    // ===== ATTRIBUTES API =====

    /**
     * Gets all custom attributes for a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @returns {Promise<Object>} Attributes object (key-value pairs) or empty object
     */
    async getAttributes(featureId, featureType) {
        const feature = await this._getFeature(featureId, featureType);
        return feature?.properties?.attributes || {};
    },

    /**
     * Sets or updates a custom attribute on a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} key - Attribute key
     * @param {*} value - Attribute value (will be converted to string)
     * @returns {Promise<void>}
     */
    async setAttribute(featureId, featureType, key, value) {
        const validation = this.validateAttributeKey(key);
        if (!validation.valid) {
            console.warn(`UserDataManager: Invalid attribute key - ${validation.reason}`);
            return;
        }

        const stringValue = value === null || value === undefined ? '' : String(value);
        let changed = false;

        await this._updateFeature(featureId, featureType, (feature) => {
            if (!feature.properties.attributes) {
                feature.properties.attributes = {};
            }
            // Only flag a real change — re-setting the same value must NOT emit a fake update.
            if (feature.properties.attributes[key] !== stringValue) {
                feature.properties.attributes[key] = stringValue;
                changed = true;
            }
            return feature;
        });

        if (changed) {
            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.ATTRIBUTES, {
                key,
                value: stringValue,
                action: 'set',
            });
        }
        // Whether a change was written. False also when the store refused the write (lock, rank):
        // the change is applied under the document lock since 2026-09-24, so a refused write never
        // runs it and no FEATURE_UPDATED follows; the caller has to redraw from the store itself.
        return changed;
    },

    /**
     * Removes a custom attribute from a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} key - Attribute key to remove
     * @returns {Promise<boolean>} True if attribute was removed
     */
    async removeAttribute(featureId, featureType, key) {
        let removed = false;

        await this._updateFeature(featureId, featureType, (feature) => {
            if (feature.properties.attributes && key in feature.properties.attributes) {
                delete feature.properties.attributes[key];
                removed = true;
            }
            return feature;
        });

        if (removed) {
            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.ATTRIBUTES, {
                key,
                action: 'removed',
            });
        }

        return removed;
    },

    /**
     * Renames an attribute key in a SINGLE persistence write (delete old + set new).
     * Atomic — avoids the data-loss window of removeAttribute() + setAttribute().
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} oldKey - Existing attribute key
     * @param {string} newKey - New attribute key
     * @param {*} value - Value for the new key when the old one is no longer stored. When it is,
     *   its STORED value is carried over, not this one: the Attributes tab passes the value it drew,
     *   and a colleague may have changed it since (the tab does not redraw on a remote edit).
     *   Carrying the drawn value undid the colleague's value on every client and on the server
     *   (`frontend/tests/e2e-ui/browser-collab-renomear-atributo.repro.spec.js`).
     * @returns {Promise<boolean>} True if the rename was applied
     */
    async renameAttribute(featureId, featureType, oldKey, newKey, value) {
        const validation = this.validateAttributeKey(newKey);
        if (!validation.valid) {
            console.warn(`UserDataManager: Invalid attribute key - ${validation.reason}`);
            return false;
        }

        const stringValue = value === null || value === undefined ? '' : String(value);
        let renamed = false;

        await this._updateFeature(featureId, featureType, (feature) => {
            if (!feature.properties.attributes) {
                feature.properties.attributes = {};
            }
            let carried = stringValue;
            if (Object.hasOwn(feature.properties.attributes, oldKey)) {
                carried = feature.properties.attributes[oldKey];
                delete feature.properties.attributes[oldKey];
            }
            feature.properties.attributes[newKey] = carried;
            renamed = true;
            return feature;
        });

        if (renamed) {
            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.ATTRIBUTES, {
                key: newKey,
                value: stringValue,
                action: 'renamed',
            });
        }

        return renamed;
    },

    // ===== IMAGES API =====

    /**
     * Gets all images associated with a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @returns {Promise<Array>} Array of image objects
     */
    async getImages(featureId, featureType) {
        const feature = await this._getFeature(featureId, featureType);
        return feature?.properties?.images || [];
    },

    /**
     * Adds an image to a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {File} file - Image file to add
     * @returns {Promise<Object|null>} Created image object or null on failure
     */
    async addImage(featureId, featureType, file) {
        // Use shared validation utility.
        //
        // IT SPEAKS NOW. The refusal stopped at `console.warn`, so a picture the gate rejected
        // looked to the person exactly like a click that did nothing. The gallery that calls this
        // refuses first, with the same sentence, so this is the second line of defence for any
        // future caller rather than a duplicate toast.
        const validation = validateImageFile(file);
        if (!validation.valid) {
            console.warn(`UserDataManager: Invalid image file - ${validation.reason}`);
            showWarning(validation.reason);
            return null;
        }

        try {
            // Use shared processing utility
            const processedImage = await processImageFile(file);
            const imageId = IDUtils.generateUniqueId();

            const imageData = {
                id: imageId,
                name: file.name,
                type: file.type,
                size: file.size,
                data: processedImage.data,
                thumbnail: processedImage.thumbnail,
                addedAt: Date.now(),
            };

            await this._updateFeature(featureId, featureType, (feature) => {
                if (!feature.properties.images) {
                    feature.properties.images = [];
                }
                feature.properties.images.push(imageData);
                return feature;
            });

            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.IMAGES, {
                imageId,
                action: 'added',
            });

            return imageData;
        } catch (error) {
            console.error('UserDataManager: Error adding image -', error);
            return null;
        }
    },

    /**
     * Removes an image from a feature.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} imageId - Image identifier to remove
     * @returns {Promise<boolean>} True if image was removed
     */
    async removeImage(featureId, featureType, imageId) {
        let removed = false;

        await this._updateFeature(featureId, featureType, (feature) => {
            if (feature.properties.images) {
                const initialLength = feature.properties.images.length;
                feature.properties.images = feature.properties.images.filter(
                    img => img.id !== imageId
                );
                removed = feature.properties.images.length < initialLength;
            }
            return feature;
        });

        if (removed) {
            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.IMAGES, {
                imageId,
                action: 'removed',
            });
        }

        return removed;
    },

    /**
     * Updates the name of an image.
     * @param {string} featureId - Feature identifier
     * @param {string} featureType - Feature type (singular)
     * @param {string} imageId - Image identifier
     * @param {string} newName - New name for the image
     * @returns {Promise<Object|null>} Updated image object or null
     */
    async updateImageName(featureId, featureType, imageId, newName) {
        let updatedImage = null;

        await this._updateFeature(featureId, featureType, (feature) => {
            if (feature.properties.images) {
                const image = feature.properties.images.find(img => img.id === imageId);
                if (image) {
                    image.name = newName;
                    updatedImage = { ...image };
                }
            }
            return feature;
        });

        if (updatedImage) {
            this._emitUpdate(featureId, featureType, FeatureUpdateProperty.IMAGES, {
                imageId,
                action: 'updated',
            });
        }

        return updatedImage;
    },

    /**
     * Downloads an image to the user's device.
     * @param {Object} image - Image object with data and name
     */
    downloadImage(image) {
        if (!image?.data || !image?.name) {
            console.warn('UserDataManager: Invalid image for download');
            return;
        }

        const link = document.createElement('a');
        link.href = image.data;
        link.download = image.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    // Image processing is now handled by utilities/image_utils.js

    // ===== IMPORT UTILITIES =====

    /**
     * Extracts custom attributes from imported GeoJSON properties.
     * Filters out system properties, converts values to strings, and sanitizes HTML.
     * Description-like properties (descricao, description, desc) are extracted
     * separately and returned in the result for mapping to feature.properties.descricao.
     *
     * The first non-empty NAME (`nome`/`name`, any casing) is returned as `nome`, for the
     * caller to use as the feature's name. A later name key with the same value is the same
     * name written twice (our own KMZ export writes `<name>` and an ExtendedData `nome`) and is
     * consumed with it.
     *
     * A RESERVED key that no import reader consumes (an `ID`, `TYPE`, `NOME` column that was not
     * the name, `color`, `layer`...) is KEPT as a user attribute named `<key>_importado`, with a
     * numeric suffix when that name is taken, instead of being dropped as it was until
     * 2026-09-23. It never lands on the reserved key itself, so no system property is written.
     * The keys a reader does consume (the temporal columns, the trajectory) are still skipped.
     * @param {Object} importedProperties - Properties from imported GeoJSON feature
     * @returns {{ attributes: Object, descricao: string, nome: (string|undefined) }} Extracted
     *   user attributes, description, and the file's name for the feature when it had one
     */
    extractAttributesFromImport(importedProperties) {
        if (!importedProperties || typeof importedProperties !== 'object') {
            return { attributes: {}, descricao: '' };
        }

        const extracted = {};
        let descricao = '';
        let nome;

        /** The first free attribute name for a reserved imported key. */
        const nomeLivre = (key) => {
            const base = `${key}${IMPORTED_KEY_SUFFIX}`;
            let candidato = base;
            for (let n = 2; Object.hasOwn(extracted, candidato)
                || Object.hasOwn(importedProperties, candidato); n++) {
                candidato = `${base}_${n}`;
            }
            return candidato;
        };

        // THE DESCRIPTION AND THE NAME ARE CHOSEN FIRST, Portuguese keys before foreign ones:
        // `descricao`/`nome` are what our own KMZ writes in ExtendedData, the exact values, while
        // `description`/`name` there are the generated balloon and the placemark title (which is
        // the label text of a labelled point). For a foreign file only one spelling usually
        // exists, and the order does not matter.
        const entradas = Object.entries(importedProperties);
        for (const grupo of DESCRIPTION_KEY_PRIORITY) {
            if (descricao) break;
            for (const [key, value] of entradas) {
                if (!grupo.has(key.toLowerCase())) continue;
                const texto = textoDeDescricaoImportada(value);
                if (texto !== '') {
                    descricao = sanitizeHtml(texto);
                    break;
                }
            }
        }
        for (const grupo of NAME_KEY_PRIORITY) {
            if (nome !== undefined) break;
            for (const [key, value] of entradas) {
                if (!grupo.has(key.toLowerCase()) || value === null || value === undefined
                    || typeof value === 'object') continue;
                const texto = String(value).trim();
                if (texto !== '') {
                    nome = texto;
                    break;
                }
            }
        }

        for (const [key, value] of entradas) {
            // Description-like properties fill descricao (chosen above) and are never attributes
            if (DESCRIPTION_PROPERTY_KEYS.has(key.toLowerCase())) {
                continue;
            }

            // Handle special case: imported property named "attributes" that isn't
            // an object. This MUST precede the system skip: 'attributes' is itself
            // listed in SYSTEM_PROPERTIES (to avoid recursion on the object form),
            // so while the skip ran first this whole branch was unreachable and an
            // imported scalar named `attributes` was dropped without a trace.
            // Case-INSENSITIVE, like the system skip below it: were it not, an
            // imported scalar named `Attributes` would now fall through to that
            // skip and be dropped without a trace, which is the very loss this
            // branch exists to prevent.
            if (key.toLowerCase() === 'attributes' && value !== null && value !== undefined
                && typeof value !== 'object') {
                // Sanitize to prevent XSS from imported data
                extracted['attributes_imported'] = sanitizeHtml(String(value));
                continue;
            }

            // The file's NAME for the feature (chosen above): consumed, and so is the same name
            // written twice (our own KMZ: `<name>` plus ExtendedData `nome`) or an empty one.
            const lower = key.toLowerCase();
            const escalar = value !== null && value !== undefined && typeof value !== 'object';
            if (NAME_PROPERTY_KEYS.has(lower) && escalar) {
                const texto = String(value).trim();
                if (texto === nome || texto === '') continue;
            }

            // Reserved names, case-INSENSITIVELY (a column spelled `Begin`, `INICIO` or
            // `fillcolor` must not become a user attribute under that very name). A reserved
            // name a reader consumes is skipped; any other one is KEPT under `<key>_importado`,
            // because dropping it lost an `ID`, `TYPE` or second `NOME` column without a trace.
            if (SYSTEM_PROPERTIES_LOWER.has(lower)) {
                if (CONSUMED_ON_IMPORT_LOWER.has(lower) || !escalar) continue;
                extracted[nomeLivre(key)] = sanitizeHtml(String(value));
                continue;
            }

            // Skip properties starting with underscore (internal)
            if (key.startsWith('_')) {
                continue;
            }

            // Skip null/undefined values
            if (value === null || value === undefined) {
                continue;
            }

            // Skip nested objects/arrays (not supported as attribute values)
            if (typeof value === 'object') {
                continue;
            }

            // Convert to string and sanitize to prevent XSS from imported data
            extracted[key] = sanitizeHtml(String(value));
        }

        return { attributes: extracted, descricao, nome };
    },

    // ===== VALIDATION =====

    /**
     * Validates an attribute key.
     * @param {string} key - Attribute key to validate
     * @returns {Object} Validation result with valid (boolean) and reason (string)
     */
    validateAttributeKey(key) {
        if (!key || typeof key !== 'string') {
            return { valid: false, reason: 'Chave vazia ou inválida' };
        }

        const trimmed = key.trim();
        if (trimmed.length === 0) {
            return { valid: false, reason: 'Chave vazia' };
        }

        if (trimmed.length > 50) {
            return { valid: false, reason: 'Chave muito longa (máximo 50 caracteres)' };
        }

        // Check for system property conflict. The lookup lowercases the key, so
        // it MUST be made against a lowercased index: `SYSTEM_PROPERTIES` stores
        // 'fillColor', 'layerId', 'groupId', 'fontSize' and dozens more in
        // camelCase, and comparing a lowercased key against them guaranteed the
        // miss. Every camelCase entry validated as free, and the user could
        // create an attribute that shadows a real visual property.
        if (SYSTEM_PROPERTIES_LOWER.has(trimmed.toLowerCase())) {
            return { valid: false, reason: 'Chave reservada pelo sistema' };
        }

        // Allow alphanumeric, underscore, hyphen, space, and accented characters
        const validKeyRegex = /^[\p{L}\p{N}_\- ]+$/u;
        if (!validKeyRegex.test(trimmed)) {
            return { valid: false, reason: 'Chave contém caracteres inválidos' };
        }

        return { valid: true };
    },

    /**
     * Validates an image file.
     * Delegates to shared utility function.
     * @param {File} file - File to validate
     * @returns {Object} Validation result with valid (boolean) and reason (string)
     */
    validateImageFile(file) {
        return validateImageFile(file);
    },

    /**
     * Gets the list of system properties (for debugging/testing).
     * @returns {Set<string>} Set of system property names
     */
    getSystemProperties() {
        return new Set(SYSTEM_PROPERTIES);
    },

    /**
     * Gets image configuration (for UI display).
     * @returns {Object} Image configuration
     */
    getImageConfig() {
        return { ...IMAGE_CONFIG };
    },
};

export default userDataManager;
