// Path: tests/unit/temporal-controller-estado-e-aplicacao.repro.test.js
//
// QUATRO DEFEITOS DO CONTROLADOR TEMPORAL, presos dirigindo a CLASSE de verdade com a barra, o
// serviço de render e a store em duplo. O que o arquivo NÃO alcança é o desenho: barra, filtros e
// fontes do MapLibre são do Playwright.
//
// C1 / E9 — O RAMO DESLIGADO RETORNAVA CEDO SEM ZERAR `_bounds` NEM `_cursor`, e a troca de mapa
//   não os zerava tampouco. `getBounds()` seguia respondendo a janela do ÚLTIMO mapa com temporal
//   ligado, de modo que uma trajetória nova nascia ancorada na data de OUTRO mapa e a seção de
//   validade misturava a config de um com os limites do outro; e `getCursor()` prometia NaN com o
//   temporal desligado (é o que fecha o portão da derivação em E9) e entregava o cursor velho.
//   A causa é estado publicado que sobrevive ao que ele descreve. A correção zera os dois nos dois
//   momentos, e guarda o cursor POR MAPA, porque ele é estado pessoal: religar no mesmo mapa
//   devolve a pessoa onde ela estava, sem nunca expor o valor enquanto o temporal está desligado.
//
// C11 — O SYNC CHAMAVA `applyTemporalState` FORA DO GUARDA DE CONCORRÊNCIA e zerava o cache de
//   trajetória ANTES dos seus awaits, enquanto um quadro em voo ainda escrevia na mesma fonte:
//   duas passadas de getData/setData na mesma fonte, e o cache repovoado pelo quadro entre o zero
//   e a aplicação que deveria consumi-lo. A correção serializa TODA aplicação numa cadeia só e põe
//   o zero DENTRO da vez do sync, imediatamente antes da aplicação dele.
//
// M7 — TODO `LAYERS_CHANGED` PAGAVA A APLICAÇÃO DE DESLIGAR com o temporal já desligado, que é o
//   caso da maioria dos mapas: o ramo desligado chamava `applyTemporalState({enabled:false})` a
//   cada evento, e cada uma dessas chamadas relê as três fontes móveis. A correção só paga quando
//   há algo ligado a desfazer (transição ligado→desligado, ou a primeira sincronização).
//
// C10 — A BARRA VIVE NO BODY, ABAIXO DOS VISUALIZADORES 3D E 360 em tela cheia: abrir um deles com
//   a reprodução rodando escondia a barra e deixava o cursor andando e filtrando os marcadores,
//   sem como pausar. A correção pausa ao entrar no visualizador. (A barra SEGUE invisível lá
//   dentro: movê-la para dentro dos visualizadores é outro trabalho.)
//
// V10 — o duplo aparo do cursor entre mapas está preso na forma pura, em
//   `tests/unit/temporal-playback-model.test.js`; aqui fica o caminho pelo controlador.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ===== Duplos =====

const bus = { emit: vi.fn() };
/** Handlers registrados por `subscribe`, para disparar evento como o barramento real faria. */
let handlers = [];

vi.mock('../../src/js/utilities/event-cleanup.js', () => ({
    setupCleanup: vi.fn(),
    cleanup: vi.fn(),
    subscribe: vi.fn((target, eventBus, type, handler) => { handlers.push({ type, handler }); }),
}));

vi.mock('../../src/js/events/index.js', () => ({
    EventTypes: {
        MAP_TEMPORAL_CHANGED: 'map:temporalChanged',
        TEMPORAL_CONFIG_CHANGED: 'temporal:configChanged',
        LAYERS_CHANGED: 'layers:changed',
        BRIEFING_PRESENT_STARTED: 'briefing:presentStarted',
        TEMPORAL_CURSOR_CHANGED: 'temporal:cursorChanged',
    },
}));

vi.mock('../../src/js/store/control.registry.js', () => ({ registerControl: vi.fn() }));

vi.mock('../../src/js/mode/application-mode.manager.js', () => ({
    ApplicationModeEvents: { VIEWER_MODE_CHANGED: 'application:viewerModeChanged' },
    ViewerMode: { MAP_2D: '2d', VIEWER_3D: '3d', VIEWER_360: '360' },
}));

