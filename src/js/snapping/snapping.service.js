// Path: js/snapping/snapping.service.js

/**
 * @fileoverview Snapping service for EBGeo.
 * Resolves screen coordinates to the nearest vertex or edge of existing
 * features on the map, within a configurable pixel tolerance.
 *
 * @module snapping/snapping.service
 * @dependencies snapping/snapping.constants, state/state_manager
 */

import {
    SNAP_TOLERANCE_PX,
    SNAP_VERTEX_BONUS_PX,
    SNAP_QUERY_PADDING_PX,
    SNAPPABLE_LAYER_IDS,
    SNAP_INDICATOR_SOURCE,
    SNAP_INDICATOR_STYLE,
    SnapType,
} from './snapping.constants.js';

// ============================================================================
// GEOMETRY HELPERS (pure functions)
// ============================================================================

/**
 * Extracts all vertex coordinates from a GeoJSON geometry.
 * @param {Object} geometry - GeoJSON geometry
 * @returns {Array<[number, number]>} Array of [lng, lat] pairs
 */
function extractVertices(geometry) {
    if (!geometry || !geometry.coordinates) return [];

    switch (geometry.type) {
        case 'Point':
            return [geometry.coordinates.slice(0, 2)];

        case 'MultiPoint':
        case 'LineString':
            return geometry.coordinates.map(c => c.slice(0, 2));

        case 'MultiLineString':
        case 'Polygon':
            return geometry.coordinates.flat().map(c => c.slice(0, 2));

        case 'MultiPolygon':
            return geometry.coordinates.flat(2).map(c => c.slice(0, 2));

        default:
            return [];
    }
}

/**
 * Extracts all edge segments from a GeoJSON geometry.
 * @param {Object} geometry - GeoJSON geometry
 * @returns {Array<[[number,number],[number,number]]>} Pairs of consecutive vertices
 */
function extractSegments(geometry) {
    if (!geometry || !geometry.coordinates) return [];

    const segments = [];

    const addRingSegments = (ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
            segments.push([ring[i].slice(0, 2), ring[i + 1].slice(0, 2)]);
        }
    };

    switch (geometry.type) {
        case 'LineString':
            addRingSegments(geometry.coordinates);
            break;

        case 'MultiLineString':
            geometry.coordinates.forEach(addRingSegments);
            break;

        case 'Polygon':
            geometry.coordinates.forEach(addRingSegments);
            break;

        case 'MultiPolygon':
            geometry.coordinates.forEach(poly => poly.forEach(addRingSegments));
            break;

        // Point/MultiPoint have no edges
        default:
            break;
    }

    return segments;
}

/**
 * Euclidean distance between two pixel points.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
function distPixels(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Projects a point onto a segment in pixel space.
 * Returns the closest point on segment a→b to point p.
 * @param {{x: number, y: number}} p - Point
 * @param {{x: number, y: number}} a - Segment start
 * @param {{x: number, y: number}} b - Segment end
 * @returns {{ point: {x: number, y: number}, t: number }} Closest point and parameter t ∈ [0,1]
 */
function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;

    // Degenerate segment (a === b)
    if (lenSq === 0) {
        return { point: { x: a.x, y: a.y }, t: 0 };
    }

    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));

    return {
        point: {
            x: a.x + t * abx,
            y: a.y + t * aby,
        },
        t,
    };
}

/**
 * Linearly interpolates between two geographic coordinates.
 * @param {[number, number]} coordA - [lng, lat]
 * @param {[number, number]} coordB - [lng, lat]
 * @param {number} t - Interpolation parameter ∈ [0,1]
 * @returns {[number, number]} [lng, lat]
 */
function interpolateLngLat(coordA, coordB, t) {
    return [
        coordA[0] + t * (coordB[0] - coordA[0]),
        coordA[1] + t * (coordB[1] - coordA[1]),
    ];
}

