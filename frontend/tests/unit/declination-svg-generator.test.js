// Path: tests/unit/declination-svg-generator.test.js

/**
 * Pins the premise of the declination image-sync fix: the diagram is a PURE, deterministic
 * function of the synced props (declination/convergence). Because of this, a peer that never
 * received the (un-uploaded) PNG blob can regenerate an identical diagram locally — which is
 * exactly what the control now does on a remote declination op.
 */

import { describe, it, expect } from 'vitest';
import { generateDeclinationSvg } from '../../src/js/military_tools/declination_tool/declination_svg_generator.js';

describe('generateDeclinationSvg — deterministic from synced props', () => {
    it('returns an SVG string from declination + convergence', () => {
        const svg = generateDeclinationSvg(5.2, 1.1);
        expect(typeof svg).toBe('string');
        expect(svg).toContain('<svg');
    });

    it('is deterministic — same inputs produce identical output (peer rebuilds the same diagram)', () => {
        expect(generateDeclinationSvg(5.2, 1.1)).toBe(generateDeclinationSvg(5.2, 1.1));
    });

    it('varies with the declination value (it encodes the synced prop)', () => {
        expect(generateDeclinationSvg(5.2, 1.1)).not.toBe(generateDeclinationSvg(-3.4, 1.1));
    });

    it('handles zero / negative / large declinations without throwing', () => {
        expect(() => generateDeclinationSvg(0, 0)).not.toThrow();
        expect(() => generateDeclinationSvg(-90, 45)).not.toThrow();
        expect(() => generateDeclinationSvg(89.9, -44.4)).not.toThrow();
    });
});
