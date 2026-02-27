// Path: js/search/search-bar.search-providers.js

/**
 * @fileoverview Search providers for the search bar.
 * Extracted from search-bar.component.js for better organization.
 * Each provider handles a specific search source.
 * @module search/search-bar.search-providers
 */

import config from '../config.js';
import { getCurrentMapFeatures } from '../store/feature.operations.js';
import { getAllStorageTypes, getFeatureDisplayNameFromStorage } from '../store/store.constants.js';
import { tryParseCoordinates, formatCoordinates } from '../utilities/coordinate_converter.js';
import { MAX_RESULTS } from './search-bar.icons.js';

// ============================================================================
// COORDINATE SEARCH
// ============================================================================

/**
 * Searches for coordinates in the query string.
 * Auto-detects coordinate format (Lat/Long, DMS, UTM, MGRS).
 * @param {string} query - Search query
 * @returns {Promise<Array>} Search results
 */
export async function searchCoordinates(query) {
    try {
        const parsed = await tryParseCoordinates(query);
        if (parsed) {
            // Format the coordinates for display
            const formattedCoords = await formatCoordinates(parsed.lat, parsed.lng, parsed.format);

            return [{
                type: 'coordinate',
                name: formattedCoords,
                description: `Coordenada ${parsed.formatLabel}`,
                coordinates: [parsed.lng, parsed.lat],
                format: parsed.format,
                formatLabel: parsed.formatLabel,
                original: {
                    lat: parsed.lat,
                    lng: parsed.lng,
                    format: parsed.format,
                    formatLabel: parsed.formatLabel
                }
            }];
        }
    } catch (error) {
        console.warn('[SearchProviders] Error parsing coordinates:', error);
    }
    return [];
}

// ============================================================================
// LOCAL FEATURES SEARCH
// ============================================================================

/**
 * Checks if a feature matches the search query.
 * @param {Object} feature - GeoJSON feature
 * @param {string} normalizedQuery - Lowercase search query
 * @returns {Object|null} Match info with field name, or null if no match
 */
function featureMatchesQuery(feature, normalizedQuery) {
    const props = feature.properties;
    if (!props) return null;

    // Check name/nome
    const name = props.name || props.nome || '';
    if (name.toLowerCase().includes(normalizedQuery)) {
        return { field: 'nome' };
    }

    // Check description/descricao
    const description = props.description || props.descricao || '';
    if (description.toLowerCase().includes(normalizedQuery)) {
        return { field: 'descrição' };
    }

    // Check attributes object
    if (props.attributes && typeof props.attributes === 'object') {
        for (const [key, value] of Object.entries(props.attributes)) {
            if (value && typeof value === 'string' && value.toLowerCase().includes(normalizedQuery)) {
                return { field: `atributo: ${key}` };
            }
        }
    }

    return null;
}

/**
 * Gets center coordinates of a feature.
 * @param {Object} feature - GeoJSON feature
 * @returns {Array|null} [lng, lat] or null
 */
function getFeatureCenter(feature) {
    const geom = feature.geometry;
    if (!geom) return null;

    if (geom.type === 'Point') {
        return geom.coordinates;
    }

    // Calculate centroid for other geometry types
    if (geom.type === 'Polygon' && geom.coordinates[0]) {
        const coords = geom.coordinates[0];
        const sum = coords.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
        return [sum[0] / coords.length, sum[1] / coords.length];
    }

    if (geom.type === 'LineString' && geom.coordinates.length > 0) {
        const mid = Math.floor(geom.coordinates.length / 2);
        return geom.coordinates[mid];
    }

    return null;
}

/**
 * Searches local features from the store.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Search results
 */
export async function searchLocalFeatures(query) {
    const results = [];
    const normalizedQuery = query.toLowerCase();

    try {
        const allFeatures = await getCurrentMapFeatures();
        const storageTypes = getAllStorageTypes();

        for (const storageType of storageTypes) {
            const features = allFeatures[storageType] || [];

            for (const feature of features) {
                const matchInfo = featureMatchesQuery(feature, normalizedQuery);
                if (matchInfo) {
                    const name = feature.properties?.name || feature.properties?.nome || 'Sem nome';
                    results.push({
                        type: 'feature',
                        subtype: storageType,
                        name: name,
                        layer: getFeatureDisplayNameFromStorage(storageType),
                        matchedField: matchInfo.field,
                        coordinates: getFeatureCenter(feature),
                        feature: feature,
                    });

                    if (results.length >= MAX_RESULTS.features) {
                        return results;
                    }
                }
            }
        }
    } catch (error) {
        console.warn('[SearchProviders] Error searching local features:', error);
    }

    return results;
}

// ============================================================================
// 3D MODELS SEARCH
// ============================================================================

/**
 * Searches 3D models from config.
 * @param {string} query - Search query
 * @returns {Array} Search results
 */
export function search3DModels(query) {
    if (!config.tilesets || config.tilesets.length === 0) {
        return [];
    }

    const normalizedQuery = query.toLowerCase();

    return config.tilesets
        .filter(tileset =>
            tileset.name?.toLowerCase().includes(normalizedQuery) ||
            tileset.keywords?.some(kw => kw.toLowerCase().includes(normalizedQuery))
        )
        .slice(0, MAX_RESULTS.models3d)
        .map(tileset => ({
            type: '3d-model',
            name: tileset.name,
            tilesetId: tileset.id,
            coordinates: tileset.locate ? [tileset.locate.lon, tileset.locate.lat] : null,
            dataCaptura: tileset.data_captura,
        }));
}

// ============================================================================
// STREETVIEW MARKERS SEARCH
// ============================================================================

/**
 * Searches streetview projects from the API service cache.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Search results
 */
export async function searchStreetViewMarkers(query) {
    try {
        const { getCachedProjects, fetchProjects } = await import('../street_view_tool/streetview-api.service.js');

        // Use cache first, fetch if empty
        const projects = getCachedProjects() || await fetchProjects();
        if (!projects || projects.length === 0) return [];

        const normalizedQuery = query.toLowerCase();

        return projects
            .filter(p =>
                p.name?.toLowerCase().includes(normalizedQuery) ||
                p.keywords?.some(kw => kw.toLowerCase().includes(normalizedQuery))
            )
            .slice(0, MAX_RESULTS.streetview)
            .map(p => ({
                type: 'streetview-marker',
                name: p.name,
                markerId: p.id,
                coordinates: p.center ? [p.center.lon, p.center.lat] : null,
                dataCaptura: p.captureDate || null,
            }));
    } catch {
        return [];
    }
}

// ============================================================================
// API SEARCH
// ============================================================================

/**
 * Searches external API.
 * @param {string} query - Search query
 * @param {maplibregl.Map} map - Map instance for center coordinates
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<Array>} Search results
 */
export async function searchAPI(query, map, signal) {
    const center = map.getCenter();
    const url = `${config.search.apiUrl}?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}`;

    const response = await fetch(url, { signal });

    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data
        .filter(item => item.nome && item.longitude && item.latitude)
        .slice(0, MAX_RESULTS.places)
        .map(item => ({
            type: 'place',
            name: item.nome,
            description: `${item.municipio || ''}, ${item.estado || ''}`.trim().replace(/^,|,$/g, ''),
            coordinates: [item.longitude, item.latitude],
            original: item,
        }));
}
