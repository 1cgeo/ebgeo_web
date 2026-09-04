import { describe, it, expect } from 'vitest';

import { resolveSetupMode } from '../../src/js/layers/setup-mode.js';

describe('resolveSetupMode', () => {
    it('keeps the content only when the caller says so AND an application source survived', () => {
        expect(resolveSetupMode({ contentPreserved: true }, true)).toBe('preserved');
    });

    it('rebuilds when the caller did not say the map is the same (atlas map switch)', () => {
        expect(resolveSetupMode(undefined, true)).toBe('full');
        expect(resolveSetupMode({}, true)).toBe('full');
        expect(resolveSetupMode({ contentPreserved: false }, true)).toBe('full');
    });

    it('rebuilds when the style swap dropped the application sources (MapLibre full-rebuild fallback)', () => {
        expect(resolveSetupMode({ contentPreserved: true }, false)).toBe('full');
        expect(resolveSetupMode({ contentPreserved: true }, undefined)).toBe('full');
    });
});
