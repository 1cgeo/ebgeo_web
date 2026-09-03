// Path: js/import_export/kmz/kmz-feature-mapper.js

/**
 * @fileoverview Maps one EBGeo feature to its KML representation, resolving
 * whatever binary assets it needs along the way.
 *
 * @module import_export/kmz/kmz-feature-mapper
 */

import {
    buildGeometry,
    dashPatternToMeters,
    fitDashPattern,
    lineLength,
    imageLatLonBox,
    LINE_STYLE_DASH_PATTERNS,
} from './kml-geometry.js';
import {
    buildLineStyle,
    buildPolyStyle,
    buildIconStyle,
    buildLabelStyle,
    toKmlColor,
    styleSignature,
    collectDegradedStyle,
    iconScale,
} from './kml-style.js';
import { buildDescription, buildExtendedData } from './kml-balloon.js';
import { buildPlacemark, buildGroundOverlay } from './kml-document.js';
import {
    resolvePointIcon,
    resolveStoredImage,
    collectPhotos,
    POINT_ICON_NATIVE_PX,
} from './kmz-assets.js';
import { classifyFeatureType, FeatureCategory } from './kmz-feature-types.js';

/**
 * Zoom used to size dash patterns when a feature carries no creation zoom.
 * Dash lengths are defined in screen pixels, so they need some reference scale.
 */
const DASH_REFERENCE_ZOOM = 15;

/** Reference label size, in pixels, that maps to a KML label scale of 1. */
const LABEL_BASE_PX = 16;

/**
 * Extracts a representative latitude for a feature, used to scale dash
 * patterns and image extents.
 *
 * @param {Object} geometry - GeoJSON geometry
 * @returns {number} Latitude in degrees, or 0 when undeterminable
 */
function representativeLatitude(geometry) {
    const coords = geometry?.coordinates;
    if (!coords) return 0;

    let node = coords;
    // Descend into nested coordinate arrays until a [lng, lat] pair is reached.
    while (Array.isArray(node) && Array.isArray(node[0])) node = node[0];

    return Array.isArray(node) && Number.isFinite(node[1]) ? node[1] : 0;
}

/**
 * Resolves the dash pattern, in meters, for a feature's line style.
 *
 * @param {Object} properties - Feature properties
 * @param {Object} geometry - GeoJSON geometry
 * @param {boolean} simulateDash - Whether dash simulation is enabled
 * @returns {Array<number>|undefined} Dash pattern in meters, or undefined for solid
 */
function resolveDashMeters(properties, geometry, simulateDash) {
    if (!simulateDash) return undefined;

    const pattern = LINE_STYLE_DASH_PATTERNS[properties?.lineStyle];
    if (!pattern) return undefined;

    // Line and polygon features do not record the zoom they were drawn at, so
    // this is only a starting guess — fitDashPattern() below corrects it.
    const zoom = Number.isFinite(properties.createdAtZoom)
        ? properties.createdAtZoom
        : DASH_REFERENCE_ZOOM;

    const meters = dashPatternToMeters(pattern, representativeLatitude(geometry), zoom);
    if (meters.length < 2) return undefined;

    const fitted = fitDashPattern(meters, measureGeometryLength(geometry));
    return fitted.length >= 2 ? fitted : undefined;
}

/**
 * Total drawable length of a geometry, used to normalize dash patterns.
 *
 * @param {Object} geometry - GeoJSON geometry
 * @returns {number} Length in meters
 */
function measureGeometryLength(geometry) {
    if (!geometry) return 0;

    switch (geometry.type) {
        case 'LineString':
            return lineLength(geometry.coordinates);
        case 'MultiLineString':
            return (geometry.coordinates || []).reduce((sum, l) => sum + lineLength(l), 0);
        case 'Polygon':
            return (geometry.coordinates || []).reduce((sum, r) => sum + lineLength(r), 0);
        case 'MultiPolygon':
            return (geometry.coordinates || [])
                .reduce((sum, rings) => sum + rings.reduce((s, r) => s + lineLength(r), 0), 0);
        default:
            return 0;
    }
}

/**
 * Human-readable notes about style that KML cannot reproduce.
 *
 * @param {Object} properties - Feature properties
 * @returns {Array<string>} Notes in pt-BR for the balloon
 */
function degradationNotes(properties) {
    const notes = [];
    if (properties?.hatchEnabled === true) {
        notes.push('Hachura não é suportada pelo KML — exibida como preenchimento sólido.');
    }
    return notes;
}

/**
 * Builds the shared Placemark text blocks for a feature.
 *
 * @param {Object} feature - GeoJSON feature
 * @param {string} featureType - Source feature type
 * @param {Array<{href: string, name: string}>} photos - Photo references
 * @returns {{description: string, extendedData: string}} Prebuilt elements
 */
