// Path: tests/unit/single-shot-tools-guard.test.js
//
// ROOT CAUSE it guards: in the single-shot tools (point, text, military symbol,
// coordination measure) `handleMapClick` gated on `this.isActive`, but `isActive`
// only became false much later, inside `toolManager.deactivateCurrentTool()`, which
// runs AFTER several awaits (name generation, symbol/image generation, the store
// write). Two clicks in the same tick therefore both passed the gate and created two
// features. The fix disarms the tool (`this.isActive = false`) BEFORE the first await.
//
// This test makes the losing interleaving deterministic: the second click is issued
// while the first creation is still pending (its promise is resolved only after both
// clicks were dispatched), which is exactly the window the bug lived in.

import { describe, it, expect, beforeAll } from 'vitest';

const TOOLS = [
    {
        nome: 'point',
        modulo: '../../src/js/draw_tools/point_tool/add_point_control.js',
        criacao: 'createPointAtCoordinates',
    },
    {
        nome: 'text',
        modulo: '../../src/js/draw_tools/text_tool/add_text_control.js',
        criacao: 'createTextFeature',
    },
    {
        nome: 'military_symbol',
        modulo: '../../src/js/military_tools/military_symbol_tool/add_military_symbol_control.js',
        criacao: 'createMilitarySymbolFeature',
    },
    {
        nome: 'coordination_measure',
        modulo: '../../src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js',
        criacao: 'createCoordinationMeasureFeature',
    },
];

const classes = new Map();

beforeAll(async () => {
    for (const tool of TOOLS) {
        const mod = await import(/* @vite-ignore */ tool.modulo);
        classes.set(tool.nome, mod.default);
    }
});

/**
 * Build a control whose creation step is a controllable pending promise and whose
 * toolManager records the deactivation, without touching MapLibre.
 * @param {Function} ControlClass - Control constructor
 * @param {string} creationMethod - Name of the async creation method to stub
 * @returns {{control: Object, contagem: () => number, liberar: () => void}}
 */
function makeControl(ControlClass, creationMethod) {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const control = new ControlClass({
        selectionManager: {},
        deactivateCurrentTool: () => { control.isActive = false; },
    });

    control[creationMethod] = async () => {
        calls += 1;
        await gate;
        return {};
    };

    control.isActive = true;
    return { control, contagem: () => calls, liberar: () => release() };
}

const clique = { lngLat: { lng: -53.1, lat: -29.7 }, point: { x: 10, y: 10 } };

describe('ferramentas de tiro único: submissão em voo', () => {
    for (const tool of TOOLS) {
        it(`${tool.nome}: um segundo clique durante a criação não cria outra feição`, async () => {
            const { control, contagem, liberar } = makeControl(classes.get(tool.nome), tool.criacao);

            const primeiro = control.handleMapClick(clique);
            const segundo = control.handleMapClick(clique);
            liberar();
            await Promise.all([primeiro, segundo]);

            expect(contagem()).toBe(1);
        });

        it(`${tool.nome}: borda — ferramenta inativa não cria nada`, async () => {
            const { control, contagem, liberar } = makeControl(classes.get(tool.nome), tool.criacao);
            control.isActive = false;

            await control.handleMapClick(clique);
            liberar();

            expect(contagem()).toBe(0);
        });

        it(`${tool.nome}: borda — coordenada inválida não cria nem desarma a ferramenta`, async () => {
            const { control, contagem, liberar } = makeControl(classes.get(tool.nome), tool.criacao);

            await control.handleMapClick({ lngLat: { lng: NaN, lat: -29.7 }, point: { x: 10, y: 10 } });
            liberar();

            expect(contagem()).toBe(0);
            expect(control.isActive).toBe(true);
        });
    }
});
