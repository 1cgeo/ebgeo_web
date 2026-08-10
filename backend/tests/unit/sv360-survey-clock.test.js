// Path: tests/unit/sv360-survey-clock.test.js
// scripts/sv360-survey-clock.js — the two constants that decide what a 360
// capture time MEANS, and the two conversions the ETL runs on both edges.
//
// WHY THESE ASSERTIONS AND NOT OTHERS. Every number here was measured at the
// origin, and getting one of them wrong produces no error at all — it produces a
// photo stamped three hours off, a solar calibration that quietly disagrees with
// itself, and a run list ordered wrong. The origin found exactly that: commit
// e2fb591 ("o time_img da fonte nao e epoch UTC, e o fuso nao e um so") fixed a
// -3 h clock skew on the external sources and a wrong timezone on the two Roraima
// projects, after the wrong hour had already broken the solar fit in silence.
// So the test pins the VALUES, not just the shape of the functions.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_CLOCK_SKEW_HOURS,
  SURVEY_OFFSET_HOURS,
  epochToInstant,
  instantToLocal,
  localToInstant,
  readEpoch,
  surveyOffsetHours,
} from '../../scripts/sv360-survey-clock.js';

describe('sv360 survey clock', () => {
  describe('surveyOffsetHours', () => {
    it('defaults to Brasilia time', () => {
      assert.equal(SURVEY_OFFSET_HOURS, -3);
      assert.equal(surveyOffsetHours('alegrete'), -3);
      assert.equal(surveyOffsetHours('faxinal'), -3);
    });

    // The two projects north of the equator, in Roraima. The origin checked it
    // by the mean coordinate of each project, not by longitude, because the
    // Brazilian zones follow state borders.
    it('gives UTC-4 to the two Roraima projects', () => {
      assert.equal(surveyOffsetHours('1pef'), -4);
      assert.equal(surveyOffsetHours('3pef'), -4);
    });

    it('falls back to the default for an unknown slug', () => {
      assert.equal(surveyOffsetHours('projeto-que-nao-existe'), -3);
    });
  });

  describe('localToInstant / instantToLocal', () => {
    it('reads local wall clock as the survey offset, not as UTC', () => {
      const d = localToInstant('2025-03-17T09:58:14', 'alegrete');
      assert.equal(d.toISOString(), '2025-03-17T12:58:14.000Z');
    });

    it('applies the Roraima offset where it belongs', () => {
      const d = localToInstant('2025-03-17T09:58:14', '1pef');
      assert.equal(d.toISOString(), '2025-03-17T13:58:14.000Z');
    });

    it('renders an instant back as the local wall clock', () => {
      const local = instantToLocal(new Date('2025-03-17T12:58:14.000Z'), 'alegrete');
      assert.equal(local, '2025-03-17T09:58:14');
    });

    // The round trip is what keeps the two scales comparable: the grouping
    // library compares this string against the one it reads off the PIC_
    // filename, and a lossy trip would shift a run boundary silently.
    it('round-trips every offset in the table', () => {
      const casos = [
        ['alegrete', '2025-03-17T09:58:14'],
        ['1pef', '2024-11-02T06:00:00'],
        ['3pef', '2024-11-02T17:59:59'],
        ['santana_livramento', '2022-08-21T13:37:21'],
      ];
      assert.ok(casos.length > 0);
      for (const [slug, local] of casos) {
        assert.equal(instantToLocal(localToInstant(local, slug), slug), local);
      }
    });

    it('returns null for a value that is not a timestamp', () => {
      assert.equal(localToInstant(null, 'alegrete'), null);
      assert.equal(localToInstant('2025-03-17', 'alegrete'), null);
      assert.equal(instantToLocal(null, 'alegrete'), null);
      assert.equal(instantToLocal('nao e data', 'alegrete'), null);
    });
  });

  describe('epochToInstant', () => {
    // THE FIX OF e2fb591. The `time_img` of the survey geojson is not a UTC
    // epoch: three independent projects converged on a -3,0 h clock skew in a
    // solar fit, and correcting it dropped the fraction of photos with the sun
    // below the horizon from 21%-26% to 0%.
    it('subtracts the measured clock skew of the external sources', () => {
      assert.equal(SOURCE_CLOCK_SKEW_HOURS, -3);
      const d = epochToInstant(1742212800); // 2025-03-17T12:00:00Z as written
      assert.equal(d.toISOString(), '2025-03-17T09:00:00.000Z');
    });

    // The skew corrects the INSTANT and the offset only renders it. Composing
    // the two has to reproduce the origin's single formula,
    // `epoch + (fuso + desvio) * 3600`, or the port changed the hour it imports.
    it('composes with the offset exactly as the origin computed it', () => {
      const epoch = 1742212800;
      for (const slug of ['alegrete', '1pef']) {
        const esperado = new Date((epoch + (surveyOffsetHours(slug) - 3) * 3600) * 1000)
          .toISOString()
          .slice(0, 19);
        assert.equal(instantToLocal(epochToInstant(epoch), slug), esperado);
      }
    });
  });

  describe('readEpoch', () => {
    it('accepts an epoch inside the window, quoted or not', () => {
      assert.equal(readEpoch(1742212800), 1742212800);
      assert.equal(readEpoch(' "1742212800" '), 1742212800);
      assert.equal(readEpoch('1742212800.9'), 1742212800);
    });

    it('refuses anything outside 2015-2035, which is junk', () => {
      assert.equal(readEpoch(0), null);
      assert.equal(readEpoch(1420070399), null);
      assert.equal(readEpoch(2051222401), null);
      assert.equal(readEpoch('nao e numero'), null);
      assert.equal(readEpoch(null), null);
      assert.equal(readEpoch(undefined), null);
    });
  });
});
