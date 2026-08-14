// Path: js/first_person_3d_tool/components/markers-layer-fp.js

/**
 * @fileoverview Explanatory marker layer of the first-person viewer.
 *
 * Each marker is a world point with a title and a text. The label is HTML
 * projected over the canvas, not 3D geometry: it costs nothing to render and
 * the text stays legible at any distance. A ray against the voxel collision
 * octree hides a marker when there is a wall between it and the camera.
 *
 * This class only decides which labels are on screen and which survive the
 * overlap tie-break. It does NOT draw the card: a click emits
 * MARKER_FP_CLICKED and the application feature panel — the same one 2D, Cesium
 * and 360 open — renders the content. See marker-panel-fp.js.
 *
 * Every label is a real DOM button, so opening a card is an ordinary click on an
 * ordinary element. An earlier version also let the centre of the screen pick a
 * label, for the captured-pointer mode that no longer exists.
 */

import {
    setupCleanup,
    addScopedDomListener,
    clearScopedListeners,
    cleanup
} from '@utils/event-cleanup.js';
import { generateUUID } from '@utils/uuid.js';
import {
    MARKER_MAX_DISTANCE as MAX_DISTANCE_M,
    MARKER_MAX_VISIBLE as MAX_VISIBLE_LABELS,
    MARKER_LABEL_PADDING_PX as BOX_SLACK_PX,
    MARKER_OCCLUSION_SLACK as OCCLUSION_SLACK_M
} from '../walk/constants.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';

/** Fallback label box used before the browser has measured the element. */
const FALLBACK_LABEL_WIDTH_PX = 120;
const FALLBACK_LABEL_HEIGHT_PX = 24;

/** Minimum depth in front of the camera for a label to be projected, in meters. */
const MIN_FRONT_DISTANCE_M = 0.2;

/** Distance below which the occlusion ray is skipped, in meters. */
const MIN_OCCLUSION_DISTANCE_M = 0.5;

/** Normalized-device margin: a bit outside the frustum still gets a label. */
const NDC_MARGIN = 1.1;

/** Minimum label opacity, reached at MAX_DISTANCE_M. */
const MIN_LABEL_OPACITY = 0.45;

/**
 * @typedef {import('./marker-panel-fp.js').FpMarker} FpMarker
 */

/**
 * Projected HTML label layer for the curated scene markers.
 */
export class FpMarkersLayer {
    /**
     * @param {HTMLElement} container - Element that hosts the labels.
     * @param {number} fovDegrees - Vertical field of view of the viewer camera.
     * @param {Object|null} collision - VoxelCollision instance, or null when the scene has no octree.
     * @param {(foto: string) => (string|null)} [resolvePhotoUrl] - Resolves a marker photo path into a URL.
     * @param {{id: string, name: string}} [scene] - Scene identity, carried in the click payload
     *   so the feature panel can name the scene the item belongs to.
     */
    constructor(container, fovDegrees, collision, resolvePhotoUrl, scene) {
        setupCleanup(this);

        this._fovDegrees = Number.isFinite(fovDegrees) && fovDegrees > 0 ? fovDegrees : 60;
        this._collision = collision || null;
        this._resolvePhotoUrl = typeof resolvePhotoUrl === 'function' ? resolvePhotoUrl : () => null;
        this._sceneId = scene?.id ?? null;
        this._sceneName = scene?.name ?? '';

        /** @type {Map<string, {marker: FpMarker, el: HTMLButtonElement}>} */
        this._items = new Map();
        /** Id of the marker whose card is open, or null. */
        this._openId = null;
        this._interactive = true;
        this._labelsVisible = true;
        /** How many labels each visible label is covering, in the current frame. */
        this._covered = new Map();

        this._root = document.createElement('div');
        this._root.className = 'fp3d-labels';
        container.appendChild(this._root);

    }

    /**
     * Replaces the marker set. Safe to call again: the old labels and their
     * listeners are dropped before the new ones are created.
     * @param {ReadonlyArray<FpMarker>} markers - Curated markers of the scene.
     */
    setMarkers(markers) {
        this.closePanel();
        clearScopedListeners(this, 'labels');
        for (const { el } of this._items.values()) {
            el.remove();
        }
        this._items.clear();
        this._covered.clear();

        for (const marker of markers || []) {
            if (!marker || !Number.isFinite(marker.x) || !Number.isFinite(marker.y) || !Number.isFinite(marker.z)) {
                continue;
            }
            const id = marker.id || generateUUID();
            const title = marker.titulo || '';

            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'fp3d-label fp3d-label--hidden';
            el.textContent = title;
            // The original title is kept aside: the visible text gains and loses
            // the "+N" suffix every frame, and without this it would pile up.
            el.dataset.title = title;
            if (this._interactive) {
                el.classList.add('fp3d-label--interactive');
            }

            // The walk controller listens for mousedown on the document and would
            // rotate the camera along with the click. The label eats it first.
            addScopedDomListener(this, 'labels', el, 'mousedown', (ev) => ev.stopPropagation());
            addScopedDomListener(this, 'labels', el, 'click', (ev) => {
                ev.stopPropagation();
                this._toggleMarker(id, marker);
            });

            this._root.appendChild(el);
            this._items.set(id, { marker, el });
        }
    }

