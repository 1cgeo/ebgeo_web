// Path: tests/unit/trava-que-chega-derruba-a-selecao.test.js

/**
 * @fileoverview A feição SELECIONADA que uma trava alcança deixa de ser editável, pelas duas
 * metades do conserto de 2026-09-24.
 *
 * O defeito (medido com dois navegadores, repro em
 * `tests/e2e-ui/trava-chega-com-feicao-selecionada.repro.spec.js`): as travas de feição, camada e
 * grupo são convenção do cliente e só eram perguntadas no instante da SELEÇÃO. A trava que chegava
 * depois deixava a seleção intacta, e Delete apagava a feição no servidor.
 *
 * As duas metades, e a razão de este arquivo existir ao lado do repro: o repro de navegador passa
 * com a primeira sozinha (a seleção cai antes do Delete), então a SEGUNDA, a recusa dentro de
 * `deleteSelectedFeatures`, só tem vermelho aqui.
 *   1. `watchEffectiveLocks` derruba a seleção quando LAYERS_CHANGED, GROUPS_CHANGED ou
 *      FEATURE_MODIFIED a encontram travada, sem salvar o painel, nomeando a trava;
 *   2. `deleteSelectedFeatures` não entrega feição travada à ferramenta, venha de onde vier.
 *
 * Controle negativo: sem o filtro em `deleteSelectedFeatures`, os dois casos de exclusão reprovam;
 * com `watchEffectiveLocks` vazio, os três casos de evento reprovam.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} };
afterAll(() => { delete globalThis.document; });

const selecionadas = new Map();
const stateManagerFalso = {
    isFeatureSelected: (tipo, id) => selecionadas.has(`${tipo}:${id}`),
    addToSelection: (tipo, id, feicao) => selecionadas.set(`${tipo}:${id}`, feicao),
    removeFromSelection: (tipo, id) => selecionadas.delete(`${tipo}:${id}`),
    clearSelection: () => selecionadas.clear(),
    getSelectionCount: () => selecionadas.size,
    getSelectedFeatures: () => [...selecionadas.entries()].map(([chave, feicao]) => {
        const [type, id] = chave.split(':');
        return { type, id, feature: feicao };
    }),
    batchUpdate: (fn) => fn(),
    setActiveTool: () => {},
    subscribe: () => () => {}
};

/** Trava por camada: o que a store responderia com a camada `travada` bloqueada. */
const camadasTravadas = new Set();
function estadoDeTrava(feicao) {
    if (!feicao?.properties) return null;
    if (feicao.properties.bloqueado === true) return 'feicao';
    if (camadasTravadas.has(feicao.properties.layerId)) return 'camada';
    return null;
}

vi.mock('../../src/js/store', () => ({
    getFeatureGroup: () => null,
    getVisibleLayerIds: () => ['default', 'travada'],
    isFeatureEffectivelyLocked: (f) => estadoDeTrava(f) !== null,
    featureLockState: (f) => estadoDeTrava(f),
    getStateManager: () => stateManagerFalso,
    getControl: () => null,
    startBatchUndo: () => {},
    commitBatchUndo: () => {},
    discardBatchUndo: () => {},
    getFeatureIcon: () => '',
    getFeatureById: async () => null,
    getStorageTypeFromSource: (tipo) => tipo
}));

vi.mock('../../src/js/utilities/pointer-utils', () => ({
    createTwoFingerTapHandler: () => () => {}
}));

vi.mock('../../src/js/store/write-coordinator.js', () => ({
    whenStoreWritesResume: async () => true,
    STORE_RECOVERY_NOTICE: 'recuperando'
}));

const avisos = [];
vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operationBlocked' },
    emitStoreError: (tipo, payload) => avisos.push({ tipo, payload })
}));

const { default: SelectionManager } = await import('../../src/js/tool_manager/selection_manager.js');
const { EventTypes } = await import('../../src/js/events/event_types.js');

function mapaFalso() {
    const el = { addEventListener: () => {}, removeEventListener: () => {}, style: {} };
    return {
        queryRenderedFeatures: () => [], getSource: () => null, getZoom: () => 12,
        on: () => {}, off: () => {}, getContainer: () => el, getCanvasContainer: () => el
    };
}

function ponto(id, layerId, extra = {}) {
    return { type: 'Feature', properties: { id, source: 'point', layerId, ...extra }, geometry: { type: 'Point', coordinates: [0, 0] } };
}

function barramentoFalso() {
    const ouvintes = new Map();
    return {
        on(tipo, fn) {
            if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
            ouvintes.get(tipo).add(fn);
            return () => ouvintes.get(tipo).delete(fn);
        },
        emit(tipo, payload) { for (const fn of ouvintes.get(tipo) || []) fn(payload); },
        contagem: (tipo) => ouvintes.get(tipo)?.size ?? 0
    };
}

