// Path: js/3d_models_viewer_tool/services/viewshed-3d.js

/**
 * @module 3d_models_viewer_tool/services/viewshed-3d
 * @description 3D viewshed (line-of-sight) analysis, written in house over the Cesium 1.145 API.
 *
 * It replaces `frontend/public/vendors/cesium/cesium-viewshed.js`, 154710 bytes of obfuscated,
 * unlicensed, unattributed UMD that ran with the product page's privileges and was coupled to
 * eleven private `ShadowMap` fields. Decision D15 of 2026-09-15 (`docs/decisions/decisions-2026.md`);
 * the behaviour inventory this file implements is `docs/wiki/viewshed-3d.md`, and the acceptance it
 * answers is `docs/seguranca/cesium-viewshed-reescrita-aceite.md`.
 *
 * ## THE PRIVATE SURFACE THAT SURVIVED, AND WHY EACH ONE IS UNAVOIDABLE
 *
 * The rewrite went from eleven private `ShadowMap` fields plus the private constructor down to
 * THREE touches. They are listed here because a reader must be able to audit them without reading
 * the code, and each one is pinned by `frontend/tests/unit/viewshed-3d-api-privada.test.js`, which
 * reads Cesium's own source and goes red when a name moves. That test is the whole point: a private
 * name that changes silently is exactly how the old plugin broke on a version bump.
 *
 * 1. **`scene.context`**, because `ShadowMap`'s constructor demands it. Cesium marks the whole
 *    constructor `@internalConstructor` with `@privateParam` options, and the published typings
 *    declare it as `constructor()` taking nothing, so there is NO supported way to build one.
 * 2. **`shadowMap._shadowMapTexture`**, the depth texture rendered from the observer. Nothing on
 *    `ShadowMap` exposes it, and it is the one thing the fragment shader cannot do without: it IS
 *    the analysis. Everything else the old plugin read from private fields is computed here from
 *    public API (see below).
 * 3. **`frameState.shadowMaps`**, pushed from `update`. This is how a primitive offers an analytic
 *    shadow map to the frame; there is no public registration point.
 *
 * ## WHAT STOPPED BEING PRIVATE, WHICH IS THE ACTUAL GAIN
 *
 * - `_shadowMapMatrix` is now computed here, and it is exactly reproducible because the pieces are
 *   public: scale-bias times `lightCamera.frustum.projectionMatrix` times `lightCamera.viewMatrix`
 *   times `scene.camera.inverseViewMatrix`. Cesium's own `ShadowMap.update` builds it from those
 *   same four, and with cascades off nothing refits the light frustum behind our back.
 * - `_lightPositionEC` is `camera.viewMatrix * lightCamera.positionWC`, both public.
 * - `_lightCamera.up/direction/right` were never private in the first place; we own the camera.
 * - `_textureSize` is `shadowMap.size`, public. `_darkness` is `shadowMap.darkness`, public.
 * - `_isPointLight`, `_pointBias`, `_primitiveBias`, `_terrainBias` only ever chose two numbers
 *   (a depth bias and a normal-shading smoothness). We declare our own, as constants, in the open.
 * - `_lightDirectionEC` and `_distance` were read and never used by the plugin's own shader.
 *
 * ## THREE DECISIONS THAT CHANGE THE DRAWING, DECLARED
 *
 * 1. **The shader is GLSL ES 3.00**, so the automatic ES 1.00 to 3.00 rewrite of `ShaderSource`
 *    dies with it, and so does the `Cesium.defaultValue` polyfill and the injected
 *    `isDestroyed`/`destroy`. `cesium-compat.js` existed only for those three and is deleted.
 * 2. **The angle tests keep `>` strict, deliberately**, because `viewshed_tool_3d.js` compensates
 *    for it: a sector wider than 150 degrees is split, and each piece renders 1.5 degrees narrower
 *    so the seam is not mixed twice. Switching to `>=` would turn that compensation into a visible
 *    gap, so the two would have to change in the same commit. They did not.
 * 3. **The frustum outline is drawn by us, as a spherical sector**, and no longer by the
 *    `RectangularSensorPrimitive` that took up half the old file (the acceptance says it need not be
 *    ported, and it has no other caller). A sphere is also the honest shape: the analysis cuts at a
 *    constant DISTANCE from the observer, so a flat far plane, which is what a plain frustum outline
 *    would draw, would promise a boundary the shader does not have.
 */

