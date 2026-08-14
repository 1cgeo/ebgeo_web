// Path: js/first_person_3d_tool/tools/measurement_tool_fp.js
/**
 * @fileoverview Tape measure over the first-person splat model.
 *
 * The measured point comes from a ray cast from the eye through the cursor against
 * the collision octree — the same octree that holds the walk up. Precision is the
 * voxel size: 5 cm.
 *
 * The drawing is an overlay on top of the canvas, not 3D geometry: SVG for the lines
 * and the points, a div for the distance label. That way the measurement never enters
 * the splat render pass and the text stays legible at any distance.
 *
 * INTERACTION IS THE 2D TOOL'S, not the prototype's. It follows
 * `measurement_tool/measurement-distance.control.js` step for step:
 *
 *   - left click adds a vertex, as many as you like, with NO modifier key;
 *   - right click or double click closes the measurement;
 *   - closing shows the shared results card and freezes the drawing;
 *   - the next click starts a fresh measurement, wiping the previous one.
 *
 * The prototype instead required shift to keep a polyline open, closed a
 * measurement on the second plain click, and stacked every measurement on
 * screen forever. That is a second grammar for the same verb, and a user who
 * has measured on the 2D map already knows this one.
 *
 * ONE MEASUREMENT AT A TIME, also from the 2D tool. The prototype's stack of
 * finished measurements is gone: without it there is nothing to explain about
 * which measurement the card is describing.
 */

import { removeElement } from '@utils/event-cleanup.js';
import { formatDistance } from '@js/measurement_tool/measurement-geometry.js';
import {
    MEASURE_RANGE as RANGE,
    MEASURE_NEAR_PLANE as NEAR_PLANE,
    MEASURE_OCCLUSION_SLACK as OCCLUSION_SLACK,
    MEASURE_MIN_SEGMENT as MIN_LEG
} from '../walk/constants.js';

/**
 * @typedef {Object} FpPoint
 * @property {number} x - World X, meters
 * @property {number} y - World Y, meters
 * @property {number} z - World Z, meters
 */

/**
 * @typedef {Object} FpCamera
 * @property {{ elements: ArrayLike<number> }} matrixWorld - World matrix of the camera
 * @property {number} aspect - Viewport aspect ratio (width / height)
 */

/**
 * @typedef {Object} FpScreenPoint
 * @property {number} x - Pixel X inside the container
 * @property {number} y - Pixel Y inside the container
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Below this distance from the eye an occlusion test is pointless. */
const MIN_OCCLUSION_DISTANCE = 0.4;
/** Radius of the point disc and of the cursor ring, in pixels. */
const DISC_RADIUS = 4;
const CURSOR_RADIUS = 6;
/** Vertical offset of the "total" pill above the last point, in pixels. */
const TOTAL_PILL_OFFSET = 22;

const CLASS_HIDDEN = 'fp3d-hidden';

/**
 * Recycled element pool for the overlay.
 *
 * The overlay is rebuilt every single frame while the camera moves. Creating and
 * dropping the SVG lines, circles and label divs each frame would churn the DOM and
 * the GC for nothing — the element count barely changes between frames. So elements
 * are created once, handed out again on the next frame, and the leftovers are only
 * hidden (never detached), which keeps their layout boxes warm.
 *
 * Usage per frame: `reset()` → N × `next()` → `hideSpares()`.
 *
 * @template {SVGElement|HTMLElement} T
 */
class Pool {
    /**
     * @param {() => T} create - Factory for a brand-new element
     * @param {Element} parent - Node the created elements are appended to
     */
    constructor(create, parent) {
        /** @type {T[]} */
        this._items = [];
        this._used = 0;
        this._create = create;
        this._parent = parent;
    }

    /**
     * Hand out the next element, creating one only if the pool ran dry.
     * @returns {T} A visible, ready-to-configure element
     */
    next() {
        let el = this._items[this._used];
        if (!el) {
            el = this._create();
            this._items.push(el);
            this._parent.appendChild(el);
        }
        el.classList.remove(CLASS_HIDDEN);
        this._used++;
        return el;
    }

    /** Start a new frame: every element becomes available again. */
    reset() {
        this._used = 0;
    }