function buildTextBlocks(feature, featureType, photos) {
    const properties = feature.properties || {};
    const extras = collectDegradedStyle(properties);

    // A text feature's content lives in `text`, not `nome`. Record it as an
    // attribute too so the string survives re-import into other GIS tools.
    if (featureType === 'text' && properties.text) {
        extras.texto = properties.text;
    }

    return {
        description: buildDescription({
            properties,
            photos,
            notes: degradationNotes(properties),
        }),
        extendedData: buildExtendedData(properties, extras),
    };
}

/**
 * Maps a single feature to KML, registering any assets it needs.
 *
 * @param {Object} params - Mapping inputs
 * @param {Object} params.feature - GeoJSON feature
 * @param {string} params.featureType - EBGeo storage type
 * @param {import('./kml-document.js').StyleRegistry} params.styles - Style registry
 * @param {import('./kmz-assets.js').AssetRegistry} params.assets - Asset registry
 * @param {Object} [params.options={}] - Export options
 * @param {boolean} [params.options.simulateDash=true] - Whether to slice dashed lines
 * @param {boolean} [params.options.includePhotos=true] - Whether to embed attachment photos
 * @returns {Promise<string|null>} KML element, or null when nothing is drawable
 */
export async function mapFeatureToKml({ feature, featureType, styles, assets, options = {} }) {
    if (!feature?.geometry) return null;

    const { simulateDash = true, includePhotos = true } = options;
    const properties = feature.properties || {};
    const visible = properties.visivel !== false;

    const photos = includePhotos ? collectPhotos(assets, feature) : [];
    const { description, extendedData } = buildTextBlocks(feature, featureType, photos);

    const category = classifyFeatureType(featureType);

    if (category === FeatureCategory.SKIPPED) return null;

    if (category === FeatureCategory.IMAGE) {
        return mapImageFeature({ feature, assets, description, extendedData, visible });
    }

    if (category === FeatureCategory.SYMBOL) {
        return mapSymbolFeature({
            feature, featureType, styles, assets, description, extendedData, visible,
        });
    }

    if (category === FeatureCategory.POINT) {
        return mapPointFeature({
            feature, styles, assets, description, extendedData, visible,
        });
    }

    if (category === FeatureCategory.TEXT) {
        return mapTextFeature({ feature, styles, description, extendedData, visible });
    }

    const dashMeters = resolveDashMeters(properties, feature.geometry, simulateDash);
    const geometry = buildGeometry(feature.geometry, { dashMeters });
    if (!geometry) return null;

    const body = category === FeatureCategory.AREA
        ? buildLineStyle(properties) + buildPolyStyle(properties)
        : buildLineStyle(properties);

    const styleId = styles.register(styleSignature(featureType, properties), body);

    return buildPlacemark({
        name: properties.nome,
        styleId,
        description,
        extendedData,
        geometry,
        visible,
    });
}

/**
 * Maps a point feature, resolving its marker icon and optional label.
 *
 * @param {Object} params - Mapping inputs
 * @returns {Promise<string|null>} KML Placemark
 */
async function mapPointFeature({ feature, styles, assets, description, extendedData, visible }) {
    const properties = feature.properties || {};

    const geometry = buildGeometry(feature.geometry);
    if (!geometry) return null;

    const icon = await resolvePointIcon(assets, properties);

    const size = Number.isFinite(properties.size) ? properties.size : 10;
    const iconXml = buildIconStyle({
        href: icon?.href,
        scale: iconScale(size * 2, POINT_ICON_NATIVE_PX),
        opacity: Number.isFinite(properties.opacity) ? properties.opacity : 1,
    });

    const showLabel = properties.showLabel === true && Boolean(properties.labelText);
    const labelXml = showLabel
        ? buildLabelStyle({
            color: properties.labelColor || '#ffffff',
            scale: (properties.labelSize || LABEL_BASE_PX) / LABEL_BASE_PX,
        })
        // Without this, Google Earth prints every point's name next to its icon.
        : '<LabelStyle><scale>0</scale></LabelStyle>';

    const styleId = styles.register(
        styleSignature('point', properties, icon?.href || 'none'),
        iconXml + labelXml
    );

    return buildPlacemark({
        name: showLabel ? properties.labelText : properties.nome,
        styleId,
        description,
        extendedData,
        geometry,
        visible,
    });
}

/**
 * Maps a text feature to a label-only Placemark.
 *
 * Rotation and background boxes have no KML equivalent; they are recorded in
 * the balloon rather than silently dropped.
 *
 * @param {Object} params - Mapping inputs
 * @returns {string|null} KML Placemark
 */