/** Mapas do duplo da store: nome -> { enabled, config }. */
const maps = new Map();
let currentMapName = 'A';

vi.mock('../../src/js/store/index.js', () => ({
    getCurrentMapNameSync: vi.fn(() => currentMapName),
    getCurrentMapFeatures: vi.fn(async () => { callLog.push('features'); return {}; }),
    getMapTemporalConfig: vi.fn(async (name) => { callLog.push('config'); return maps.get(name).config; }),
    isMapTemporalEnabledSync: vi.fn((name) => maps.get(name).enabled),
    shiftMapTemporalTimes: vi.fn(async () => 0),
}));

/** Rastro em ordem de chamada, para afirmar que nada se intercala onde não pode. */
let callLog = [];
/** Estado passado a cada `applyTemporalState`, em ordem. */
let applyStates = [];
/** Quantas aplicações estão em voo ao mesmo tempo (o defeito C11 é este número passar de 1). */
let inFlight = 0;
let maxInFlight = 0;
/** Quando definido, a aplicação fica presa até ele resolver. */
let gate = null;

vi.mock('../../src/js/temporal/temporal-render.service.js', () => ({
    applyTemporalState: vi.fn(async (map, state) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        callLog.push('apply:start');
        applyStates.push({ ...state });
        if (gate) await gate;
        inFlight -= 1;
        callLog.push('apply:end');
    }),
    resetTrajectoryCache: vi.fn(() => { callLog.push('reset'); }),
    shiftSourcesTemporal: vi.fn(async () => {}),
}));

// Barra em duplo: o controlador só lhe manda estado, e nada aqui toca o DOM. A classe mora DENTRO
// da fábrica porque a fábrica roda no import do controlador, antes de qualquer declaração do corpo
// deste arquivo ser avaliada.
vi.mock('../../src/js/temporal/temporal-timeline-bar.js', () => {
    class FakeBar {
        constructor(callbacks) { this.cb = callbacks; this.visible = false; this.cursor = NaN; this.playing = false; }
        mount() {}
        destroy() {}
        getCoordsSlot() { return null; }
        setVisible(v) { this.visible = v; }
        setCursor(c) { this.cursor = c; }
        setBounds() {}
        setSpeed() {}
        setReveal(r) { this.reveal = r; }
        setTimeContext() {}
        setPlaying(p) { this.playing = p; }
    }
    return { TemporalTimelineBar: FakeBar };
});

import { TemporalController } from '../../src/js/temporal/temporal-controller.js';
import { TEMPORAL_UNITS } from '../../src/js/temporal/temporal.constants.js';

const MINUTO = TEMPORAL_UNITS.MINUTO.ms;

// ===== Andaime =====

let rafQueue = [];
const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

/** Espera todo microtask pendente (a cadeia de aplicação tem vários saltos). */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** Executa os callbacks de animação pendentes, como um quadro do navegador faria. */
async function drainRaf() {
    for (let round = 0; round < 5 && rafQueue.length; round += 1) {
        const pending = rafQueue;
        rafQueue = [];
        for (const cb of pending) cb(performance.now());
        await settle();
    }
}

function defineMap(name, { enabled, inicio, fim, unidade = 'MINUTO' }) {
    maps.set(name, {
        enabled,
        config: { ativo: enabled, unidade, inicio, fim, modo: 'absoluto', origem: null },
    });
}

function makeController() {
    const controller = new TemporalController({ map: { id: 'map' }, eventBus: bus });
    controller.init(null);
    return controller;
}

/** Dispara um evento assinado pelo controlador, como o barramento real faria. */
function fire(type, payload) {
    for (const h of handlers) if (h.type === type) h.handler(payload);
}

let controller = null;

beforeEach(() => {
    handlers = [];
    callLog = [];
    applyStates = [];
    inFlight = 0;
    maxInFlight = 0;
    gate = null;
    rafQueue = [];
    maps.clear();
    currentMapName = 'A';
    bus.emit.mockClear();
    globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    globalThis.cancelAnimationFrame = vi.fn();
    // A: temporal LIGADO, janela de 10 minutos. B: temporal DESLIGADO.
    defineMap('A', { enabled: true, inicio: 1000, fim: 1000 + 10 * MINUTO });
    defineMap('B', { enabled: false, inicio: null, fim: null });
});