    /** Hide whatever this frame did not claim. */
    hideSpares() {
        for (let i = this._used; i < this._items.length; i++) {
            this._items[i].classList.add(CLASS_HIDDEN);
        }
    }

    /** Detach and forget every element. */
    destroy() {
        for (const el of this._items) {
            removeElement(el);
        }
        this._items.length = 0;
        this._used = 0;
    }
}

/**
 * Tape measure layer for the first-person viewer.
 *
 * Draws closed measurements plus the polyline currently being built, as an SVG/HTML
 * overlay stacked on the viewer canvas.
 */
export class FpMeasurementTool {
    /**
     * @param {HTMLElement} container - Element the overlay is mounted into
     * @param {number} fovDegrees - Vertical field of view, degrees
     * @param {import('../walk/voxel-collision.js').VoxelCollision|null} collision - Loaded octree, or null
     */
    constructor(container, fovDegrees, collision) {
        this._fovDegrees = fovDegrees;
        this._collision = collision || null;

        this._svg = document.createElementNS(SVG_NS, 'svg');
        this._svg.classList.add('fp3d-measure');
        container.appendChild(this._svg);

        this._labels = document.createElement('div');
        this._labels.classList.add('fp3d-measure-labels');
        container.appendChild(this._labels);

        this._lines = new Pool(() => {
            const el = document.createElementNS(SVG_NS, 'line');
            el.classList.add('fp3d-measure__line');
            return el;
        }, this._svg);

        this._points = new Pool(() => {
            const el = document.createElementNS(SVG_NS, 'circle');
            el.classList.add('fp3d-measure__point');
            return el;
        }, this._svg);

        this._pills = new Pool(() => {
            const el = document.createElement('div');
            el.classList.add('fp3d-measure__pill');
            return el;
        }, this._labels);

        this._enabled = false;
        /**
         * The one measurement, open or closed.
         * @type {FpPoint[]}
         */
        this._vertices = [];
        /** True once the measurement is closed: the drawing freezes and the card is up. */
        this._finalized = false;
        /**
         * Point under the cursor, snapped to the surface.
         * @type {FpPoint|null}
         */
        this._preview = null;
        /**
         * Unit chosen in the results card, or null for the indoor auto format.
         * @type {Object|null}
         */
        this._unit = null;
    }

    /** @returns {boolean} Measuring needs the octree: with no collision loaded it cannot turn on. */
    get available() {
        return this._collision !== null;
    }

    /** @returns {boolean} Whether the tool is currently turned on. */
    get active() {
        return this._enabled;
    }

    /** @returns {boolean} Whether a measurement is open and taking points. */
    get inProgress() {
        return !this._finalized && this._vertices.length > 0;
    }

    /** @returns {boolean} Whether the measurement is closed and the card is up. */
    get finalized() {
        return this._finalized;
    }

    /** @returns {number} Vertices pinned so far. */
    get vertexCount() {
        return this._vertices.length;
    }

    /**
     * Turn the tool on or off. Turning it off drops everything drawn.
     * @param {boolean} enabled - Desired state
     */
    setActive(enabled) {
        this._enabled = enabled && this.available;
        if (!this._enabled) {
            this.clear();
        }
    }

    /**
     * Sets the unit the overlay labels are drawn in.
     *
     * Driven by the unit selector of the results card, exactly as the 2D tool
     * redraws its map labels: picking "Pés" in the card and leaving the pills in
     * metres would be two readings of one measurement.
     *
     * @param {Object|null} unit - DISTANCE_UNITS entry, or null for the auto format
     */
    setDisplayUnit(unit) {
        this._unit = unit || null;
    }

    /**
     * Per-segment and total lengths, for the results card.
     * @returns {{segmentDistances: number[], totalDistance: number}} Lengths in meters
     */
    getResults() {
        const segmentDistances = [];
        for (let i = 1; i < this._vertices.length; i++) {
            segmentDistances.push(distance(this._vertices[i - 1], this._vertices[i]));
        }
        return {
            segmentDistances,
            totalDistance: polylineLength(this._vertices)
        };
    }

