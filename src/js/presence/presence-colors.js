// Path: js/presence/presence-colors.js

/**
 * @fileoverview Deterministic per-user visual identity for presence — a stable color and
 * initials derived from a user key (userId, falling back to clientId/name). The SAME key
 * always yields the SAME color, so a collaborator is recognizable by color across the
 * online-users roster AND their live cursor on the map.
 *
 * The palette is a curated set of distinct hues, each dark enough for white text to read
 * on it (used as avatar / cursor-label backgrounds).
 */

/** Curated, visually-distinct palette (≈ Tailwind 600 weights — white text reads on all). */
const PRESENCE_PALETTE = Object.freeze([
    '#2563eb', // blue
    '#7c3aed', // violet
    '#db2777', // pink
    '#dc2626', // red
    '#ea580c', // orange
    '#ca8a04', // yellow-700
    '#16a34a', // green
    '#0d9488', // teal
    '#0891b2', // cyan
    '#4f46e5', // indigo
    '#c026d3', // fuchsia
    '#e11d48', // rose
    '#059669', // emerald
    '#65a30d', // lime-700
]);

/**
 * Stable 32-bit string hash (djb2). Deterministic across clients for the same key.
 * @param {string} str
 * @returns {number} Non-negative hash.
 */
function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0; // hash * 33 + c
    }
    return Math.abs(hash);
}

/**
 * Resolves a stable color for a presence key. Same key → same palette color, app-wide.
 * @param {string} key - User id (preferred), else client id or name.
 * @returns {string} A hex color from the palette.
 */
export function getPresenceColor(key) {
    const k = (key == null ? '' : String(key)).trim();
    if (!k) return PRESENCE_PALETTE[0];
    return PRESENCE_PALETTE[hashString(k) % PRESENCE_PALETTE.length];
}

/**
 * Builds up to two uppercase initials from a display name. "João Silva" → "JS",
 * "alfa" → "AL", "" → "?". Diacritics are preserved (uppercased).
 * @param {string} name
 * @returns {string} 1–2 character initials.
 */
export function getInitials(name) {
    const clean = (name == null ? '' : String(name)).trim();
    if (!clean) return '?';
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
        return words[0].slice(0, 2).toUpperCase();
    }
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export { PRESENCE_PALETTE };
