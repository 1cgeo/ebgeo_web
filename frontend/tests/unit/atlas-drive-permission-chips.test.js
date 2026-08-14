// Path: tests/unit/atlas-drive-permission-chips.test.js

/**
 * @fileoverview The atlas permission ladder has FIVE levels; the Atlas Drive
 * card chip had a style for only three, and 'manage'/'comment' are grantable
 * from the sharing modal. Reads the stylesheet as text because the rules are
 * the artifact under test (there is no DOM in this environment).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(
    fileURLToPath(new URL('../../src/css/atlas-drive.css', import.meta.url)),
    'utf8',
);

// Canonical ladder, low to high, mirroring PERMISSION_LEVELS in
// backend/src/middleware/permissions.js.
const PERMISSION_LEVELS = ['read', 'comment', 'write', 'manage', 'owner'];

/**
 * Finds a chip modifier rule with a non-empty declaration block.
 * @param {string} level - permission level
 * @returns {boolean} true when the rule exists and declares something
 */
function hasChipRule(level) {
    const rule = new RegExp(`\\.atlas-drive__chip--${level}\\s*(,[^{]*)?\\{([^}]*)\\}`);
    const match = CSS.match(rule);
    return Boolean(match && match[2].trim().length > 0);
}

describe('atlas-drive.css — permission chips', () => {
    it.each(PERMISSION_LEVELS)('styles the "%s" level', (level) => {
        expect(hasChipRule(level)).toBe(true);
    });

    it('does not match a level that does not exist (guards the matcher itself)', () => {
        // Without this, a regex that accidentally matched anything would report
        // five green checks while proving nothing.
        expect(hasChipRule('editor')).toBe(false);
        expect(hasChipRule('')).toBe(false);
    });

    it('keeps the base chip class the modifiers depend on', () => {
        expect(CSS).toMatch(/\.atlas-drive__chip\s*\{/);
    });
});