    /**
     * Cast the ray from the eye through the cursor and remember where it lands.
     *
     * `ndcX` and `ndcY` run from -1 to 1, with zero at the center of the screen.
     *
     * @param {FpCamera} camera - Current camera
     * @param {number} ndcX - Normalized device X
     * @param {number} ndcY - Normalized device Y
     */
    point(camera, ndcX, ndcY) {
        if (!this._enabled || !this._collision) {
            return;
        }
        const e = camera.matrixWorld.elements;
        const tan = Math.tan((this._fovDegrees * Math.PI) / 360);
        // Direction in camera space, then rotated by the world matrix columns.
        const cx = ndcX * tan * camera.aspect;
        const cy = ndcY * tan;
        const cz = -1;
        let dx = cx * e[0] + cy * e[4] + cz * e[8];
        let dy = cx * e[1] + cy * e[5] + cz * e[9];
        let dz = cx * e[2] + cy * e[6] + cz * e[10];
        const n = Math.hypot(dx, dy, dz) || 1;
        dx /= n;
        dy /= n;
        dz /= n;
        this._preview = this._collision.queryRay(e[12], e[13], e[14], dx, dy, dz, RANGE);
    }

    /**
     * Pin the point under the cursor. No modifier key, and it never closes the
     * measurement on its own — closing is right click or double click.
     *
     * A click on a closed measurement starts a fresh one, which is what the 2D
     * tool does: the user who clicks again is measuring again, not editing.
     *
     * @returns {boolean} True when a vertex was actually added
     */
    addPoint() {
        if (!this._enabled || !this._preview) {
            return false;
        }
        if (this._finalized) {
            this.restart();
        }
        // Two clicks on the same spot are not a measurement: the leg would come out zero.
        const last = this._vertices[this._vertices.length - 1];
        if (last && distance(last, this._preview) < MIN_LEG) {
            return false;
        }
        this._vertices.push({ x: this._preview.x, y: this._preview.y, z: this._preview.z });
        return true;
    }

    /**
     * Close the measurement.
     *
     * @param {boolean} [dropLast=false] - Drop the last vertex first. Set by the
     *   double click, whose first click already pinned the point the second one
     *   is closing on — the same correction the 2D tool makes.
     * @returns {boolean} True when a measurement of two vertices or more closed
     */
    finalize(dropLast = false) {
        if (this._finalized || this._vertices.length === 0) {
            return false;
        }
        if (dropLast && this._vertices.length > 1) {
            this._vertices.pop();
        }
        if (this._vertices.length < 2) {
            // A single point is not a measurement. Drop it and stay open, so the
            // user can just carry on clicking.
            this._vertices.length = 0;
            return false;
        }
        this._finalized = true;
        this._preview = null;
        return true;
    }

    /** Wipe the measurement and take points again. */
    restart() {
        this._vertices.length = 0;
        this._finalized = false;
        this._unit = null;
    }

    /**
     * Drop the last pinned vertex. Has no effect on a closed measurement, which
     * is reopened by clicking rather than edited.
     */
    undo() {
        if (this._finalized) {
            return;
        }
        this._vertices.pop();
    }

    /** Wipe everything, including the preview. */
    clear() {
        this._vertices.length = 0;
        this._finalized = false;
        this._preview = null;
        this._unit = null;
    }

    /**
     * Redraw the overlay. Call once per frame, after moving the camera.
     * @param {FpCamera} camera - Current camera
     * @param {number} width - Container width in pixels
     * @param {number} height - Container height in pixels
     */
    update(camera, width, height) {
        this._lines.reset();
        this._points.reset();
        this._pills.reset();
        this._svg.setAttribute('width', String(width));
        this._svg.setAttribute('height', String(height));

        const e = camera.matrixWorld.elements;
        const tan = Math.tan((this._fovDegrees * Math.PI) / 360);
        const toScreen = (p) => project(e, tan, camera.aspect, width, height, p);

        if (this._vertices.length > 0) {
            // The live segment to the cursor only exists while the measurement is
            // open: once closed the drawing freezes, like the 2D preview line.
            const live = this._enabled && !this._finalized && this._preview;
            const pts = live ? [...this._vertices, this._preview] : this._vertices;
            this._drawPolyline(pts, toScreen, e, Boolean(live));
        }
        if (this._enabled && !this._finalized && this._preview) {
            const p = toScreen(this._preview);
            if (p) {
                const ring = this._points.next();
                ring.setAttribute('cx', String(p.x));
                ring.setAttribute('cy', String(p.y));
                ring.setAttribute('r', String(CURSOR_RADIUS));
                ring.classList.add('fp3d-measure__point--preview');
                ring.classList.remove('fp3d-measure__point--occluded');
            }
        }

        this._lines.hideSpares();
        this._points.hideSpares();
        this._pills.hideSpares();
    }

