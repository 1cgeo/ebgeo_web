// Path: js/temporal/temporal-timeline-bar.js

/**
 * @fileoverview Timeline bar view for the Temporal Module. A "dumb" DOM
 * component: it renders the scrubber, play/pause, speed selector, current-time
 * label, settings gear and trajectory keypoint pins, and reports user gestures
 * through callbacks. All state lives in TemporalController.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
} from '../utilities/event-cleanup.js';
import {
    TEMPORAL_SPEED_OPTIONS,
    TEMPORAL_UNITS,
} from './temporal.constants.js';
import {
    formatInstant,
    cursorToFraction,
    fractionToCursor,
    buildTicks,
} from './temporal.utils.js';

const ICONS = {
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    settings:
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.61.78 1.05 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

export class TemporalTimelineBar {
    /**
     * @param {Object} callbacks
     * @param {(cursor:number)=>void} callbacks.onScrub - Fired while dragging the handle/track.
     * @param {()=>void} callbacks.onPlayToggle - Fired when play/pause is clicked.
     * @param {(speed:number)=>void} callbacks.onSpeedChange - Fired when speed changes.
     * @param {()=>void} callbacks.onOpenSettings - Fired when the gear is clicked.
     * @param {(index:number, cursor:number)=>void} callbacks.onKeypointDrag - Pin dragged (live).
     * @param {(index:number, cursor:number)=>void} callbacks.onKeypointCommit - Pin drag finished.
     */
    constructor(callbacks = {}) {
        this._cb = callbacks;
        this._root = null;
        this._track = null;
        this._progress = null;
        this._handle = null;
        this._ticksEl = null;
        this._keypointsEl = null;
        this._timeLabel = null;
        this._rangeStart = null;
        this._rangeEnd = null;
        this._playBtn = null;
        this._speedSelect = null;

        this._inicio = 0;
        this._fim = 1;
        this._unidade = 'HORA';
        this._cursor = 0;

        this._dragging = false;        // scrubbing the cursor
        this._draggingPin = -1;        // index of pin being dragged (-1 = none)

        setupCleanup(this);
    }

    /**
     * Builds the bar and attaches it (hidden) to a parent element.
     * @param {HTMLElement} parent
     */
    mount(parent) {
        const root = document.createElement('div');
        root.className = 'temporal-bar';
        root.dataset.hidden = 'true';
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', 'Controle de linha do tempo');

        root.innerHTML = `
            <div class="temporal-bar__controls">
                <button type="button" class="temporal-bar__btn temporal-bar__play" title="Reproduzir" aria-label="Reproduzir">${ICONS.play}</button>
                <select class="temporal-bar__speed" title="Velocidade de reprodução" aria-label="Velocidade de reprodução">
                    ${TEMPORAL_SPEED_OPTIONS.map((s) => `<option value="${s}">${s}x</option>`).join('')}
                </select>
            </div>
            <div class="temporal-bar__timeline">
                <div class="temporal-bar__time" aria-live="polite">—</div>
                <div class="temporal-bar__track" tabindex="0" role="slider" aria-label="Cursor temporal">
                    <div class="temporal-bar__ticks"></div>
                    <div class="temporal-bar__progress"></div>
                    <div class="temporal-bar__keypoints"></div>
                    <div class="temporal-bar__handle"></div>
                </div>
                <div class="temporal-bar__range">
                    <span class="temporal-bar__range-start">—</span>
                    <span class="temporal-bar__range-end">—</span>
                </div>
            </div>
            <div class="temporal-bar__actions">
                <button type="button" class="temporal-bar__btn temporal-bar__settings" title="Configurações temporais" aria-label="Configurações temporais">${ICONS.settings}</button>
            </div>
        `;

        this._root = root;
        this._track = root.querySelector('.temporal-bar__track');
        this._progress = root.querySelector('.temporal-bar__progress');
        this._handle = root.querySelector('.temporal-bar__handle');
        this._ticksEl = root.querySelector('.temporal-bar__ticks');
        this._keypointsEl = root.querySelector('.temporal-bar__keypoints');
        this._timeLabel = root.querySelector('.temporal-bar__time');
        this._rangeStart = root.querySelector('.temporal-bar__range-start');
        this._rangeEnd = root.querySelector('.temporal-bar__range-end');
        this._playBtn = root.querySelector('.temporal-bar__play');
        this._speedSelect = root.querySelector('.temporal-bar__speed');

        parent.appendChild(root);
        this._wireEvents();
        return root;
    }

    _wireEvents() {
        addDomListener(this, this._playBtn, 'click', () => this._cb.onPlayToggle?.());
        addDomListener(this, this._speedSelect, 'change', (e) =>
            this._cb.onSpeedChange?.(Number(e.target.value))
        );
        addDomListener(this, this._root.querySelector('.temporal-bar__settings'), 'click', () =>
            this._cb.onOpenSettings?.()
        );

        // Scrubbing (pointer events cover mouse + touch).
        addDomListener(this, this._track, 'pointerdown', (e) => this._onTrackPointerDown(e));
        addDomListener(this, window, 'pointermove', (e) => this._onPointerMove(e));
        addDomListener(this, window, 'pointerup', (e) => this._onPointerUp(e));

        // Keyboard nudge on the track.
        addDomListener(this, this._track, 'keydown', (e) => this._onTrackKeyDown(e));
    }

    _onTrackPointerDown(e) {
        const pin = e.target.closest('.temporal-bar__keypoint');
        if (pin) {
            this._draggingPin = Number(pin.dataset.index);
            this._track.setPointerCapture?.(e.pointerId);
            e.preventDefault();
            return;
        }
        this._dragging = true;
        this._track.setPointerCapture?.(e.pointerId);
        this._scrubToClientX(e.clientX, true);
        e.preventDefault();
    }

    _onPointerMove(e) {
        if (this._draggingPin >= 0) {
            this._cb.onKeypointDrag?.(this._draggingPin, this._clientXToCursor(e.clientX));
        } else if (this._dragging) {
            this._scrubToClientX(e.clientX, true);
        }
    }

    _onPointerUp(e) {
        if (this._draggingPin >= 0) {
            this._cb.onKeypointCommit?.(this._draggingPin, this._clientXToCursor(e.clientX));
            this._draggingPin = -1;
        }
        this._dragging = false;
    }

    _onTrackKeyDown(e) {
        const step = TEMPORAL_UNITS[this._unidade]?.ms || 0;
        if (e.key === 'ArrowRight') {
            this._cb.onScrub?.(Math.min(this._fim, this._cursor + step));
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            this._cb.onScrub?.(Math.max(this._inicio, this._cursor - step));
            e.preventDefault();
        }
    }

    _clientXToCursor(clientX) {
        const rect = this._track.getBoundingClientRect();
        const frac = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
        return fractionToCursor(frac, this._inicio, this._fim);
    }

    _scrubToClientX(clientX, fireCallback) {
        const cursor = this._clientXToCursor(clientX);
        this.setCursor(cursor);
        if (fireCallback) this._cb.onScrub?.(cursor);
    }

    // ===== View API (driven by the controller) =====

    /** Shows or hides the entire bar. */
    setVisible(visible) {
        if (this._root) this._root.dataset.hidden = visible ? 'false' : 'true';
    }

    /** Sets the timeline range + unit and redraws ticks/labels. */
    setBounds(inicio, fim, unidade) {
        this._inicio = inicio;
        this._fim = fim;
        this._unidade = unidade;
        this._renderTicks();
        if (this._rangeStart) this._rangeStart.textContent = formatInstant(inicio, unidade);
        if (this._rangeEnd) this._rangeEnd.textContent = formatInstant(fim, unidade);
        this.setCursor(this._cursor);
    }

    /** Positions the handle/progress and updates the time label. */
    setCursor(cursor) {
        this._cursor = cursor;
        const frac = cursorToFraction(cursor, this._inicio, this._fim);
        const pct = `${(frac * 100).toFixed(3)}%`;
        if (this._handle) this._handle.style.left = pct;
        if (this._progress) this._progress.style.width = pct;
        if (this._timeLabel) this._timeLabel.textContent = formatInstant(cursor, this._unidade);
        if (this._track) {
            this._track.setAttribute('aria-valuenow', String(Math.round(cursor)));
            this._track.setAttribute('aria-valuetext', formatInstant(cursor, this._unidade));
        }
    }

    /** Reflects playing state on the play/pause button. */
    setPlaying(playing) {
        if (!this._playBtn) return;
        this._playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
        this._playBtn.title = playing ? 'Pausar' : 'Reproduzir';
        this._playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
    }

    /** Reflects the selected playback speed. */
    setSpeed(speed) {
        if (this._speedSelect) this._speedSelect.value = String(speed);
    }

    /**
     * Renders trajectory keypoint pins on the track (or clears them).
     * @param {Array<{t:number}>|null} keypoints - Normalized keypoints, or null.
     */
    setKeypoints(keypoints) {
        if (!this._keypointsEl) return;
        this._keypointsEl.textContent = '';
        if (!Array.isArray(keypoints) || keypoints.length === 0) return;

        const frag = document.createDocumentFragment();
        keypoints.forEach((kp, index) => {
            const pin = document.createElement('div');
            pin.className = 'temporal-bar__keypoint';
            pin.dataset.index = String(index);
            pin.title = `Keypoint ${index + 1}: ${formatInstant(kp.t, this._unidade)}`;
            const frac = cursorToFraction(kp.t, this._inicio, this._fim);
            pin.style.left = `${(frac * 100).toFixed(3)}%`;
            frag.appendChild(pin);
        });
        this._keypointsEl.appendChild(frag);
    }

    /**
     * Repositions a single keypoint pin in time without rebuilding the pin set
     * (so its index stays stable during a drag gesture).
     * @param {number} index - Pin index.
     * @param {number} cursor - New time (epoch ms).
     */
    moveKeypoint(index, cursor) {
        if (!this._keypointsEl) return;
        const pin = this._keypointsEl.querySelector(`.temporal-bar__keypoint[data-index="${index}"]`);
        if (!pin) return;
        const frac = cursorToFraction(cursor, this._inicio, this._fim);
        pin.style.left = `${(frac * 100).toFixed(3)}%`;
        pin.title = `Keypoint ${index + 1}: ${formatInstant(cursor, this._unidade)}`;
    }

    _renderTicks() {
        if (!this._ticksEl) return;
        this._ticksEl.textContent = '';
        const ticks = buildTicks(this._inicio, this._fim, this._unidade);
        if (ticks.length === 0) return;

        const frag = document.createDocumentFragment();
        for (const t of ticks) {
            const mark = document.createElement('div');
            mark.className = 'temporal-bar__tick';
            const frac = cursorToFraction(t, this._inicio, this._fim);
            mark.style.left = `${(frac * 100).toFixed(3)}%`;
            frag.appendChild(mark);
        }
        this._ticksEl.appendChild(frag);
    }

    destroy() {
        cleanup(this);
        removeElement(this._root);
        this._root = null;
    }
}