// ============================================================================
// SNAPPING SERVICE
// ============================================================================

/** @type {SnappingService|null} Singleton instance */
let _instance = null;

/**
 * Snapping service — resolves screen coordinates to the nearest snap target.
 */
export class SnappingService {
    /**
     * @param {Object} options
     * @param {Object} options.stateManager - StateManager instance
     */
    constructor({ stateManager }) {
        if (_instance) {
            return _instance;
        }

        this._stateManager = stateManager;
        this._ctrlHeld = false;

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onWindowBlur = this._onWindowBlur.bind(this);

        this._setupCtrlListener();

        _instance = this;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Resolves the effective coordinate for a screen point.
     * If snapping is active and a target is found within tolerance,
     * returns the snapped coordinate; otherwise returns the fallback.
     *
     * @param {Object} map - MapLibre map instance
     * @param {{x: number, y: number}} screenPoint - Cursor position in pixels
     * @param {{lng: number, lat: number}} fallbackLngLat - Original coordinate
     * @param {string|null} [excludeFeatureId=null] - Feature ID to exclude (e.g., the one being edited)
     * @returns {{ lng: number, lat: number, snapped: boolean, snapType: string|null }}
     */
    resolve(map, screenPoint, fallbackLngLat, excludeFeatureId = null) {
        // Fast path: snapping disabled or temporarily paused
        if (!this._isEffectivelyEnabled()) {
            return {
                lng: fallbackLngLat.lng,
                lat: fallbackLngLat.lat,
                snapped: false,
                snapType: null,
            };
        }

        // Query rendered features in a small bbox around the cursor
        const padding = SNAP_QUERY_PADDING_PX;
        const bbox = [
            [screenPoint.x - padding, screenPoint.y - padding],
            [screenPoint.x + padding, screenPoint.y + padding],
        ];

        let candidates;
        try {
            candidates = map.queryRenderedFeatures(bbox, {
                layers: this._getAvailableLayers(map),
            });
        } catch (_err) {
            // Layers may not exist yet during startup
            return this._fallback(fallbackLngLat);
        }

        if (!candidates || candidates.length === 0) {
            return this._fallback(fallbackLngLat);
        }

        // Filter out the feature being edited
        if (excludeFeatureId) {
            candidates = candidates.filter(
                f => f.properties?.id !== excludeFeatureId
            );
        }

        if (candidates.length === 0) {
            return this._fallback(fallbackLngLat);
        }

        // Find the best snap target among all candidates
        return this._findBestSnap(map, screenPoint, fallbackLngLat, candidates);
    }

    /**
     * Shows the snap indicator on the map.
     * @param {Object} map - MapLibre map instance
     * @param {{ lng: number, lat: number }} lngLat - Snap position
     * @param {string} snapType - 'vertex' or 'edge'
     */
    showIndicator(map, lngLat, snapType) {
        const source = map.getSource(SNAP_INDICATOR_SOURCE);
        if (!source) return;

        const style = SNAP_INDICATOR_STYLE[snapType] || SNAP_INDICATOR_STYLE.vertex;

        source.setData({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [lngLat.lng, lngLat.lat],
            },
            properties: {
                snapType,
                radius: style.radius,
                color: style.color,
                strokeColor: style.strokeColor,
                strokeWidth: style.strokeWidth,
                opacity: style.opacity,
            },
        });
    }

    /**
     * Hides the snap indicator.
     * @param {Object} map - MapLibre map instance
     */
    hideIndicator(map) {
        const source = map.getSource(SNAP_INDICATOR_SOURCE);
        if (!source) return;

        source.setData({
            type: 'FeatureCollection',
            features: [],
        });
    }

    /**
     * Whether snapping is globally enabled.
     * @returns {boolean}
     */
    isEnabled() {
        return !!this._stateManager.getUnsafe('ui.snapping.enabled');
    }

