// Path: js/first_person_3d_tool/walk/walk-mode.js

/**
 * @module first_person_3d_tool/walk/walk-mode
 * @description First-person walk controller: voxel collision in, camera state out.
 *
 * Ported from `walk-core.ts` of the museu-gs project, which extracted it from
 * `walk-demo.ts` of manycoretech/aholo-viewer (MIT), itself derived from the
 * SuperSplat Viewer. The physics is a faithful port: gravity, ground spring,
 * jump, crouch, capsule push-out and mouse-look.
 *
 * WHAT WAS DROPPED. The third-person orbit camera (avatar, zoom wheel, camera
 * occlusion) is out of scope here — this viewer is first person only. So is
 * POINTER LOCK: the original captured the pointer so the view followed the mouse
 * with no button held, game style. Turning is now always a drag, which keeps a
 * visible cursor over the scene — the labels, the tape and the toolbar all need
 * one, and a captured pointer is a mode the user has to discover and escape.
 *
 * WHAT WAS ADDED. `destroy()`. The original is a single-use page that never
 * tears down; here the viewer opens and closes many times in the same session,
 * so every listener is tracked and removed.
 */

import { Vector3, Euler } from '@manycore/aholo-viewer';
import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import {
    FP_DEFAULTS,
    WALK_SIMULATION_STEP_SECONDS,
    MAX_SUBSTEPS,
    WALK_CAPSULE_HEIGHT,
    WALK_CAPSULE_RADIUS,
    WALK_HOVER_HEIGHT,
    WALK_EYE_HEIGHT,
    WALK_GRAVITY,
    WALK_JUMP_SPEED,
    WALK_JUMP_LOCKOUT_SECONDS,
    WALK_CROUCH_DROP,
    WALK_CROUCH_RATE,
    PENETRATION_EPSILON,
    CROUCH_KEYS,
    MOVEMENT_KEYS
} from './constants.js';
import { VoxelCollision } from './voxel-collision.js';
import { isTypingTarget } from '@utils/typing-target.js';

/** Mouse-look sensitivity, in radians per pixel of pointer movement. */
const LOOK_SENSITIVITY = 0.002;

/** Pitch limit, just short of straight up and straight down. */
const PITCH_LIMIT = Math.PI / 2 - 0.01;

/**
 * Every key this controller tracks.
 *
 * Deliberately an allowlist: the tool keys (T, L, Esc, Backspace, Delete)
 * belong to the keyboard service, and this module must not so much as record
 * them.
 * @constant {Set<string>}
 */
const TRACKED_KEYS = new Set([...MOVEMENT_KEYS, ...CROUCH_KEYS, 'Space']);

/**
 * Ground probe offsets around the capsule axis, as [dx, dz] in meters.
 * Module-level so the per-step probe allocates nothing.
 * @constant {Array<Array<number>>}
 */
const GROUND_PROBE_OFFSETS = [
    [0, 0],
    [-WALK_CAPSULE_RADIUS, 0],
    [WALK_CAPSULE_RADIUS, 0],
    [0, WALK_CAPSULE_RADIUS],
    [0, -WALK_CAPSULE_RADIUS]
];

/** Ground raycast reach below the capsule base, in meters. */
const GROUND_PROBE_DISTANCE = 1.0;

/**
 * First-person walk controller.
 *
 * The caller drives it: `startAtPose()` once, `update(dt)` every frame, then
 * `getCameraState()` to place the render camera.
 */
