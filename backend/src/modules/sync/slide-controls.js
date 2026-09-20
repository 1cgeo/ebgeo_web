// Path: src/modules/sync/slide-controls.js
//
// THE CLOSED VOCABULARY OF `slides.controls`: which map controls a briefing slide shows while it is
// being PRESENTED (owner's rule, 2026-09-20: a presentation is a clean stage, every control is
// hidden unless the author ticked it for that slide, and the default of every one is false).
//
// MIRROR of `SLIDE_CONTROLS` in `frontend/src/js/briefing/slide-controls.js`. The column is JSONB,
// and an open object there would be a free-form store inside a slide, so every key outside this
// list is DROPPED and every value that is not exactly `true` reads as false: hidden is the default,
// and it is the side that fails closed. A control added on one side and not on the other is
// silently discarded on the way in, which is why the two lists are compared by a test that imports
// BOTH (`frontend/tests/unit/controles-do-slide.test.js`).
//
// ZERO IMPORTS, by contract: the sync write path and the atlas clone/import both read it, and the
// mirror test loads it in plain node.

export const SLIDE_CONTROL_KEYS = Object.freeze([
  'basemap', 'models3d', 'views360', 'terrain', 'coordinates', 'utilities',
]);

/**
 * @param {*} raw - `controls` as the client sent it.
 * @returns {Object<string, boolean>|null} The six flags, or null when nothing usable came.
 */
export function normalizeSlideControls(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of SLIDE_CONTROL_KEYS) out[key] = Object.hasOwn(raw, key) && raw[key] === true;
  return out;
}
