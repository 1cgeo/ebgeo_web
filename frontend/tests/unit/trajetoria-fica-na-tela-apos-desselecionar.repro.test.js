// Path: tests/unit/trajetoria-fica-na-tela-apos-desselecionar.repro.test.js
//
// REPRO: a trajetória de uma feição continuava desenhada depois de a feição ser desselecionada.
//
// A SEQUÊNCIA, relatada pelo dono em 2026-09-20: (1) selecionar uma feição com trajetória, (2)
// clicar numa aba do painel lateral ("Mapas", por exemplo), (3) clicar no mapa para tirar a
// seleção. O caminho e os vértices da trajetória ficavam na tela, sem feição selecionada nenhuma.
//
// A CAUSA RAIZ é um contrato implícito entre dois módulos. `TrajectoryEditControl` amarrava a vida
// do desenho ao evento `FEATURE_PANEL_CLOSED`, como se "painel fechou" e "feição desselecionada"
// fossem a mesma coisa. Não são: `expandSidebar` (`state/state_manager.js`) recolhe o painel de
// feição ZERANDO `ui.featurePanelOpen` sem emitir o evento, de propósito, porque a feição continua
// selecionada e o painel volta quando a barra lateral fecha. No passo 3, `closeFeaturePanel` lê a
// bandeira já falsa e retorna cedo, então o evento não sai NUNCA, e o `hide()` não roda.
//
// O dono do desenho é a SELEÇÃO, e é a ela que o controle passou a obedecer.
//
// ESTE ARQUIVO DIRIGE AS PEÇAS REAIS: o `StateManager` real com o barramento real, e o controle
// real, executando a sequência do relato pelos MESMOS métodos que a interface chama. Só a store é
// duplo, e só para entregar os dois serviços ao controle. O QUE NÃO ALCANÇA: MapLibre e DOM; o
// sinal medido é o controle ter soltado a feição e removido as camadas dele do mapa falso.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createStateManager, _resetForTesting } from '../../src/js/state/state_manager.js';
import { createEventBus } from '../../src/js/events/event_bus.js';

const servicos = { estado: null, barramento: null };

vi.mock('@store', () => ({
    registerControl: () => {},
    getControl: () => null,
    getEventBus: () => servicos.barramento,
    getStateManager: () => servicos.estado,
    updateFeatureProperty: async () => {},
    getStorageTypeFromSource: (fonte) => fonte,
    getMapTemporalConfigSync: () => ({ unidade: 'DIA' }),
}));

let TrajectoryEditControl;
beforeAll(async () => {
    ({ TrajectoryEditControl } = await import('@js/temporal/trajectory-tool/trajectory-edit-control.js'));
}, 120000);

const FEICAO = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
    properties: {
        id: 'ponto-1', source: 'points',
        trajetoria: [{ t: 1000, lng: -47.9, lat: -15.8 }, { t: 2000, lng: -47.8, lat: -15.7 }],
    },
};

/** Mapa falso: guarda as camadas e as fontes vivas, que é o que "está na tela" significa aqui. */
function mapaFalso() {
    const camadas = new Set();
    const fontes = new Map();
    return {
        camadas, fontes,
        getCanvas: () => ({ style: { cursor: '' }, addEventListener() {}, removeEventListener() {} }),
        on() {}, off() {},
        dragPan: { enable() {}, disable() {} },
        getLayer: (id) => (camadas.has(id) ? { id } : undefined),
        getSource: (id) => fontes.get(id),
        addSource: (id) => fontes.set(id, { setData() {} }),
        addLayer: ({ id }) => camadas.add(id),
        removeLayer: (id) => camadas.delete(id),
        removeSource: (id) => fontes.delete(id),
        moveLayer() {},
    };
}

let estado;
let mapa;
let editor;

beforeEach(() => {
    _resetForTesting();
    estado = createStateManager();
    const barramento = createEventBus();
    estado.setEventBus(barramento);
    servicos.estado = estado;
    servicos.barramento = barramento;
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} });
    // `isTouchDevice` lê `window`; em node não há, e o ramo de toque não é o sujeito aqui.
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });

    mapa = mapaFalso();
    editor = new TrajectoryEditControl();
    editor.onAdd(mapa, null);
});

