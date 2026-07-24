// Path: js/import_export/kmz/kml-geometry.js

/**
 * @fileoverview Pure GeoJSON -> KML geometry conversion.
 *
 * Covers three jobs that are all easy to get subtly wrong:
 * - Coordinate serialization (KML is `lng,lat,alt`, same axis order as GeoJSON).
 * - Dash simulation, because KML `<LineStyle>` has no dash array at all.
 * - `<LatLonBox>` for zoom-invariant image features.
 *
 * No DOM, no turf, no map instance — everything here is node-testable.
 *
 * @module import_export/kmz/kml-geometry
 */

/** Decimal places kept when serializing coordinates (~11 cm at the equator). */
const COORD_PRECISION = 6;

/** Mean meters per degree of latitude, matching the app's own constant. */
const METERS_PER_DEGREE = 111320;

/** Scale factor the image tool applies between pixel size and rendered size. */
const IMAGE_PIXEL_SCALE = 0.625;

/** Guard for cos(latitude) so longitude math stays finite at the poles. */
const MIN_COS_LAT = 1e-6;

/**
 * Upper bound on segments emitted by dash simulation. A brush stroke with
 * thousands of vertices dashed at 2px would otherwise explode the document.
 */
const MAX_DASH_SEGMENTS = 2000;

/**
 * Dash patterns in pixels, mirroring `LINE_STYLE_DASHARRAY` in
 * `js/layers/styles/layer.helpers.js` so exports match on-screen rendering.
 * A pattern of `[1, 0]` means "solid".
 */
export const LINE_STYLE_DASH_PATTERNS = {
    dashed: [8, 4],
    dotted: [2, 3],
    'dash-dot': [8, 4, 2, 4],
    'long-dash': [16, 6],
    'short-dash': [4, 4],
    'dot-dot-dash': [2, 2, 2, 2, 8, 2],
};

/**
 * Formats a number for KML output, avoiding exponent notation and "-0".
 *
 * @param {number} value - Number to format
 * @returns {string} Fixed-precision decimal string
 */
