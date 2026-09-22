// Path: js/3d_models_viewer_tool/services/viewer-teardown.js

/**
 * @fileoverview Tearing the Cesium 3D viewer down with ONE OWNER PER OBJECT.
 *
 * THE DEFECT THIS EXISTS FOR (release 1.0.0+e91fb15a, 2026-09-21, origin `rejeicao`, map page):
 * `DeveloperError: This object was destroyed, i.e., destroy() was called.`, thrown by
 * `viewer.destroy()` itself from `DataSourceDisplay._onDataSourceRemoved`. The teardown in
 * `map_3d.js` emptied `scene.primitives` and `scene.groundPrimitives` with `removeAll()` right
 * before destroying the viewer. Those collections belong to the SCENE, and inside them live two
 * `PrimitiveCollection`s that belong to the viewer's `DataSourceDisplay`, with one child collection
 * per data source (the default one included). `removeAll()` destroys every member, so it destroyed
 * the display's collections from outside; `viewer.destroy()` then runs `DataSourceDisplay.destroy`,
 * which calls `remove` on the default data source's collection, and `destroyObject` had already
 * turned that method into a thrower. The display joins the scene on the first data source or entity,
 * and `CesiumMeasure` adds a data source on construction, so every session that opened the 3D viewer
 * paid it on unload, where it surfaced as an unhandled rejection of the barrel's async wrapper.
 *
 * WHY IT SHOWED UP ONLY AFTER 2026-09-14. The vendored 1.138 was the release bundle, where the body
 * of `throwOnDestroyed` is compiled out by the `debug` pragma and the call returns nothing. The npm
 * package is imported from `Source/`, where the pragma survives and the stub throws. The same
 * sequence was silent for as long as it existed and became loud with the migration (decision V9).
 *
 * THE RULE, which is the whole module:
 *  - each tool releases what IT added (entities, handlers, primitives, its own data source, timers,
 *    bus listeners) while the viewer is still alive;
 *  - the viewer releases what it owns (the entity collection, the data source collection, the scene
 *    and every primitive still in it) in its own `destroy()`, and NOTHING else empties those
 *    collections on the way out;
 *  - a step that throws does not stop the ones after it. A tool left armed is worse than a warning:
 *    its primitives would be destroyed by the scene out of order, and its debounce timer or pending
 *    store read would reach a destroyed viewer. The failures are returned to the caller, never
 *    swallowed here.
 *
 * Zero imports on purpose: the rule is exercised in node against a double that throws the way Cesium
 * throws (`frontend/tests/integration/visualizador-3d-desmontagem.repro.test.js`).
 */

/**
 * @typedef {Object} TeardownStep
 * @property {string} name - What the step releases; it names the failure, if there is one.
 * @property {Function} run - Synchronous release, run while the viewer is still alive.
 */

/**
 * @typedef {Object} TeardownFailure
 * @property {string} step - The `name` of the step that threw, or `'viewer'` for `destroy()` itself.
 * @property {*} error - What it threw, untouched, so the report keeps the original stack.
 */

/**
 * Runs every release step, in order, and only then destroys the viewer.
 *
 * @param {object|null} viewer - The Cesium viewer, or null when it never came up.
 * @param {TeardownStep[]} steps - The tools' own releases. Each one runs even if an earlier one threw.
 * @returns {TeardownFailure[]} Empty when the teardown was clean.
 */
export function teardownCesiumViewer(viewer, steps) {
    const failures = [];

    for (const step of steps) {
        try {
            step.run();
        } catch (error) {
            failures.push({ step: step.name, error });
        }
    }

    if (viewer && !viewer.isDestroyed()) {
        try {
            viewer.destroy();
        } catch (error) {
            failures.push({ step: 'viewer', error });
        }
    }

    return failures;
}

/**
 * Throws what the teardown collected, AFTER the caller has reset its own state.
 *
 * One failure is rethrown as it came, because its stack is the one the defect report needs. Several
 * go out together in an `AggregateError` whose message names the steps.
 *
 * @param {TeardownFailure[]} failures - As returned by `teardownCesiumViewer`.
 * @throws {*} The single failure, or an `AggregateError` with all of them.
 */
export function throwIfTeardownFailed(failures) {
    if (failures.length === 0) return;
    if (failures.length === 1) throw failures[0].error;
    throw new AggregateError(
        failures.map((f) => f.error),
        `3D viewer teardown failed in: ${failures.map((f) => f.step).join(', ')}`
    );
}
