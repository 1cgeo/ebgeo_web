import { describe, it, expect } from 'vitest';
import {
    pixelsToDegrees,
    degreesToPixels,
    createPointBoundingBox,
    normalizeCoordinates,
    calculateDistance,
    calculateBearing
} from '../../src/js/utilities/geometry-utils.js';

// ============================================================================
// pixelsToDegrees / degreesToPixels
// ============================================================================

describe('pixelsToDegrees', () => {
    it('returns 0 for 0 pixels', () => {
        expect(pixelsToDegrees(0, 0, 10)).toBe(0);
    });

    it('returns larger degrees at lower zoom levels', () => {
        const lowZoom = pixelsToDegrees(100, 0, 5);
        const highZoom = pixelsToDegrees(100, 0, 15);
        expect(lowZoom).toBeGreaterThan(highZoom);
    });

    it('returns smaller degrees at higher latitudes (Mercator distortion)', () => {
        const equator = pixelsToDegrees(100, 0, 10);
        const highLat = pixelsToDegrees(100, 60, 10);
        expect(highLat).toBeLessThan(equator);
    });

    it('handles negative latitudes (southern hemisphere)', () => {
        const north = pixelsToDegrees(100, 30, 10);
        const south = pixelsToDegrees(100, -30, 10);
        expect(north).toBeCloseTo(south, 10);
    });
});

describe('degreesToPixels', () => {
    it('is inverse of pixelsToDegrees', () => {
        const latitude = -23.5;
        const zoom = 15;
        const originalPixels = 50;
        const degrees = pixelsToDegrees(originalPixels, latitude, zoom);
        const backToPixels = degreesToPixels(degrees, latitude, zoom);
        expect(backToPixels).toBeCloseTo(originalPixels, 5);
    });

    it('returns 0 for 0 degrees', () => {
        expect(degreesToPixels(0, 0, 10)).toBe(0);
    });
});

// ============================================================================
// createPointBoundingBox
// ============================================================================

describe('createPointBoundingBox', () => {
    it('creates a GeoJSON Polygon', () => {
        const bbox = createPointBoundingBox([-43.2, -22.9], 10, 15);
        expect(bbox.type).toBe('Polygon');
        expect(bbox.coordinates).toHaveLength(1);
        expect(bbox.coordinates[0]).toHaveLength(5); // Closed ring
    });

    it('first and last coordinates are the same (closed ring)', () => {
        const bbox = createPointBoundingBox([-43.2, -22.9], 10, 15);
        const ring = bbox.coordinates[0];
        expect(ring[0]).toEqual(ring[4]);
    });

    it('creates bbox centered on the point', () => {
        const center = [-43.2, -22.9];
        const bbox = createPointBoundingBox(center, 10, 15);
        const ring = bbox.coordinates[0];
        // Centroid should be approximately at the original point
        const avgLng = (ring[0][0] + ring[2][0]) / 2;
        const avgLat = (ring[0][1] + ring[2][1]) / 2;
        expect(avgLng).toBeCloseTo(center[0], 5);
        expect(avgLat).toBeCloseTo(center[1], 5);
    });
});

// ============================================================================
// normalizeCoordinates
// ============================================================================

describe('normalizeCoordinates', () => {
    it('parses JSON string to array', () => {
        expect(normalizeCoordinates('[1, 2]')).toEqual([1, 2]);
    });

    it('passes through arrays', () => {
        const arr = [1, 2, 3];
        expect(normalizeCoordinates(arr)).toBe(arr);
    });

    it('returns null for invalid JSON', () => {
        expect(normalizeCoordinates('invalid')).toBeNull();
    });

    it('returns null for non-array JSON', () => {
        expect(normalizeCoordinates('{"a":1}')).toBeNull();
    });

    it('handles nested coordinate arrays (line/polygon)', () => {
        const input = '[[1,2],[3,4]]';
        const result = normalizeCoordinates(input);
        expect(result).toEqual([[1, 2], [3, 4]]);
    });
});

// ============================================================================
// calculateDistance
// ============================================================================

describe('calculateDistance', () => {
    it('returns 0 for same point', () => {
        const point = [-43.2, -22.9];
        expect(calculateDistance(point, point)).toBe(0);
    });

    it('calculates distance between Rio de Janeiro and São Paulo (~357 km)', () => {
        const rio = [-43.1729, -22.9068];
        const sp = [-46.6333, -23.5505];
        const distance = calculateDistance(rio, sp);
        // ~357 km with Haversine
        expect(distance).toBeGreaterThan(350000);
        expect(distance).toBeLessThan(365000);
    });

    it('calculates distance between known points (Brasilia to Rio ~933 km)', () => {
        const brasilia = [-47.8825, -15.7942];
        const rio = [-43.1729, -22.9068];
        const distance = calculateDistance(brasilia, rio);
        expect(distance).toBeGreaterThan(900000);
        expect(distance).toBeLessThan(960000);
    });

    it('is symmetric', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-46.6, -23.5];
        expect(calculateDistance(p1, p2)).toBeCloseTo(calculateDistance(p2, p1), 5);
    });

    it('handles cross-hemisphere points', () => {
        const north = [-43.2, 10.0];
        const south = [-43.2, -10.0];
        const distance = calculateDistance(north, south);
        // ~20 degrees of latitude ≈ 2222 km
        expect(distance).toBeGreaterThan(2200000);
        expect(distance).toBeLessThan(2250000);
    });
});

// ============================================================================
// calculateBearing
// ============================================================================

describe('calculateBearing', () => {
    it('returns 0 for due north', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-43.2, -22.0]; // Same lng, higher lat
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeCloseTo(0, 0);
    });

    it('returns ~90 for due east', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-42.2, -22.9]; // Higher lng, same lat
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeCloseTo(90, 0);
    });

    it('returns ~180 for due south', () => {
        const p1 = [-43.2, -22.0];
        const p2 = [-43.2, -23.0]; // Same lng, lower lat
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeCloseTo(180, 0);
    });

    it('returns ~270 for due west', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-44.2, -22.9]; // Lower lng, same lat
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeCloseTo(270, 0);
    });

    it('returns value in range [0, 360)', () => {
        const p1 = [-43.2, -22.9];
        const p2 = [-44.5, -23.8];
        const bearing = calculateBearing(p1, p2);
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThan(360);
    });
});