function formatCoord(value) {
    if (!Number.isFinite(value)) return '0';
    const fixed = value.toFixed(COORD_PRECISION);
    // toFixed can produce "-0.000000"; normalize it so output is stable.
    return /^-0(\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed;
}

/**
 * Checks that a position is a usable `[lng, lat]` pair.
 *
 * @param {*} position - Candidate coordinate
 * @returns {boolean} Whether the position is finite and well-formed
 */
function isValidPosition(position) {
    return Array.isArray(position)
        && position.length >= 2
        && Number.isFinite(position[0])
        && Number.isFinite(position[1]);
}

/**
 * Serializes a list of positions into a KML `<coordinates>` payload.
 *
 * @param {Array<Array<number>>} positions - GeoJSON positions
 * @returns {string} Space-separated `lng,lat,alt` triples
 */
export function formatCoordinates(positions) {
    if (!Array.isArray(positions)) return '';
    return positions
        .filter(isValidPosition)
        .map(p => `${formatCoord(p[0])},${formatCoord(p[1])},${formatCoord(p[2] ?? 0)}`)
        .join(' ');
}

/**
 * Great-circle distance between two positions, in meters.
 *
 * @param {Array<number>} a - Start position `[lng, lat]`
 * @param {Array<number>} b - End position `[lng, lat]`
 * @returns {number} Distance in meters
 */
function haversine(a, b) {
    const R = 6371008.8;
    const toRad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toRad;
    const dLng = (b[0] - a[0]) * toRad;
    const lat1 = a[1] * toRad;
    const lat2 = b[1] * toRad;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Linearly interpolates between two positions.
 *
 * @param {Array<number>} a - Start position
 * @param {Array<number>} b - End position
 * @param {number} t - Interpolation factor in [0, 1]
 * @returns {Array<number>} Interpolated position
 */
function lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Splits a line into the "on" runs of a dash pattern.
 *
 * KML cannot express dashes, so a dashed line is exported as many short solid
 * lines. The pattern is given in meters (the caller converts from the app's
 * pixel dash arrays at a reference zoom), alternating on/off lengths.
 *
 * @param {Array<Array<number>>} positions - Line positions
 * @param {Array<number>} patternMeters - Alternating on/off lengths in meters
 * @returns {Array<Array<Array<number>>>} One position array per emitted dash
 */
export function dashLineString(positions, patternMeters) {
    const coords = Array.isArray(positions) ? positions.filter(isValidPosition) : [];
    if (coords.length < 2) return [];

    const pattern = Array.isArray(patternMeters)
        ? patternMeters.filter(n => Number.isFinite(n) && n >= 0)
        : [];

    // Solid: no pattern, or the canonical [1, 0] "draw everything" marker.
    const isSolid = pattern.length < 2
        || pattern.every(n => n === 0)
        || (pattern.length === 2 && pattern[1] === 0);
    if (isSolid) return [coords];

    const runs = [];
    let current = [coords[0]];
    let patternIndex = 0;
    let remaining = pattern[0];
    let drawing = true;

    for (let i = 0; i < coords.length - 1; i++) {
        const start = coords[i];
        const end = coords[i + 1];
        const segmentLength = haversine(start, end);
        if (segmentLength === 0) continue;

        let traveled = 0;

        while (segmentLength - traveled > remaining) {
            traveled += remaining;
            const point = lerp(start, end, traveled / segmentLength);

            if (drawing) {
                current.push(point);
                runs.push(current);
                current = [];
            } else {
                current = [point];
            }

            drawing = !drawing;
            patternIndex = (patternIndex + 1) % pattern.length;
            remaining = pattern[patternIndex];

            // A zero-length pattern entry would spin forever.
            if (remaining <= 0) return [coords];
            if (runs.length >= MAX_DASH_SEGMENTS) return [coords];
        }

        remaining -= segmentLength - traveled;
        if (drawing) current.push(end);
    }

    if (drawing && current.length >= 2) runs.push(current);

    return runs;
}

/**
 * Converts a pixel dash pattern into meters at a given latitude and zoom.
 *
 * @param {Array<number>} patternPixels - Dash pattern in pixels
 * @param {number} latitude - Latitude the feature sits at
 * @param {number} zoom - Reference zoom level
 * @returns {Array<number>} Dash pattern in meters
 */
export function dashPatternToMeters(patternPixels, latitude, zoom) {
    if (!Array.isArray(patternPixels)) return [];
    if (!Number.isFinite(latitude) || !Number.isFinite(zoom)) return [];

    // Same formula as metersPerPixel() in js/utilities/geometry-utils.js.
    const metersPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180)
        / Math.pow(2, zoom);
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return [];

    return patternPixels.map(px => px * metersPerPixel);
}

/**
 * Total length of a polyline, in meters.
 *
 * @param {Array<Array<number>>} positions - Line positions
 * @returns {number} Length in meters
 */
export function lineLength(positions) {
    const coords = Array.isArray(positions) ? positions.filter(isValidPosition) : [];
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += haversine(coords[i], coords[i + 1]);
    }
    return total;
}

/** Fewest dash cycles a line should show before the pattern is tightened. */
const MIN_DASH_CYCLES = 6;

/** Most dash cycles a line should show before the pattern is loosened. */
const MAX_DASH_CYCLES = 150;

/**
 * Rescales a dash pattern so it stays visible at the line's actual size.
 *
 * The app draws dashes at a constant size in SCREEN pixels, so their ground
 * length depends on the zoom the user happens to be at. KML dashes are baked
 * into geometry and are therefore fixed on the ground. Converting at a guessed
 * reference zoom makes a line drawn while zoomed in come out with one or two
 * enormous dashes — indistinguishable from a solid line — and a line drawn
 * while zoomed out come out with thousands of specks.
 *
 * Normalizing against the line's own length keeps the dash reading as a dash
 * at any scale.
 *
 * @param {Array<number>} patternMeters - Dash pattern in meters
 * @param {number} totalLength - Line length in meters
 * @returns {Array<number>} Rescaled pattern, or an empty array when unusable
 */