import { Cesium } from '@js/vendor/cesium.js';
// A ARITMETICA MORA NUM ARQUIVO DE ZERO IMPORTS, e a razao e testabilidade: este modulo puxa o
// Cesium inteiro, entao nada aqui dentro pode ser exercitado por um teste de node. Ver
// `frontend/tests/unit/viewshed-3d-geometria.test.js`.
import {
    observerFovDegrees,
    frustumOutlineAngles,
    directionFromAngles,
} from './viewshed-geometry.js';

// ============================================================================
// SHADER
// ============================================================================

/**
 * The tinting pass, as a full-screen post-process.
 *
 * It is written as five REFUSALS followed by one decision, and that order is the specification
 * (`docs/wiki/viewshed-3d.md`). Every refusal writes the untouched scene colour and returns, so a
 * pixel is only painted when it survived all five.
 *
 * Unlike the plugin's shader, the geometry is done entirely in EYE space. The plugin converted both
 * the observer and the fragment back to world coordinates with `czm_inverseView` and compared them
 * there, which is the same arithmetic done at ECEF magnitudes (around 6.4e6 m) in 32-bit floats.
 * Eye space is camera-relative, so the same distance and the same two angles are computed with
 * metres-scale operands. Measured: the switch moved 0.000% of the reference image.
 */
const VIEWSHED_FRAGMENT_SHADER = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler2D u_shadowTexture;
uniform mat4 u_shadowMatrix;
uniform vec3 u_observerEC;
uniform vec3 u_forwardEC;
uniform vec3 u_upEC;
uniform vec3 u_rightEC;
uniform vec3 u_visibleColor;
uniform vec3 u_hiddenColor;
uniform vec2 u_texelStep;
uniform float u_distance;
uniform float u_horizontalAngle;
uniform float u_verticalAngle;
uniform float u_mixAmount;
uniform float u_depthBias;

in vec2 v_textureCoordinates;

const float DEGREES_PER_RADIAN = 57.29577951308232;

// Angle, in degrees, between toPoint and the forward axis, measured in the plane whose normal
// is "axis".
//
// EVERY COMMENT IN THIS SOURCE IS A LINE COMMENT, AND ISSO NAO E ESTILO. Cesium's removeComments
// counts the newlines inside each doc-style block comment it finds, and a block comment that has
// no newline makes that count null: the shader never compiles, Cesium stops rendering, and the
// canvas goes BLACK with "Cannot read properties of null (reading 'length')" in the console, far
// from anything that names this file. Measured here on 2026-09-15, on the first run of the
// rewrite, and it cost a full round to find.
float angleAround(vec3 axis, vec3 toPoint, vec3 forward)
{
    vec3 projected = toPoint - axis * dot(axis, toPoint);
    float lengths = length(projected) * length(forward);
    if (lengths == 0.0) {
        return 0.0;
    }
    return abs(acos(clamp(dot(projected, forward) / lengths, -1.0, 1.0))) * DEGREES_PER_RADIAN;
}

// One PCF tap: 1.0 when the shadow map says this depth is the closest thing the observer sees.
float shadowTap(vec2 uv, float depth)
{
    return step(depth, texture(u_shadowTexture, uv).r);
}

// 3x3 percentage-closer filter. Anything below 1.0 is treated as occluded.
float shadowVisibility(vec2 uv, float depth)
{
    float sum = shadowTap(uv, depth);
    sum += shadowTap(uv + vec2(-u_texelStep.x, -u_texelStep.y), depth);
    sum += shadowTap(uv + vec2(0.0, -u_texelStep.y), depth);
    sum += shadowTap(uv + vec2(u_texelStep.x, -u_texelStep.y), depth);
    sum += shadowTap(uv + vec2(-u_texelStep.x, 0.0), depth);
    sum += shadowTap(uv + vec2(u_texelStep.x, 0.0), depth);
    sum += shadowTap(uv + vec2(-u_texelStep.x, u_texelStep.y), depth);
    sum += shadowTap(uv + vec2(0.0, u_texelStep.y), depth);
    sum += shadowTap(uv + vec2(u_texelStep.x, u_texelStep.y), depth);
    return sum / 9.0;
}