    /**
     * Turns clicking on labels on or off.
     *
     * The measurement mode uses the cursor over the scene, so the labels stop
     * capturing clicks while it is on.
     * @param {boolean} enabled - True to make labels clickable.
     */
    setInteractive(enabled) {
        this._interactive = !!enabled;
        for (const { el } of this._items.values()) {
            el.classList.toggle('fp3d-label--interactive', this._interactive);
        }
        if (!this._interactive) {
            this.closePanel();
        }
    }

    /**
     * Turns the labels on or off, and returns the new state.
     *
     * Turning them off hides the labels AND closes the card: what is left is the
     * clean scene, for whoever wants to look at the piece without a tag on top.
     * @returns {boolean} True when the labels are now visible.
     */
    toggleLabels() {
        this._labelsVisible = !this._labelsVisible;
        if (!this._labelsVisible) {
            this.closePanel();
            for (const { el } of this._items.values()) {
                el.classList.add('fp3d-label--hidden');
            }
        }
        return this._labelsVisible;
    }

    /**
     * Are the labels currently on?
     * @returns {boolean} True when labels are drawn.
     */
    get labelsVisible() {
        return this._labelsVisible;
    }

    /**
     * Is a marker card open?
     * @returns {boolean} True when the card is open.
     */
    get panelOpen() {
        return this._openId !== null;
    }

    /**
     * Closes the marker card. Serves Esc, which comes from outside this layer.
     */
    closePanel() {
        if (this._openId === null) return;
        this._openId = null;
        getEventBus().emit(EventTypes.MARKER_FP_DESELECTED, { sceneId: this._sceneId });
    }