export function fitDashPattern(patternMeters, totalLength) {
    if (!Array.isArray(patternMeters) || patternMeters.length < 2) return [];
    if (!Number.isFinite(totalLength) || totalLength <= 0) return [];

    const cycleLength = patternMeters.reduce((sum, n) => sum + n, 0);
    if (!Number.isFinite(cycleLength) || cycleLength <= 0) return [];

    const cycles = totalLength / cycleLength;

    let factor = 1;
    if (cycles < MIN_DASH_CYCLES) factor = cycles / MIN_DASH_CYCLES;
    else if (cycles > MAX_DASH_CYCLES) factor = cycles / MAX_DASH_CYCLES;

    if (factor === 1) return patternMeters;

    return patternMeters.map(n => n * factor);
}

/**
 * Wraps positions in a KML `<LineString>`.
 *
 * @param {Array<Array<number>>} positions - Line positions
 * @returns {string|null} KML fragment, or null when the line is degenerate
 */
export function buildLineString(positions) {
    const coords = formatCoordinates(positions);
    if (!coords || (positions?.filter(isValidPosition).length ?? 0) < 2) return null;
    return `<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>`;
}

/**
 * Ensures a ring is explicitly closed, as KML requires.
 *
 * @param {Array<Array<number>>} ring - Ring positions
 * @returns {Array<Array<number>>} Closed ring
 */
function closeRing(ring) {
    const valid = ring.filter(isValidPosition);
    if (valid.length < 3) return valid;
    const first = valid[0];
    const last = valid[valid.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        return [...valid, first];
    }
    return valid;
}

/**
 * Wraps rings in a KML `<Polygon>`, mapping rings 2..n to inner boundaries.
 *
 * @param {Array<Array<Array<number>>>} rings - GeoJSON polygon rings
 * @returns {string|null} KML fragment, or null when the polygon is degenerate
 */
export function buildPolygon(rings) {
    if (!Array.isArray(rings) || rings.length === 0) return null;

    const [outerRing, ...innerRings] = rings;
    const outer = closeRing(Array.isArray(outerRing) ? outerRing : []);
    if (outer.length < 4) return null;

    const outerXml = `<outerBoundaryIs><LinearRing><coordinates>${formatCoordinates(outer)}</coordinates></LinearRing></outerBoundaryIs>`;

    const innerXml = innerRings
        .map(ring => closeRing(Array.isArray(ring) ? ring : []))
        .filter(ring => ring.length >= 4)
        .map(ring => `<innerBoundaryIs><LinearRing><coordinates>${formatCoordinates(ring)}</coordinates></LinearRing></innerBoundaryIs>`)
        .join('');

    return `<Polygon><tessellate>1</tessellate>${outerXml}${innerXml}</Polygon>`;
}

/**
 * Converts a GeoJSON geometry to KML, applying dash simulation to linework.
 *
 * @param {Object} geometry - GeoJSON geometry
 * @param {Object} [options] - Conversion options
 * @param {Array<number>} [options.dashMeters] - Dash pattern in meters (omit for solid)
 * @returns {string|null} KML geometry fragment, or null when nothing is drawable
 */
export function buildGeometry(geometry, { dashMeters } = {}) {
    if (!geometry || typeof geometry !== 'object') return null;

    const dashed = Array.isArray(dashMeters) && dashMeters.length >= 2;

    /**
     * Emits one or many LineStrings depending on whether dashing applies.
     * @param {Array<Array<number>>} positions - Line positions
     * @returns {Array<string>} KML fragments
     */
    const lineFragments = (positions) => {
        const runs = dashed ? dashLineString(positions, dashMeters) : [positions];
        return runs.map(buildLineString).filter(Boolean);
    };

    switch (geometry.type) {
        case 'Point': {
            const coords = formatCoordinates([geometry.coordinates]);
            return coords ? `<Point><coordinates>${coords}</coordinates></Point>` : null;
        }

        case 'MultiPoint': {
            const parts = (geometry.coordinates || [])
                .filter(isValidPosition)
                .map(p => `<Point><coordinates>${formatCoordinates([p])}</coordinates></Point>`);
            return wrapMulti(parts);
        }

        case 'LineString':
            return wrapMulti(lineFragments(geometry.coordinates || []));

        case 'MultiLineString': {
            const parts = (geometry.coordinates || []).flatMap(lineFragments);
            return wrapMulti(parts);
        }

        case 'Polygon': {
            const polygon = buildPolygon(geometry.coordinates || []);
            if (!polygon) return null;
            if (!dashed) return polygon;
            // A dashed outline cannot come from PolyStyle, so the fill and the
            // dashes travel together as separate members of one MultiGeometry.
            const outlines = (geometry.coordinates || []).flatMap(lineFragments);
            return wrapMulti([polygon, ...outlines]);
        }

        case 'MultiPolygon': {
            const parts = (geometry.coordinates || [])
                .map(rings => buildPolygon(rings))
                .filter(Boolean);
            if (dashed) {
                const outlines = (geometry.coordinates || [])
                    .flatMap(rings => rings.flatMap(lineFragments));
                return wrapMulti([...parts, ...outlines]);
            }
            return wrapMulti(parts);
        }

        case 'GeometryCollection': {
            const parts = (geometry.geometries || [])
                .map(g => buildGeometry(g, { dashMeters }))
                .filter(Boolean);
            return wrapMulti(parts);
        }

        default:
            return null;
    }
}

