// Path: js/sidebar/components/feature-location-section.js

/**
 * @fileoverview Location section component for the feature panel.
 * Displays coordinates in multiple formats and provides navigation.
 */

import { formatCoordinates } from '../../utilities/coordinate_converter.js';
import { FeatureNavigationUtils } from '../../utilities/feature_navigation_utils.js';

// turf is loaded globally via script tag

// Feature types that should show coordinates
const TYPES_WITH_COORDINATES = ['point', 'text', 'coordination_measure', 'image', 'military_symbol', 'circle'];

/**
 * Creates the location section for the feature panel.
 * @param {Object} options - Configuration options
 * @param {Object} options.feature - The selected feature
 * @param {string} options.featureType - The type of the feature
 * @param {Object} options.map - Map instance for navigation
 * @returns {Promise<HTMLElement>} The location section element
 */
export async function createLocationSection(options) {
    const { feature, featureType, map } = options;

    const container = document.createElement('div');
    container.className = 'feature-location-section';

    // Check if this feature type should show coordinates
    const showCoordinates = TYPES_WITH_COORDINATES.includes(featureType);

    if (showCoordinates) {
        // Section header
        const header = document.createElement('div');
        header.className = 'feature-location-header';
        header.textContent = 'Localização';
        container.appendChild(header);

        // Coordinates container
        const coordsContainer = document.createElement('div');
        coordsContainer.className = 'feature-location-coords';

        // Get center point of feature
        const center = getFeatureCenter(feature);

        if (center) {
            const [lng, lat] = center;

            // Lat/Lng row
            const latLngRow = document.createElement('div');
            latLngRow.className = 'feature-location-row';

            const latLngIcon = document.createElement('span');
            latLngIcon.className = 'feature-location-icon';
            latLngIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`;

            const latLngText = document.createElement('span');
            latLngText.className = 'feature-location-text';
            const formattedLatLng = await formatCoordinates(lat, lng, 'latlong');
            latLngText.textContent = formattedLatLng;
            latLngText.title = 'Clique para copiar';
            latLngText.style.cursor = 'pointer';
            latLngText.addEventListener('click', () => {
                copyToClipboard(formattedLatLng);
                showCopyFeedback(latLngText);
            });

            latLngRow.appendChild(latLngIcon);
            latLngRow.appendChild(latLngText);
            coordsContainer.appendChild(latLngRow);

            // UTM row
            const utmRow = document.createElement('div');
            utmRow.className = 'feature-location-row';

            const utmIcon = document.createElement('span');
            utmIcon.className = 'feature-location-icon';
            utmIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;

            const utmText = document.createElement('span');
            utmText.className = 'feature-location-text';
            const formattedUtm = await formatCoordinates(lat, lng, 'utm_wgs84');
            utmText.textContent = formattedUtm;
            utmText.title = 'Clique para copiar';
            utmText.style.cursor = 'pointer';
            utmText.addEventListener('click', () => {
                copyToClipboard(formattedUtm);
                showCopyFeedback(utmText);
            });

            utmRow.appendChild(utmIcon);
            utmRow.appendChild(utmText);
            coordsContainer.appendChild(utmRow);
        } else {
            const noCoords = document.createElement('div');
            noCoords.className = 'feature-location-no-coords';
            noCoords.textContent = 'Coordenadas indisponíveis';
            coordsContainer.appendChild(noCoords);
        }

        container.appendChild(coordsContainer);
    }

    // Center on map button (always shown for all feature types)
    const centerButton = document.createElement('button');
    centerButton.className = 'feature-location-center-btn';
    centerButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Centralizar no mapa
    `;

    centerButton.addEventListener('click', () => {
        if (map && feature) {
            FeatureNavigationUtils.zoomToFeature(feature, map, {
                duration: 800,
                paddingPercent: 0.3
            });
        }
    });

    container.appendChild(centerButton);

    return container;
}

/**
 * Gets the center point of a feature.
 * @param {Object} feature - GeoJSON feature
 * @returns {Array|null} [lng, lat] or null
 */
function getFeatureCenter(feature) {
    if (!feature?.geometry) return null;

    try {
        const geometry = feature.geometry;

        // Check for explicit center in properties (used by circle, ellipse, etc.)
        if (feature.properties?.center) {
            let center = feature.properties.center;
            // Handle string format
            if (typeof center === 'string') {
                try {
                    center = JSON.parse(center);
                } catch {
                    return null;
                }
            }
            if (Array.isArray(center) && center.length >= 2) {
                return center;
            }
        }

        switch (geometry.type) {
            case 'Point':
                return geometry.coordinates;

            case 'LineString':
                // Get midpoint of line
                if (geometry.coordinates.length > 0) {
                    const midIndex = Math.floor(geometry.coordinates.length / 2);
                    return geometry.coordinates[midIndex];
                }
                return null;

            case 'Polygon':
                // Use turf centroid
                try {
                    const centroid = turf.centroid(feature);
                    return centroid.geometry.coordinates;
                } catch {
                    // Fallback: first coordinate
                    if (geometry.coordinates[0]?.length > 0) {
                        return geometry.coordinates[0][0];
                    }
                }
                return null;

            case 'MultiPoint':
                if (geometry.coordinates.length > 0) {
                    return geometry.coordinates[0];
                }
                return null;

            case 'MultiLineString':
                if (geometry.coordinates[0]?.length > 0) {
                    const firstLine = geometry.coordinates[0];
                    const midIndex = Math.floor(firstLine.length / 2);
                    return firstLine[midIndex];
                }
                return null;

            case 'MultiPolygon':
                try {
                    const centroid = turf.centroid(feature);
                    return centroid.geometry.coordinates;
                } catch {
                    if (geometry.coordinates[0]?.[0]?.length > 0) {
                        return geometry.coordinates[0][0][0];
                    }
                }
                return null;

            default:
                return null;
        }
    } catch (error) {
        console.warn('Error getting feature center:', error);
        return null;
    }
}

/**
 * Copies text to clipboard.
 * @param {string} text - Text to copy
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }
}

/**
 * Shows copy feedback on element.
 * @param {HTMLElement} element - Element to show feedback on
 */
function showCopyFeedback(element) {
    const originalText = element.textContent;
    element.textContent = 'Copiado!';
    element.classList.add('copied');

    setTimeout(() => {
        element.textContent = originalText;
        element.classList.remove('copied');
    }, 1500);
}