    /**
     * Repositions the labels. Call once per frame, after moving the camera.
     * @param {Object} camera - Viewer camera with matrixWorld and aspect.
     * @param {number} width - Canvas width, in pixels.
     * @param {number} height - Canvas height, in pixels.
     */
    update(camera, width, height) {
        if (!this._labelsVisible || this._items.size === 0) return;

        const e = camera?.matrixWorld?.elements;
        if (!e) return;

        // Column 3 of the world matrix is the position; columns 0..2 are the camera axes.
        const px = e[12];
        const py = e[13];
        const pz = e[14];
        const tanHalfFov = Math.tan((this._fovDegrees * Math.PI) / 360);
        const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0
            ? camera.aspect
            : (height > 0 ? width / height : 1);

        /** Labels already placed, for the overlap tie-break. */
        const placed = [];
        this._covered.clear();

        // First pass: projection only, which is pure arithmetic. The occlusion
        // ray is left for later, because it is expensive (up to 140 octree steps)
        // and most markers never even get drawn.
        const onScreen = [];
        for (const { marker, el } of this._items.values()) {
            const dx = marker.x - px;
            const dy = marker.y - py;
            const dz = marker.z - pz;
            // Project into camera space: the inverse of a rotation is its transpose.
            const cx = dx * e[0] + dy * e[1] + dz * e[2];
            const cy = dx * e[4] + dy * e[5] + dz * e[6];
            const cz = dx * e[8] + dy * e[9] + dz * e[10];
            const dist = Math.hypot(dx, dy, dz);
            const front = -cz;
            if (front <= MIN_FRONT_DISTANCE_M || dist > MAX_DISTANCE_M) {
                el.classList.add('fp3d-label--hidden');
                continue;
            }
            const nx = cx / front / (tanHalfFov * aspect);
            const ny = cy / front / tanHalfFov;
            if (Math.abs(nx) > NDC_MARGIN || Math.abs(ny) > NDC_MARGIN) {
                el.classList.add('fp3d-label--hidden');
                continue;
            }
            onScreen.push({
                el,
                sx: ((nx + 1) / 2) * width,
                sy: ((1 - ny) / 2) * height,
                dist, dx, dy, dz
            });
        }

        // Second pass: the occlusion ray only for the closest ones, the only
        // candidates that can survive the MAX_VISIBLE_LABELS cap. Testing the
        // rest is spending octree to hide a label that would not be drawn anyway.
        onScreen.sort((a, b) => a.dist - b.dist);
        const budget = MAX_VISIBLE_LABELS * 2;
        /** Candidates of this frame, from nearest to farthest. */
        const candidates = [];
        for (let i = 0; i < onScreen.length; i++) {
            const c = onScreen[i];
            if (i >= budget || this._isOccluded(px, py, pz, c.dx, c.dy, c.dz, c.dist)) {
                c.el.classList.add('fp3d-label--hidden');
                continue;
            }
            candidates.push(c);
        }

        // In the display cases the pieces sit centimeters apart, and the labels
        // turn into a smear of text. Whoever is CLOSER stays; whoever would land
        // on top disappears, and shows up as soon as the visitor walks closer.
        for (const c of candidates) {
            if (placed.length >= MAX_VISIBLE_LABELS) {
                c.el.classList.add('fp3d-label--hidden');
                continue;
            }
            c.el.style.left = `${c.sx}px`;
            c.el.style.top = `${c.sy}px`;
            // Measure with the label VISIBLE: while hidden, offsetWidth returns
            // zero and the box would come out smaller than the text.
            c.el.classList.remove('fp3d-label--hidden');
            const w = (c.el.offsetWidth || FALLBACK_LABEL_WIDTH_PX) + BOX_SLACK_PX;
            const h = (c.el.offsetHeight || FALLBACK_LABEL_HEIGHT_PX) + BOX_SLACK_PX;
            const box = { x: c.sx - w / 2, y: c.sy - h / 2, w, h, owner: c.el };
            const conflict = placed.find(
                (o) =>
                    Math.abs(o.x + o.w / 2 - (box.x + box.w / 2)) < (o.w + box.w) / 2 &&
                    Math.abs(o.y + o.h / 2 - (box.y + box.h / 2)) < (o.h + box.h) / 2
            );
            if (conflict) {
                // The hidden label does not vanish without a trace: the one on top
                // counts how many pieces it covers, so the visitor knows there is
                // more there and walks closer.
                c.el.classList.add('fp3d-label--hidden');
                this._covered.set(conflict.owner, (this._covered.get(conflict.owner) ?? 0) + 1);
                continue;
            }
            placed.push(box);
            c.el.style.opacity = String(Math.max(MIN_LABEL_OPACITY, 1 - c.dist / MAX_DISTANCE_M));
        }

        for (const box of placed) {
            const n = this._covered.get(box.owner) ?? 0;
            const base = box.owner.dataset.title ?? '';
            box.owner.textContent = n > 0 ? `${base}  +${n}` : base;
        }
    }

    /**
     * Removes every label and the card, with all their listeners.
     */
    destroy() {
        cleanup(this);
        for (const { el } of this._items.values()) {
            el.remove();
        }
        this._items.clear();
        this._covered.clear();
        this.closePanel();
        this._root.remove();
    }

    /**
     * Opens the card of a marker, or closes it when it is already the open one.
     * @param {string} id - Marker id.
     * @param {FpMarker} marker - Marker data.
     */
    _toggleMarker(id, marker) {
        if (this._openId === id) {
            this.closePanel();
            return;
        }
        this._openId = id;
        getEventBus().emit(EventTypes.MARKER_FP_CLICKED, {
            marker,
            sceneId: this._sceneId,
            sceneName: this._sceneName,
            photoUrl: marker.foto ? this._resolvePhotoUrl(marker.foto) : null
        });
    }

    /**
     * Is there solid geometry between the camera and the marker?
     * @param {number} px - Camera x, in meters.
     * @param {number} py - Camera y, in meters.
     * @param {number} pz - Camera z, in meters.
     * @param {number} dx - Camera-to-marker vector x, in meters.
     * @param {number} dy - Camera-to-marker vector y, in meters.
     * @param {number} dz - Camera-to-marker vector z, in meters.
     * @param {number} dist - Length of that vector, in meters.
     * @returns {boolean} True when the marker is behind geometry.
     */
    _isOccluded(px, py, pz, dx, dy, dz, dist) {
        if (!this._collision || dist < MIN_OCCLUSION_DISTANCE_M) {
            return false;
        }
        const inv = 1 / dist;
        const hit = this._collision.queryRay(
            px, py, pz,
            dx * inv, dy * inv, dz * inv,
            dist - OCCLUSION_SLACK_M
        );
        return hit !== null;
    }
}