function mapTextFeature({ feature, styles, description, extendedData, visible }) {
    const properties = feature.properties || {};

    const geometry = buildGeometry(feature.geometry);
    if (!geometry) return null;

    const size = Number.isFinite(properties.size) ? properties.size : LABEL_BASE_PX;
    const body = '<IconStyle><scale>0</scale></IconStyle>'
        + buildLabelStyle({
            color: properties.color || '#000000',
            scale: size / LABEL_BASE_PX,
        });

    const styleId = styles.register(styleSignature('text', properties), body);

    return buildPlacemark({
        name: properties.text || properties.nome,
        styleId,
        description,
        extendedData,
        geometry,
        visible,
    });
}

/**
 * Maps a military symbol, coordination measure or declination diagram.
 *
 * @param {Object} params - Mapping inputs
 * @returns {Promise<string|null>} KML Placemark
 */
async function mapSymbolFeature({
    feature, featureType, styles, assets, description, extendedData, visible,
}) {
    const properties = feature.properties || {};

    const geometry = buildGeometry(feature.geometry);
    if (!geometry) return null;

    const asset = await resolveStoredImage(assets, properties.id, {
        keyPrefix: featureType,
        regenerate: () => regenerateSymbol(featureType, properties),
    });

    // O `<scale>` do KML e sobre o tamanho NATIVO do arquivo, e o arquivo nem sempre tem o
    // tamanho logico da feicao: a medida de coordenacao rasteriza acima para o simbolo nao
    // borrar quando o zoom amplia o icone, e grava a razao em `pixelRatio`. Sem multiplicar
    // por ela, o `iconScale` dava 1 e o Google Earth desenhava o bitmap inteiro, ou seja o
    // icone saia `pixelRatio` vezes maior. Feicao sem a chave vale 1, como sempre foi.
    const razaoDePixel = Number.isFinite(properties.pixelRatio) && properties.pixelRatio > 0
        ? properties.pixelRatio
        : 1;
    const larguraLogica = properties.width || POINT_ICON_NATIVE_PX;
    const nativeWidth = asset?.width || larguraLogica * razaoDePixel;
    const desired = larguraLogica
        * (Number.isFinite(properties.size) ? properties.size : 1);

    const body = buildIconStyle({
        href: asset?.href,
        scale: iconScale(desired, nativeWidth),
        heading: properties.rotation,
        opacity: Number.isFinite(properties.opacity) ? properties.opacity : 1,
    }) + '<LabelStyle><scale>0</scale></LabelStyle>';

    const styleId = styles.register(
        styleSignature(featureType, properties, asset?.href || 'none'),
        body
    );

    return buildPlacemark({
        name: properties.nome,
        styleId,
        description,
        extendedData,
        geometry,
        visible,
    });
}

/**
 * Regenerates a symbol PNG when none was persisted for the feature.
 * The generators are lazily imported so they stay out of the export chunk
 * unless a fallback is actually needed.
 *
 * @param {string} featureType - EBGeo storage type
 * @param {Object} properties - Feature properties
 * @returns {Promise<{blob: Blob, width: number, height: number}|null>} Generated image
 */
async function regenerateSymbol(featureType, properties) {
    try {
        if (featureType === 'military_symbol') {
            const { MilitarySymbolGenerator } = await import(
                '@js/military_tools/military_symbol_tool/military_symbol_generator.js'
            );
            return await new MilitarySymbolGenerator().generateSymbolBlob(properties);
        }

        if (featureType === 'coordination_measure') {
            const { CoordinationMeasureGenerator } = await import(
                '@js/military_tools/coordination_measure_tool/coordination_measure_generator.js'
            );
            return await new CoordinationMeasureGenerator().generateSymbolBlob(properties);
        }
    } catch (error) {
        console.warn(`KMZ export: could not regenerate ${featureType} symbol`, error);
    }

    return null;
}

/**
 * Maps an image feature to a GroundOverlay, falling back to a marker when the
 * ground extent cannot be determined.
 *
 * @param {Object} params - Mapping inputs
 * @returns {Promise<string|null>} KML element
 */
async function mapImageFeature({ feature, assets, description, extendedData, visible }) {
    const properties = feature.properties || {};

    const asset = await resolveStoredImage(assets, properties.id, { keyPrefix: 'image' });
    if (!asset) return null;

    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates)) return null;

    const box = imageLatLonBox({
        lng: coordinates[0],
        lat: coordinates[1],
        width: properties.width,
        height: properties.height,
        size: properties.size,
        rotation: properties.rotation,
        createdAtZoom: properties.createdAtZoom,
    });

    if (!box) {
        // No usable extent: keep the image reachable as a marker rather than
        // dropping the feature from the export entirely.
        return buildPlacemark({
            name: properties.nome || 'Imagem',
            description,
            extendedData,
            geometry: buildGeometry(feature.geometry),
            visible,
        });
    }

    return buildGroundOverlay({
        name: properties.nome || 'Imagem',
        href: asset.href,
        box,
        color: toKmlColor('#ffffff', Number.isFinite(properties.opacity) ? properties.opacity : 1),
        visible,
        description,
        extendedData,
    });
}