afterEach(() => {
    controller?.destroy();
    controller = null;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
});

// ============================================================================
// C1 / E9 — o estado publicado descreve o mapa que está na tela, ou nada
// ============================================================================

describe('C1/E9: limites e cursor não sobrevivem ao mapa nem ao interruptor', () => {
    it('trocar para um mapa com temporal DESLIGADO zera limites e cursor', async () => {
        controller = makeController();
        await settle();
        expect(controller.getBounds()).toEqual({ inicio: 1000, fim: 1000 + 10 * MINUTO });
        expect(Number.isFinite(controller.getCursor())).toBe(true);

        currentMapName = 'B';
        await controller.sync();

        expect(controller.getBounds()).toBeNull();
        expect(Number.isNaN(controller.getCursor())).toBe(true);
    });

    it('desligar o temporal NO MESMO mapa também zera os dois', async () => {
        controller = makeController();
        await settle();
        controller.setCursor(1000 + 4 * MINUTO);

        maps.get('A').enabled = false;
        await controller.sync();

        expect(controller.getBounds()).toBeNull();
        expect(Number.isNaN(controller.getCursor())).toBe(true);
        expect(controller.getFilterWindow()).toBeNull();
    });

    it('o cursor é pessoal POR MAPA: religar devolve a pessoa onde ela estava', async () => {
        controller = makeController();
        await settle();
        const escolhido = 1000 + 7 * MINUTO;
        controller.setCursor(escolhido);
        expect(controller.getCursor()).toBe(escolhido);

        // Desliga (o cursor some da vista pública), e liga de novo.
        maps.get('A').enabled = false;
        await controller.sync();
        expect(Number.isNaN(controller.getCursor())).toBe(true);

        maps.get('A').enabled = true;
        await controller.sync();
        expect(controller.getCursor()).toBe(escolhido);
    });

    it('a memória do cursor é por mapa, e não vaza de um para o outro', async () => {
        defineMap('C', { enabled: true, inicio: 500_000, fim: 500_000 + 10 * MINUTO });
        controller = makeController();
        await settle();
        controller.setCursor(1000 + 6 * MINUTO);

        currentMapName = 'C';
        await controller.sync();
        // O mapa C nunca teve cursor: começa no início DELE, não no instante do mapa A.
        expect(controller.getCursor()).toBe(500_000);

        currentMapName = 'A';
        await controller.sync();
        expect(controller.getCursor()).toBe(1000 + 6 * MINUTO);
    });
});

// ============================================================================
// M7 — o mapa sem temporal não paga a aplicação a cada evento de camada
// ============================================================================

describe('M7: o ramo desligado só trabalha quando há o que desfazer', () => {
    it('LAYERS_CHANGED em cadeia num mapa sem temporal não repete a aplicação', async () => {
        currentMapName = 'B';
        controller = makeController();
        await settle();
        // A primeira sincronização paga uma vez, para deixar o estado limpo.
        expect(applyStates).toHaveLength(1);
        expect(applyStates[0].enabled).toBe(false);

        for (let i = 0; i < 5; i += 1) {
            fire('layers:changed');
            await settle();
        }
        expect(applyStates).toHaveLength(1);
        // E nada de zerar o cache de trajetória: ele só serve ao caminho ligado.
        expect(callLog.filter((e) => e === 'reset')).toHaveLength(0);
    });

    it('a transição ligado→desligado ainda paga a aplicação de desfazer, uma vez', async () => {
        controller = makeController();
        await settle();
        const ligadas = applyStates.length;

        maps.get('A').enabled = false;
        await controller.sync();
        expect(applyStates).toHaveLength(ligadas + 1);
        expect(applyStates.at(-1).enabled).toBe(false);

        await controller.sync();
        await controller.sync();
        expect(applyStates).toHaveLength(ligadas + 1);
    });
});

// ============================================================================
// C11 — uma aplicação por vez, e o zero do cache dentro da vez do sync
// ============================================================================