export class WalkMode {
    /**
     * @param {HTMLElement} container - Element that owns the pointer events.
     */
    constructor(container) {
        setupCleanup(this);

        this._container = container;
        this._collision = null;

        this._enabled = false;
        this._keys = {};
        this._mouseLookDragging = false;
        /** Whether a right-drag turns the camera. The measuring tape borrows it. */
        this._lookWithRightButton = true;

        /** Remaining time with the ground spring disabled, so the jump can leave the floor. */
        this._jumpLockout = 0;

        this._yaw = 0;
        this._pitch = 0;
        this._position = new Vector3();
        this._velocity = new Vector3();
        this._grounded = false;
        this._groundYFiltered = null;
        this._horizontalSpeed = 0;

        /** How far the eye has already dropped into the crouch, from 0 to 1. */
        this._crouch = 0;

        this._cameraPosition = new Vector3();
        this._cameraRotation = new Euler(0, 0, 0, 'YXZ');
        this._cameraScale = new Vector3(1, 1, 1);
        this._characterPosition = new Vector3();

        // Scratch vectors: the movement math runs 60 times a second, so it must
        // not allocate. The original built three Vector3 per physics step.
        this._scratchMove = new Vector3();
        this._scratchForward = new Vector3();
        this._scratchRight = new Vector3();
        this._scratchUp = new Vector3(0, 1, 0);
        this._scratchPush = { x: 0, y: 0, z: 0 };

        this._accumulator = 0;

        /** Horizontal walk speed, in m/s. Writable by the caller (per-scene config). */
        this.moveSpeed = FP_DEFAULTS.walkSpeed;

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onDocumentPointerDown = this._onDocumentPointerDown.bind(this);
        this._onDocumentFocusIn = this._onDocumentFocusIn.bind(this);
        this._onWindowBlur = this._onWindowBlur.bind(this);
        this._onVisibilityChange = this._onVisibilityChange.bind(this);

        this._registerListeners();
    }

    /**
     * Bind every input listener, all of them tracked for destroy().
     * @private
     */
    _registerListeners() {
        addDomListener(this, document, 'keydown', this._onKeyDown);
        // The keyup goes on the WINDOW and in CAPTURE, not on the document in
        // bubble. In bubble any panel that calls stopPropagation on the way down
        // swallows the key release, and the character walks forever. In capture
        // on the window nothing can intercept it first.
        addDomListener(this, window, 'keyup', this._onKeyUp, true);
        addDomListener(this, document, 'mousedown', this._onMouseDown);
        addDomListener(this, document, 'mouseup', this._onMouseUp);
        addDomListener(this, document, 'mousemove', this._onMouseMove);
        addDomListener(this, document, 'contextmenu', this._onContextMenu);
        // Prevent "stuck key" drift when keyup is lost (UI panel focus, tab blur).
        addDomListener(this, document, 'pointerdown', this._onDocumentPointerDown, true);
        addDomListener(this, document, 'focusin', this._onDocumentFocusIn, true);
        addDomListener(this, window, 'blur', this._onWindowBlur);
        // Entering or leaving fullscreen is a transition where the browser
        // usually eats the key release.
        addDomListener(this, document, 'fullscreenchange', this._onWindowBlur);
        addDomListener(this, document, 'visibilitychange', this._onVisibilityChange);
    }

    /**
     * Attach the voxel collision data used by ground checks and capsule push-out.
     * @param {Object} metadata - Octree header: gridBounds, voxelResolution, leafSize, treeDepth.
     * @param {Uint32Array} nodes - Packed octree nodes.
     * @param {Uint32Array} leafData - Packed leaf occupancy bits.
     */
    loadVoxelCollision(metadata, nodes, leafData) {
        this._collision = new VoxelCollision(metadata, nodes, leafData);
    }

    /**
     * Place the walker at a known position and camera angle, then enable it.
     * @param {Object} position - Vector3 eye position, in scene meters.
     * @param {number} yaw - Heading, in radians.
     * @param {number} pitch - Elevation, in radians.
     */
    startAtPose(position, yaw, pitch) {
        this._position.copy(position);
        this._velocity.set(0, 0, 0);
        this._yaw = yaw;
        this._pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
        this._activateAtCurrentPose();
    }

    /**
     * Reset runtime state, resolve spawn collision, and snap to the ground below.
     * @private
     */
    _activateAtCurrentPose() {
        this._enabled = true;
        this._keys = {};
        this._accumulator = 0;
        this._jumpLockout = 0;
        this._grounded = false;
        this._horizontalSpeed = 0;
        this._crouch = 0;
        this._groundYFiltered = null;
        this._resolveSpawnCollision();

        const groundY = this._probeGround(this._position);
        if (groundY !== null) {
            this._grounded = true;
            this._velocity.y = 0;
            this._position.y = groundY + WALK_HOVER_HEIGHT + WALK_EYE_HEIGHT;
            this._groundYFiltered = groundY;
        }
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    }

    /**
     * Stop walk mode and clear held input.
     * Listeners stay bound but every handler bails out while disabled, so this
     * leaks nothing; `destroy()` is what unbinds them.
     */
    disable() {
        this._enabled = false;
        this._clearInputState();
    }