    /** Detach the overlay and forget every pooled element. */
    destroy() {
        this._lines.destroy();
        this._points.destroy();
        this._pills.destroy();
        removeElement(this._svg);
        removeElement(this._labels);
        this._vertices.length = 0;
        this._finalized = false;
        this._preview = null;
        this._unit = null;
        this._collision = null;
        this._enabled = false;
    }

    /**
     * Draw one polyline with the label of each leg plus the total.
     * @param {ReadonlyArray<FpPoint>} pts - Polyline points, world space
     * @param {(p: FpPoint) => FpScreenPoint|null} toScreen - World-to-pixel projector
     * @param {ArrayLike<number>} e - Camera world matrix elements
     * @param {boolean} open - True when the last point is the live cursor preview
     */
    _drawPolyline(pts, toScreen, e, open) {
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const seg = clipSegment(e, toScreen, a, b);
            if (!seg) {
                continue;
            }
            const line = this._lines.next();
            line.setAttribute('x1', String(seg.a.x));
            line.setAttribute('y1', String(seg.a.y));
            line.setAttribute('x2', String(seg.b.x));
            line.setAttribute('y2', String(seg.b.y));
            line.classList.toggle('fp3d-measure__line--pending', open && i === pts.length - 2);

            const pill = this._pills.next();
            pill.textContent = this._format(distance(a, b));
            pill.classList.remove('fp3d-measure__pill--total');
            // Runtime-computed position: recalculated every frame from the projection.
            pill.style.left = `${(seg.a.x + seg.b.x) / 2}px`;
            pill.style.top = `${(seg.a.y + seg.b.y) / 2}px`;
        }

        for (let i = 0; i < pts.length; i++) {
            // The last point of an open polyline is the preview: it gets the ring, not the disc.
            if (open && i === pts.length - 1) {
                continue;
            }
            const p = toScreen(pts[i]);
            if (!p) {
                continue;
            }
            const disc = this._points.next();
            disc.setAttribute('cx', String(p.x));
            disc.setAttribute('cy', String(p.y));
            disc.setAttribute('r', String(DISC_RADIUS));
            disc.classList.remove('fp3d-measure__point--preview');
            disc.classList.toggle('fp3d-measure__point--occluded', this._isOccluded(e, pts[i]));
        }

        if (pts.length > 2) {
            const end = toScreen(pts[pts.length - 1]);
            if (end) {
                const total = this._pills.next();
                total.textContent = `total ${this._format(polylineLength(pts))}`;
                total.classList.add('fp3d-measure__pill--total');
                // Runtime-computed position: recalculated every frame from the projection.
                total.style.left = `${end.x}px`;
                total.style.top = `${end.y - TOTAL_PILL_OFFSET}px`;
            }
        }
    }

    /**
     * Label text for a length, honouring the unit picked in the results card.
     * @param {number} meters - Distance in meters
     * @returns {string} Formatted UI string
     */
    _format(meters) {
        return this._unit ? formatDistance(meters, this._unit) : formatMeters(meters);
    }

    /**
     * Is there a wall between the eye and the point?
     * @param {ArrayLike<number>} e - Camera world matrix elements
     * @param {FpPoint} p - World point
     * @returns {boolean} True when the octree blocks the line of sight
     */
    _isOccluded(e, p) {
        if (!this._collision) {
            return false;
        }
        const dx = p.x - e[12];
        const dy = p.y - e[13];
        const dz = p.z - e[14];
        const dist = Math.hypot(dx, dy, dz);
        if (dist < MIN_OCCLUSION_DISTANCE) {
            return false;
        }
        const inv = 1 / dist;
        return this._collision.queryRay(
            e[12], e[13], e[14],
            dx * inv, dy * inv, dz * inv,
            dist - OCCLUSION_SLACK
        ) !== null;
    }
}