describe('C11: o sync termina por dentro do guarda de concorrência', () => {
    it('o zero do cache cai DEPOIS dos awaits do sync e colado na aplicação dele', async () => {
        // Limites automáticos, para o sync pagar também a leitura de feições (o segundo await).
        defineMap('D', { enabled: true, inicio: null, fim: null });
        currentMapName = 'D';
        controller = makeController();
        await settle();

        const reset = callLog.indexOf('reset');
        expect(reset).toBeGreaterThan(callLog.indexOf('config'));
        expect(reset).toBeGreaterThan(callLog.indexOf('features'));
        expect(callLog[reset + 1]).toBe('apply:start');
    });

    it('uma aplicação em voo não é atravessada pela do sync, nem pelo zero do cache', async () => {
        controller = makeController();
        await settle();
        callLog = [];
        applyStates = [];
        maxInFlight = 0;

        let abrir;
        gate = new Promise((resolve) => { abrir = resolve; });

        // Um quadro de reprodução entra em voo e fica preso dentro do apply.
        controller.setCursor(1000 + 2 * MINUTO);
        await drainRaf();
        expect(applyStates).toHaveLength(1);

        // Com ele preso, chega uma sincronização (troca de config, camada, o que for).
        const syncing = controller.sync();
        await settle();
        // Ela não pode ter começado a escrever: a fonte ainda está com o quadro.
        expect(applyStates).toHaveLength(1);
        expect(maxInFlight).toBe(1);

        abrir();
        gate = null;
        await syncing;
        await settle();

        expect(applyStates.length).toBeGreaterThan(1);
        expect(maxInFlight).toBe(1);
        // E nenhum zero de cache caiu no meio de uma aplicação aberta.
        let abertas = 0;
        for (const evento of callLog) {
            if (evento === 'apply:start') abertas += 1;
            else if (evento === 'apply:end') abertas -= 1;
            else if (evento === 'reset') expect(abertas).toBe(0);
        }
    });
});

// ============================================================================
// C10 — entrar no 3D/360 pausa a reprodução
// ============================================================================

describe('C10: a reprodução não continua atrás de um visualizador em tela cheia', () => {
    it('entrar no 3D pausa', async () => {
        controller = makeController();
        await settle();
        controller.togglePlay();
        expect(controller.isPlaying()).toBe(true);

        fire('application:viewerModeChanged', { previousMode: '2d', currentMode: '3d' });
        expect(controller.isPlaying()).toBe(false);
    });

    it('entrar no 360 pausa', async () => {
        controller = makeController();
        await settle();
        controller.togglePlay();
        fire('application:viewerModeChanged', { previousMode: '2d', currentMode: '360' });
        expect(controller.isPlaying()).toBe(false);
    });

    it('voltar para o mapa 2D não pausa (nem retoma) sozinho', async () => {
        controller = makeController();
        await settle();
        controller.togglePlay();
        fire('application:viewerModeChanged', { previousMode: '3d', currentMode: '2d' });
        expect(controller.isPlaying()).toBe(true);
    });

    it('um payload sem modo não derruba a reprodução', async () => {
        controller = makeController();
        await settle();
        controller.togglePlay();
        fire('application:viewerModeChanged', undefined);
        fire('application:viewerModeChanged', {});
        expect(controller.isPlaying()).toBe(true);
    });
});

// ============================================================================
// V10 — o instante de um slide espera o sync do mapa dele
// ============================================================================

// ============================================================================
// A reprodução ANDA: o primeiro quadro tem dt zero por construção
// ============================================================================
//
// Defeito (2026-09-21, nascido e morto no mesmo dia): a parada defensiva contra janela
// degenerada testava `advance <= 0`. O primeiro quadro de toda reprodução semeia
// `_lastFrameTs` com o próprio carimbo, então `dt` é 0, o avanço é 0 e a reprodução parava
// antes de andar, em todo mapa. Nenhum teste de node dirigia um quadro; quem acusou foi o
// spec de interface reescrito no mesmo lote, que mede o cursor e não o rótulo do botão.