    /**
     * Called once per frame: runs the fixed physics steps, then updates the camera.
     * @param {number} dt - Seconds since the previous frame.
     */
    update(dt) {
        if (!this._enabled) {
            return;
        }
        // Stuck-key safety net: with no focus on the page there is no way a key
        // can be held. The `blur` handler should have cleared it, but blur
        // itself gets lost on tab switches and fullscreen transitions.
        if (!document.hasFocus()) {
            this._clearInputState();
        }

        const dtClamped = Math.min(Math.max(0, dt), 1 / 20);
        this._accumulator = Math.min(
            this._accumulator + dtClamped,
            MAX_SUBSTEPS * WALK_SIMULATION_STEP_SECONDS
        );
        while (this._accumulator >= WALK_SIMULATION_STEP_SECONDS) {
            this._step(WALK_SIMULATION_STEP_SECONDS);
            this._accumulator -= WALK_SIMULATION_STEP_SECONDS;
        }
        this._updateCharacterPosition();

        // Crouching only lowers the eye. The capsule stays the same, so there is
        // no way to sink through the floor nor to slide in under a wall.
        const crouchTarget = CROUCH_KEYS.some((code) => this._keys[code]) ? 1 : 0;
        this._crouch += (crouchTarget - this._crouch) * Math.min(1, WALK_CROUCH_RATE * dtClamped);
        this._cameraPosition.set(
            this._position.x,
            this._position.y - this._crouch * WALK_CROUCH_DROP,
            this._position.z
        );
        this._cameraRotation.set(this._pitch, this._yaw, 0, 'YXZ');
    }

    /**
     * Current camera transform for the render scene.
     * @returns {{position: Object, rotation: Object, scale: Object}}
     */
    getCameraState() {
        return {
            position: this._cameraPosition,
            rotation: this._cameraRotation,
            scale: this._cameraScale
        };
    }

    /**
     * Current walker state (feet position and motion), for HUD and debugging.
     * @returns {{position: Object, grounded: boolean, verticalVelocity: number, speed: number}}
     */
    getCharacterState() {
        return {
            position: this._characterPosition,
            grounded: this._grounded,
            verticalVelocity: this._velocity.y,
            speed: this._horizontalSpeed
        };
    }

    /**
     * Vertical impulse, only with both feet on the ground.
     * @returns {boolean} True when the jump was applied.
     */
    jump() {
        if (!this._enabled || !this._grounded || this._jumpLockout > 0) {
            return false;
        }
        this._velocity.y = WALK_JUMP_SPEED;
        this._jumpLockout = WALK_JUMP_LOCKOUT_SECONDS;
        this._grounded = false;
        return true;
    }

    /**
     * Lend the right button to a tool, or take it back.
     *
     * The measuring tape turns it off while it is on, so a right click there
     * pins the last vertex and closes instead of turning the view. Any drag in
     * flight is cancelled, otherwise the camera would keep following the mouse
     * until a release that no longer turns anything.
     *
     * @param {boolean} enabled - True to let a right-drag turn the camera
     */
    setLookWithRightButton(enabled) {
        this._lookWithRightButton = enabled !== false;
        if (!this._lookWithRightButton) {
            this._mouseLookDragging = false;
        }
    }

    /**
     * Unbind every listener and drop the collision data. After this the
     * instance is dead; build a new one to walk again.
     */
    destroy() {
        this._enabled = false;
        this._clearInputState();
        cleanup(this);
        this._collision = null;
        this._container = null;
    }

