// Path: tests/unit/csv-escape.test.js

/**
 * @fileoverview Unit tests for escapeCsvCell (CSV formula-injection hardening).
 *
 * Pins both halves of the contract: a cell that a spreadsheet would execute as a
 * formula is neutralized with a leading apostrophe, and a plain number is NOT
 * (the naive "prefix every leading dash" fix turns numeric columns into text).
 */

import { describe, it, expect } from 'vitest';
import { escapeCsvCell } from '@utils/csv-escape.js';

describe('escapeCsvCell', () => {
    describe('formula injection', () => {
        const dangerous = [
            ['=HYPERLINK("http://evil.example","clique")', 'equals'],
            ['=cmd|\' /C calc\'!A0', 'DDE payload'],
            ['+1+1', 'plus'],
            ['@SUM(A1:A9)', 'at sign'],
            ['\tX', 'tab'],
            ['\rX', 'carriage return'],
        ];

        for (const [value, label] of dangerous) {
            it(`neutralizes a cell starting with ${label}`, () => {
                const out = escapeCsvCell(value);
                expect(out.startsWith('"\'')).toBe(true);
                expect(out).toBe(`"'${value.replace(/"/g, '""')}"`);
            });
        }

        it('neutralizes a formula that also contains quotes, doubling them', () => {
            expect(escapeCsvCell('=A1&"x"')).toBe('"\'=A1&""x"""');
        });
    });

    describe('numeric values are never prefixed (regression: negative numbers)', () => {
        for (const value of ['-5', '-3,14', '-0.5', '-0', '42']) {
            it(`keeps ${JSON.stringify(value)} numeric`, () => {
                expect(escapeCsvCell(value)).toBe(`"${value}"`);
            });
        }

        it('keeps a negative number given as a Number', () => {
            expect(escapeCsvCell(-5)).toBe('"-5"');
        });

        it('keeps a padded negative number numeric (trim before the numeric test)', () => {
            expect(escapeCsvCell(' -5 ')).toBe('" -5 "');
        });

        it('still neutralizes a dash cell that is NOT a number', () => {
            expect(escapeCsvCell('-5+cmd')).toBe('"\'-5+cmd"');
            expect(escapeCsvCell('-')).toBe('"\'-"');
        });
    });

    describe('edges', () => {
        it('turns null and undefined into an empty cell', () => {
            expect(escapeCsvCell(null)).toBe('""');
            expect(escapeCsvCell(undefined)).toBe('""');
        });

        it('turns an empty string into an empty cell', () => {
            expect(escapeCsvCell('')).toBe('""');
        });

        it('doubles inner quotes without prefixing a harmless cell', () => {
            expect(escapeCsvCell('a"b')).toBe('"a""b"');
        });

        it('leaves a dangerous character that is not leading alone', () => {
            expect(escapeCsvCell('a=1')).toBe('"a=1"');
        });

        it('does not treat NaN or Infinity as numeric text needing a prefix', () => {
            expect(escapeCsvCell(NaN)).toBe('"NaN"');
            expect(escapeCsvCell(Infinity)).toBe('"Infinity"');
            // -Infinity DOES start with a dash and is not a plain number, so it is
            // quoted with the apostrophe — the safe side of the trade.
            expect(escapeCsvCell(-Infinity)).toBe('"\'-Infinity"');
        });

        it('preserves an embedded newline (still one quoted cell)', () => {
            expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
        });
    });
});