void main()
{
    vec4 color = texture(colorTexture, v_textureCoordinates);
    float rawDepth = texture(depthTexture, v_textureCoordinates).r;

    // 1. Sky: nothing was drawn here.
    if (rawDepth >= 1.0) {
        out_FragColor = color;
        return;
    }

    vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, rawDepth);
    vec3 positionEC = eye.xyz / eye.w;

    // 2. Outside the observer's shadow frustum.
    vec4 shadowPosition = u_shadowMatrix * vec4(positionEC, 1.0);
    shadowPosition /= shadowPosition.w;
    if (any(lessThan(shadowPosition.xyz, vec3(0.0))) || any(greaterThan(shadowPosition.xyz, vec3(1.0)))) {
        out_FragColor = color;
        return;
    }

    // 3. Beyond the requested range.
    vec3 toPoint = positionEC - u_observerEC;
    if (length(toPoint) > u_distance) {
        out_FragColor = color;
        return;
    }

    // 4. Outside the horizontal opening (azimuth around the observer's up axis).
    if (angleAround(u_upEC, toPoint, u_forwardEC) > u_horizontalAngle * 0.5) {
        out_FragColor = color;
        return;
    }

    // 5. Outside the vertical opening (elevation around the observer's right axis).
    if (angleAround(u_rightEC, toPoint, u_forwardEC) > u_verticalAngle * 0.5) {
        out_FragColor = color;
        return;
    }

    // All nine taps must agree. There is no half tone, which is why shadow edges are hard.
    float bias = u_depthBias * max(shadowPosition.z * 0.01, 1.0);
    float visibility = shadowVisibility(shadowPosition.xy, shadowPosition.z - bias);
    vec3 tint = visibility == 1.0 ? u_visibleColor : u_hiddenColor;
    out_FragColor = mix(color, vec4(tint, 1.0), u_mixAmount);
}
`;

// ============================================================================
// CONSTANTS
// ============================================================================

/** Defaults, matching what the replaced plugin used, because the caller relies on them. */
const DEFAULTS = Object.freeze({
    horizontalAngle: 120,
    verticalAngle: 90,
    alpha: 0.5,
    distance: 100,
});

/** Shadow map resolution. Cesium's own default; the texel step in the shader derives from it. */
const SHADOW_MAP_SIZE = 2048;

/**
 * Depth bias, in shadow-map depth units, and the value the plugin took from `_primitiveBias`.
 * It is declared here instead of read off a private field because it is a rendering constant, not
 * a fact about Cesium: it trades shadow acne for peter-panning, and it is ours to tune.
 */
const SHADOW_DEPTH_BIAS = 0.00002;

/** Near plane of the observer camera. Too small costs depth precision; too large clips the feet. */
const OBSERVER_NEAR_PLANE = 0.1;

/** Far plane of the observer camera. The real cut is the distance test in the shader. */
const OBSERVER_FAR_PLANE = 5000;

/** Converts clip space [-1, 1] to texture space [0, 1]; the same matrix Cesium's ShadowMap uses. */
const SCALE_BIAS_MATRIX = Object.freeze(
    new Cesium.Matrix4(
        0.5, 0.0, 0.0, 0.5,
        0.0, 0.5, 0.0, 0.5,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0,
    ),
);

// ============================================================================
// THE CLASS
// ============================================================================

const scratchViewProjection = new Cesium.Matrix4();

/**
 * ONE SCRATCH PER UNIFORM, AND NAO UM SO PARA OS TRES EIXOS. `ShaderProgram._setUniforms` reads
 * EVERY uniform callback first and only then calls `set()` on each, so three callbacks returning
 * the same `Cartesian3` end up as three copies of whichever one was written last. Measured here on
 * 2026-09-15: with one shared scratch, forward, up and right all arrived as `right`, the two angle
 * tests refused every pixel, and the scene came back untinted with no error anywhere. The shadow
 * comparison was correct the whole time, which is what made it look like a shadow-map problem.
 */
const scratchObserverEC = new Cesium.Cartesian3();
const scratchForwardEC = new Cesium.Cartesian3();
const scratchUpEC = new Cesium.Cartesian3();
const scratchRightEC = new Cesium.Cartesian3();
const scratchTexelStep = new Cesium.Cartesian2();

/**
 * One viewshed sector: the tinting pass, the depth map that feeds it, and the drawn outline.
 *
 * It is added to `scene.primitives` by itself, because that is what makes Cesium call `update`
 * every frame, which is where the shadow map is offered to the frame.
 */
export class Viewshed3D {
    /**
     * @param {object} viewer - The Cesium viewer.
     * @param {object} [options] - Options.
     * @param {object} [options.cameraPosition] - Observer position (Cartesian3). With `viewPosition`, draws at once.
     * @param {object} [options.viewPosition] - Target position (Cartesian3).
     * @param {number} [options.horizontalAngle] - Horizontal opening in degrees.
     * @param {number} [options.verticalAngle] - Vertical opening in degrees.
     * @param {object} [options.visibleAreaColor] - Cesium.Color for what the observer sees.
     * @param {object} [options.hiddenAreaColor] - Cesium.Color for what it does not.
     * @param {number} [options.alpha] - Tint strength, 0 to 1.
     * @param {number} [options.distance] - Range in metres.
     * @param {Function} [options.calback] - Called once the sector is complete. THE SPELLING IS THE
     *   CONTRACT: the caller passes `calback`, one L, inherited from the replaced plugin. Fixing it
     *   here without fixing `viewshed_tool_3d.js` gives an interactive mode that never completes,
     *   silently.
     */
    constructor(viewer, options = {}) {
        if (!viewer) return;

        this.viewer = viewer;
        this.cameraPosition = options.cameraPosition ?? null;
        this.viewPosition = options.viewPosition ?? null;
        this._horizontalAngle = options.horizontalAngle ?? DEFAULTS.horizontalAngle;
        this._verticalAngle = options.verticalAngle ?? DEFAULTS.verticalAngle;
        this._visibleAreaColor = options.visibleAreaColor ?? new Cesium.Color(0, 1, 0);
        this._hiddenAreaColor = options.hiddenAreaColor ?? new Cesium.Color(1, 0, 0);
        this._alpha = options.alpha ?? DEFAULTS.alpha;
        this._distance = options.distance ?? DEFAULTS.distance;
        this.calback = options.calback;

        this.heading = 0;
        this.pitch = 0;

        this._destroyed = false;
        this._observerCamera = null;
        this._shadowMap = null;
        this._postProcess = null;
        this._outline = null;
        this._handler = null;

        if (this.cameraPosition && this.viewPosition) {
            this._addToScene();
            if (this.calback) this.calback();
        } else {
            this._bindPickingEvents();
        }
    }

    // ---- public properties the caller reads and writes -------------------

    /** @returns {number} Horizontal opening in degrees. */
    get horizontalAngle() { return this._horizontalAngle; }
    set horizontalAngle(value) { this._horizontalAngle = value; this._rebuildOutline(); }

    /** @returns {number} Vertical opening in degrees. */
    get verticalAngle() { return this._verticalAngle; }
    set verticalAngle(value) { this._verticalAngle = value; this._rebuildOutline(); }

    /** @returns {number} Range in metres. */
    get distance() { return this._distance; }
    set distance(value) { this._distance = value; this._rebuildOutline(); }

    /** @returns {object} Cesium.Color of the visible area. */
    get visibleAreaColor() { return this._visibleAreaColor; }
    set visibleAreaColor(value) { this._visibleAreaColor = value; }

    /** @returns {object} Cesium.Color of the hidden area. */
    get hiddenAreaColor() { return this._hiddenAreaColor; }
    set hiddenAreaColor(value) { this._hiddenAreaColor = value; }

    /** @returns {number} Tint strength. */
    get alpha() { return this._alpha; }
    set alpha(value) { this._alpha = value; }

    // ---- lifecycle -------------------------------------------------------

    /**
     * Frame hook. Cesium calls it because this object lives in `scene.primitives`.
     *
     * PRIVATE SURFACE 3 of 3: `frameState.shadowMaps` is the only way a primitive can ask for an
     * analytic shadow map to be rendered this frame.
     * @param {object} frameState - Cesium frame state.
     */
    update(frameState) {
        if (this._destroyed || !this._shadowMap) return;
        frameState.shadowMaps.push(this._shadowMap);
    }

    /**
     * @returns {boolean} True once `destroy` has run.
     */
    isDestroyed() {
        return this._destroyed === true;
    }

    /**
     * Tears everything down. Callable more than once: the caller wraps it in `try` and calls it on
     * both the deactivate path and the completion path.
     *
     * It does NOT use `Cesium.destroyObject`, on purpose. That helper replaces every method with a
     * thrower, so the second call would throw where the contract asks for a no-op.
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        this._unbindPickingEvents();

        const viewer = this.viewer;
        if (viewer && !viewer.isDestroyed?.()) {
            const scene = viewer.scene;
            if (this._postProcess) scene.postProcessStages.remove(this._postProcess);
            if (this._outline) scene.primitives.remove(this._outline);
            // Removing self is what the replaced plugin never did: it left a dead object in the
            // collection being asked for an update on every frame, for the life of the viewer.
            scene.primitives.remove(this);
        }

        if (this._shadowMap && !this._shadowMap.isDestroyed?.()) {
            this._shadowMap.destroy();
        }

        this._shadowMap = null;
        this._postProcess = null;
        this._outline = null;
        this._observerCamera = null;
        this.viewer = null;
    }

    // ---- construction ----------------------------------------------------

    /**
     * Builds the observer camera, the shadow map, the tinting pass and the outline, and joins the
     * scene's primitive collection.
     * @private
     */
    _addToScene() {
        this._createObserverCamera();
        this._createShadowMap();
        this._createPostProcess();
        this._rebuildOutline();
        this.viewer.scene.primitives.add(this);
    }

    /**
     * The camera that stands at the observer and looks at the target.
     *
     * Two things that are not obvious. The up axis is the GEOCENTRIC normal at the observer, not the
     * ellipsoid normal and not the scene camera's up: it is what makes the horizontal opening be a
     * horizontal opening. And the range is RECOMPUTED from the two positions, to one decimal, and
     * overwrites whatever range was asked for, because the target is by construction the point at
     * that range (this is also true on the non-interactive path).
     * @private
     */
    _createObserverCamera() {
        const scene = this.viewer.scene;
        const camera = new Cesium.Camera(scene);

        const forward = Cesium.Cartesian3.subtract(
            this.viewPosition,
            this.cameraPosition,
            new Cesium.Cartesian3(),
        );
        camera.position = Cesium.Cartesian3.clone(this.cameraPosition, new Cesium.Cartesian3());
        camera.direction = Cesium.Cartesian3.normalize(forward, new Cesium.Cartesian3());
        camera.up = Cesium.Cartesian3.normalize(this.cameraPosition, new Cesium.Cartesian3());

        this._distance = Number(
            Cesium.Cartesian3.distance(this.viewPosition, this.cameraPosition).toFixed(1),
        );

        camera.frustum = new Cesium.PerspectiveFrustum({
            fov: Cesium.Math.toRadians(observerFovDegrees(this._horizontalAngle, this._verticalAngle)),
            aspectRatio: scene.canvas.clientWidth / scene.canvas.clientHeight,
            near: OBSERVER_NEAR_PLANE,
            far: OBSERVER_FAR_PLANE,
        });

        this.heading = Cesium.Math.toDegrees(camera.heading);
        this.pitch = Cesium.Math.toDegrees(camera.pitch);

        this._observerCamera = camera;
    }

    /**
     * The depth map rendered from the observer.
     *
     * PRIVATE SURFACE 1 of 3: `scene.context` and the `ShadowMap` constructor. `fromLightSource`
     * false is the flag that keeps this map out of the scene's own shading: it is an analysis, not
     * a light. Cascades off keeps the light frustum exactly as built above, which is what lets
     * `_shadowMatrix` be computed from public API.
     * @private
     */
    _createShadowMap() {
        const scene = this.viewer.scene;
        this._shadowMap = new Cesium.ShadowMap({
            context: scene.context,
            lightCamera: this._observerCamera,
            enabled: true,
            isPointLight: false,
            cascadesEnabled: false,
            softShadows: false,
            normalOffset: false,
            fromLightSource: false,
            size: SHADOW_MAP_SIZE,
            maximumDistance: OBSERVER_FAR_PLANE,
        });
    }

    /**
     * Registers the tinting pass and wires its uniforms.
     *
     * Every uniform is a FUNCTION, evaluated per frame, because two of them depend on the scene
     * camera and therefore change whenever the user moves.
     * @private
     */
    _createPostProcess() {
        const self = this;
        this._postProcess = this.viewer.scene.postProcessStages.add(
            new Cesium.PostProcessStage({
                name: 'ebgeo-viewshed-3d',
                fragmentShader: VIEWSHED_FRAGMENT_SHADER,
                uniforms: {
                    // PRIVATE SURFACE 2 of 3, and the only one with no public substitute.
                    u_shadowTexture: () => self._shadowMap?._shadowMapTexture,
                    u_shadowMatrix: () => self._shadowMatrix(),
                    u_observerEC: () => self._axisToEyeCoordinates('position'),
                    u_forwardEC: () => self._axisToEyeCoordinates('direction'),
                    u_upEC: () => self._axisToEyeCoordinates('up'),
                    u_rightEC: () => self._axisToEyeCoordinates('right'),
                    u_visibleColor: () => self._visibleAreaColor,
                    u_hiddenColor: () => self._hiddenAreaColor,
                    u_texelStep: () => Cesium.Cartesian2.fromElements(
                        1 / SHADOW_MAP_SIZE,
                        1 / SHADOW_MAP_SIZE,
                        scratchTexelStep,
                    ),
                    u_distance: () => self._distance,
                    u_horizontalAngle: () => self._horizontalAngle,
                    u_verticalAngle: () => self._verticalAngle,
                    u_mixAmount: () => self._alpha,
                    u_depthBias: () => SHADOW_DEPTH_BIAS,
                },
            }),
        );
    }

    /**
     * Eye-space to shadow-texture-space matrix, the one the plugin read off `_shadowMapMatrix`.
     *
     * It is `scaleBias * lightProjection * lightView * inverse(sceneView)`, and every factor is
     * public. Cesium's own `ShadowMap.update` composes the same four; with cascades disabled and no
     * point light, nothing refits the light frustum between frames, so this stays in step.
     * @private
     * @returns {object} Cesium.Matrix4.
     */
    _shadowMatrix() {
        const camera = this._observerCamera;
        Cesium.Matrix4.multiply(
            camera.frustum.projectionMatrix,
            camera.viewMatrix,
            scratchViewProjection,
        );
        Cesium.Matrix4.multiply(SCALE_BIAS_MATRIX, scratchViewProjection, scratchViewProjection);
        return Cesium.Matrix4.multiply(
            scratchViewProjection,
            this.viewer.scene.camera.inverseViewMatrix,
            scratchViewProjection,
        );
    }

    /**
     * One of the observer camera's axes (or its position), expressed in the scene camera's eye space.
     * @private
     * @param {'position'|'direction'|'up'|'right'} axis - Which one.
     * @returns {object} Cesium.Cartesian3.
     */
    _axisToEyeCoordinates(axis) {
        const view = this.viewer.scene.camera.viewMatrix;
        if (axis === 'position') {
            return Cesium.Matrix4.multiplyByPoint(
                view,
                this._observerCamera.positionWC,
                scratchObserverEC,
            );
        }
        if (axis === 'direction') {
            return Cesium.Matrix4.multiplyByPointAsVector(
                view, this._observerCamera.directionWC, scratchForwardEC,
            );
        }
        if (axis === 'up') {
            return Cesium.Matrix4.multiplyByPointAsVector(
                view, this._observerCamera.upWC, scratchUpEC,
            );
        }
        return Cesium.Matrix4.multiplyByPointAsVector(
            view, this._observerCamera.rightWC, scratchRightEC,
        );
    }

    // ---- the drawn outline ----------------------------------------------

    /**
     * Draws (or redraws) the wireframe of the sector.
     *
     * A spherical sector, not a frustum outline: the shader cuts at a constant DISTANCE, so the far
     * boundary is a sphere, and a flat far plane would draw a boundary the analysis does not have.
     * @private
     */
    _rebuildOutline() {
        if (this._destroyed || !this.viewer || !this._observerCamera) return;

        const scene = this.viewer.scene;
        if (this._outline) {
            scene.primitives.remove(this._outline);
            this._outline = null;
        }

        const collection = new Cesium.PolylineCollection();
        const forward = this._observerCamera.directionWC;
        const right = this._observerCamera.rightWC;
        const up = this._observerCamera.upWC;
        const origin = this._observerCamera.positionWC;

        /**
         * @param {{azimuth: number, elevation: number}} angle
         * @returns {object} Cesium.Cartesian3 on the sector's far surface.
         */
        const pointAt = (angle) => {
            const dir = directionFromAngles(forward, right, up, angle.azimuth, angle.elevation);
            return new Cesium.Cartesian3(
                origin.x + dir.x * this._distance,
                origin.y + dir.y * this._distance,
                origin.z + dir.z * this._distance,
            );
        };

        for (const line of frustumOutlineAngles(this._horizontalAngle, this._verticalAngle)) {
            const positions = line.apex
                ? [Cesium.Cartesian3.clone(origin, new Cesium.Cartesian3()), pointAt(line.points[0])]
                : line.points.map(pointAt);
            collection.add({
                positions,
                width: 1,
                // ALPHA 0.99, E O NOVENTA E NOVE E O PONTO. Uma polilinha opaca entra na passada
                // opaca e ESCREVE PROFUNDIDADE, de modo que o proprio pos-processamento a pinta de
                // verde ou de vermelho: o fio de arame, que e anotacao e nao terreno, passa a
                // mentir sobre o que o observador enxerga (medido em 2026-09-15, com o arco da
                // cupula saindo metade verde). Abaixo de 1.0 o material e translucido, a linha nao
                // escreve profundidade, e ela permanece branca, que e o que o sensor do vendor
                // fazia. A diferenca visual entre 1.0 e 0.99 de alfa nao existe na tela.
                material: Cesium.Material.fromType('Color', {
                    color: Cesium.Color.WHITE.withAlpha(0.99),
                }),
            });
        }

        scene.primitives.add(collection);
        this._outline = collection;
    }

    // ---- interactive mode ------------------------------------------------

    /**
     * Two clicks: the first fixes the observer, the second the target. Moving the mouse in between
     * keeps the range live, which is what makes the gesture readable.
     * @private
     */
    _bindPickingEvents() {
        const scene = this.viewer.scene;
        const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);

        handler.setInputAction((click) => {
            const picked = pickScenePosition(scene, click.position);
            if (!picked) return;
            if (!this.cameraPosition) {
                this.cameraPosition = picked;
                return;
            }
            if (!this.viewPosition) {
                this.viewPosition = picked;
                this._addToScene();
                this._unbindPickingEvents();
                if (this.calback) this.calback();
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction((movement) => {
            if (!this.cameraPosition) return;
            const hovered = pickScenePosition(scene, movement.endPosition);
            if (!hovered) return;
            this._distance = Number(
                Cesium.Cartesian3.distance(this.cameraPosition, hovered).toFixed(1),
            );
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        this._handler = handler;
    }

    /** @private */
    _unbindPickingEvents() {
        if (!this._handler) return;
        this._handler.destroy();
        this._handler = null;
    }
}

/**
 * The position under the cursor, preferring real scene geometry and falling back to the globe.
 *
 * `pickPosition` reads the depth buffer, so it answers for a 3D model; when nothing was drawn there
 * it returns nothing useful and the globe ray is the answer. This is the helper the replaced plugin
 * published onto the Cesium namespace as `getCurrentMousePosition`; here it is a module function,
 * because writing onto the library's namespace is how that file made itself hard to remove.
 * @param {object} scene - Cesium scene.
 * @param {object} windowPosition - Cartesian2 in window coordinates.
 * @returns {object|null} Cartesian3, or null.
 */
function pickScenePosition(scene, windowPosition) {
    if (scene.pickPositionSupported && Cesium.defined(scene.pick(windowPosition))) {
        const picked = scene.pickPosition(windowPosition);
        if (Cesium.defined(picked)) {
            const carto = Cesium.Cartographic.fromCartesian(picked);
            if (carto && carto.height >= -500) return picked;
        }
    }
    if (scene.mode === Cesium.SceneMode.SCENE3D) {
        const ray = scene.camera.getPickRay(windowPosition);
        return scene.globe.pick(ray, scene) ?? null;
    }
    return scene.camera.pickEllipsoid(windowPosition, scene.ellipsoid) ?? null;
}