    /**
     * One fixed physics step: ground probe, gravity, horizontal movement, push-out.
     * @param {number} dt - Fixed step, in seconds.
     * @private
     */
    _step(dt) {
        const rawGroundY = this._probeGround(this._position);
        const hasGround = rawGroundY !== null;

        if (hasGround) {
            if (this._groundYFiltered === null) {
                this._groundYFiltered = rawGroundY;
            } else {
                const a = 1 - Math.exp(-20 * dt);
                this._groundYFiltered += (rawGroundY - this._groundYFiltered) * a;
            }
        } else {
            this._groundYFiltered = null;
        }

        const groundYStick = hasGround && this._groundYFiltered !== null
            ? this._groundYFiltered
            : rawGroundY;

        // Jump: while the lockout runs the ground spring stays off and only
        // gravity acts.
        if (this._jumpLockout > 0) {
            this._jumpLockout = Math.max(0, this._jumpLockout - dt);
        }
        const jumping = this._jumpLockout > 0;

        if (hasGround && !jumping) {
            const targetY = groundYStick + WALK_HOVER_HEIGHT + WALK_EYE_HEIGHT;
            const displacement = this._position.y - targetY;
            if (displacement > 0.1) {
                this._velocity.y -= WALK_GRAVITY * dt;
                const nextY = this._position.y + this._velocity.y * dt;
                if (nextY <= targetY) {
                    this._position.y = targetY;
                    this._velocity.y = 0;
                }
                this._grounded = false;
            } else {
                const spring = -800 * displacement - 57 * this._velocity.y;
                this._velocity.y += spring * dt;
                this._grounded = true;
            }
        } else {
            this._velocity.y -= WALK_GRAVITY * dt;
            this._grounded = false;
        }

        const forwardInput = (this._keys.KeyW || this._keys.ArrowUp ? 1 : 0)
            - (this._keys.KeyS || this._keys.ArrowDown ? 1 : 0);
        const strafeInput = (this._keys.KeyD || this._keys.ArrowRight ? 1 : 0)
            - (this._keys.KeyA || this._keys.ArrowLeft ? 1 : 0);
        const hasMoveInput = forwardInput !== 0 || strafeInput !== 0;

        const move = this._scratchMove.set(0, 0, 0);
        const forward = this._scratchForward.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
        const right = this._scratchRight.crossVectors(forward, this._scratchUp);
        if (forwardInput !== 0) {
            move.addScaledVector(forward, forwardInput);
        }
        if (strafeInput !== 0) {
            move.addScaledVector(right, strafeInput);
        }
        if (hasMoveInput) {
            move.normalize().multiplyScalar(this.moveSpeed);
        }

        const accel = this._grounded ? 24 : 6;
        const blend = Math.min(1, accel * dt);
        this._velocity.x += (move.x - this._velocity.x) * blend;
        this._velocity.z += (move.z - this._velocity.z) * blend;

        const dampFactor = this._grounded ? 0.99 : 0.998;
        const alpha = this._damp(dampFactor, dt);
        this._velocity.x = this._lerp(this._velocity.x, 0, alpha * 0.35);
        this._velocity.z = this._lerp(this._velocity.z, 0, alpha * 0.35);
        this._horizontalSpeed = Math.hypot(this._velocity.x, this._velocity.z);

        this._position.addScaledVector(this._velocity, dt);
        this._resolveCollision();
    }

    /**
     * Place the walker's feet on the current ground height.
     * @private
     */
    _updateCharacterPosition() {
        let groundY = null;
        if (this._grounded) {
            groundY = this._groundYFiltered !== null
                ? this._groundYFiltered
                : this._probeGround(this._position);
        }
        const footY = groundY !== null
            ? groundY
            : this._position.y - WALK_HOVER_HEIGHT - WALK_EYE_HEIGHT;
        this._characterPosition.set(this._position.x, footY, this._position.z);
    }

    /**
     * Raycast below the capsule and return a stable ground height.
     *
     * Five probes and the MEDIAN, not the single centre ray: a splat-derived
     * floor is speckled, and one stray voxel under the centre would teleport the
     * eye. The median throws the outlier away.
     * @param {Object} pos - Vector3 eye position.
     * @returns {number|null} Ground height in meters, or null when nothing is below.
     * @private
     */
    _probeGround(pos) {
        if (!this._collision) {
            return null;
        }
        const oy = pos.y - WALK_EYE_HEIGHT;
        const hits = [];
        for (let i = 0; i < GROUND_PROBE_OFFSETS.length; i++) {
            const [ox, oz] = GROUND_PROBE_OFFSETS[i];
            const hit = this._collision.queryRay(
                pos.x + ox, oy, pos.z + oz,
                0, -1, 0,
                GROUND_PROBE_DISTANCE
            );
            if (hit) {
                hits.push(hit.y);
            }
        }
        if (hits.length === 0) {
            return null;
        }
        hits.sort((a, b) => a - b);
        const mid = Math.floor(hits.length / 2);
        return hits.length % 2 === 1 ? hits[mid] : (hits[mid - 1] + hits[mid]) * 0.5;
    }

