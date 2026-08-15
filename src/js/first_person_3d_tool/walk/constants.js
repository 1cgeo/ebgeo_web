// Path: js/first_person_3d_tool/walk/constants.js
/**
 * @fileoverview Numeric constants for the first-person (Gaussian splatting) viewer.
 *
 * Ported from the museu-gs prototype (walk-core.ts / main.ts / marcadores.ts /
 * medicao.ts). Every value here was measured against the real scene, so the
 * rationale comments travel with the numbers.
 */

// =============================================================================
// Scene defaults
// =============================================================================

/**
 * Defaults applied to a scene that does not override them in `config.js`.
 *
 * `walkSpeed`: the upstream walk-demo default is 7 m/s, a 25 km/h sprint that
 * blows past the display cases. 2.4 m/s is close to a human stride and still
 * crosses the room quickly.
 * `clickTolerancePx`: maximum pointer travel, in pixels, for a drag to still
 * count as a click.
 */
export const FP_DEFAULTS = {
    fov: 60,
    walkSpeed: 2.4,
    clickTolerancePx: 5
};

// =============================================================================
// Voxel collision
// =============================================================================

/** Node value marking a fully solid subtree (no children, no leaf bitmask). */
export const SOLID_LEAF_MARKER = 0xff000000 >>> 0;

/** Minimum penetration, in metres, worth pushing the capsule out of. */
export const PENETRATION_EPSILON = 1e-4;

/** Push-out passes per resolve, so corner contacts do not trap the capsule. */
export const MAX_RESOLVE_ITERATIONS = 4;

// =============================================================================
// Walk controller
// =============================================================================

/** Fixed physics step, in seconds. */
export const WALK_SIMULATION_STEP_SECONDS = 1 / 60;

/** Cap on fixed steps consumed per frame, so a stalled tab does not fast-forward. */
export const MAX_SUBSTEPS = 10;

/** Height of the collision capsule, in metres. */
export const WALK_CAPSULE_HEIGHT = 1.5;

/** Radius of the collision capsule, in metres. */
export const WALK_CAPSULE_RADIUS = 0.12;

/** Gap kept between the capsule bottom and the ground, in metres. */
export const WALK_HOVER_HEIGHT = 0.2;

/** Eye height above the ground contact point, in metres. */
export const WALK_EYE_HEIGHT = WALK_CAPSULE_HEIGHT - 0.1 - WALK_HOVER_HEIGHT;

/** Gravity, in metres per second squared. */
export const WALK_GRAVITY = 9.8;

/** Target jump height, in metres. Only ever read through WALK_JUMP_SPEED. */
const WALK_JUMP_HEIGHT = 0.9;

/** Initial vertical speed that reaches WALK_JUMP_HEIGHT under WALK_GRAVITY. */
export const WALK_JUMP_SPEED = Math.sqrt(2 * WALK_GRAVITY * WALK_JUMP_HEIGHT);

/** Time the ground support spring stays off, so the jump can leave the floor. */
export const WALK_JUMP_LOCKOUT_SECONDS = 0.22;

/** How far the eye drops when crouching, in metres. */
export const WALK_CROUCH_DROP = 0.6;

/** Crouch transition rate, per second. */
export const WALK_CROUCH_RATE = 12;

/**
 * Crouch keys. Shift, and only Shift.
 *
 * MEASURED PITFALL: Ctrl is deliberately absent. `Ctrl+W` closes the Chrome tab
 * and no `preventDefault` from the page can cancel it, so a visitor crouching
 * with Ctrl while walking forward would lose the page. What is left is Shift,
 * which the browser ignores. Windows caveat: five consecutive TAPS on Shift
 * open the Sticky Keys dialog; holding it down, which is the crouch gesture,
 * does not.
 *
 * C USED TO BE HERE, as the game convention, and was dropped: one gesture with
 * two keys is two things to teach and two things to draw in the corner legend,
 * and the second key bought nothing the first did not already do. Do not add it
 * back because a shooter has it.
 *
 * RELATED PITFALL: the full keyboard only ever reaches a page in fullscreen,
 * through the Keyboard Lock API. This viewer has no fullscreen shortcut, so the
 * browser keeps `Ctrl+W` and friends for itself — which is exactly why Ctrl
 * cannot be a crouch key here.
 */
export const CROUCH_KEYS = ['ShiftLeft', 'ShiftRight'];

/**
 * Movement keys, which need preventDefault so the page does not scroll.
 *
 * The arrows walk alongside WASD: a one-time visitor does not rest a hand on
 * WASD, they look for the arrow keys.
 */
export const MOVEMENT_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
]);

// =============================================================================
// Curated markers
// =============================================================================

/**
 * Label range, in metres.
 *
 * 7 m, and the number was chosen by rejecting a larger one. With 78 pieces in a
 * 14 by 9 m room, a 12 m range puts nearly the whole collection on screen at
 * once: the label stops being a guide to what is within arm's reach and becomes
 * an index of the room, which is not what it is for. 7 m keeps a label on the
 * pieces the visitor could walk up to and touch.
 */
export const MARKER_MAX_DISTANCE = 7;

/** Ceiling of labels per frame. Above that the screen becomes a wall of text. */
export const MARKER_MAX_VISIBLE = 12;

/** Padding added to the label box in the overlap test, in pixels. */
export const MARKER_LABEL_PADDING_PX = 4;

/** Occlusion ray pull-back, so a marker flush against a wall does not hide itself. */
export const MARKER_OCCLUSION_SLACK = 0.25;

// =============================================================================
// Measurement tool
// =============================================================================

/** Measurement ray range, in metres. */
export const MEASURE_RANGE = 40;

/** Near clip plane, in metres. Segments behind it are cut. */
export const MEASURE_NEAR_PLANE = 0.06;

/** Occlusion ray pull-back, so a point on a surface does not hide itself. */
export const MEASURE_OCCLUSION_SLACK = 0.12;

/** Shortest accepted segment, in metres. Below it the click repeats the previous point. */
export const MEASURE_MIN_SEGMENT = 0.02;

// The overlay colour is NOT here: it is `--fp3d-measure-color` in
// first-person-3d.css. Paint belongs to the stylesheet, and a second copy in JS
// would be the one that drifts.
