// Path: js/import_export/kmz/kml-balloon.js

/**
 * @fileoverview Pure builders for Placemark text content: XML escaping,
 * the `<description>` balloon (CDATA HTML) and `<ExtendedData>` attributes.
 *
 * This module deliberately does NOT use `escapeHtml` from `@utils/html-escape.js`:
 * that helper relies on `document.createElement`, which does not exist in the
 * node test environment, and XML escaping is the correct semantics here anyway.
 *
 * @module import_export/kmz/kml-balloon
 */

/** Width applied to embedded photos in the balloon, in CSS pixels. */
const PHOTO_WIDTH = 240;

/**
 * Escapes the five XML predefined entities.
 * Safe for both element text and attribute values.
 *
 * @param {*} value - Value to escape (coerced to string; null/undefined -> '')
 * @returns {string} XML-safe string
 */
export function escapeXml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Makes a payload safe to place inside a CDATA section.
 *
 * A literal `]]>` anywhere in user text would terminate the CDATA block early
 * and produce invalid KML. The standard fix is to split the sequence across
 * two CDATA sections.
 *
 * @param {string} payload - Raw CDATA content
 * @returns {string} Content that cannot terminate the section prematurely
 */
export function makeCdataSafe(payload) {
    if (typeof payload !== 'string') return '';
    return payload.split(']]>').join(']]]]><![CDATA[>');
}

/**
 * Wraps content in a CDATA section, escaping any premature terminator.
 *
 * @param {string} payload - Content to wrap
 * @returns {string} CDATA section
 */
export function wrapCdata(payload) {
    return `<![CDATA[${makeCdataSafe(payload)}]]>`;
}

/**
 * Parses a data URL into its MIME type and base64 payload.
 *
 * @param {string} dataUrl - Data URL (`data:image/png;base64,...`)
 * @returns {{ mime: string, base64: string, extension: string }|null} Parts, or null if unparseable
 */
export function parseDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string') return null;
    const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/s);
    if (!match) return null;

    const mime = match[1].toLowerCase();
    const base64 = match[2];
    if (!base64) return null;

    return { mime, base64, extension: extensionForMime(mime) };
}

/**
 * Maps an image MIME type to a file extension.
 *
 * @param {string} mime - MIME type
 * @returns {string} File extension without the dot
 */
export function extensionForMime(mime) {
    switch (mime) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        case 'image/svg+xml':
            return 'svg';
        default:
            return 'bin';
    }
}

/**
 * Reduces a string to characters that are safe in a zip entry path.
 * Prevents both path traversal and archive corruption from exotic names.
 *
 * @param {*} value - Candidate path segment
 * @param {string} [fallback='item'] - Value used when nothing usable remains
 * @returns {string} Safe, non-empty path segment
 */
export function sanitizePathSegment(value, fallback = 'item') {
    if (value == null) return fallback;

    const cleaned = String(value)
        // Separators and exotic characters become underscores, so no path
        // structure can survive inside a single segment.
        .replace(/[^A-Za-z0-9._-]/g, '_')
        // Collapse dot runs so no "..' traversal marker remains in the name.
        .replace(/\.{2,}/g, '_')
        .replace(/^\.+/, '');

    // A segment of only separators carries no identity — prefer the fallback.
    if (!/[A-Za-z0-9]/.test(cleaned)) return fallback;

    return cleaned.slice(0, 64);
}

/**
 * Builds the `<ExtendedData>` block from feature attributes.
 *
 * Includes the user's custom attributes (`properties.attributes`) plus any
 * extra key/value pairs the caller wants preserved, such as style aspects that
 * KML cannot represent.
 *
 * @param {Object} properties - Feature properties
 * @param {Object} [extras={}] - Additional key/value pairs to record
 * @returns {string} KML fragment, or an empty string when there is nothing to record
 */
export function buildExtendedData(properties = {}, extras = {}) {
    const entries = [];

    if (properties.nome) entries.push(['nome', properties.nome]);
    if (properties.descricao) entries.push(['descricao', properties.descricao]);

    const attributes = properties.attributes;
    if (attributes && typeof attributes === 'object') {
        for (const [key, value] of Object.entries(attributes)) {
            if (value == null || value === '') continue;
            entries.push([key, value]);
        }
    }

    for (const [key, value] of Object.entries(extras)) {
        if (value == null || value === '') continue;
        entries.push([key, value]);
    }

    if (entries.length === 0) return '';

    const data = entries
        .map(([key, value]) =>
            `<Data name="${escapeXml(key)}"><value>${escapeXml(value)}</value></Data>`)
        .join('');

    return `<ExtendedData>${data}</ExtendedData>`;
}

/**
 * Builds the `<description>` balloon as a CDATA-wrapped HTML fragment.
 *
 * @param {Object} params - Balloon inputs
 * @param {Object} params.properties - Feature properties
 * @param {Array<{href: string, name: string}>} [params.photos=[]] - Embedded photo references
 * @param {Array<string>} [params.notes=[]] - Human-readable notes (e.g. style degradation)
 * @returns {string} `<description>` element, or an empty string when there is no content
 */
export function buildDescription({ properties = {}, photos = [], notes = [] } = {}) {
    const sections = [];

    if (properties.nome) {
        sections.push(`<h3>${escapeXml(properties.nome)}</h3>`);
    }

    if (properties.descricao) {
        // Preserve author line breaks; the text is escaped first so the <br>
        // we insert is the only markup that survives.
        const paragraph = escapeXml(properties.descricao).replace(/\r?\n/g, '<br/>');
        sections.push(`<p>${paragraph}</p>`);
    }

    const attributes = properties.attributes;
    if (attributes && typeof attributes === 'object') {
        const rows = Object.entries(attributes)
            .filter(([, value]) => value != null && value !== '')
            .map(([key, value]) =>
                `<tr><th align="left">${escapeXml(key)}</th><td>${escapeXml(value)}</td></tr>`)
            .join('');
        if (rows) {
            sections.push(`<table border="0" cellpadding="4">${rows}</table>`);
        }
    }

    if (notes.length > 0) {
        const items = notes.map(note => `<li>${escapeXml(note)}</li>`).join('');
        sections.push(`<ul>${items}</ul>`);
    }

    if (photos.length > 0) {
        const images = photos
            .filter(photo => photo && photo.href)
            .map((photo) => {
                const href = escapeXml(photo.href);
                const caption = photo.name ? `<div>${escapeXml(photo.name)}</div>` : '';
                return `<div><a href="${href}"><img src="${href}" width="${PHOTO_WIDTH}"/></a>${caption}</div>`;
            })
            .join('');
        if (images) sections.push(images);
    }

    if (sections.length === 0) return '';

    return `<description>${wrapCdata(sections.join(''))}</description>`;
}