/**
 * World point into camera space.
 * @param {ArrayLike<number>} e - Camera world matrix elements
 * @param {FpPoint} p - World point
 * @returns {FpPoint} Point in camera space
 */
function toCameraSpace(e, p) {
    const dx = p.x - e[12];
    const dy = p.y - e[13];
    const dz = p.z - e[14];
    return {
        x: dx * e[0] + dy * e[1] + dz * e[2],
        y: dx * e[4] + dy * e[5] + dz * e[6],
        z: dx * e[8] + dy * e[9] + dz * e[10]
    };
}

/**
 * World to pixel. Returns null behind the near plane.
 * @param {ArrayLike<number>} e - Camera world matrix elements
 * @param {number} tan - Tangent of half the vertical FOV
 * @param {number} aspect - Viewport aspect ratio
 * @param {number} width - Container width in pixels
 * @param {number} height - Container height in pixels
 * @param {FpPoint} p - World point
 * @returns {FpScreenPoint|null} Pixel position, or null when clipped
 */
function project(e, tan, aspect, width, height, p) {
    const c = toCameraSpace(e, p);
    const front = -c.z;
    if (front < NEAR_PLANE) {
        return null;
    }
    const nx = c.x / front / (tan * aspect);
    const ny = c.y / front / tan;
    return { x: ((nx + 1) / 2) * width, y: ((1 - ny) / 2) * height };
}

/**
 * Clip the segment against the near plane.
 *
 * Without this, a point behind the camera projects mirrored and the line crosses the
 * screen backwards.
 *
 * @param {ArrayLike<number>} e - Camera world matrix elements
 * @param {(p: FpPoint) => FpScreenPoint|null} toScreen - World-to-pixel projector
 * @param {FpPoint} a - Segment start, world space
 * @param {FpPoint} b - Segment end, world space
 * @returns {{ a: FpScreenPoint, b: FpScreenPoint }|null} Clipped segment in pixels, or null
 */
function clipSegment(e, toScreen, a, b) {
    const fa = -toCameraSpace(e, a).z;
    const fb = -toCameraSpace(e, b).z;
    if (fa < NEAR_PLANE && fb < NEAR_PLANE) {
        return null;
    }
    let pa = a;
    let pb = b;
    if (fa < NEAR_PLANE) {
        pa = lerp(a, b, (NEAR_PLANE - fa) / (fb - fa));
    } else if (fb < NEAR_PLANE) {
        pb = lerp(b, a, (NEAR_PLANE - fb) / (fa - fb));
    }
    const ta = toScreen(pa);
    const tb = toScreen(pb);
    return ta && tb ? { a: ta, b: tb } : null;
}

/**
 * Linear interpolation between two world points.
 * @param {FpPoint} a - Start point
 * @param {FpPoint} b - End point
 * @param {number} t - Interpolation factor
 * @returns {FpPoint} Interpolated point
 */
function lerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Euclidean distance between two world points.
 * @param {FpPoint} a - First point
 * @param {FpPoint} b - Second point
 * @returns {number} Distance in meters
 */
function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Total length of a polyline.
 * @param {ReadonlyArray<FpPoint>} pts - Polyline points
 * @returns {number} Length in meters
 */
function polylineLength(pts) {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        total += distance(pts[i], pts[i + 1]);
    }
    return total;
}

/**
 * Indoor-scale distance text (pt-BR). Below 1 m it reads in centimeters; above,
 * in meters with 2 decimals and a comma separator.
 *
 * The 2D formatters in `measurement_tool/measurement-geometry.js` switch to km and
 * use a dot, which is wrong for a walk-through of a single room.
 *
 * @param {number} meters - Distance in meters
 * @returns {string} Formatted UI string
 */
function formatMeters(meters) {
    if (meters < 1) {
        return `${Math.round(meters * 100)} cm`;
    }
    return `${meters.toFixed(2).replace('.', ',')} m`;
}
