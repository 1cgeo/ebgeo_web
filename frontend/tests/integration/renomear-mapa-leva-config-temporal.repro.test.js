// Path: tests/integration/renomear-mapa-leva-config-temporal.repro.test.js

/**
 * @fileoverview Regressao: renomear um mapa APAGAVA a configuracao temporal dele (S1).
 *
 * A CAUSA. A config temporal mora num app setting chaveado pelo NOME do mapa
 * (`temporal_<nome>`, lido por `setCurrentMap`), e a trava do mapa tambem (`mapLocked_<nome>`).
 * Todo o resto dos laterais de um mapa pendura na CHAVE de armazenamento, que o rename nao
 * muda. `LocalRepository.renameMap` transferia cores, notas, grupos, camadas, 3D, 360 e grade
 * chave a chave, entao no ramo UUID nao havia linha nenhuma para os dois chaveados por nome e no
 * ramo legado a transferencia so parecia existir, porque la a chave por acaso e o nome. O
 * resultado era a janela, a unidade, o modo relativo e o Dia D sumirem no rename, com
 * `temporal_<nomeAntigo>` sobrando no disco como orfao que nenhuma exclusao alcanca.
 *
 * O ESPELHO EM MEMORIA tinha o mesmo buraco: `renameMapInMemory` re-chaveava maps, groups,
 * layers, currentMap e lockedMaps, e deixava `temporalConfigs` e `temporalView` no nome velho. A
 * segunda e a que nao tem volta, porque a vista de tela nao esta no disco: ninguem a reconstroi.
 *
 * A REGRA QUE O CONSERTO INTRODUZ, espelho da guarda de homonimo de `deleteMap`: a transferencia
 * e uma COPIA, e so vira mudanca quando nenhum outro registro ainda atende pelo nome antigo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock localforage (mesmo arnes de `temporal-config-stray-delete.repro.test.js`)
// ============================================================================

const { stores } = vi.hoisted(() => ({ stores: {} }));

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (key, value) => { map.set(key, value); }),
                    getItem: vi.fn(async (key) => {
                        const val = map.get(key);
                        return val !== undefined ? val : null;
                    }),
                    removeItem: vi.fn(async (key) => { map.delete(key); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (callback) => {
                        for (const [key, value] of map.entries()) {
                            callback(value, key);
                        }
                    }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

vi.mock('../../src/js/store/atlas/atlas.entity.js', () => ({
    createAtlas: vi.fn((name) => ({ id: 'atlas-uuid', name: name || 'Projeto sem nome', maps: [] })),
    isValidAtlas: vi.fn(() => true)
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        resolveToId: vi.fn((nameOrId) => nameOrId),
        resolveToName: vi.fn((id) => id),
        registerMap: vi.fn(),
        renameMap: vi.fn()
    }
}));

import { LocalRepository } from '../../src/js/store/repositories/local.repository.js';
import mapManager from '../../src/js/store/store-state-manager.js';
import { memoryStore } from '../../src/js/store/memory-store.js';

const MAP_ID = '11111111-2222-4333-8444-555555555555';
const OUTRO_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

/** A config que o defeito apagava: janela, unidade, modo relativo e Dia D. */
const CONFIG = Object.freeze({
    ativo: true,
    unidade: 'HORA',
    inicio: 1700000000000,
    fim: 1700086400000,
    modo: 'relativo',
    origem: 1700000000000
});

let repo;

beforeEach(() => {
    for (const storeName of Object.keys(stores)) {
        stores[storeName]._map.clear();
    }
    vi.clearAllMocks();
    repo = new LocalRepository();
    memoryStore.temporalConfigs.clear();
    memoryStore.temporalView.clear();
    memoryStore.lockedMaps.clear();
    memoryStore.maps = {};
    memoryStore.groups = {};
    memoryStore.layers = {};
    memoryStore.currentMap = null;
});

