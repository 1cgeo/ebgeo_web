// Path: js/3d_models_viewer_tool/services/cesium-compat.js
/**
 * @module 3d_models_viewer_tool/services/cesium-compat
 * @description Compatibility patches for running `cesium-viewshed`, a third-party plugin built
 * for Cesium ~1.100, on the Cesium this app loads (1.145.0 from npm since 2026-09-14, V9;
 * 1.138.0 as a vendored `<script>` before that).
 *
 * Patches applied:
 * 1. Cesium.defaultValue polyfill (removed in Cesium 1.134)
 * 2. GLSL ES 1.0 → 3.0 shader auto-upgrade (Cesium uses WebGL2 since 1.138)
 * 3. isDestroyed()/destroy() for primitives missing them (required since Cesium 1.138)
 *
 * THE THREE STILL EARN THEIR KEEP ON 1.145, and that was measured rather than assumed: the
 * Playwright capture of 2026-09-14 computed a viewshed over a real tileset and read the image
 * (green visible, red occluded, the frustum wireframe), which exercises all three at once. The
 * version bump brought no fourth patch.
 *
 * WHAT THE npm MIGRATION DID ADD is not here, it is in `frontend/src/js/vendor/cesium.js`: the
 * object these functions receive has to be an EXTENSIBLE copy of the module namespace, and it has
 * to carry `__esModule: true`. Without the first, `polyfillDefaultValue` cannot write; without the
 * second, the plugin reads every Cesium symbol as `undefined` and never defines `ViewShed3D`, so
 * `patchPrimitiveLifecycle` below skips both class names through its own `continue` and nothing
 * anywhere goes red. That header carries the measurement.
 */

// ============================================================================
// GLSL SHADER UPGRADE (WebGL1 → WebGL2)
// ============================================================================

/**
 * Upgrades a GLSL ES 1.0 fragment shader source to ES 3.0 syntax.
 * Cesium 1.138 uses WebGL2 and prepends `#version 300 es` to all shaders,
 * but does not auto-convert legacy GLSL 1.0 keywords.
 * @param {string} src - Fragment shader source string
 * @returns {string} Upgraded shader source
 */
function upgradeFragmentShaderToGLSL3(src) {
    if (!src || typeof src !== 'string') return src;
    // Skip shaders already in GLSL 3.0 syntax
    if (src.includes('out_FragColor')) return src;
    // Only upgrade shaders that use GLSL 1.0 constructs
    if (!src.includes('varying') && !src.includes('texture2D') && !src.includes('gl_FragColor')) return src;

    let result = src;
    // varying → in (fragment shader inputs)
    result = result.replace(/\bvarying\s+(vec\d|mat\d|float|int)/g, 'in $1');
    // texture2D( → texture(
    result = result.replace(/\btexture2D\s*\(/g, 'texture(');
    // gl_FragColor → out_FragColor (Cesium auto-adds the layout declaration)
    result = result.replace(/\bgl_FragColor\b/g, 'out_FragColor');
    return result;
}

/**
 * Upgrades a GLSL ES 1.0 vertex shader source to ES 3.0 syntax.
 * @param {string} src - Vertex shader source string
 * @returns {string} Upgraded shader source
 */
function upgradeVertexShaderToGLSL3(src) {
    if (!src || typeof src !== 'string') return src;
    // Only upgrade shaders that use GLSL 1.0 constructs
    if (!src.includes('attribute') && !src.includes('varying')) return src;

    let result = src;
    // attribute → in (vertex inputs)
    result = result.replace(/\battribute\s+(vec\d|mat\d|float|int)/g, 'in $1');
    // varying → out (vertex outputs to fragment shader)
    result = result.replace(/\bvarying\s+(vec\d|mat\d|float|int)/g, 'out $1');
    return result;
}

/**
 * Patches Cesium's ShaderSource to auto-upgrade GLSL ES 1.0 → 3.0 syntax.
 * Cesium's own shaders are already in ES 3.0 syntax and are unaffected
 * because guard checks skip sources that don't contain legacy keywords.
 * @param {object} CesiumNS - The Cesium global namespace
 */
function patchShaderSourceForGLSL3(CesiumNS) {
    const ShaderSource = CesiumNS.ShaderSource;
    if (!ShaderSource) return;

    const origCreateFragment = ShaderSource.prototype.createCombinedFragmentShader;
    const origCreateVertex = ShaderSource.prototype.createCombinedVertexShader;

    ShaderSource.prototype.createCombinedFragmentShader = function (context) {
        if (this.sources) {
            for (let i = 0; i < this.sources.length; i++) {
                this.sources[i] = upgradeFragmentShaderToGLSL3(this.sources[i]);
            }
        }
        return origCreateFragment.call(this, context);
    };

    ShaderSource.prototype.createCombinedVertexShader = function (context) {
        if (this.sources) {
            for (let i = 0; i < this.sources.length; i++) {
                this.sources[i] = upgradeVertexShaderToGLSL3(this.sources[i]);
            }
        }
        return origCreateVertex.call(this, context);
    };
}

// ============================================================================
// POLYFILLS & PRIMITIVE PATCHES
// ============================================================================

/**
 * Polyfills Cesium.defaultValue which was removed in Cesium 1.134.
 * Required by cesium-viewshed library built for Cesium ~1.100.
 * @param {object} CesiumNS - The Cesium global namespace
 */
function polyfillDefaultValue(CesiumNS) {
    if (CesiumNS.defaultValue) return;

    CesiumNS.defaultValue = function (a, b) {
        return a !== undefined && a !== null ? a : b;
    };
    CesiumNS.defaultValue.EMPTY_OBJECT = CesiumNS.Frozen?.EMPTY_OBJECT ?? Object.freeze({});
}

/**
 * Adds isDestroyed()/destroy() to primitive classes that lack them.
 * Cesium 1.138 fires a `primitiveAdded` event from PrimitiveCollection.add()
 * whose handler calls isDestroyed() on every added primitive.
 * @param {object} CesiumNS - The Cesium global namespace
 * @param {string[]} classNames - Primitive class names to patch on CesiumNS
 */
function patchPrimitiveLifecycle(CesiumNS, classNames) {
    for (const className of classNames) {
        if (!CesiumNS[className]) continue;

        const proto = CesiumNS[className].prototype;
        if (!proto.isDestroyed) {
            proto.isDestroyed = function () {
                return this._isDestroyed === true;
            };
        }
        // Wrap existing destroy to set _isDestroyed flag, or create one
        const origDestroy = proto.destroy;
        proto.destroy = function () {
            this._isDestroyed = true;
            if (origDestroy) {
                return origDestroy.call(this);
            }
            return CesiumNS.destroyObject(this);
        };
    }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Applies all Cesium compatibility patches needed before loading third-party plugins.
 * Must be called after Cesium.js is loaded but before cesium-viewshed/cesium-measure.
 * @param {object} CesiumNS - The Cesium global namespace
 */
export function applyCesiumPreLoadPatches(CesiumNS) {
    polyfillDefaultValue(CesiumNS);
    patchShaderSourceForGLSL3(CesiumNS);
}

/**
 * Applies Cesium compatibility patches that require the third-party plugins to be loaded.
 * Must be called after cesium-viewshed/cesium-measure scripts have been loaded.
 * @param {object} CesiumNS - The Cesium global namespace
 */
export function applyCesiumPostLoadPatches(CesiumNS) {
    patchPrimitiveLifecycle(CesiumNS, ['RectangularSensorPrimitive', 'ViewShed3D']);
}
