// Path: tests/unit/briefing-vista-do-slide-na-transicao.test.js

/**
 * @fileoverview O serviço de transição APLICA a vista do slide (mapa base e interruptor temporal)
 * e DEVOLVE a tela à pessoa na saída.
 *
 * POR QUE EXISTE (decisão do dono, 2026-09-20). A base e o interruptor viraram estado de vista de
 * cada pessoa, então o slide passou a dizer o que ELE mostra. O que se decide é puro e está preso
 * em `tests/unit/slide-view.test.js`; este arquivo prende a FIAÇÃO no serviço, que é onde o
 * apresentador, o editor e o PDF de briefing se encontram, e três coisas que só a fiação erra:
 *
 *   1. a vista é aplicada em TODO slide, e não só quando o mapa muda. Era assim antes (o serviço só
 *      chamava `switchMap` na troca de mapa), e dois slides do MESMO mapa com bases diferentes são
 *      exatamente o caso novo;
 *   2. nada aqui grava: a base vai pelos dois caminhos que só desenham, e o interruptor por
 *      `setMapTemporalView`, carimbado como automático;
 *   3. `resetTo2D`, que os três chamadores usam na saída, devolve a base e os interruptores que a
 *      pessoa tinha ANTES do primeiro slide, e não os do penúltimo.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { storeMock, baseControl, estado } = vi.hoisted(() => {
    const estado = {
        mapaAtivo: 'Mapa A',
        baseSalva: { 'Mapa A': 'carta-topografica', 'Mapa B': 'osm' },
        temporalSalvo: { 'Mapa A': false, 'Mapa B': true },
        vista: new Map(),
    };
    const baseControl = {
        map: {},
        currentLayer: 'imagens',
        availableBasemaps: ['carta-topografica', 'imagens', 'osm'],
        switchMap: vi.fn(async (_aplicarPosicao, opcoes = {}) => {
            if (opcoes.baseLayer) baseControl.currentLayer = opcoes.baseLayer;
        }),
        applySharedBasemap: vi.fn(async (id) => { baseControl.currentLayer = id; return id; }),
    };
    const storeMock = {
        SlideMode: { MAP_2D: '2d', VIEWER_3D: '3d', VIEWER_360: '360' },
        getCurrentMapNameSync: vi.fn(() => estado.mapaAtivo),
        setCurrentMap: vi.fn(async (nome) => { estado.mapaAtivo = nome; }),
        getEventBus: vi.fn(() => ({ emit: vi.fn(), on: vi.fn() })),
        getControl: vi.fn((nome) => (nome === 'BaseLayerControl' ? baseControl : null)),
        getCurrentBaseLayer: vi.fn(async () => estado.baseSalva[estado.mapaAtivo]),
        isMapTemporalSavedEnabled: vi.fn(async () => estado.temporalSalvo[estado.mapaAtivo]),
        isMapTemporalEnabledSync: vi.fn((nome) => estado.vista.get(nome ?? estado.mapaAtivo) ?? false),
        setMapTemporalView: vi.fn((nome, ligado) => { estado.vista.set(nome ?? estado.mapaAtivo, ligado); return ligado; }),
    };
    return { storeMock, baseControl, estado };
});

vi.mock('@store/index.js', () => storeMock);
vi.mock('@js/map/animation.service.js', () => ({ flyTo: vi.fn(async () => {}) }));

const { createTransitionService } = await import('@js/briefing/presentation/transition.service.js');

const fakeMap = () => ({ stop: vi.fn(), getZoom: vi.fn(() => 10), jumpTo: vi.fn() });
const slide2d = (extra) => ({
    mode: '2d', mapId: 'Mapa A',
    position: { longitude: -47, latitude: -15, zoom: 9 }, orientation: { bearing: 0, pitch: 0 },
    ...extra,
});

beforeEach(() => {
    vi.clearAllMocks();
    estado.mapaAtivo = 'Mapa A';
    estado.vista = new Map([['Mapa A', true]]);
    baseControl.currentLayer = 'imagens';
});

describe('a transição aplica a vista do slide', () => {
    it('dois slides do MESMO mapa com bases diferentes trocam a base, sem trocar de mapa', async () => {
        const svc = createTransitionService(fakeMap());

        await svc.transitionToSlideInstant(slide2d({ baseLayer: 'osm', temporalEnabled: false }));
        expect(baseControl.currentLayer).toBe('osm');
        await svc.transitionToSlideInstant(slide2d({ baseLayer: 'carta-topografica', temporalEnabled: true }));

        expect(baseControl.currentLayer).toBe('carta-topografica');
        expect(storeMock.setCurrentMap).not.toHaveBeenCalled();
        // Pelo caminho que MANTÉM o conteúdo desenhado, e nunca por um que grave.
        expect(baseControl.applySharedBasemap.mock.calls.map(([id]) => id)).toEqual(['osm', 'carta-topografica']);
        expect(baseControl.switchMap).not.toHaveBeenCalled();
        expect(estado.vista.get('Mapa A')).toBe(true);
    });

    it('slide ANTIGO (sem os campos) herda a vista SALVA do mapa dele', async () => {
        const svc = createTransitionService(fakeMap());

        await svc.transitionToSlideInstant(slide2d({ mapId: 'Mapa B' }));

        expect(storeMock.setCurrentMap).toHaveBeenCalledWith('Mapa B');
        // Troca de mapa: a base salva do mapa NOVO entra junto com a remontagem do conteúdo.
        expect(baseControl.switchMap).toHaveBeenCalledWith(false, { baseLayer: 'osm' });
        expect(estado.vista.get('Mapa B')).toBe(true);
    });

    it('o interruptor entra carimbado como AUTOMÁTICO: slide não é gente ligando a linha do tempo', async () => {
        const svc = createTransitionService(fakeMap());

        await svc.transitionToSlideInstant(slide2d({ temporalEnabled: false }));

        expect(storeMock.setMapTemporalView).toHaveBeenCalledWith('Mapa A', false, { automatico: true });
    });

    it('base que este espectador não desenha cai para a SALVA do mapa', async () => {
        const svc = createTransitionService(fakeMap());

        await svc.transitionToSlideInstant(slide2d({ baseLayer: 'base-privada-da-om' }));

        expect(baseControl.currentLayer).toBe('carta-topografica');
    });

    it('a base que já está na tela não é reaplicada', async () => {
        const svc = createTransitionService(fakeMap());

        await svc.transitionToSlideInstant(slide2d({ baseLayer: 'imagens' }));

        expect(baseControl.applySharedBasemap).not.toHaveBeenCalled();
    });
});

describe('a saída devolve a tela à pessoa', () => {
    it('`resetTo2D` repõe a base e os interruptores de ANTES do primeiro slide, em todos os mapas tocados', async () => {
        const svc = createTransitionService(fakeMap());
        estado.vista.set('Mapa B', false);

        await svc.transitionToSlideInstant(slide2d({ baseLayer: 'osm', temporalEnabled: false }));
        await svc.transitionToSlideInstant(slide2d({ mapId: 'Mapa B', baseLayer: 'carta-topografica', temporalEnabled: true }));
        expect(estado.vista.get('Mapa A')).toBe(false);
        expect(estado.vista.get('Mapa B')).toBe(true);

        await svc.resetTo2D();

        // A base era `imagens` antes do primeiro slide, e é para ela que se volta, não para `osm`.
        expect(baseControl.currentLayer).toBe('imagens');
        expect(estado.vista.get('Mapa A')).toBe(true);
        expect(estado.vista.get('Mapa B')).toBe(false);
    });

    it('sem slide nenhum aplicado não há o que devolver', async () => {
        const svc = createTransitionService(fakeMap());

        await svc.resetTo2D();

        expect(baseControl.applySharedBasemap).not.toHaveBeenCalled();
        expect(storeMock.setMapTemporalView).not.toHaveBeenCalled();
    });

    it('uma segunda saída não repõe de novo: o que foi lembrado é consumido', async () => {
        const svc = createTransitionService(fakeMap());
        await svc.transitionToSlideInstant(slide2d({ baseLayer: 'osm' }));
        await svc.resetTo2D();
        vi.clearAllMocks();

        await svc.resetTo2D();

        expect(baseControl.applySharedBasemap).not.toHaveBeenCalled();
    });
});
