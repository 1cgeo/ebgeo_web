// Path: src/js/phone/phone-search-overlay.js

/**
 * @fileoverview Phone search overlay component.
 * Floating search pill + full-screen search overlay for the phone layout (<=480px).
 *
 * The pill is always visible. Tapping it opens a full-screen overlay with an
 * input field and result list.
 *
 * This component does NOT implement search logic — it exposes callbacks
 * (onSearch, onResultSelect) for the layout orchestrator to wire up.
 */

import { setupCleanup, addDomListener, trackTimer, cleanup, removeElement } from '@utils/event-cleanup.js';

// ---------------------------------------------------------------------------
// SVG Icons
// ---------------------------------------------------------------------------

const SEARCH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

const BACK_ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;

const LOCATION_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_DELAY_MS = 300;

/**
 * Phone search overlay with floating pill and full-screen search mode.
 */
export class PhoneSearchOverlay {
    /**
     * @param {Object} options
     * @param {import('maplibre-gl').Map} options.map - MapLibre map instance
     */
    constructor({ map }) {
        /** @private */
        this._map = map;

        setupCleanup(this);

        /** @private @type {HTMLElement|null} */
        this._pill = null;

        /** @private @type {HTMLElement|null} */
        this._overlay = null;

        /** @private @type {HTMLInputElement|null} */
        this._input = null;

        /** @private @type {HTMLElement|null} */
        this._resultsContainer = null;

        /** @private @type {boolean} */
        this._isOpen = false;

        /** @private @type {Function|null} */
        this._searchCallback = null;

        /** @private @type {Function|null} */
        this._resultSelectCallback = null;

        /** @private @type {Function|null} */
        this._hamburgerCallback = null;

        /** @private @type {HTMLElement|null} */
        this._hamburgerBtn = null;

        /** @private @type {number|null} */
        this._debounceTimer = null;

        /** @private @type {Array<Object>} */
        this._results = [];

        // Bind handlers once so they can be removed
        /** @private */
        this._handleKeyDown = this._onKeyDown.bind(this);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Append the pill and overlay elements to the given parent.
     * @param {HTMLElement} parent
     */
    mount(parent) {
        this._buildPill();
        this._buildOverlay();

        parent.appendChild(this._pill);
        parent.appendChild(this._overlay);

        this._bindEvents();
    }

    /**
     * Remove all DOM elements and clean up listeners / timers.
     */
    destroy() {
        this._clearDebounce();

        cleanup(this);

        removeElement(this._pill);
        removeElement(this._overlay);

        this._pill = null;
        this._overlay = null;
        this._input = null;
        this._resultsContainer = null;
        this._hamburgerBtn = null;
        this._searchCallback = null;
        this._resultSelectCallback = null;
        this._hamburgerCallback = null;
        this._results = [];
    }

    /**
     * Open the full-screen overlay and focus the input.
     */
    open() {
        if (this._isOpen) return;
        this._isOpen = true;

        this._overlay.removeAttribute('hidden');
        // Use requestAnimationFrame to ensure the overlay is rendered before focusing
        requestAnimationFrame(() => {
            if (this._input) {
                this._input.focus();
            }
        });
    }

    /**
     * Close the overlay, blur the input, and clear the query.
     */
    close() {
        if (!this._isOpen) return;
        this._isOpen = false;

        if (this._input) {
            this._input.value = '';
            this._input.blur();
        }

        this._overlay.setAttribute('hidden', '');
        this.clearResults();
    }

    /**
     * Whether the full-screen overlay is currently visible.
     * @returns {boolean}
     */
    isOpen() {
        return this._isOpen;
    }

    /**
     * Populate the results list.
     * @param {Array<{id: string, text: string, subtitle?: string, icon?: string, coordinates?: [number, number]}>} results
     */
    setResults(results) {
        this._results = results;
        this._renderResults();
    }

    /**
     * Clear all results from the list.
     */
    clearResults() {
        this._results = [];
        this._renderResults();
    }

    /**
     * Register a callback invoked when the user types a query.
     * The callback receives the trimmed query string (debounced 300ms).
     * @param {Function} callback - (query: string) => void
     */
    onSearch(callback) {
        this._searchCallback = callback;
    }

    /**
     * Register a callback invoked when the user selects a result.
     * @param {Function} callback - (result: Object) => void
     */
    onResultSelect(callback) {
        this._resultSelectCallback = callback;
    }

    /**
     * Register a callback invoked when the hamburger menu button is tapped.
     * @param {Function} callback - () => void
     */
    onHamburgerTap(callback) {
        this._hamburgerCallback = callback;
    }

    // -----------------------------------------------------------------------
    // DOM construction
    // -----------------------------------------------------------------------

    /** @private */
    _buildPill() {
        const pill = document.createElement('div');
        pill.className = 'phone-search-bar';

        // Hamburger menu button
        const hamburger = document.createElement('button');
        hamburger.className = 'phone-search-bar__hamburger';
        hamburger.setAttribute('aria-label', 'Menu');
        hamburger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
        this._hamburgerBtn = hamburger;

        // Search icon
        const icon = document.createElement('div');
        icon.className = 'phone-search-bar__icon';
        icon.innerHTML = SEARCH_ICON_SVG;

        // Placeholder text
        const text = document.createElement('span');
        text.className = 'phone-search-bar__text';
        text.textContent = 'Pesquisar no mapa...';

        pill.appendChild(hamburger);
        pill.appendChild(icon);
        pill.appendChild(text);

        this._pill = pill;
    }

    /** @private */
    _buildOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'phone-search-overlay';
        overlay.setAttribute('hidden', '');

        // ---- Header ----
        const header = document.createElement('div');
        header.className = 'phone-search-overlay__header';

        const backBtn = document.createElement('button');
        backBtn.className = 'phone-search-overlay__back';
        backBtn.setAttribute('type', 'button');
        backBtn.setAttribute('aria-label', 'Voltar');
        backBtn.innerHTML = BACK_ARROW_SVG;

        const input = document.createElement('input');
        input.className = 'phone-search-overlay__input';
        input.type = 'text';
        input.placeholder = 'Pesquisar no mapa...';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');

        header.appendChild(backBtn);
        header.appendChild(input);

        // ---- Results ----
        const results = document.createElement('div');
        results.className = 'phone-search-overlay__results';

        overlay.appendChild(header);
        overlay.appendChild(results);

        this._overlay = overlay;
        this._input = input;
        this._resultsContainer = results;
    }