afterEach(() => {
    editor.onRemove();
    _resetForTesting();
    vi.unstubAllGlobals();
});

/** O passo 1 do relato: selecionar, abrir o painel, e o painel mostra a trajetória. */
function selecionarComTrajetoria() {
    estado.selectFeature('points', 'ponto-1', FEICAO);
    estado.openFeaturePanel('ponto-1', 'points');
    editor.show(FEICAO);
}

/** O passo 3 do relato, como `selection_manager.js` e `ui_manager.js` o fazem. */
async function desselecionar() {
    estado.clearSelection();
    estado.closeFeaturePanel();
    // A checagem da seleção é adiada um microtick de propósito (ver o controle).
    await Promise.resolve();
}

describe('a trajetória some quando a feição é desselecionada', () => {
    it('PISO: selecionar mostra a trajetória (sem isto os casos abaixo passariam sobre nada)', () => {
        selecionarComTrajetoria();

        expect(mapa.camadas.size).toBeGreaterThan(0);
        expect(editor._feature).toBe(FEICAO);
    });

    it('REPRO: selecionar, abrir a aba Mapas e desselecionar tira a trajetória da tela', async () => {
        selecionarComTrajetoria();

        estado.expandSidebar('mapas');
        // A feição CONTINUA selecionada, então a trajetória fica: a barra lateral só cobriu o painel.
        expect(editor._feature).toBe(FEICAO);

        await desselecionar();

        expect(editor._feature, 'o controle ainda segura a feição desselecionada').toBeNull();
        expect([...mapa.camadas], 'as camadas da trajetória continuam no mapa').toEqual([]);
    });

    it('o caminho comum continua valendo: desselecionar com o painel aberto também tira', async () => {
        selecionarComTrajetoria();

        await desselecionar();

        expect(editor._feature).toBeNull();
        expect([...mapa.camadas]).toEqual([]);
    });

    it('trocar a seleção para OUTRA feição tira a trajetória da anterior', async () => {
        selecionarComTrajetoria();
        estado.expandSidebar('camadas');

        estado.selectFeature('lines', 'linha-9', { type: 'Feature', properties: { id: 'linha-9' } });
        await Promise.resolve();

        expect(editor._feature).toBeNull();
    });

    it('a feição que CONTINUA selecionada não perde a trajetória em mudança alheia da seleção', async () => {
        selecionarComTrajetoria();

        // Seleção múltipla: a feição da trajetória segue no conjunto.
        estado.addToSelection('lines', 'linha-9', { type: 'Feature', properties: { id: 'linha-9' } });
        await Promise.resolve();

        expect(editor._feature).toBe(FEICAO);
        expect(mapa.camadas.size).toBeGreaterThan(0);
    });

    it('limpar e resselecionar no MESMO tick não pisca: vale o estado final da seleção', async () => {
        selecionarComTrajetoria();

        estado.clearSelection();
        estado.selectFeature('points', 'ponto-1', FEICAO);
        await Promise.resolve();

        expect(editor._feature).toBe(FEICAO);
    });

    it('montagem do painel EM VOO que chega depois do deselect não desenha nada', async () => {
        // `createFeaturePanelContent` é assíncrona e chama `show()` no fim. Se a pessoa desseleciona
        // durante a montagem, o `show()` chega com a seleção já vazia, e depois dele não há mais
        // mudança de seleção nenhuma que tire o desenho.
        selecionarComTrajetoria();
        await desselecionar();

        editor.show(FEICAO);

        expect(editor._feature).toBeNull();
        expect([...mapa.camadas]).toEqual([]);
    });

    it('um controle removido solta a assinatura: a seleção não mexe mais nele', async () => {
        selecionarComTrajetoria();
        editor.onRemove();
        const esconder = vi.spyOn(editor, 'hide');

        estado.clearSelection();
        await Promise.resolve();

        expect(esconder).not.toHaveBeenCalled();
    });
});
