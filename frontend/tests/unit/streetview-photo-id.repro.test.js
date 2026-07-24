import { describe, it, expect } from 'vitest';
import { isUUID } from '../../src/js/street_view_tool/streetview-api.service.js';

/**
 * Regression: `isUUID` pinned the version nibble to 4, so it rejected every real
 * photo id. The studio mints them as UUID **v5** and the backend validates them
 * that way (`.guid({ version: ['uuidv5'] })` in sv360.schemas.js,
 * sv360.write.schemas.js and sv360.admin.schemas.js).
 *
 * The two call sites in the same module branch on this predicate, and both took
 * the wrong branch: `resolveToUUID` sent a valid id off to be resolved as a
 * legacy filename, and `getPhotoDisplayName` returned early with the raw id as
 * the "display name" — which is what the briefing editor
 * (`briefing-editor.control.js:1433`) and the 360 section of the features tab
 * (`streetview360-section.component.js:86`) render to the operator.
 *
 * The predicate's job is to tell a UUID apart from a legacy filename, so the
 * shape is what matters, not the version.
 */
describe('isUUID (photo id vs legacy filename)', () => {
    it('accepts a v5 uuid — the version the studio actually mints', () => {
        expect(isUUID('a6c3f0d2-7b1e-5c4a-9f3d-2e8b7a1c4d60')).toBe(true);
    });

    it('accepts a v4 uuid', () => {
        expect(isUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    });

    it('accepts every version nibble 1-8', () => {
        for (const v of '12345678') {
            const id = `a6c3f0d2-7b1e-${v}c4a-9f3d-2e8b7a1c4d60`;
            expect(isUUID(id), `version ${v} rejected`).toBe(true);
        }
    });

    it('is case-insensitive', () => {
        expect(isUUID('A6C3F0D2-7B1E-5C4A-9F3D-2E8B7A1C4D60')).toBe(true);
    });

    it('rejects the legacy filenames it exists to discriminate', () => {
        for (const name of ['IMG_0042.jpg', 'foto-360.webp', 'ponto_01', '']) {
            expect(isUUID(name), `${name} accepted`).toBe(false);
        }
    });

    it('rejects malformed uuid-ish strings', () => {
        const bad = [
            'a6c3f0d2-7b1e-5c4a-9f3d-2e8b7a1c4d6',    // short last group
            'a6c3f0d2-7b1e-5c4a-9f3d-2e8b7a1c4d600',  // long last group
            'a6c3f0d27b1e5c4a9f3d2e8b7a1c4d60',       // no dashes
            'g6c3f0d2-7b1e-5c4a-9f3d-2e8b7a1c4d60',   // non-hex
            ' a6c3f0d2-7b1e-5c4a-9f3d-2e8b7a1c4d60',  // leading space
        ];
        for (const s of bad) {
            expect(isUUID(s), `${s} accepted`).toBe(false);
        }
    });

    it('does not throw on non-string input', () => {
        for (const v of [null, undefined, 42, {}, []]) {
            expect(() => isUUID(v)).not.toThrow();
        }
    });
});
