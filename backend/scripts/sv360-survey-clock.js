// Path: scripts/sv360-survey-clock.js
// The SURVEY CLOCK of the 360 corpus: the two constants that turn a raw capture
// time into an instant, and back into the local wall clock the run boundary is
// expressed in. Ported from ebgeo_360 `scripts/import-captured-at.js` (branch
// master, including the fix in e2fb591).
//
// WHY ITS OWN FILE: both ETL scripts need it, and for opposite directions.
// `sv360-import-captured-at.js` turns a source timestamp INTO an instant to
// store in sv360.photos.capture_date; `sv360-derive-runs.js` turns that instant
// BACK into local wall clock so it can be compared with the `startedAt` that
// sv360.capture-runs.js reads off the PIC_ filename. Two copies of "what the
// offset of this project is" diverge in silence, and the symptom is a run
// ordered wrong, never an error.
//
// THE SCALE PROBLEM THIS FILE EXISTS TO SOLVE. The origin stores capture time as
// TEXT holding LOCAL wall clock ('2025-03-17T09:58:14', no zone), because that is
// the same scale the PIC_ filename carries, and sv360.capture-runs.js compares
// the two AS STRINGS. Here the destination is TIMESTAMPTZ, which stores an
// INSTANT. Feeding a zoneless local string to TIMESTAMPTZ would make the stored
// instant depend on the session TimeZone of whoever ran the ETL — the exact
// silent-drift trap migration 014 calls out. So the conversion is explicit in
// both directions, and the offset is data, not a default.

/**
 * Survey timezone offset, in hours, where it is NOT Brasilia time.
 *
 * From the origin, measured there and not guessed: Brazil has four zones and
 * they follow STATE borders, not meridians, so the list is explicit instead of
 * derived from longitude — deriving it would be wrong at the border. Checked
 * against each project's mean coordinate: only `1pef` (lat +3,37) and `3pef`
 * (lat +4,37) sit north of the equator, in Roraima, which is UTC-4. The other
 * 26 projects are in the South or the Southeast.
 */
export const SURVEY_OFFSET_BY_SLUG = {
  '1pef': -4, // Roraima
  '3pef': -4, // Roraima
};

/**
 * Default survey offset, in hours.
 *
 * Brazil has had no daylight saving since 2019 and the corpus spans 2022 to
 * 2025, so the offset is constant per project.
 */
export const SURVEY_OFFSET_HOURS = -3;

/**
 * Empirical clock skew of the EXTERNAL sources, in hours.
 *
 * The `time_img` of fotos.geojson and the `time` of the CSVs are NOT UTC epochs,
 * despite the format. Without this correction the survey appears to run until
 * 21h and 22h, and the chief confirmed no collection happened at that hour.
 *
 * The value came from measurement, not from a guess. Left as a free parameter in
 * a solar fit, three independent projects converged on -3,0 h EXACTLY, and the
 * residual collapsed:
 *   alegrete            32,61 -> 2,61
 *   santana_livramento  24,36 -> 3,04
 *   uruguaiana          21,99 -> 2,52
 * Corrected, the working day runs 07h to 18h and the fraction of photos with the
 * sun below the horizon drops from 21%-26% to 0%.
 *
 * The control: `faxinal` and `saica` take their time from the FILENAME, never
 * pass through this conversion, and the same search finds skew ZERO on them.
 *
 * It applies ONLY to the external epoch. Time deduced from the filename, and
 * time carried over from the legacy index.db (already converted there), are
 * local wall clock already.
 */
export const SOURCE_CLOCK_SKEW_HOURS = -3;

/** Smallest and largest accepted epoch: 2015-01-01 and 2035-01-01. Outside is junk. */
export const EPOCH_MIN = 1420070400;
export const EPOCH_MAX = 2051222400;

const H = 3600 * 1000;

/**
 * The survey offset of one project, in hours.
 *
 * @param {string} slug - Project slug
 * @returns {number} Offset in hours (negative west of Greenwich)
 */
export function surveyOffsetHours(slug) {
  return SURVEY_OFFSET_BY_SLUG[slug] ?? SURVEY_OFFSET_HOURS;
}

/**
 * Local wall clock -> instant.
 *
 * @param {string} local - `YYYY-MM-DDTHH:MM:SS`, no zone
 * @param {string} slug - Project slug, which picks the offset
 * @returns {Date|null} The instant, or null if the string is unparseable
 */
export function localToInstant(local, slug) {
  if (typeof local !== 'string' || local.length < 19) return null;
  const asUtc = Date.parse(`${local.slice(0, 19)}Z`);
  if (!Number.isFinite(asUtc)) return null;
  return new Date(asUtc - surveyOffsetHours(slug) * H);
}

/**
 * Instant -> local wall clock, in the same shape the filename carries.
 *
 * @param {Date|string|number|null} instant - Value read from a TIMESTAMPTZ column
 * @param {string} slug - Project slug, which picks the offset
 * @returns {string|null} `YYYY-MM-DDTHH:MM:SS`, or null
 */
export function instantToLocal(instant, slug) {
  if (instant === null || instant === undefined) return null;
  const d = instant instanceof Date ? instant : new Date(instant);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + surveyOffsetHours(slug) * H).toISOString().slice(0, 19);
}

/**
 * External-source epoch -> instant, applying the measured clock skew.
 *
 * @param {number} epoch - Seconds since 1970-01-01, as the source writes it
 * @returns {Date} The corrected instant
 */
export function epochToInstant(epoch) {
  return new Date((epoch + SOURCE_CLOCK_SKEW_HOURS * 3600) * 1000);
}

/**
 * Reads an epoch out of a text field, refusing anything outside the window.
 *
 * @param {string|number|null|undefined} value - Raw source field
 * @returns {number|null} A valid epoch, or null
 */
export function readEpoch(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).trim().replace(/^"|"$/g, ''));
  if (!Number.isFinite(n) || n < EPOCH_MIN || n > EPOCH_MAX) return null;
  return Math.trunc(n);
}
