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
    subscribe,
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
        /**
         * WHICH labels each visible label is covering, in the current frame.
         * It used to be a COUNT, enough to write the "+N" suffix. It is the ids
         * now because clicking that suffix opens the pile
         * (`_openPile`), and a count cannot say what is in it.
         * @type {Map<HTMLButtonElement, string[]>}
         */
        this._covered = new Map();
        /**
         * Labels drawn in the last frame, with where they landed. Read only by
         * `pickAtCenter`, which is the crosshair's hit test.
         * @type {Array<{id: string, sx: number, sy: number}>}
         */
        this._placed = [];
        /** True while the crosshair replaces the cursor (immersive mode). */
        this._aiming = false;
        this._aimRadiusPx = 0;
        /** Label currently lit by the aim, so the class moves instead of piling up. */
        this._aimedEl = null;

        this._root = document.createElement('div');
        this._root.className = 'fp3d-labels';
        container.appendChild(this._root);

        // The two ways INTO this layer from the feature panel, which is built in
        // the sidebar and holds no reference to us. The list asks us to open an
        // item because `_openId` lives here; the open item's panel asks for the
        // full list because the markers live here.
        const bus = getEventBus();
        subscribe(this, bus, EventTypes.MARKER_FP_PICKED, ({ id } = {}) => this._openById(id));
        subscribe(this, bus, EventTypes.MARKER_FP_LIST_REQUESTED, () => this.openAllItems());
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
        // Stale aim targets would let the crosshair open an item of the scene
        // that was just replaced, in the frame before the next `update`.
        this._placed = [];
        this._aimedEl = null;

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
            // The aim goes with them: a highlight left on a hidden label comes
            // back lit when the labels return, pointing at nothing.
            this._setAimed(null);
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
        for (const [id, { marker, el }] of this._items) {
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
                id,
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
            const box = { x: c.sx - w / 2, y: c.sy - h / 2, w, h, owner: c.el, id: c.id, sx: c.sx, sy: c.sy };
            const conflict = placed.find(
                (o) =>
                    Math.abs(o.x + o.w / 2 - (box.x + box.w / 2)) < (o.w + box.w) / 2 &&
                    Math.abs(o.y + o.h / 2 - (box.y + box.h / 2)) < (o.h + box.h) / 2
            );
            if (conflict) {
                // The hidden label does not vanish without a trace: the one on top
                // lists what it covers, which writes the "+N" suffix below AND is
                // what that suffix opens when clicked (`_toggleMarker`).
                c.el.classList.add('fp3d-label--hidden');
                const pile = this._covered.get(conflict.owner);
                if (pile) {
                    pile.push(c.id);
                } else {
                    this._covered.set(conflict.owner, [c.id]);
                }
                continue;
            }
            placed.push(box);
            c.el.style.opacity = String(Math.max(MIN_LABEL_OPACITY, 1 - c.dist / MAX_DISTANCE_M));
        }

        // Kept for the crosshair: with the pointer LOCKED the browser sends every
        // click to the locked element, so no label can be hit by DOM hit-testing
        // and the only way to know what the visitor is aiming at is where the
        // labels ended up this frame. See `pickAtCenter`.
        this._placed = placed;

        for (const box of placed) {
            const n = this._covered.get(box.owner)?.length ?? 0;
            const base = box.owner.dataset.title ?? '';
            box.owner.textContent = n > 0 ? `${base}  +${n}` : base;
            // The suffix changes what the click DOES (the pile, not the card), and
            // the HOVER TITLE is the whole of how that is announced. A visual
            // treatment was tried and rejected: see the note in
            // first-person-3d.css, next to the marker labels.
            box.owner.title = n > 0
                ? `${base} e mais ${n} ${n === 1 ? 'item' : 'itens'} neste ponto. Clique para escolher.`
                : '';
        }

        // The aim, last, because it reads `_placed` that the loop above just
        // finished writing. Outside the immersive mode this costs nothing: the
        // flag is false and `:hover` is doing the job instead.
        if (this._aiming) {
            this._setAimed(this._nearestToCenter(width, height, this._aimRadiusPx)?.owner ?? null);
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
     * Opens whatever the CROSSHAIR is on, for the immersive mode.
     *
     * IT EXISTS BECAUSE A LOCKED POINTER CANNOT CLICK. Every label is a real DOM
     * button and an ordinary click reaches it by hit-testing — but with the
     * pointer locked the browser delivers all mouse events to the locked element
     * and the labels never see one. So the aim is resolved here, in screen
     * space, against the labels this frame actually drew (`_placed`, written by
     * `update`).
     *
     * NEAREST TO THE CENTRE WINS, inside a radius, rather than "the label whose
     * box contains the centre". The boxes are small, they never overlap (the
     * layer's own tie-break guarantees it) and a crosshair that only fires on a
     * direct hit makes the visitor sweep the room hunting for a pixel. The
     * radius is what keeps it from opening a label on the far side of the view.
     *
     * @param {number} width - Canvas width, in pixels.
     * @param {number} height - Canvas height, in pixels.
     * @param {number} radiusPx - How far from the centre a label still counts.
     * @returns {string} What it did: `'none'`, `'item'`, `'closed'` or `'pile'`.
     *   The caller needs `'pile'` apart from the rest, because a list of items to
     *   choose from is useless to somebody with no cursor.
     */
    pickAtCenter(width, height, radiusPx) {
        const best = this._nearestToCenter(width, height, radiusPx);
        if (!best) return 'none';

        const entry = this._items.get(best.id);
        if (!entry) return 'none';

        // The very same call the label's own click makes, so a pile opens its
        // list here too and there is one behaviour to keep true, not two.
        return this._toggleMarker(best.id, entry.marker);
    }

    /**
     * The label the crosshair is on, or null.
     *
     * THE HIGHLIGHT AND THE CLICK MUST NOT BE TWO ANSWERS. Both go through here,
     * so what lights up is by construction what a click would open — the one
     * failure a crosshair cannot afford is pointing at one thing and firing at
     * another.
     *
     * @param {number} width - Canvas width, in pixels.
     * @param {number} height - Canvas height, in pixels.
     * @param {number} radiusPx - How far from the centre a label still counts.
     * @returns {{id: string, sx: number, sy: number, owner: HTMLButtonElement}|null} The aimed label.
     * @private
     */
    _nearestToCenter(width, height, radiusPx) {
        if (!this._labelsVisible || !this._interactive || !this._placed?.length) {
            return null;
        }
        const cx = width / 2;
        const cy = height / 2;

        let best = null;
        let bestDist = radiusPx;
        for (const box of this._placed) {
            const dist = Math.hypot(box.sx - cx, box.sy - cy);
            if (dist <= bestDist) {
                bestDist = dist;
                best = box;
            }
        }
        return best;
    }

    /**
     * Turns the crosshair aim on or off.
     *
     * Only the immersive mode uses it: outside it there is a cursor, the labels
     * are ordinary buttons and `:hover` already does this job — running an aim
     * test every frame to light a label nobody is pointing at would be work
     * spent to mislead.
     *
     * @param {boolean} enabled - True while the pointer is locked.
     * @param {number} radiusPx - Same radius the click uses.
     */
    setAim(enabled, radiusPx) {
        this._aiming = enabled === true;
        this._aimRadiusPx = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 0;
        if (!this._aiming) {
            this._setAimed(null);
        }
    }

    /**
     * Moves the aim highlight to one label, or to none.
     * @param {HTMLButtonElement|null} el - Label to light, or null.
     * @private
     */
    _setAimed(el) {
        if (this._aimedEl === el) return;
        this._aimedEl?.classList.remove('fp3d-label--aimed');
        el?.classList.add('fp3d-label--aimed');
        this._aimedEl = el ?? null;
    }

    /**
     * Opens EVERY item of the scene as a list, in the feature panel.
     *
     * The way in that does not depend on walking up to a label: it answers the
     * "Ver todos os itens" button of an open item, and the widen button of a pile.
     *
     * ALPHABETICAL, not the JSON's authoring order. The authoring order groups
     * pieces by display case, which is the right order for someone WALKING the
     * room — and the wrong one for someone reading a list of 78 lines looking for
     * a name, because it is an order the reader cannot see. `localeCompare` with
     * pt-BR and `sensitivity: 'base'` is what puts "Álidade" next to "Alidade"
     * instead of after "Z", and half these titles carry an accent.
     */
    openAllItems() {
        const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
        const all = [...this._items.values()]
            .map(({ marker }) => marker)
            .sort((a, b) => collator.compare(a.titulo ?? '', b.titulo ?? ''));
        this._emitList(all, 'Itens do acervo', false);
    }

    /**
     * Opens the card of a marker, or closes it when it is already the open one.
     *
     * A LABEL THAT COVERS OTHERS OPENS THE PILE INSTEAD. In the display cases the
     * pieces sit centimeters apart, so the layer keeps the nearest label and
     * hides the rest behind a "+N" suffix. That suffix used to be a dead end: it
     * announced there was more and, clicked, opened only the one item whose name
     * was showing. Now it opens the list of exactly what it is covering, itself
     * included, and the visitor picks.
     *
     * @param {string} id - Marker id.
     * @param {FpMarker} marker - Marker data.
     * @returns {string} `'pile'`, `'closed'` or `'item'` — what the click did.
     *   The crosshair caller acts on `'pile'`; the label's own click ignores it.
     */
    _toggleMarker(id, marker) {
        const coveredIds = this._covered.get(this._items.get(id)?.el) ?? [];
        if (coveredIds.length > 0) {
            this._emitList([marker, ...this._markersOf(coveredIds)], 'Itens neste ponto', true);
            return 'pile';
        }
        if (this._openId === id) {
            this.closePanel();
            return 'closed';
        }
        this._open(id, marker);
        return 'item';
    }

    /**
     * Opens a marker by id, whatever is open now. Serves the list, where picking
     * a row means "show me this one", never "toggle it".
     * @param {string} id - Marker id.
     */
    _openById(id) {
        const entry = this._items.get(id);
        if (!entry) return;
        this._open(id, entry.marker);
    }

    /**
     * Announces the open card. The single writer of `_openId`.
     * @param {string} id - Marker id.
     * @param {FpMarker} marker - Marker data.
     */
    _open(id, marker) {
        this._openId = id;
        getEventBus().emit(EventTypes.MARKER_FP_CLICKED, {
            marker,
            sceneId: this._sceneId,
            sceneName: this._sceneName,
            photoUrl: marker.foto ? this._resolvePhotoUrl(marker.foto) : null
        });
    }

    /**
     * Sends a set of markers to the feature panel as a list.
     *
     * The photo URLs are resolved HERE, for the same reason the card's is: the
     * resolver knows the scene folder and the panel does not.
     *
     * `_openId` is NOT cleared. The list is a way to choose an item, not a way to
     * deselect one, and it marks the open row — clearing it would also make Esc
     * skip the deselect the viewer expects.
     *
     * @param {ReadonlyArray<FpMarker>} markers - Markers to list.
     * @param {string} title - Header title of the list.
     * @param {boolean} scoped - True when this is a subset of the scene.
     */
    _emitList(markers, title, scoped) {
        const items = markers
            .filter(Boolean)
            .map((marker) => ({
                marker,
                photoUrl: marker.foto ? this._resolvePhotoUrl(marker.foto) : null
            }));
        getEventBus().emit(EventTypes.MARKER_FP_LIST_CLICKED, {
            items,
            sceneId: this._sceneId,
            sceneName: this._sceneName,
            title,
            scoped,
            openId: this._openId
        });
    }

    /**
     * @param {ReadonlyArray<string>} ids - Marker ids.
     * @returns {FpMarker[]} The markers still present, in the given order.
     */
    _markersOf(ids) {
        return ids.map((id) => this._items.get(id)?.marker).filter(Boolean);
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
