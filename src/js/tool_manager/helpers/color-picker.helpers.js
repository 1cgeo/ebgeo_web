// Path: js/tool_manager/helpers/color-picker.helpers.js

/**
 * @fileoverview Modern color picker components for attribute panels.
 * Displays most used colors as circles with custom color option.
 * Uses a global color usage tracking system across all features and attributes.
 */

import { getFrequentColors } from '../../store';

/**
 * Maximum number of frequent colors to show.
 * Grid fits 9 per row × 2 rows = 18 spots.
 * Reserve 1 for current color (if not in top), 1 for custom button = 16 frequent colors max.
 */
const MAX_FREQUENT_COLORS = 16;

/**
 * LocalStorage key for global color usage.
 */
const COLOR_USAGE_KEY = 'ebgeo_global_color_usage';

/**
 * SVG icons used in the color picker.
 */
const ICONS = {
    plus: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
};

// ===== GLOBAL COLOR USAGE SYSTEM =====

/**
 * In-memory cache of global color usage.
 * @type {Map<string, number>|null}
 */
let globalColorCache = null;

/**
 * Flag to track if we've initialized from store.
 */
let hasInitializedFromStore = false;

/**
 * Set of registered color picker grids for live updates.
 * Each entry is { grid, getCurrentColor, onSelect }
 * @type {Set<Object>}
 */
const registeredColorPickers = new Set();

/**
 * Loads global color usage from localStorage.
 * @returns {Map<string, number>} Map of color -> usage count
 */
function loadGlobalColorUsage() {
    if (globalColorCache !== null) {
        return globalColorCache;
    }

    try {
        const stored = localStorage.getItem(COLOR_USAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            globalColorCache = new Map(Object.entries(parsed));
        } else {
            globalColorCache = new Map();
        }
    } catch {
        globalColorCache = new Map();
    }

    return globalColorCache;
}

/**
 * Saves global color usage to localStorage.
 */
function saveGlobalColorUsage() {
    if (!globalColorCache) return;

    try {
        const obj = Object.fromEntries(globalColorCache);
        localStorage.setItem(COLOR_USAGE_KEY, JSON.stringify(obj));
    } catch {
        // Ignore storage errors
    }
}

/**
 * Initializes the color cache from the store's project color cache if our cache is empty.
 * This ensures we have colors from existing features.
 */
function ensureInitializedFromStore() {
    if (hasInitializedFromStore) return;
    hasInitializedFromStore = true;

    const cache = loadGlobalColorUsage();

    // If we already have colors, don't override
    if (cache.size > 0) return;

    try {
        // Get colors from the store's project-wide cache
        const storeColors = getFrequentColors(50, 'project');

        for (const { color, count } of storeColors) {
            if (color && typeof color === 'string') {
                const normalized = normalizeColor(color);
                cache.set(normalized, count || 1);
            }
        }

        if (cache.size > 0) {
            saveGlobalColorUsage();
        }
    } catch {
        // Ignore initialization errors
    }
}

/**
 * Tracks usage of a color (increments its count).
 * Also triggers refresh of all registered color pickers.
 * @param {string} color - Color hex value
 */
function trackColorUsage(color) {
    if (!color) return;

    const normalized = normalizeColor(color);
    const cache = loadGlobalColorUsage();
    const currentCount = cache.get(normalized) || 0;
    cache.set(normalized, currentCount + 1);

    // Debounce save
    clearTimeout(trackColorUsage._saveTimeout);
    trackColorUsage._saveTimeout = setTimeout(saveGlobalColorUsage, 500);

    // Debounce refresh of all pickers
    clearTimeout(trackColorUsage._refreshTimeout);
    trackColorUsage._refreshTimeout = setTimeout(refreshAllColorPickers, 50);
}

/**
 * Refreshes all registered color picker grids.
 * Called when the frequent colors list changes.
 */
function refreshAllColorPickers() {
    for (const picker of registeredColorPickers) {
        // Check if the grid is still in the DOM
        if (!picker.grid.isConnected) {
            registeredColorPickers.delete(picker);
            continue;
        }
        // Rebuild the grid with current color
        buildColorGrid(picker.grid, picker.getCurrentColor(), picker.onSelect);
    }
}

/**
 * Gets the most frequently used colors globally.
 * Merges localStorage cache with store's project colors.
 * @param {number} limit - Maximum number of colors to return
 * @returns {string[]} Array of color hex values, sorted by usage (most used first)
 */