    /**
     * Cleanup listeners.
     */
    destroy() {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onWindowBlur);
        _instance = null;
    }

    // ========================================================================
    // PRIVATE
    // ========================================================================

    /**
     * Effective snapping state: global toggle XOR Ctrl held.
     * - If global ON  + Ctrl held → disabled (temporary pause)
     * - If global OFF + Ctrl held → enabled  (temporary snap)
     * @returns {boolean}
     */
    _isEffectivelyEnabled() {
        const globalEnabled = this.isEnabled();
        return globalEnabled !== this._ctrlHeld; // XOR
    }

    /**
     * Returns only those layers from SNAPPABLE_LAYER_IDS that exist on the map.
     * @param {Object} map
     * @returns {string[]}
     */
    _getAvailableLayers(map) {
        return SNAPPABLE_LAYER_IDS.filter(id => map.getLayer(id));
    }

    /**
     * Returns fallback (non-snapped) result.
     * @param {{lng: number, lat: number}} lngLat
     * @returns {{ lng: number, lat: number, snapped: boolean, snapType: string|null }}
     */
    _fallback(lngLat) {
        return {
            lng: lngLat.lng,
            lat: lngLat.lat,
            snapped: false,
            snapType: null,
        };
    }

    /**
     * Searches all candidate features for the best snap target.
     * @param {Object} map
     * @param {{x: number, y: number}} screenPoint
     * @param {{lng: number, lat: number}} fallbackLngLat
     * @param {Array} candidates - queryRenderedFeatures results
     * @returns {{ lng: number, lat: number, snapped: boolean, snapType: string|null }}
     */
    _findBestSnap(map, screenPoint, fallbackLngLat, candidates) {
        let bestDist = Infinity;
        let bestResult = null;

        for (const feature of candidates) {
            const geom = feature.geometry;
            if (!geom) continue;

            // --- Vertex snap ---
            const vertices = extractVertices(geom);
            for (const coord of vertices) {
                const projected = map.project(coord);
                const dist = distPixels(screenPoint, projected);

                // Vertices get a bonus (lower effective distance)
                const effectiveDist = dist - SNAP_VERTEX_BONUS_PX;

                if (dist <= SNAP_TOLERANCE_PX && effectiveDist < bestDist) {
                    bestDist = effectiveDist;
                    bestResult = {
                        lng: coord[0],
                        lat: coord[1],
                        snapped: true,
                        snapType: SnapType.VERTEX,
                    };
                }
            }

            // --- Edge snap ---
            const segments = extractSegments(geom);
            for (const [coordA, coordB] of segments) {
                const pxA = map.project(coordA);
                const pxB = map.project(coordB);

                const { point: closest, t } = closestPointOnSegment(screenPoint, pxA, pxB);
                const dist = distPixels(screenPoint, closest);

                if (dist <= SNAP_TOLERANCE_PX && dist < bestDist) {
                    const snappedCoord = interpolateLngLat(coordA, coordB, t);
                    bestDist = dist;
                    bestResult = {
                        lng: snappedCoord[0],
                        lat: snappedCoord[1],
                        snapped: true,
                        snapType: SnapType.EDGE,
                    };
                }
            }
        }

        return bestResult || this._fallback(fallbackLngLat);
    }

    // ========================================================================
    // CTRL KEY HANDLING
    // ========================================================================

    _setupCtrlListener() {
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        // Reset when window loses focus (Ctrl might be released while alt-tabbed)
        window.addEventListener('blur', this._onWindowBlur);
    }

    _onKeyDown(e) {
        if (e.key === 'Control') {
            this._ctrlHeld = true;
        }
    }

    _onKeyUp(e) {
        if (e.key === 'Control') {
            this._ctrlHeld = false;
        }
    }

    _onWindowBlur() {
        this._ctrlHeld = false;
    }
}

/**
 * Returns the singleton SnappingService instance.
 * @returns {SnappingService|null}
 */
export function getSnappingService() {
    return _instance;
}