    /**
     * Push the moving capsule out of solid voxels.
     * @private
     */
    _resolveCollision() {
        if (!this._collision) {
            return;
        }
        const centerY = this._position.y - WALK_EYE_HEIGHT + WALK_CAPSULE_HEIGHT * 0.5;
        const half = WALK_CAPSULE_HEIGHT * 0.5 - WALK_CAPSULE_RADIUS;
        const push = this._scratchPush;
        push.x = 0;
        push.y = 0;
        push.z = 0;
        const hit = this._collision.queryCapsule(
            this._position.x, centerY, this._position.z,
            half, WALK_CAPSULE_RADIUS, push
        );
        if (!hit) {
            return;
        }
        this._position.x += push.x;
        this._position.y += push.y;
        this._position.z += push.z;
        // Pushed down while rising: a ceiling. Kill the upward speed so the jump
        // does not stick to it.
        if (push.y < -PENETRATION_EPSILON && this._velocity.y > 0) {
            this._velocity.y = 0;
        }
        // Pushed up while falling: a ledge the ground probe missed. Land on it.
        if (!this._grounded && push.y > PENETRATION_EPSILON && this._velocity.y < 0) {
            this._velocity.y = 0;
            this._grounded = true;
        }
    }

    /**
     * Lift the start pose until the capsule is outside solid voxels.
     * @private
     */
    _resolveSpawnCollision() {
        if (!this._collision) {
            return;
        }
        const half = WALK_CAPSULE_HEIGHT * 0.5 - WALK_CAPSULE_RADIUS;
        const minStep = WALK_CAPSULE_RADIUS;
        const push = this._scratchPush;
        for (let i = 0; i < 100; i++) {
            push.x = 0;
            push.y = 0;
            push.z = 0;
            const center = this._position.y - WALK_EYE_HEIGHT + WALK_CAPSULE_HEIGHT * 0.5;
            const hit = this._collision.queryCapsule(
                this._position.x, center, this._position.z,
                half, WALK_CAPSULE_RADIUS, push
            );
            if (!hit) {
                break;
            }
            this._position.y += Math.max(push.y, minStep);
        }
    }

    /**
     * Frame-rate independent damping factor.
     * @param {number} damping - Retained fraction per millisecond.
     * @param {number} dt - Seconds.
     * @returns {number}
     * @private
     */
    _damp(damping, dt) {
        return 1 - Math.pow(damping, dt * 1000);
    }

    /**
     * Linear interpolation.
     * @param {number} a - Start.
     * @param {number} b - End.
     * @param {number} t - Factor.
     * @returns {number}
     * @private
     */
    _lerp(a, b, t) {
        return a + (b - a) * t;
    }

    /**
     * Track the walk keys only: movement, jump and crouch.
     *
     * The tool keys (T, L, F, R, Esc, Backspace, Delete) belong to the keyboard
     * service and are not even recorded here.
     * @param {KeyboardEvent} e - Key event.
     * @private
     */
    _onKeyDown(e) {
        if (!this._enabled) {
            return;
        }
        // TYPING IS NOT WALKING, and this listener is on the DOCUMENT, so every
        // text field on the page is in its reach. Four of the six keys it tracks
        // are letters (W, A, S, D) and a fifth is the space bar, and it calls
        // `preventDefault()` on all of them — so without this guard a field could
        // not receive those characters at all while the viewer was open, and the
        // camera walked as the visitor typed. The scene's own item search
        // (`components/items-list-fp.js`) is a field open at exactly that moment,
        // which is how this was found.
        //
        // The keyboard SERVICE of this viewer already made the same test for the
        // tool keys; this class was the one that never did.
        if (isTypingTarget(e.target)) {
            return;
        }
        // With ctrl, alt or meta the key belongs to the BROWSER, not to the
        // walk. Without this guard walk mode was swallowing the visitor's
        // Ctrl+S and Ctrl+A.
        if (e.ctrlKey || e.altKey || e.metaKey) {
            return;
        }
        if (!TRACKED_KEYS.has(e.code)) {
            return;
        }
        this._keys[e.code] = true;
        if (MOVEMENT_KEYS.has(e.code)) {
            e.preventDefault();
        }
        if (e.code === 'Space' && !e.repeat) {
            e.preventDefault();
            this.jump();
        }
    }

    /**
     * @param {KeyboardEvent} e - Key event.
     * @private
     */
    _onKeyUp(e) {
        if (!this._enabled) {
            return;
        }
        this._keys[e.code] = false;
    }