function getGlobalFrequentColors(limit = MAX_FREQUENT_COLORS) {
    // Ensure we have data from the store
    ensureInitializedFromStore();

    const cache = loadGlobalColorUsage();

    // Also get colors from the store's project cache and merge
    try {
        const storeColors = getFrequentColors(50, 'project');
        for (const { color, count } of storeColors) {
            if (color && typeof color === 'string') {
                const normalized = normalizeColor(color);
                // Add store counts to our cache (but don't double count if already tracked)
                if (!cache.has(normalized)) {
                    cache.set(normalized, count || 1);
                }
            }
        }
    } catch {
        // Ignore errors
    }

    return Array.from(cache.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([color]) => color);
}

// ===== COLOR UTILITIES =====

/**
 * Normalizes a color to uppercase 6-digit hex format.
 * Strips alpha channel if present (#RRGGBBAA -> #RRGGBB).
 * @param {string} color - Color value
 * @returns {string} Normalized color (6-digit hex)
 */
function normalizeColor(color) {
    if (!color) return '#000000';
    let normalized = color.toUpperCase();
    // Strip alpha channel if present (#RRGGBBAA -> #RRGGBB)
    if (normalized.length === 9 && normalized.startsWith('#')) {
        normalized = normalized.slice(0, 7);
    }
    return normalized;
}

/**
 * Determines if a color is light (for contrast purposes).
 * @param {string} color - Hex color
 * @returns {boolean} True if color is light
 */
function isLightColor(color) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
}

// ===== COLOR PICKER COMPONENT =====

/**
 * Creates a modern color picker with circle swatches.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.label - Label text for the color picker (header)
 * @param {string} config.value - Initial color value (hex)
 * @param {Function} config.onChange - Callback when color changes (receives color string)
 * @returns {HTMLElement} Color picker container element
 */
export function createModernColorPicker(config) {
    const { label, value, onChange } = config;
    let currentColor = normalizeColor(value);

    const container = document.createElement('div');
    container.className = 'color-picker-circles';

    // Header
    const header = document.createElement('div');
    header.className = 'color-picker-circles-header';
    header.textContent = label;
    container.appendChild(header);

    // Colors grid
    const grid = document.createElement('div');
    grid.className = 'color-picker-circles-grid';

    // Handler for color selection
    const handleColorSelect = (selectedColor) => {
        const normalized = normalizeColor(selectedColor);
        currentColor = normalized;

        // Track this color usage
        trackColorUsage(normalized);

        // Update UI (will be done by refreshAllColorPickers, but do immediately for responsiveness)
        updateGridColors(grid, normalized, handleColorSelect);

        // Notify parent
        onChange(normalized);
    };

    // Register this picker for live updates
    const pickerRef = {
        grid,
        getCurrentColor: () => currentColor,
        onSelect: handleColorSelect
    };
    registeredColorPickers.add(pickerRef);

    // Build initial grid
    buildColorGrid(grid, currentColor, handleColorSelect);

    container.appendChild(grid);

    // Cleanup when removed from DOM (using MutationObserver)
    const observer = new MutationObserver((mutations, obs) => {
        if (!container.isConnected) {
            registeredColorPickers.delete(pickerRef);
            obs.disconnect();
        }
    });
    // Observe parent changes when container is added to DOM
    requestAnimationFrame(() => {
        if (container.parentNode) {
            observer.observe(container.parentNode, { childList: true });
        }
    });

    return container;
}

/**
 * Builds the color grid with frequent colors, current color, and custom button.
 *
 * @param {HTMLElement} grid - Grid container
 * @param {string} currentColor - Currently selected color
 * @param {Function} onSelect - Selection handler
 */
