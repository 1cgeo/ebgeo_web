// Path: js/phone/phone-icons.constants.js

/**
 * @fileoverview Shared SVG icon constants for phone layout components.
 * All icons are static markup (no user data) and safe for innerHTML.
 */

// ============================================================================
// FEATURE TYPE ICONS (14x14, used in bottom sheet layer tree)
// ============================================================================

/** @type {Object<string, string>} SVG icons keyed by feature type */
export const FEATURE_TYPE_ICONS_14 = Object.freeze({
    point: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3"/></svg>',
    line: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="13" x2="13" y2="3"/></svg>',
    polygon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="8,2 14,6 12,13 4,13 2,6"/></svg>',
    circle: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/></svg>',
    ellipse: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="8" rx="7" ry="5"/></svg>',
    rectangle: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10"/></svg>',
    text: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h10v2H9v8H7V5H3V3z"/></svg>',
    sector: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 8L3 3A7 7 0 0 1 13 3Z"/></svg>',
    brush: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 13c2-2 3-4 5-6s4-3 5-4"/></svg>',
    image: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.5" fill="currentColor"/><path d="M2 11l3-3 2 2 3-3 4 4"/></svg>',
    arrow: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="13" x2="13" y2="3"/><polyline points="7,3 13,3 13,9"/></svg>',
    boundary: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"><rect x="2" y="2" width="12" height="12"/></svg>',
    occupied_front: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8h12"/><path d="M5 5l3 3-3 3M8 5l3 3-3 3"/></svg>',
    coordination_line: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8h4"/><path d="M5 8l3-3 3 3-3 3z"/><path d="M11 8h4"/></svg>',
    military_symbol: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="10" height="8"/><line x1="8" y1="4" x2="8" y2="2"/></svg>',
    coordination_measure: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>',
});

/** Default icon for unknown feature types (14x14) */
export const DEFAULT_FEATURE_ICON_14 = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="2"/></svg>';

// ============================================================================
// FEATURE TYPE ICONS (16x16, used in feature editor)
// ============================================================================

/** @type {Object<string, string>} SVG icons keyed by feature type */
export const FEATURE_TYPE_ICONS_16 = Object.freeze({
    point: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/></svg>',
    line: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="13" x2="13" y2="3"/></svg>',
    polygon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><polygon points="8,2 14,6 12,13 4,13 2,6"/></svg>',
    circle: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/></svg>',
    ellipse: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="8" rx="6" ry="4"/></svg>',
    rectangle: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="12" height="8" rx="1"/></svg>',
    text: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="4" y1="3" x2="12" y2="3"/><line x1="8" y1="3" x2="8" y2="13"/><line x1="6" y1="13" x2="10" y2="13"/></svg>',
    sector: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 8 L14 8 A6 6 0 0 0 8 2 Z"/></svg>',
    brush: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 13 Q5 8 8 9 Q11 10 13 3"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.5"/><path d="M2 11 L6 8 L9 10 L12 7 L14 9"/></svg>',
});

/** Default icon for feature types not in the map (16x16) */
export const DEFAULT_FEATURE_ICON_16 = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="10" height="10" rx="2"/></svg>';

// ============================================================================
// COMMON ICONS
// ============================================================================

/** Chevron icon for expand/collapse (used in bottom sheet and drawer) */
export const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

/** Close (X) icon for feature deselect / modal close */
export const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the 14x14 SVG icon for a feature type (bottom sheet tree).
 * @param {string} featureType - Feature type string
 * @returns {string} SVG markup
 */
export function getFeatureIcon14(featureType) {
    return FEATURE_TYPE_ICONS_14[featureType] || DEFAULT_FEATURE_ICON_14;
}

/**
 * Get the 16x16 SVG icon for a feature type (feature editor).
 * @param {string} featureType - Feature type string
 * @returns {string} SVG markup
 */
export function getFeatureIcon16(featureType) {
    return FEATURE_TYPE_ICONS_16[featureType] || DEFAULT_FEATURE_ICON_16;
}