describe('a trava que chega derruba a seleção', () => {
    let sm;
    let apagadas;
    let painel;

    beforeEach(() => {
        selecionadas.clear();
        camadasTravadas.clear();
        avisos.length = 0;
        apagadas = [];
        painel = { salvou: 0, fechouSemSalvar: 0 };
        sm = new SelectionManager(mapaFalso());
        sm.uiManager = {
            saveChangesAndClosePanel: () => { painel.salvou += 1; },
            closePanelWithoutSave: () => { painel.fechouSemSalvar += 1; },
            updateUI: () => {}
        };
        sm.updateUI = () => {};
        sm.ensureControlFor = async () => ({ deleteFeatures: async (fs) => { apagadas.push(...fs.map((f) => f.properties.id)); } });
    });

    it('Delete com uma feição de camada travada e outra livre apaga só a livre, e diz qual trava', async () => {
        selecionadas.set('point:a', ponto('a', 'travada'));
        selecionadas.set('point:b', ponto('b', 'default'));
        camadasTravadas.add('travada');
        await sm.deleteSelectedFeatures();
        expect(apagadas).toEqual(['b']);
        expect(avisos).toHaveLength(1);
        expect(avisos[0].payload.message).toMatch(/^Camada bloqueada\./);
    });

    it('Delete com tudo travado não chama a ferramenta e desfaz a seleção sem salvar o painel', async () => {
        selecionadas.set('point:a', ponto('a', 'default', { bloqueado: true }));
        await sm.deleteSelectedFeatures();
        expect(apagadas).toEqual([]);
        expect(selecionadas.size).toBe(0);
        expect(painel.salvou).toBe(0);
        expect(avisos[0].payload.message).toMatch(/^Feição bloqueada\./);
    });

    it('CONTROLE: nada travado, Delete apaga tudo e não avisa', async () => {
        selecionadas.set('point:a', ponto('a', 'default'));
        await sm.deleteSelectedFeatures();
        expect(apagadas).toEqual(['a']);
        expect(avisos).toHaveLength(0);
    });

    it('watchEffectiveLocks assina os três eventos por onde a trava chega', () => {
        const bus = barramentoFalso();
        sm.watchEffectiveLocks(bus);
        for (const tipo of [EventTypes.LAYERS_CHANGED, EventTypes.GROUPS_CHANGED, EventTypes.FEATURE_MODIFIED]) {
            expect(bus.contagem(tipo), tipo).toBe(1);
        }
    });

    it('a camada travada que chega (LAYERS_CHANGED) derruba a seleção sem salvar e nomeia a camada', () => {
        const bus = barramentoFalso();
        sm.watchEffectiveLocks(bus);
        selecionadas.set('point:a', ponto('a', 'travada'));
        bus.emit(EventTypes.LAYERS_CHANGED, {});
        expect(selecionadas.size, 'ainda livre: a seleção fica').toBe(1);
        camadasTravadas.add('travada');
        bus.emit(EventTypes.LAYERS_CHANGED, {});
        expect(selecionadas.size).toBe(0);
        expect(painel.salvou).toBe(0);
        expect(painel.fechouSemSalvar).toBe(1);
        expect(avisos.map((a) => a.payload.message)).toEqual([expect.stringMatching(/^Camada bloqueada\./)]);
    });

    it('a trava da própria feição chega pelo PAYLOAD do FEATURE_MODIFIED, não pela cópia velha da seleção', () => {
        const bus = barramentoFalso();
        sm.watchEffectiveLocks(bus);
        selecionadas.set('point:a', ponto('a', 'default'));
        bus.emit(EventTypes.FEATURE_MODIFIED, { featureId: 'outra', feature: ponto('outra', 'default', { bloqueado: true }) });
        expect(selecionadas.size, 'a trava de OUTRA feição não mexe na seleção').toBe(1);
        bus.emit(EventTypes.FEATURE_MODIFIED, { featureId: 'a', feature: ponto('a', 'default', { bloqueado: true }) });
        expect(selecionadas.size).toBe(0);
        expect(avisos[0].payload.message).toMatch(/^Feição bloqueada\./);
    });

    it('sem seleção, o evento não faz nada (nem aviso)', () => {
        const bus = barramentoFalso();
        sm.watchEffectiveLocks(bus);
        camadasTravadas.add('travada');
        bus.emit(EventTypes.GROUPS_CHANGED, {});
        expect(avisos).toHaveLength(0);
        expect(painel.fechouSemSalvar).toBe(0);
    });

    it('barramento ausente ou sem on é ignorado, sem lançar', () => {
        expect(() => sm.watchEffectiveLocks(null)).not.toThrow();
        expect(() => sm.watchEffectiveLocks({})).not.toThrow();
    });
});