describe('LocalRepository.renameMap leva os laterais chaveados por NOME', () => {
    it('ramo UUID: a config temporal segue o mapa e nao sobra orfao', async () => {
        await repo.saveMap(MAP_ID, { id: MAP_ID, name: 'Operação' });
        await repo.saveSetting('temporal_Operação', CONFIG);

        await repo.renameMap(MAP_ID, 'Operação Fase 2');

        expect(await repo.getSetting('temporal_Operação Fase 2')).toEqual(CONFIG);
        expect(await repo.getSetting('temporal_Operação')).toBeNull();
    });

    it('ramo LEGADO (chave = nome): a config temporal segue junto com cores e grade', async () => {
        await repo.saveMap('Operação', { id: 'Operação', name: 'Operação' });
        await repo.saveSetting('temporal_Operação', CONFIG);
        await repo.saveSetting('gridStyle_Operação', { format: 'utm', visible: true });

        await repo.renameMap('Operação', 'Operação Fase 2');

        expect(await repo.getSetting('temporal_Operação Fase 2')).toEqual(CONFIG);
        expect(await repo.getSetting('temporal_Operação')).toBeNull();
        // Controle: o que ja funcionava continua funcionando no mesmo ramo.
        expect(await repo.getSetting('gridStyle_Operação Fase 2')).toEqual({ format: 'utm', visible: true });
    });

    it('a trava do mapa viaja pela mesma porta', async () => {
        // O gesto de renomear recusa mapa travado, entao o valor que de fato viaja e `false`; o
        // que a transferencia impede e o registro sobrar sob o nome antigo para ser adotado pelo
        // proximo mapa que nascer com aquele nome.
        await repo.saveMap(MAP_ID, { id: MAP_ID, name: 'Operação' });
        await repo.saveSetting('mapLocked_Operação', false);

        await repo.renameMap(MAP_ID, 'Operação Fase 2');

        expect(await repo.getSetting('mapLocked_Operação Fase 2')).toBe(false);
        expect(await repo.getSetting('mapLocked_Operação')).toBeNull();
    });

    it('homonimo: com outro registro ainda atendendo pelo nome antigo, COPIA em vez de mover', async () => {
        // Espelho da guarda de `deleteMap`: um lateral chaveado por nome pertence a quem atende
        // por aquele nome. Levar a chave embora roubaria a config do homonimo sobrevivente.
        await repo.saveMap(MAP_ID, { id: MAP_ID, name: 'Principal' });
        await repo.saveMap(OUTRO_ID, { id: OUTRO_ID, name: 'Principal' });
        await repo.saveSetting('temporal_Principal', CONFIG);

        await repo.renameMap(MAP_ID, 'Principal Bis');

        expect(await repo.getSetting('temporal_Principal Bis')).toEqual(CONFIG);
        expect(await repo.getSetting('temporal_Principal')).toEqual(CONFIG);
    });

    it('borda: sem nada guardado, o rename nao fabrica config nenhuma sob o nome novo', async () => {
        await repo.saveMap(MAP_ID, { id: MAP_ID, name: 'Operação' });

        await repo.renameMap(MAP_ID, 'Operação Fase 2');

        expect(await repo.getSetting('temporal_Operação Fase 2')).toBeNull();
        expect(await repo.getSetting('mapLocked_Operação Fase 2')).toBeNull();
    });

    it('borda: renomear para o MESMO nome nao apaga a config', async () => {
        // A transferencia le e escreve a mesma chave; sem a guarda de igualdade a remocao do
        // nome antigo aconteceria depois da escrita e levaria junto a config recem-gravada.
        await repo.saveMap(MAP_ID, { id: MAP_ID, name: 'Operação' });
        await repo.saveSetting('temporal_Operação', CONFIG);

        await repo.renameMap(MAP_ID, 'Operação');

        expect(await repo.getSetting('temporal_Operação')).toEqual(CONFIG);
    });
});

describe('renameMapInMemory re-chaveia as DUAS metades do temporal', () => {
    it('a config salva e a vista de tela acompanham o novo nome', async () => {
        memoryStore.temporalConfigs.set('Operação', { ...CONFIG });
        // A vista de tela e o CONTRARIO do salvo: e exatamente o valor que so existe em memoria.
        memoryStore.temporalView.set('Operação', false);

        mapManager.renameMapInMemory('Operação', 'Operação Fase 2');

        expect(memoryStore.temporalConfigs.get('Operação Fase 2')).toEqual(CONFIG);
        expect(memoryStore.temporalConfigs.has('Operação')).toBe(false);
        expect(memoryStore.temporalView.get('Operação Fase 2')).toBe(false);
        expect(memoryStore.temporalView.has('Operação')).toBe(false);
    });

    it('borda: sem entrada no cache, nada e fabricado sob o nome novo', async () => {
        // `has` e a asserção que importa: gravar `undefined` sob o nome novo faria
        // `isMapTemporalEnabledSync` ler um booleano ausente como vista definida.
        mapManager.renameMapInMemory('Operação', 'Operação Fase 2');

        expect(memoryStore.temporalConfigs.has('Operação Fase 2')).toBe(false);
        expect(memoryStore.temporalView.has('Operação Fase 2')).toBe(false);
    });

    it('controle: o que ja era re-chaveado continua sendo', async () => {
        memoryStore.maps['Operação'] = { undoStacks: {}, redoStacks: {} };
        memoryStore.lockedMaps.add('Operação');
        memoryStore.currentMap = 'Operação';
        memoryStore.temporalView.set('Operação', true);

        mapManager.renameMapInMemory('Operação', 'Operação Fase 2');

        expect(memoryStore.maps['Operação Fase 2']).toBeDefined();
        expect(memoryStore.lockedMaps.has('Operação Fase 2')).toBe(true);
        expect(memoryStore.currentMap).toBe('Operação Fase 2');
        expect(memoryStore.temporalView.get('Operação Fase 2')).toBe(true);
    });
});
