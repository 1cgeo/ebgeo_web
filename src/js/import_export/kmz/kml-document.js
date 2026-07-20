// Path: js/import_export/kmz/kml-document.js

/**
 * @fileoverview Pure assembly of the KML document: style dedupe registry,
 * Placemark/GroundOverlay wrappers, per-layer Folders and the outer envelope.
 *
 * @module import_export/kmz/kml-document
 */

import { escapeXml } from './kml-balloon.js';

/** Folder name used for features whose layer no longer exists. */
export const ORPHAN_FOLDER_NAME = 'Sem camada';

/**
 * Computes a short, stable hash of a string (FNV-1a, 32-bit).
 * Used to turn a style signature into a compact KML id.
 *
 * @param {string} input - String to hash
 * @returns {string} Eight-character lowercase hex hash
 */
export function hashString(input) {
    let hash = 0x811c9dc5;
    const text = String(input ?? '');
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        // 32-bit FNV prime multiply, kept in range via Math.imul.
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Collects unique `<Style>` definitions so identical styles are emitted once
 * and referenced by many Placemarks.
 */
export class StyleRegistry {
    constructor() {
        /** @type {Map<string, string>} signature -> style body XML */
        this._styles = new Map();
    }

    /**
     * Registers a style body and returns the id to reference it by.
     *
     * @param {string} signature - Stable identity of the style
     * @param {string} body - Inner XML of the `<Style>` element
     * @returns {string} Style id, without the leading '#'
     */
    register(signature, body) {
        const id = `s_${hashString(signature)}`;
        if (!this._styles.has(id)) {
            this._styles.set(id, body);
        }
        return id;
    }

    /** @returns {number} Number of distinct styles registered. */
    get size() {
        return this._styles.size;
    }

    /**
     * Serializes every registered style.
     *
     * @returns {string} Concatenated `<Style>` elements
     */
    toXml() {
        const parts = [];
        for (const [id, body] of this._styles) {
            parts.push(`<Style id="${id}">${body}</Style>`);
        }
        return parts.join('');
    }
}

/**
 * Builds a `<Placemark>` element.
 *
 * @param {Object} params - Placemark parts
 * @param {string} [params.name] - Display name (escaped here)
 * @param {string} [params.styleId] - Registered style id
 * @param {string} [params.description] - Prebuilt `<description>` element
 * @param {string} [params.extendedData] - Prebuilt `<ExtendedData>` element
 * @param {string} params.geometry - Prebuilt geometry element
 * @param {boolean} [params.visible=true] - Whether the feature starts visible
 * @returns {string|null} KML fragment, or null when there is no geometry
 */
export function buildPlacemark({
    name,
    styleId,
    description = '',
    extendedData = '',
    geometry,
    visible = true,
} = {}) {
    if (!geometry) return null;

    const nameXml = name ? `<name>${escapeXml(name)}</name>` : '';
    const styleXml = styleId ? `<styleUrl>#${styleId}</styleUrl>` : '';
    const visibilityXml = visible ? '' : '<visibility>0</visibility>';

    return `<Placemark>${nameXml}${visibilityXml}${styleXml}`
        + `${description}${extendedData}${geometry}</Placemark>`;
}

/**
 * Builds a `<GroundOverlay>` element for a georeferenced image.
 *
 * @param {Object} params - Overlay parts
 * @param {string} [params.name] - Display name
 * @param {string} params.href - Relative image path inside the KMZ
 * @param {{north: number, south: number, east: number, west: number, rotation: number}} params.box - Extent
 * @param {string} [params.color] - KML color controlling overlay opacity
 * @param {number} [params.drawOrder=10] - Stacking order below vector Placemarks
 * @param {boolean} [params.visible=true] - Whether the overlay starts visible
 * @param {string} [params.description] - Prebuilt `<description>` element
 * @param {string} [params.extendedData] - Prebuilt `<ExtendedData>` element
 * @returns {string|null} KML fragment, or null when inputs are unusable
 */
export function buildGroundOverlay({
    name,
    href,
    box,
    color,
    drawOrder = 10,
    visible = true,
    description = '',
    extendedData = '',
} = {}) {
    if (!href || !box) return null;
    if (![box.north, box.south, box.east, box.west].every(Number.isFinite)) return null;

    const nameXml = name ? `<name>${escapeXml(name)}</name>` : '';
    const colorXml = color ? `<color>${color}</color>` : '';
    const visibilityXml = visible ? '' : '<visibility>0</visibility>';
    const rotation = Number.isFinite(box.rotation) ? box.rotation : 0;

    return `<GroundOverlay>${nameXml}${visibilityXml}${colorXml}`
        + `<drawOrder>${drawOrder}</drawOrder>${description}${extendedData}`
        + `<Icon><href>${escapeXml(href)}</href></Icon>`
        + `<LatLonBox><north>${box.north}</north><south>${box.south}</south>`
        + `<east>${box.east}</east><west>${box.west}</west>`
        + `<rotation>${rotation}</rotation></LatLonBox></GroundOverlay>`;
}

/**
 * Builds a `<Folder>` element, omitting it entirely when it has no children.
 *
 * @param {Object} params - Folder parts
 * @param {string} params.name - Folder name
 * @param {Array<string>} params.children - Prebuilt child elements
 * @param {boolean} [params.visible=true] - Whether the folder starts visible
 * @param {boolean} [params.open=false] - Whether the folder starts expanded
 * @returns {string|null} KML fragment, or null when there is nothing to show
 */
export function buildFolder({ name, children = [], visible = true, open = false } = {}) {
    const parts = children.filter(Boolean);
    if (parts.length === 0) return null;

    return `<Folder><name>${escapeXml(name)}</name>`
        + `<visibility>${visible ? 1 : 0}</visibility>`
        + `<open>${open ? 1 : 0}</open>`
        + `${parts.join('')}</Folder>`;
}

/**
 * Assembles the complete KML document.
 *
 * @param {Object} params - Document parts
 * @param {string} params.name - Document name (usually the map name)
 * @param {string} [params.description] - Plain-text document description
 * @param {StyleRegistry} params.styles - Registry holding every unique style
 * @param {Array<string>} params.folders - Prebuilt `<Folder>` elements
 * @returns {string} Complete KML document
 */
export function buildKmlDocument({ name, description = '', styles, folders = [] } = {}) {
    const descriptionXml = description
        ? `<description>${escapeXml(description)}</description>`
        : '';
    const stylesXml = styles ? styles.toXml() : '';
    const foldersXml = folders.filter(Boolean).join('');

    return '<?xml version="1.0" encoding="UTF-8"?>'
        + '<kml xmlns="http://www.opengis.net/kml/2.2">'
        + '<Document>'
        + `<name>${escapeXml(name)}</name>`
        + descriptionXml
        + '<open>1</open>'
        + stylesXml
        + foldersXml
        + '</Document>'
        + '</kml>';
}
