// Path: tests/unit/centralizar-simbolo-pela-caixa.repro.test.js

/**
 * REPRO: "Centralizar no mapa" num símbolo de medida de coordenação ou de engenharia voava para
 * o ponto em zoom 15, enquanto o símbolo militar ENQUADRAVA o símbolo. O comportamento certo,
 * nas palavras do dono (2026-09-24), é o do símbolo militar.
 *
 * CAUSA. `zoomToFeature` (`utilities/feature_navigation_utils.js`) enquadra a caixa de seleção
 * (`properties.selectionBox`) só para os tipos de uma lista, e a lista era escrita à mão com
 * quatro tipos. Os dois símbolos ficaram de fora mesmo GRAVANDO a caixa: o controle de medida
 * de coordenação a calcula (`calculateSelectionBoxGeometry`) e o de engenharia a herda, porque
 * `AddEngineeringSymbolControl` estende `AddCoordinationMeasureControl`. O campo `selectionBox`
 * do registro de tipos repetia a mesma lista, e um teste de paridade prendia as duas cópias uma
 * à outra: duas cópias igualmente erradas concordavam até o verde.
 *
 * CONSERTO. O campo do registro passou a dizer a verdade dos controles, e a lista passou a
 * DERIVAR dele. Este arquivo prende as duas metades: o comportamento (os três símbolos pedem à
 * câmera exatamente a mesma coisa) e o motivo de ele ser o certo (os dois controles escrevem a
 * caixa).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEATURE_TYPE_REGISTRY } from '@store/feature-type.registry.js';

vi.mock('@store', () => ({ getSourceTypeFromStorage: (t) => t }));

// O duble do MapLibre entra pelo ponto único, como em `navegacao-de-feicao-coordenadas.test.js`.
const dubleDoMapLibre = {};
vi.mock('@js/map/maplibre.js', () => ({ maplibregl: dubleDoMapLibre }));

const { zoomToFeature } = await import('../../src/js/utilities/feature_navigation_utils.js');

/** Answers like LngLatBounds and remembers what it was extended with. */
class LimitesFalsos {
    constructor() { this.pontos = []; }
    extend(c) { this.pontos.push(c); }
    isEmpty() { return this.pontos.length === 0; }
    getNorthEast() { return { lng: Math.max(...this.pontos.map((c) => c[0])), lat: Math.max(...this.pontos.map((c) => c[1])) }; }
    getSouthWest() { return { lng: Math.min(...this.pontos.map((c) => c[0])), lat: Math.min(...this.pontos.map((c) => c[1])) }; }
}

const CAIXA = {
    type: 'Polygon',
    coordinates: [[[-43.2, -22.95], [-43.1, -22.95], [-43.1, -22.85], [-43.2, -22.85], [-43.2, -22.95]]],
};

/** What "Centralizar no mapa" asks of the camera for one symbol, with the panel's options. */
async function pedidoDaCamera(source) {
    const map = { getZoom: () => 8, flyTo: vi.fn(), fitBounds: vi.fn() };
    const feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.15, -22.9] },
        properties: { source, selectionBox: CAIXA },
    };
    await zoomToFeature(feature, map, { duration: 800, paddingPercent: 0.3 });
    return {
        voou: map.flyTo.mock.calls.length,
        enquadrou: map.fitBounds.mock.calls.map(([limites, opcoes]) => ({ pontos: limites.pontos, opcoes })),
    };
}

const ler = (rel) => readFileSync(fileURLToPath(new URL(`../../src/js/${rel}`, import.meta.url)), 'utf8');

describe('centralizar símbolo pela caixa, como o símbolo militar', () => {
    beforeEach(() => {
        dubleDoMapLibre.LngLatBounds = LimitesFalsos;
    });

    it('o símbolo militar enquadra a caixa (é a referência, e ela precisa estar de pé)', async () => {
        const militar = await pedidoDaCamera('military_symbol');
        expect(militar.voou).toBe(0);
        expect(militar.enquadrou).toHaveLength(1);
        expect(militar.enquadrou[0].pontos).toHaveLength(5);
    });

    it('medida de coordenação e símbolo de engenharia pedem à câmera EXATAMENTE o mesmo', async () => {
        const militar = await pedidoDaCamera('military_symbol');
        for (const source of ['coordination_measure', 'engineering_symbol']) {
            expect(await pedidoDaCamera(source), source).toEqual(militar);
        }
    });

    it('o registro marca a caixa nos três símbolos', () => {
        const comCaixa = new Set(FEATURE_TYPE_REGISTRY.filter((r) => r.selectionBox).map((r) => r.type));
        for (const tipo of ['military_symbol', 'coordination_measure', 'engineering_symbol']) {
            expect(comCaixa.has(tipo), tipo).toBe(true);
        }
    });

    it('e o registro diz a verdade dos controles: os dois gravam a caixa', () => {
        // A medida de coordenação CALCULA a caixa; o símbolo de engenharia a herda por extensão.
        expect(ler('military_tools/coordination_measure_tool/add_coordination_measure_control.js'))
            .toMatch(/selectionBox\s*=\s*this\.geometry\.calculateSelectionBoxGeometry\(/);
        expect(ler('military_tools/engineering_symbol_tool/add_engineering_symbol_control.js'))
            .toMatch(/class AddEngineeringSymbolControl extends AddCoordinationMeasureControl\b/);
    });
});
