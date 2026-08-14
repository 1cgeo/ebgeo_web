// Path: js/search/search-bar.search-providers.js

/**
 * @fileoverview Search providers for the search bar.
 * Each provider handles a specific search source.
 */

import config from '@js/config.js';
import { getFirstPersonScenes } from '@js/first_person_3d_tool/scene-config.service.js';
import { getCurrentMapFeatures } from '@store/feature.operations.js';
import { getAllMapNamesStore, getCurrentMapNameSync } from '@store/map.operations.js';
import { getAllStorageTypes, getFeatureDisplayNameFromStorage } from '@store/store.constants.js';
import { tryParseCoordinates, formatCoordinates } from '@utils/coordinate_converter.js';
import { MAX_RESULTS } from './search-bar.icons.js';

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
 * Searches features in a single map.
 * @param {string} mapName - Map name to search
 * @param {string} normalizedQuery - Lowercase search query
 * @param {boolean} isCurrentMap - Whether this is the active map
 * @param {number} maxResults - Maximum results to collect
 * @returns {Promise<Array>} Search results
 */
async function searchFeaturesInMap(mapName, normalizedQuery, isCurrentMap, maxResults) {
    const results = [];
    const allFeatures = await getCurrentMapFeatures(mapName);
    const storageTypes = getAllStorageTypes();

    for (const storageType of storageTypes) {
        const features = allFeatures[storageType] || [];

        for (const feature of features) {
            const matchInfo = featureMatchesQuery(feature, normalizedQuery);
            if (matchInfo) {
                const name = feature.properties?.name || feature.properties?.nome || 'Sem nome';
                const typeLabel = getFeatureDisplayNameFromStorage(storageType);

                results.push({
                    type: 'feature',
                    subtype: storageType,
                    name: name,
                    layer: isCurrentMap ? typeLabel : `${typeLabel} · ${mapName}`,
                    matchedField: matchInfo.field,
                    coordinates: getFeatureCenter(feature),
                    feature: feature,
                    mapName: isCurrentMap ? null : mapName,
                });

                if (results.length >= maxResults) {
                    return results;
                }
            }
        }
    }

    return results;
}

/**
 * Searches local features from the store across all maps.
 * Current map results appear first, followed by other maps.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Search results
 */
export async function searchLocalFeatures(query) {
    const normalizedQuery = query.toLowerCase();
    const maxTotal = MAX_RESULTS.features;

    // Search current map first (priority)
    let results = [];
    try {
        results = await searchFeaturesInMap(
            getCurrentMapNameSync(), normalizedQuery, true, maxTotal
        );
    } catch (error) {
        console.warn('[SearchProviders] Error searching current map features:', error);
    }

    if (results.length >= maxTotal) {
        return results;
    }

    // Search remaining maps
    try {
        const allMapNames = await getAllMapNamesStore();
        const currentMap = getCurrentMapNameSync();

        for (const mapName of allMapNames) {
            if (mapName === currentMap) continue;

            const remaining = maxTotal - results.length;
            const mapResults = await searchFeaturesInMap(
                mapName, normalizedQuery, false, remaining
            );
            results.push(...mapResults);

            if (results.length >= maxTotal) {
                return results.slice(0, maxTotal);
            }
        }
    } catch (error) {
        console.warn('[SearchProviders] Error searching other maps:', error);
    }

    return results;
}

/**
 * Searches 3D products from config: Cesium tilesets plus first-person (Gaussian
 * splatting) scenes. Both come back as `'3d-model'` so they keep the same icon
 * and the same `data-type` styling in the dropdown; the `viewer` field is the
 * discriminator that tells the click handler which viewer to open —
 * 'cesium' carries `tilesetId`, 'firstPerson' carries `sceneId`.
 *
 * Each source is capped at MAX_RESULTS.models3d on its own, so a long tileset
 * list can never crowd the scenes out of the dropdown (and vice versa).
 *
 * @param {string} query - Search query
 * @returns {Array} Search results
 */
export function search3DModels(query) {
    const normalizedQuery = query.toLowerCase();

    return [
        ...searchTilesets3D(normalizedQuery),
        ...searchFirstPersonScenes(normalizedQuery)
    ];
}

/**
 * Searches Cesium 3D tilesets from config.
 * @param {string} normalizedQuery - Lowercase search query
 * @returns {Array} Search results
 */
function searchTilesets3D(normalizedQuery) {
    if (!config.tilesets || config.tilesets.length === 0) {
        return [];
    }

    return config.tilesets
        .filter(tileset =>
            tileset.name?.toLowerCase().includes(normalizedQuery) ||
            tileset.keywords?.some(kw => kw.toLowerCase().includes(normalizedQuery))
        )
        .slice(0, MAX_RESULTS.models3d)
        .map(tileset => ({
            type: '3d-model',
            viewer: 'cesium',
            name: tileset.name,
            tilesetId: tileset.id,
            coordinates: tileset.locate ? [tileset.locate.lon, tileset.locate.lat] : null,
            dataCaptura: tileset.data_captura,
        }));
}

/**
 * Searches first-person (Gaussian splatting) scenes from config.
 * Returns an empty array when the module is disabled or has no scenes.
 * @param {string} normalizedQuery - Lowercase search query
 * @returns {Array} Search results
 */
function searchFirstPersonScenes(normalizedQuery) {
    return getFirstPersonScenes()
        .filter(scene =>
            scene.name?.toLowerCase().includes(normalizedQuery) ||
            scene.keywords?.some(kw => kw.toLowerCase().includes(normalizedQuery))
        )
        .slice(0, MAX_RESULTS.models3d)
        .map(scene => ({
            type: '3d-model',
            viewer: 'firstPerson',
            name: scene.name,
            sceneId: scene.id,
            coordinates: scene.locate ? [scene.locate.lon, scene.locate.lat] : null,
            dataCaptura: scene.data_captura || null,
        }));
}

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
        .filter(item =>
            item.nome &&
            item.longitude != null && item.longitude !== '' && !isNaN(item.longitude) &&
            item.latitude != null && item.latitude !== '' && !isNaN(item.latitude)
        )
        .slice(0, MAX_RESULTS.places)
        .map(item => ({
            type: 'place',
            name: item.nome,
            description: `${item.municipio || ''}, ${item.estado || ''}`.trim().replace(/^,|,$/g, ''),
            coordinates: [item.longitude, item.latitude],
            original: item,
        }));
}
