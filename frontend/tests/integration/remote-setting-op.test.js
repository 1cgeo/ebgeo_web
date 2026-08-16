// Path: tests/integration/remote-setting-op.test.js

/**
 * Uma operação de `setting` vinda de OUTRO cliente precisa persistir no atlas local e aparecer no
 * mapa na hora — é o que faz a preferência de aparência ser do PROJETO e não da máquina.
 *
 * ESTE ARQUIVO FICOU VERDE PROVANDO O CONTRÁRIO. O dublê de `getControl` respondia ao nome
 * `'terrain'`, e o registro real usa `'TerrainControl'` (cinco chamadores em produção, todos com
 * o nome longo). O handler pedia o nome curto, recebia `undefined` de verdade, e o apply ao vivo
 * NUNCA rodou para ninguém — mas aqui recebia o espião, porque o dublê tinha sido escrito a partir
 * do código que ele deveria julgar. **Dublê copiado do sujeito confirma o erro do sujeito.**
 * O nome agora é o mesmo dos chamadores de produção, e o caso vale o que promete.
 *
 * Dois defeitos irmãos vieram no mesmo conserto: a persistência usava `getAtlas()`, que devolve
 * null num slot sem registro de atlas (o caso comum), e `globeProjection` não era tratada.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    atlasStore: { atlas: { settings: {} } },
    terrainSpy: vi.fn(),
    projectionSpy: vi.fn(),
    terrainActive: false,
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({
        getMap: vi.fn(),
        saveMap: vi.fn(),
        getAtlas: async () => h.atlasStore.atlas,
        saveAtlas: async (a) => { h.atlasStore.atlas = a; },
        // `ensureAtlas` existe no repositório real e é o que o caminho de escrita usa: um dublê
        // sem ele esconderia justamente o ramo "não havia registro", que é o do defeito.
        ensureAtlas: async () => {
            if (!h.atlasStore.atlas) h.atlasStore.atlas = { settings: {} };
            return h.atlasStore.atlas;
        },
    }),
}));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: { saveBriefing: vi.fn(), getBriefing: vi.fn(), deleteBriefing: vi.fn() },
}));

vi.mock('../../src/js/store/control.registry.js', () => ({
    // O NOME REAL do registro. Ver o cabeçalho: o nome errado aqui foi o que manteve este arquivo
    // verde enquanto o comportamento estava quebrado em produção.
    getControl: (name) => (name === 'TerrainControl'
        ? { setExaggeration: h.terrainSpy, _wasTerrainActive: h.terrainActive }
        : undefined),
    registerControl: vi.fn(),
}));

import { applyRemoteOperation, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';

const remoteSetting = (data) => applyRemoteOperation({
    entityType: 'setting', operationType: 'update', entityId: 'atlas', mapId: null, data,
});

beforeEach(() => {
    h.atlasStore.atlas = { settings: {} };
    h.terrainSpy.mockClear();
    h.projectionSpy.mockClear();
    h.terrainActive = false;
    globalThis.__ebgeoMap = { setProjection: h.projectionSpy, setSky: vi.fn() };
    setRemoteHandlerEventBus({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
});

describe('operação remota de setting: aparência do atlas', () => {
    it('persiste o exagero e aplica no controle de terreno', async () => {
        await remoteSetting({ terrainExaggeration: 2.5 });
        expect(h.atlasStore.atlas.settings.terrainExaggeration).toBe(2.5);
        expect(h.terrainSpy).toHaveBeenCalledWith(2.5);
    });

    it('grava mesmo quando NÃO havia registro de atlas', async () => {
        // O caso que `getAtlas()` perdia calado: sem registro, o valor do par não chegava ao
        // disco e sumia no primeiro F5.
        h.atlasStore.atlas = null;
        await remoteSetting({ terrainExaggeration: 2 });
        expect(h.atlasStore.atlas?.settings?.terrainExaggeration).toBe(2);
    });

    it('persiste a projeção e a aplica no mapa vivo', async () => {
        await remoteSetting({ globeProjection: false });
        expect(h.atlasStore.atlas.settings.globeProjection).toBe(false);
        expect(h.projectionSpy).toHaveBeenCalledWith({ type: 'mercator' });

        await remoteSetting({ globeProjection: true });
        expect(h.atlasStore.atlas.settings.globeProjection).toBe(true);
        expect(h.projectionSpy).toHaveBeenLastCalledWith({ type: 'globe' });
    });

    it('com o terreno LIGADO, persiste a projeção mas não mexe no mapa', async () => {
        // Globo e relevo não convivem (MapLibre #4792). Aplicar aqui apagaria o terreno que o
        // usuário está vendo; o TerrainControl restaura a escolha ao desligar o relevo.
        h.terrainActive = true;
        await remoteSetting({ globeProjection: true });
        expect(h.atlasStore.atlas.settings.globeProjection).toBe(true);
        expect(h.projectionSpy).not.toHaveBeenCalled();
    });

    it('ignora uma op de setting sem chave de aparência', async () => {
        await remoteSetting({ somethingElse: 1 });
        expect(h.terrainSpy).not.toHaveBeenCalled();
        expect(h.projectionSpy).not.toHaveBeenCalled();
        expect(h.atlasStore.atlas.settings).toEqual({});
    });
});