    // -----------------------------------------------------------------------
    // Event binding
    // -----------------------------------------------------------------------

    /** @private */
    _bindEvents() {
        // Hamburger tap → fire hamburger callback
        addDomListener(this, this._hamburgerBtn, 'click', (e) => {
            e.stopPropagation(); // Prevent pill click from opening search
            if (this._hamburgerCallback) {
                this._hamburgerCallback();
            }
        });

        // Pill tap → open overlay
        addDomListener(this, this._pill, 'click', () => this.open());

        // Back button → close overlay
        const backBtn = this._overlay.querySelector('.phone-search-overlay__back');
        addDomListener(this, backBtn, 'click', () => this.close());

        // Input typing → debounced search callback
        addDomListener(this, this._input, 'input', () => this._onInputChange());

        // ESC key → close overlay
        addDomListener(this, document, 'keydown', this._handleKeyDown);
    }

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------

    /** @private */
    _onKeyDown(e) {
        if (e.key === 'Escape' && this._isOpen) {
            e.preventDefault();
            this.close();
        }
    }

    // -----------------------------------------------------------------------
    // Search input
    // -----------------------------------------------------------------------

    /** @private */
    _onInputChange() {
        this._clearDebounce();

        const query = this._input.value.trim();

        const timerId = setTimeout(() => {
            if (this._searchCallback) {
                this._searchCallback(query);
            }
        }, DEBOUNCE_DELAY_MS);

        this._debounceTimer = timerId;
        trackTimer(this, timerId, 'timeout');
    }

    // -----------------------------------------------------------------------
    // Results rendering
    // -----------------------------------------------------------------------

    /** @private */
    _renderResults() {
        if (!this._resultsContainer) return;

        // Clear existing content
        this._resultsContainer.textContent = '';

        if (this._results.length === 0) {
            // Only show empty state when the user has typed something
            if (this._input && this._input.value.trim().length > 0) {
                const empty = document.createElement('div');
                empty.className = 'phone-search-overlay__empty';
                empty.textContent = 'Nenhum resultado encontrado';
                this._resultsContainer.appendChild(empty);
            }
            return;
        }

        // Group results by section (subtitle-based) or render flat list
        const hasRecent = this._results.some(r => r._section === 'recent');
        const hasSearch = this._results.some(r => r._section === 'search');

        if (hasRecent || hasSearch) {
            this._renderGroupedResults();
        } else {
            // Default: render under "Resultados da busca"
            const title = document.createElement('div');
            title.className = 'phone-search-overlay__section-title';
            title.textContent = 'Resultados da busca';
            this._resultsContainer.appendChild(title);

            for (const result of this._results) {
                this._resultsContainer.appendChild(this._createResultItem(result));
            }
        }
    }

    /** @private */
    _renderGroupedResults() {
        const recent = this._results.filter(r => r._section === 'recent');
        const search = this._results.filter(r => r._section === 'search');
        const other = this._results.filter(r => !r._section);

        if (recent.length > 0) {
            const title = document.createElement('div');
            title.className = 'phone-search-overlay__section-title';
            title.textContent = 'Resultados recentes';
            this._resultsContainer.appendChild(title);

            for (const result of recent) {
                this._resultsContainer.appendChild(this._createResultItem(result));
            }
        }

        if (search.length > 0 || other.length > 0) {
            const title = document.createElement('div');
            title.className = 'phone-search-overlay__section-title';
            title.textContent = 'Resultados da busca';
            this._resultsContainer.appendChild(title);

            for (const result of [...search, ...other]) {
                this._resultsContainer.appendChild(this._createResultItem(result));
            }
        }
    }

    /**
     * Create a single result item element.
     * @private
     * @param {Object} result - { id, text, subtitle?, icon?, coordinates? }
     * @returns {HTMLElement}
     */
    _createResultItem(result) {
        const item = document.createElement('div');
        item.className = 'phone-search-overlay__result-item';

        // Icon
        const icon = document.createElement('div');
        icon.className = 'phone-search-overlay__result-icon';
        icon.innerHTML = LOCATION_ICON_SVG;

        // Text container
        const textContainer = document.createElement('div');

        const textEl = document.createElement('div');
        textEl.className = 'phone-search-overlay__result-text';
        textEl.textContent = result.text || '';

        textContainer.appendChild(textEl);

        if (result.subtitle) {
            const subtitleEl = document.createElement('div');
            subtitleEl.className = 'phone-search-overlay__result-subtitle';
            subtitleEl.textContent = result.subtitle;
            textContainer.appendChild(subtitleEl);
        }

        item.appendChild(icon);
        item.appendChild(textContainer);

        // Tap → fire result select callback
        addDomListener(this, item, 'click', () => {
            if (this._resultSelectCallback) {
                this._resultSelectCallback(result);
            }
        });

        return item;
    }

    // -----------------------------------------------------------------------
    // Timer helpers
    // -----------------------------------------------------------------------

    /** @private */
    _clearDebounce() {
        if (this._debounceTimer !== null) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
    }
}
