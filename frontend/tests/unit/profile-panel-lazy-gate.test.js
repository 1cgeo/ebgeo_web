// Path: tests/unit/profile-panel-lazy-gate.test.js

/**
 * ui_manager.js only downloads the Chart.js-backed ProfilePanelManager when
 * `canRenderProfile()` says the selection might render a profile. That predicate is a
 * SECOND copy of part of the decision that ProfilePanelManager.showProfilePanel() owns,
 * so the two can drift — and the drift is silent: the profile panel simply stops opening.
 *
 * This suite pins the invariant that makes the duplication safe:
 *   for every selection, manager-renders(s) IMPLIES canRenderProfile(s).
 * (The converse is deliberately NOT required — the gate may load the module and be overruled.)
 *
 * The manager's decision is exercised without any DOM: showProfilePanel() only calls
 * `this.createProfilePanel(...)` or `this.hideProfilePanel()`, so it runs against a plain
 * object via `.call()`.
 */

import { describe, it, expect, vi } from 'vitest';
import { canRenderProfile } from '@tools/ui_manager.js';
import { ProfilePanelManager } from '@tools/managers/profile-panel.manager.js';

/**
 * Runs the real manager decision without constructing it (no DOM, no Chart.js instance).
 * @param {Array<Object>} selectedFeatures
 * @returns {boolean} true when the manager would render a chart
 */
function managerRenders(selectedFeatures) {
    const createProfilePanel = vi.fn();
    const hideProfilePanel = vi.fn();
    ProfilePanelManager.prototype.showProfilePanel.call(
        { createProfilePanel, hideProfilePanel },
        selectedFeatures
    );
    return createProfilePanel.mock.calls.length > 0;
}

/**
 * @param {Object} overrides
 * @returns {Object} a GeoJSON-ish feature
 */
function feature({ source = 'line', type = 'LineString', profile = true, profileData = '[]' } = {}) {
    return {
        geometry: { type },
        properties: { id: 'f1', source, profile, profileData },
    };
}

const CASES = [
    ['line com perfil', [feature()]],
    ['los com perfil', [feature({ source: 'los', type: 'LineString' })]],
    ['los sem geometria de linha', [feature({ source: 'los', type: 'Point' })]],
    ['line sem profile', [feature({ profile: false })]],
    ['line sem profileData', [feature({ profileData: null })]],
    ['line com profileData vazio (string "")', [feature({ profileData: '' })]],
    ['polygon com perfil', [feature({ source: 'polygon', type: 'Polygon' })]],
    ['point com perfil', [feature({ source: 'point', type: 'Point' })]],
    ['duas feicoes com perfil', [feature(), feature()]],
    ['selecao vazia', []],
    ['profile = 0 (falsy numerico)', [feature({ profile: 0 })]],
    ['profile = "false" (string truthy)', [feature({ profile: 'false' })]],
];

describe('canRenderProfile: portao de carregamento sob demanda do Chart.js', () => {
    it.each(CASES)('nunca nega o carregamento quando o manager renderiza: %s', (_label, selection) => {
        const renders = managerRenders(selection);
        if (renders) {
            expect(canRenderProfile(selection)).toBe(true);
        } else {
            // Documenta o que o portao respondeu; nao e invariante (pode ser "talvez").
            expect(typeof canRenderProfile(selection)).toBe('boolean');
        }
    });

    it('a bateria contem pelo menos um caso em que o manager REALMENTE renderiza', () => {
        // Sem isto o `it.each` acima passaria verde com cobertura vazia: se nenhum
        // fixture entrasse no ramo `renders`, a invariante nao seria exercitada.
        const rendering = CASES.filter(([, selection]) => managerRenders(selection));
        expect(rendering.length).toBeGreaterThanOrEqual(2);
    });

    it('nao carrega o modulo para uma selecao que nao pode ter perfil', () => {
        expect(canRenderProfile([feature({ profile: false })])).toBe(false);
        expect(canRenderProfile([feature(), feature()])).toBe(false);
        expect(canRenderProfile([])).toBe(false);
    });

    // Bordas: entradas que nao sao selecao valida nao podem estourar o caminho de selecao.
    it.each([
        ['undefined', undefined],
        ['null', null],
        ['array com undefined', [undefined]],
        ['array com objeto sem properties', [{ geometry: { type: 'LineString' } }]],
        ['array com properties null', [{ properties: null }]],
    ])('devolve false sem lancar para %s', (_label, input) => {
        expect(canRenderProfile(input)).toBe(false);
    });
});