/**
 * Wraps fragments in a `<MultiGeometry>` only when there is more than one.
 *
 * @param {Array<string>} fragments - KML geometry fragments
 * @returns {string|null} Single fragment, MultiGeometry, or null when empty
 */
function wrapMulti(fragments) {
    const parts = fragments.filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return `<MultiGeometry>${parts.join('')}</MultiGeometry>`;
}

/**
 * Computes a KML `<LatLonBox>` for a zoom-invariant image feature.
 *
 * Image features store a pixel size plus the zoom they were created at; the
 * ground footprint is only defined relative to that zoom. `pixelsToDegrees`
 * yields degrees of LATITUDE, so the horizontal span is divided by cos(lat)
 * to convert it into degrees of longitude — omitting that makes images look
 * horizontally squashed away from the equator.
 *
 * Rotation is negated: the app rotates clockwise, KML `<rotation>` is
 * counter-clockwise.
 *
 * @param {Object} params - Image feature parameters
 * @param {number} params.lng - Center longitude
 * @param {number} params.lat - Center latitude
 * @param {number} params.width - Intrinsic image width in pixels
 * @param {number} params.height - Intrinsic image height in pixels
 * @param {number} [params.size=1] - Size multiplier
 * @param {number} [params.rotation=0] - Clockwise rotation in degrees
 * @param {number} params.createdAtZoom - Zoom the image was placed at
 * @returns {{north: number, south: number, east: number, west: number, rotation: number}|null}
 *          Box definition, or null when the inputs cannot describe an extent
 */
export function imageLatLonBox({ lng, lat, width, height, size = 1, rotation = 0, createdAtZoom }) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (!Number.isFinite(createdAtZoom)) return null;

    const multiplier = Number.isFinite(size) ? size : 1;
    if (multiplier <= 0 || width <= 0 || height <= 0) return null;

    const scaledWidth = width * multiplier * IMAGE_PIXEL_SCALE;
    const scaledHeight = height * multiplier * IMAGE_PIXEL_SCALE;

    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180)
        / Math.pow(2, createdAtZoom);
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;

    const latSpan = (scaledHeight * metersPerPixel) / METERS_PER_DEGREE;
    const cosLat = Math.max(Math.abs(Math.cos(lat * Math.PI / 180)), MIN_COS_LAT);
    const lngSpan = (scaledWidth * metersPerPixel) / METERS_PER_DEGREE / cosLat;

    if (!Number.isFinite(latSpan) || !Number.isFinite(lngSpan)) return null;

    const kmlRotation = -normalizeSignedAngle(rotation);

    return {
        north: Math.min(90, lat + latSpan / 2),
        south: Math.max(-90, lat - latSpan / 2),
        east: lng + lngSpan / 2,
        west: lng - lngSpan / 2,
        rotation: kmlRotation === 0 ? 0 : kmlRotation,
    };
}

/**
 * Normalizes an angle to (-180, 180], the range KML `<rotation>` expects.
 *
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in (-180, 180]
 */
export function normalizeSignedAngle(degrees) {
    if (!Number.isFinite(degrees)) return 0;
    let angle = degrees % 360;
    if (angle > 180) angle -= 360;
    if (angle <= -180) angle += 360;
    return angle + 0;
}