    /**
     * @param {PointerEvent} e - Pointer event.
     * @private
     */
    _onDocumentPointerDown(e) {
        this._clearInputWhenTargetLeavesContainer(e.target);
    }

    /**
     * @param {FocusEvent} e - Focus event.
     * @private
     */
    _onDocumentFocusIn(e) {
        this._clearInputWhenTargetLeavesContainer(e.target);
    }

    /**
     * Clear held keys when the user leaves the walk area.
     * @param {EventTarget|null} target - Event target.
     * @private
     */
    _clearInputWhenTargetLeavesContainer(target) {
        if (!this._enabled || !this._container) {
            return;
        }
        if (target instanceof Node && !this._container.contains(target)) {
            this._clearInputState();
        }
    }

    /** @private */
    _onWindowBlur() {
        this._clearInputState();
    }

    /** @private */
    _onVisibilityChange() {
        if (document.hidden) {
            this._clearInputState();
        }
    }

    /** @private */
    _clearInputState() {
        this._keys = {};
        this._mouseLookDragging = false;
    }

    /**
     * @param {MouseEvent} e - Mouse event.
     * @private
     */
    _onMouseDown(e) {
        if (!this._enabled || !this._container) {
            return;
        }
        if (e.target instanceof Node && !this._container.contains(e.target)) {
            return;
        }
        // Both buttons turn the camera, EXCEPT while the measuring tape is on:
        // there the right button belongs to the tape, which uses it to pin the
        // last vertex and close, the way it closes a measurement on the 2D map.
        // Sharing the button between the two would make every right-drag a
        // gamble on whether the tape noticed the movement.
        //
        // Turning by drag coexists with the tape and the marker cards because
        // what decides is the DRAG: the label consumes the mousedown before this
        // handler, and the tool only acts on release when the cursor barely
        // moved. Dragging turns, clicking clicks.
        if (e.button === 0 || (e.button === 2 && this._lookWithRightButton)) {
            this._mouseLookDragging = true;
            if (e.button === 2) {
                e.preventDefault();
            }
        }
    }

    /**
     * @param {MouseEvent} e - Mouse event.
     * @private
     */
    _onMouseUp(e) {
        // Released unconditionally, including the right button the tape may have
        // taken over mid-drag: a flag flipped between press and release must not
        // leave the camera stuck following the mouse.
        if (e.button === 0 || e.button === 2) {
            this._mouseLookDragging = false;
        }
    }

    /**
     * @param {MouseEvent} e - Mouse event.
     * @private
     */
    _onContextMenu(e) {
        if (this._container && e.target instanceof Node && this._container.contains(e.target)) {
            e.preventDefault();
        }
    }

    /**
     * @param {MouseEvent} e - Mouse event.
     * @private
     */
    _onMouseMove(e) {
        if (!this._enabled) {
            return;
        }
        // Turning is ALWAYS a drag: there is no captured-pointer mode. The
        // button has to still be down (bit 1 left, bit 2 right) — a release that
        // happened outside the window never reaches _onMouseUp, and without this
        // check the camera would keep turning with no button held.
        if (!this._mouseLookDragging || (e.buttons & 3) === 0) {
            this._mouseLookDragging = false;
            return;
        }
        // THE SIGN IS "GRAB THE SCENE", NOT "AIM THE HEAD", and it was the other
        // way round until 2026-08-17. Turning here is a DRAG, and a drag in this
        // app means the content follows the hand: MapLibre pans the map under
        // the cursor, and the 360 viewer computes its yaw as
        // `(pointerDownX - clientX) * sensitivity` (street_view_viewer.js), so
        // dragging right swings the view LEFT in both. This viewer subtracted
        // instead, which is the first-person-shooter convention — right and
        // correct where the pointer is CAPTURED and there is no hand holding
        // anything, and backwards here, where the same gesture is a drag. Adding
        // `movementX` to the yaw makes the three viewers agree.
        //
        // The vertical sign follows for the same reason and must move WITH it:
        // flipping one axis alone is worse than either convention, because the
        // two halves of one gesture then disagree.
        this._yaw += e.movementX * LOOK_SENSITIVITY;
        this._pitch += e.movementY * LOOK_SENSITIVITY;
        this._pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this._pitch));
    }
}