describe('a reprodução anda: o quadro de dt zero não é janela degenerada', () => {
    /** Runs every queued rAF callback once, with the given timestamp. */
    const runFrames = (ts) => {
        const pending = rafQueue;
        rafQueue = [];
        for (const cb of pending) cb(ts);
    };

    it('o PRIMEIRO quadro (dt = 0) não para a reprodução, e o segundo avança o cursor', async () => {
        controller = makeController();
        await settle();
        const partida = controller.getCursor();
        controller.togglePlay();
        expect(rafQueue.length).toBeGreaterThan(0); // controle: há quadro a dirigir

        runFrames(1000); // primeiro quadro: dt = 0
        expect(controller.isPlaying()).toBe(true);
        expect(controller.getCursor()).toBe(partida);

        runFrames(1500); // meio segundo depois
        expect(controller.isPlaying()).toBe(true);
        expect(controller.getCursor()).toBeGreaterThan(partida);
    });

    it('BORDA: janela degenerada (fim igual ao início) para no primeiro quadro', async () => {
        controller = makeController();
        await settle();
        // `resolveTimelineBounds` alarga `fim <= inicio` em um passo, então nenhuma config
        // chega degenerada aqui: a parada é defesa contra um chamador futuro, e só se mede
        // pondo a janela degenerada à mão. O cursor fica ANTES do fim de propósito, senão quem
        // pararia a reprodução seria o ramo de "chegou ao fim", e não o que este caso mede.
        controller._bounds = { inicio: 5000, fim: 5000 };
        controller._cursor = 4000;
        controller.togglePlay();
        expect(controller.isPlaying()).toBe(true); // controle: a reprodução chegou a começar
        runFrames(1000);
        runFrames(1500);
        expect(controller.isPlaying()).toBe(false);
    });
});

describe('V10: o cursor nomeado por mapa é aparado uma vez só', () => {
    it('o instante pedido para outro mapa sobrevive à troca', async () => {
        // A janela de A e a de E não se tocam: um aparo contra A colapsaria o pedido.
        defineMap('E', { enabled: true, inicio: 5_000_000, fim: 9_000_000 });
        controller = makeController();
        await settle();
        expect(controller.getBounds()).toEqual({ inicio: 1000, fim: 1000 + 10 * MINUTO });

        // O slide pede o instante do mapa E enquanto o controlador ainda publica o de A.
        controller.setCursor(7_000_000, { mapName: 'E' });
        // Nada muda na tela do mapa que ainda está lá.
        expect(controller.getCursor()).not.toBe(7_000_000);

        currentMapName = 'E';
        await controller.sync();
        expect(controller.getCursor()).toBe(7_000_000);
    });

    it('sem nome de mapa o comportamento é o de sempre: apara agora', async () => {
        controller = makeController();
        await settle();
        controller.setCursor(999_999_999);
        expect(controller.getCursor()).toBe(1000 + 10 * MINUTO);
    });

    it('um pedido nomeando o mapa publicado vale na hora', async () => {
        controller = makeController();
        await settle();
        controller.setCursor(1000 + 3 * MINUTO, { mapName: 'A' });
        expect(controller.getCursor()).toBe(1000 + 3 * MINUTO);
    });
});

// ============================================================================
// As duas APIs novas que outras superfícies consomem por contrato
// ============================================================================

describe('getFilterWindow / isRevealing', () => {
    it('getFilterWindow devolve a MESMA janela que o filtro do mapa 2D recebeu', async () => {
        controller = makeController();
        await settle();
        const aplicado = applyStates.at(-1);
        expect(controller.getFilterWindow()).toEqual({ start: aplicado.filterStart, end: aplicado.filterEnd });
    });

    it('getFilterWindow é null com o temporal desligado', async () => {
        currentMapName = 'B';
        controller = makeController();
        await settle();
        expect(controller.getFilterWindow()).toBeNull();
    });

    it('isRevealing acompanha o modo "mostrar feições ocultas"', async () => {
        controller = makeController();
        await settle();
        expect(controller.isRevealing()).toBe(false);
        controller.toggleReveal();
        expect(controller.isRevealing()).toBe(true);
        // Desligar o temporal também desliga o modo.
        maps.get('A').enabled = false;
        await controller.sync();
        expect(controller.isRevealing()).toBe(false);
    });
});
