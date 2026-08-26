// Path: js/draw_tools/line_tool/line_profile.js

/**
 * @fileoverview Terrain elevation profile calculation for line features.
 * Calculates elevation and slope data along a line path.
 *
 * @module draw_tools/line_tool/line_profile
 */

import { getTerrainElevation } from '../../terrain';
import { ensureTurf } from '@utils/turf-loader.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Number of sample points for profile calculation.
 * More points = smoother profile but slower calculation.
 * @constant {number}
 */
const PROFILE_STEPS = 25;

// ============================================================================
// PROFILE CALCULATION
// ============================================================================

/**
 * Calculate terrain elevation profile for a line with slope percentage.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Array<Array<number>>} coordinates - Line coordinates [[lng, lat], ...]
 * @returns {Promise<Array<Object>>} Profile data with distance, elevation, and slope
 *
 * @example
 * const profileData = await calculateProfile(map, lineCoordinates);
 * // Returns: [{ distance: 0, elevation: 100, slope: 0 }, ...]
 */
export async function calculateProfile(map, coordinates) {
    // Ja assincrona, e chamada tanto pelo controle de linha (que passa por `ensureControl`)
    // quanto por `line-split.js`. Uma linha aqui torna a funcao autossuficiente em vez de
    // depender de qual dos dois caminhos a alcancou.
    await ensureTurf();

    const line = turf.lineString(coordinates);
    const length = turf.length(line, { units: 'meters' });
    const stepLength = length / PROFILE_STEPS;

    const profileData = [];

    // Sample elevation at each step along the line
    for (let i = 0; i <= PROFILE_STEPS; i++) {
        const point = turf.along(line, i * stepLength, { units: 'meters' });
        const elevation = await getTerrainElevation(map, point.geometry.coordinates);

        profileData.push({
            distance: i * stepLength,
            elevation,
            slope: 0 // Will be calculated after all elevations are collected
        });
    }

    // Calculate slope percentage between consecutive points
    calculateSlopes(profileData);

    return profileData;
}

/**
 * Calculate slope percentages for profile data.
 * Modifies the profileData array in place.
 *
 * @param {Array<Object>} profileData - Profile data array to update
 */
function calculateSlopes(profileData) {
    for (let i = 1; i < profileData.length; i++) {
        const deltaElevation = profileData[i].elevation - profileData[i - 1].elevation;
        const deltaDistance = profileData[i].distance - profileData[i - 1].distance;

        if (deltaDistance > 0) {
            // Slope as percentage: (rise / run) * 100
            profileData[i].slope = (deltaElevation / deltaDistance) * 100;
        }
    }

    // First point inherits slope from second point for display continuity
    if (profileData.length > 1) {
        profileData[0].slope = profileData[1].slope;
    }
}

// ============================================================================
// PROFILE UTILITIES
// ============================================================================

/**
 * Get total elevation gain for a profile.
 *
 * @param {Array<Object>} profileData - Profile data array
 * @returns {number} Total elevation gain in meters
 */
export function getTotalElevationGain(profileData) {
    let gain = 0;
    for (let i = 1; i < profileData.length; i++) {
        const delta = profileData[i].elevation - profileData[i - 1].elevation;
        if (delta > 0) {
            gain += delta;
        }
    }
    return gain;
}

/**
 * Get total elevation loss for a profile.
 *
 * @param {Array<Object>} profileData - Profile data array
 * @returns {number} Total elevation loss in meters (positive value)
 */
export function getTotalElevationLoss(profileData) {
    let loss = 0;
    for (let i = 1; i < profileData.length; i++) {
        const delta = profileData[i].elevation - profileData[i - 1].elevation;
        if (delta < 0) {
            loss += Math.abs(delta);
        }
    }
    return loss;
}

/**
 * Get min and max elevation for a profile.
 *
 * @param {Array<Object>} profileData - Profile data array
 * @returns {Object} { min: number, max: number }
 */
export function getElevationRange(profileData) {
    if (profileData.length === 0) {
        return { min: 0, max: 0 };
    }

    let min = profileData[0].elevation;
    let max = profileData[0].elevation;

    for (const point of profileData) {
        if (point.elevation < min) min = point.elevation;
        if (point.elevation > max) max = point.elevation;
    }

    return { min, max };
}

/**
 * Get average slope for a profile.
 *
 * @param {Array<Object>} profileData - Profile data array
 * @returns {number} Average slope percentage
 */
export function getAverageSlope(profileData) {
    if (profileData.length <= 1) {
        return 0;
    }

    const totalSlope = profileData.reduce((sum, point) => sum + Math.abs(point.slope), 0);
    return totalSlope / profileData.length;
}

/**
 * Get maximum slope (steepest section) for a profile.
 *
 * @param {Array<Object>} profileData - Profile data array
 * @returns {number} Maximum absolute slope percentage
 */
export function getMaxSlope(profileData) {
    if (profileData.length === 0) {
        return 0;
    }

    return Math.max(...profileData.map(point => Math.abs(point.slope)));
}
