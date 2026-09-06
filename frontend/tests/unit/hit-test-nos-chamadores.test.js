// Path: tests/unit/hit-test-nos-chamadores.test.js

/**
 * @fileoverview The three CALL SITES of the shared hit-test, pinned at the
 * source.
 *
 * `hit-test.model.test.js` and `feature-hit-test.helpers.test.js` prove the
 * model and the map-facing wrapper. Nothing proved that selection, drag-start
 * and the phone tap-deselect actually GO THROUGH them: reverting all three call
 * sites to `map.queryRenderedFeatures(point)` left the whole suite green, which
 * is exactly the "cobertura vazia passa verde" failure mode. The claim those
 * files make is a claim about the WHOLE click path, and the wiring is the half
 * that no unit test of a pure function can reach.
 *
 * Why source text and not behaviour: the three callers are a MapLibre control,
 * a drag handler over the store barrel and the phone orchestrator; a behavioural
 * double for any of them would assert the double, not the wiring. What is pinned
 * here is only the wiring, and every assertion is paired with a control that
 * fails if the extraction stopped matching the file.
 *
 * NOT pinned here: that the hit-test answers correctly (its own two suites), and
 * the hover cursor of the fifteen tool controls (`visibility-hover-e-espera.test.js`
 * holds the model case for those).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads one source file of the app.
 * @param {string} relative - Path under `frontend/src/`
 * @returns {string} File contents
 */
function source(relative) {
    return readFileSync(fileURLToPath(new URL(`../../src/${relative}`, import.meta.url)), 'utf8');
}

/**
 * Slices out one method body by brace balance, starting at its signature.
 * Returns `null` when the signature is not there, so a rename shows up as a
 * failed control instead of as a vacuously passing search.
 * @param {string} text - File contents
 * @param {string} signature - Exact opening text of the method, up to its `{`
 * @returns {string|null} The body, braces included
 */
function methodBody(text, signature) {
    const start = text.indexOf(signature);
    if (start === -1) return null;

    let depth = 0;
    for (let i = text.indexOf('{', start); i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
}

const SELECTION = source('js/tool_manager/selection_manager.js');
const MOVE = source('js/tool_manager/move_handler.js');
const PHONE = source('js/phone/phone-layout.js');

describe('the click path goes through the shared hit-test', () => {
    it('selection queries with tolerance and ranks the survivors', () => {
        const body = methodBody(SELECTION, 'getAllClickedCustomFeatures(point) {');
        // CONTROL: the method is still the one that filters by visible layer.
        expect(body).toContain('visibleLayerSet');

        expect(body).toContain('queryFeaturesAtPoint(this.map, point)');
        expect(body).not.toContain('queryRenderedFeatures');
        // Ranking comes AFTER the lock/visibility filtering, so it is the return.
        expect(body).toContain('return rankHitRows(uniqueFeatures);');
        expect(SELECTION).toContain("from './helpers/feature-hit-test.helpers.js'");
    });

    it('drag-start uses the same query, gates the handle first and drops locked rows', () => {
        const body = methodBody(MOVE, '_startDrag(e) {');
        // CONTROL: the method is still the one that refuses to drag on a locked map.
        expect(body).toContain('isCurrentMapLockedSync()');

        expect(body).toContain('queryFeaturesAtPoint(this.map, e.point)');
        expect(body).not.toContain('queryRenderedFeatures');
        expect(body).toContain('isFeatureEffectivelyLocked(feature)');
        expect(body).toContain('rankHitRows(');

        // The handle gate reads the UNFILTERED rows, so it has to run before the
        // filter that would have dropped them.
        const handleGate = body.indexOf('_isClickOnEditHandleCached');
        const filter = body.indexOf('getValidDragSources');
        expect(handleGate).toBeGreaterThan(-1);
        expect(filter).toBeGreaterThan(handleGate);
    });

    it('the phone tap-deselect asks the same question, after the move guard', () => {
        const body = methodBody(PHONE, '_wireMapTapDeselect() {');
        // CONTROL: the branch's own guard against deselecting mid-move stays.
        expect(body).toContain('isMoving()');

        expect(body).toContain('queryFeaturesAtPoint(this._map, e.point)');
        expect(body).not.toContain('queryRenderedFeatures');
        expect(body.indexOf('isMoving()')).toBeLessThan(body.indexOf('queryFeaturesAtPoint'));
    });

    it('the image tool draws its box from the rendered rectangle, on the real layer id', () => {
        const image = source('js/draw_tools/image_tool/add_image_control.js');
        const body = methodBody(image, 'createSelectionBox(feature) {');
        // CONTROL: the stored box is still the fallback, not the first answer.
        expect(body).toContain('feature.properties.selectionBox');

        expect(body).toContain('createRenderedIconSelectionBox(this.map, feature, "image-layer")');
        expect(body.indexOf('createRenderedIconSelectionBox'))
            .toBeLessThan(body.indexOf('feature.properties.selectionBox'));
        expect(methodBody(image, 'getSelectionBoxStrategy() {')).toContain('"viewport"');
    });

    it('the late-tool click path keeps isClickOnEditHandle, which upstream deleted', () => {
        // `ferramenta-tardia-responde-ao-clique.test.js` calls it; the port must not
        // take it with the upstream hunk that removed it.
        expect(methodBody(SELECTION, 'isClickOnEditHandle(point) {')).not.toBeNull();
    });
});