function buildColorGrid(grid, currentColor, onSelect) {
    grid.innerHTML = '';

    // Get frequent colors (globally tracked, sorted by usage)
    const frequentColors = getGlobalFrequentColors(MAX_FREQUENT_COLORS);

    // Deduplicate (should already be unique, but ensure)
    const seenColors = new Set();
    const uniqueFrequentColors = [];

    for (const color of frequentColors) {
        const normalized = normalizeColor(color);
        if (!seenColors.has(normalized)) {
            seenColors.add(normalized);
            uniqueFrequentColors.push(normalized);
        }
    }

    // Check if current color is already in frequent list
    const normalizedCurrent = normalizeColor(currentColor);
    const currentInFrequent = seenColors.has(normalizedCurrent);

    // Build final color list
    let colorsToShow;

    if (currentInFrequent) {
        // Current color is in frequent list, show all frequent colors
        colorsToShow = uniqueFrequentColors.slice(0, MAX_FREQUENT_COLORS);
    } else if (normalizedCurrent && normalizedCurrent !== '#000000') {
        // Current color not in frequent list, make room for it
        colorsToShow = uniqueFrequentColors.slice(0, MAX_FREQUENT_COLORS - 1);
        colorsToShow.push(normalizedCurrent);
    } else {
        colorsToShow = uniqueFrequentColors.slice(0, MAX_FREQUENT_COLORS);
    }

    // Render color circles
    colorsToShow.forEach((color) => {
        const circle = createColorCircle(color, normalizedCurrent, onSelect);
        grid.appendChild(circle);
    });

    // Add custom color button (+ button) - always last
    const customButton = createCustomColorButton(normalizedCurrent, onSelect);
    grid.appendChild(customButton);
}

/**
 * Updates the grid with new colors (called when selection changes).
 *
 * @param {HTMLElement} grid - Grid container
 * @param {string} currentColor - Currently selected color
 * @param {Function} onSelect - Selection handler
 */
function updateGridColors(grid, currentColor, onSelect) {
    // Rebuild the entire grid to reflect current frequent colors
    buildColorGrid(grid, currentColor, onSelect);
}

/**
 * Creates a color circle button.
 *
 * @param {string} color - Circle color
 * @param {string} currentColor - Currently selected color
 * @param {Function} onSelect - Callback when circle is clicked
 * @returns {HTMLElement} Circle button element
 */
function createColorCircle(color, currentColor, onSelect) {
    const normalized = normalizeColor(color);
    const circle = document.createElement('button');
    circle.type = 'button';
    circle.className = 'color-picker-circle';
    circle.style.backgroundColor = color;
    circle.dataset.color = normalized;
    circle.title = normalized;

    // Add border for white/light colors
    if (isLightColor(color)) {
        circle.classList.add('light-color');
    }

    if (normalized === normalizeColor(currentColor)) {
        circle.classList.add('selected');
        addCheckIcon(circle, color);
    }

    circle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(normalized);
    });

    return circle;
}

/**
 * Creates the custom color button with + icon.
 *
 * @param {string} currentColor - Currently selected color (for picker initial value)
 * @param {Function} onSelect - Callback when color is selected
 * @returns {HTMLElement} Custom color button element
 */
function createCustomColorButton(currentColor, onSelect) {
    const wrapper = document.createElement('div');
    wrapper.className = 'color-picker-custom-wrapper';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-picker-circle color-picker-custom-btn';
    button.title = 'Cor personalizada';
    button.innerHTML = ICONS.plus;

    // Hidden native color input
    const nativeInput = document.createElement('input');
    nativeInput.type = 'color';
    nativeInput.value = currentColor || '#000000';
    nativeInput.className = 'color-picker-native-hidden';

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        nativeInput.click();
    });

    // Only trigger on final selection (change), not during dragging (input)
    nativeInput.addEventListener('change', (e) => {
        const color = normalizeColor(e.target.value);
        onSelect(color);
    });

    wrapper.appendChild(button);
    wrapper.appendChild(nativeInput);

    return wrapper;
}

/**
 * Adds check icon to selected circle.
 *
 * @param {HTMLElement} circle - Circle element
 * @param {string} color - Circle color
 */
function addCheckIcon(circle, color) {
    const checkIcon = document.createElement('span');
    checkIcon.className = 'color-picker-check';
    checkIcon.innerHTML = ICONS.check;
    checkIcon.style.color = isLightColor(color) ? '#333' : '#fff';
    circle.appendChild(checkIcon);
}

/**
 * Resets the color cache (useful for testing or when data changes significantly).
 */
export function resetColorCache() {
    globalColorCache = null;
    hasInitializedFromStore = false;
    localStorage.removeItem(COLOR_USAGE_KEY);
    // Clear registered pickers (they will be re-registered when rebuilt)
    registeredColorPickers.clear();
}

/**
 * Tracks a color programmatically (for colors set without using the picker).
 * This is exported so other modules can track colors when they set them directly.
 * @param {string} color - Color hex value
 */
export { trackColorUsage };
