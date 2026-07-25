// Path: tests/unit/atlas-settings-schema.test.js
// Item 73. `atlasSettingsSchema` carries a custom validator (atlas.schemas.js:36-48)
// enforcing min_zoom <= max_zoom and default_basemap ∈ basemaps. Every PATCH in the
// integration suite sends a VALID pair, so the custom branch has never executed with
// a violating payload: delete it, or invert the comparison, and everything stays
// green. This is pure Joi, no database.
//
// The options must match validate.js exactly (`abortEarly:false, stripUnknown:true`),
// otherwise the unit test would be checking a schema nobody runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { atlasSettingsSchema } from '../../src/modules/atlas/atlas.schemas.js';

const VALIDATION_OPTIONS = { abortEarly: false, stripUnknown: true };
const check = (payload) => atlasSettingsSchema.validate(payload, VALIDATION_OPTIONS);

describe('atlasSettingsSchema — the custom cross-field validator', () => {
  it('rejects min_zoom > max_zoom, and SAYS SO', () => {
    const { error } = check({ min_zoom: 15, max_zoom: 8 });
    assert.ok(error, 'an inverted zoom window must not be accepted');
    // The message is part of the contract: two different rules share the
    // `any.custom` code, so without it a 422 cannot be rendered into anything
    // actionable. It used to come back as '"value" failed custom validation
    // because ' — the reason silently dropped.
    assert.match(error.message, /min_zoom/);
  });

  it('accepts min_zoom === max_zoom (the comparison is >, not >=)', () => {
    const { error, value } = check({ min_zoom: 10, max_zoom: 10 });
    assert.equal(error, undefined);
    assert.equal(value.min_zoom, 10);
    assert.equal(value.max_zoom, 10);
  });

  it('accepts each bound ALONE — the guard needs both to be non-null', () => {
    assert.equal(check({ min_zoom: 15 }).error, undefined);
    assert.equal(check({ max_zoom: 8 }).error, undefined);
    assert.equal(check({ min_zoom: null, max_zoom: 8 }).error, undefined);
    assert.equal(check({ min_zoom: 15, max_zoom: null }).error, undefined);
  });

  it('holds the 0..22 zoom borders', () => {
    assert.equal(check({ min_zoom: 0 }).error, undefined);
    assert.equal(check({ max_zoom: 22 }).error, undefined);
    assert.ok(check({ min_zoom: -1 }).error, 'below the floor');
    assert.ok(check({ max_zoom: 23 }).error, 'above the ceiling');
  });

  it('rejects a default_basemap that is not in the basemaps list, and SAYS SO', () => {
    const { error } = check({ basemaps: ['osm'], default_basemap: 'satellite' });
    assert.ok(error);
    assert.match(error.message, /default_basemap/);
    assert.ok(!error.message.includes('min_zoom'), 'the two rules are distinguishable');
  });

  it('accepts a default_basemap present in the list', () => {
    assert.equal(check({ basemaps: ['osm', 'satellite'], default_basemap: 'osm' }).error, undefined);
  });

  it('CHARACTERIZATION: an EMPTY basemaps list disables the membership check', () => {
    // The guard requires `basemaps.length > 0`, so this passes today. Pinned so that
    // making the check unconditional is a visible decision and not a silent break.
    const { error, value } = check({ basemaps: [], default_basemap: 'osm' });
    assert.equal(error, undefined);
    assert.equal(value.default_basemap, 'osm');
  });

  it('CHARACTERIZATION: default_basemap alone (no basemaps key) is unconstrained', () => {
    assert.equal(check({ default_basemap: 'whatever' }).error, undefined);
  });

  it('bounds_2d must be exactly two pairs of two numbers', () => {
    assert.equal(check({ bounds_2d: [[-45, -23], [-42, -21]] }).error, undefined);
    assert.equal(check({ bounds_2d: null }).error, undefined);
    assert.ok(check({ bounds_2d: [[-45, -23], [-42, -21], [0, 0]] }).error, 'three pairs');
    assert.ok(check({ bounds_2d: [[-45, -23, 1], [-42, -21, 1]] }).error, 'triples, not pairs');
    assert.ok(check({ bounds_2d: [[-45, -23]] }).error, 'a single pair');
  });

  it('an unknown key is stripped, not rejected (stripUnknown, as validate.js runs it)', () => {
    const { error, value } = check({ foo: 1, min_zoom: 3 });
    assert.equal(error, undefined);
    assert.equal(value.foo, undefined);
    assert.equal(value.min_zoom, 3, 'the known sibling survives');
  });
});
