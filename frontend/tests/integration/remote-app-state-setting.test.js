// Path: tests/integration/remote-app-state-setting.test.js
// datamodel-13/14: a remote `setting` op (and a snapshot's atlas.settings) carrying
// mapBadgeColors / customIcons must be applied to the SAME local store keys the local
// setters use:
//   - mapBadgeColors → repo.saveSetting('mapBadgeColors', obj)
//   - customIcons    → repo.saveSetting('custom_icons', list) + cache invalidation
//
// E A CONTAGEM DE CORES, QUE SAIU DESSA LISTA EM 2026-09-21 (decisão do dono).
// `colorUsage` era escrita aqui como `color_usage_<NOME>` por mapa, enquanto o escritor local
// grava sob a chave RESOLVIDA (o UUID, com o `mapResolver` de pé). Esse par é que produzia o
// vaivém: `getColorUsageCompat` MIGRA a chave por nome para a por id e a APAGA quando não há a por
// id, e o retrato seguinte a recriava; havendo a por id, a atualização do colega era IGNORADA. O
// dado é DERIVADO (`updateColorUsage` soma e subtrai, `performInitialColorAnalysis` recalcula do
// zero quando falta), então cada cliente o computa das feições que já recebe.
//
// O QUE ESTE ARQUIVO PRENDE AGORA, nos dois casos de entrada: a chave é IGNORADA EM SILÊNCIO
// (servidor ou retrato antigo não pode lançar nem avisar, e não pode criar `color_usage_<nome>`),
// e o IRMÃO `mapBadgeColors` da MESMA carga continua sendo aplicado — ele não é derivado, é
// escolha do usuário, e a poda não pode levá-lo junto. A metade de SAÍDA está em
// `tests/unit/contagem-de-cores-nao-sincroniza.test.js`.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    settings: new Map(),
    atlas: { settings: {} },
    invalidate: vi.fn(),
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({
        getMap: vi.fn(),
        saveMap: vi.fn(),
        getAtlas: async () => h.atlas,
        ensureAtlas: async () => h.atlas,
        saveAtlas: async (a) => { h.atlas = a; },
        saveSetting: async (k, v) => { h.settings.set(k, v); },
        getSetting: async (k) => h.settings.get(k),
    }),
}));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: { saveBriefing: vi.fn(), getBriefing: vi.fn(), deleteBriefing: vi.fn() },
}));

vi.mock('../../src/js/store/control.registry.js', () => ({
    getControl: () => undefined,
    registerControl: vi.fn(),
}));

vi.mock('../../src/js/store/customIcons.operations.js', () => ({
    invalidateCustomIconsCache: (...a) => h.invalidate(...a),
}));

import {
    applyRemoteOperation,
    applyRemoteSnapshot,
    setRemoteHandlerEventBus,
} from '../../src/js/store/sync/remote-operation-handler.js';

beforeEach(() => {
    h.settings.clear();
    h.atlas = { settings: {} };
    h.invalidate.mockClear();
    setRemoteHandlerEventBus({ emit: vi.fn(), on: vi.fn(), off: vi.fn() });
});

const settingOp = (data) => applyRemoteOperation({
    entityType: 'setting', operationType: 'update', entityId: 'atlas', mapId: null, data,
});

describe('remote app-state setting op (datamodel-13/14)', () => {
    it('datamodel-13: applies mapBadgeColors to the mapBadgeColors store key', async () => {
        const mapBadgeColors = { Alfa: '#3b82f6', Bravo: '#f59e0b' };
        await settingOp({ mapBadgeColors });
        expect(h.settings.get('mapBadgeColors')).toEqual(mapBadgeColors);
    });

    it('2026-09-21: uma op com colorUsage NÃO cria color_usage_<nome>, e não lança', async () => {
        await expect(settingOp({ colorUsage: { Alfa: { '#ff0000': 3 }, Bravo: { '#00ff00': 1 } } }))
            .resolves.not.toThrow();
        expect(h.settings.has('color_usage_Alfa')).toBe(false);
        expect(h.settings.has('color_usage_Bravo')).toBe(false);
        // ABSOLUTO: nenhuma chave de contagem, e não só as duas acima. Um ramo que gravasse sob
        // outro prefixo passaria pelas duas asserções anteriores.
        expect([...h.settings.keys()].filter((k) => k.startsWith('color_usage_'))).toEqual([]);
    });

    it('2026-09-21: o IRMÃO mapBadgeColors da MESMA op continua sendo aplicado', async () => {
        // Sem este caso a poda passaria verde tendo levado junto o irmão, que NÃO é derivado: a
        // cor do crachá é escolha do usuário e não se recalcula de feição nenhuma.
        await settingOp({
            colorUsage: { Alfa: { '#ff0000': 3 } },
            mapBadgeColors: { Alfa: '#3b82f6' },
        });
        expect(h.settings.get('mapBadgeColors')).toEqual({ Alfa: '#3b82f6' });
        expect([...h.settings.keys()].filter((k) => k.startsWith('color_usage_'))).toEqual([]);
    });

    it('datamodel-14: applies customIcons to custom_icons and invalidates the registry cache', async () => {
        const customIcons = [{ id: 'i1', name: 'Tank', type: 'image/png', createdAt: 1 }];
        await settingOp({ customIcons });
        expect(h.settings.get('custom_icons')).toEqual(customIcons);
        expect(h.invalidate).toHaveBeenCalledTimes(1);
    });

    it('ignores a setting op without any app-state key (no store writes)', async () => {
        await settingOp({ somethingElse: 1 });
        expect(h.settings.size).toBe(0);
        expect(h.invalidate).not.toHaveBeenCalled();
    });
});

describe('snapshot distributes atlas.settings app-state keys (datamodel-13/14)', () => {
    it('writes mapBadgeColors / customIcons from snapshot.atlas.settings, e IGNORA colorUsage', async () => {
        // O `colorUsage` do retrato é o caso que importa para quem já usa o produto: o valor
        // continua gravado em `atlas.settings` dos atlas existentes (nenhuma migração foi escrita)
        // e o servidor segue servindo a coluna inteira. Quem o descarta é o cliente, aqui, em
        // silêncio. Era esta linha que recriava `color_usage_<nome>` a cada retrato e fechava o
        // vaivém com a migração do leitor.
        await applyRemoteSnapshot({
            atlas: {
                id: 'atlas-1',
                settings: {
                    terrainExaggeration: 2,
                    mapBadgeColors: { Alfa: '#111111' },
                    colorUsage: { Alfa: { '#ff0000': 7 } },
                    customIcons: [{ id: 'i9', name: 'Jet', type: 'image/png', createdAt: 2 }],
                },
            },
            maps: [],
            briefings: [],
        });

        expect(h.settings.get('mapBadgeColors')).toEqual({ Alfa: '#111111' });
        expect([...h.settings.keys()].filter((k) => k.startsWith('color_usage_'))).toEqual([]);
        expect(h.settings.get('custom_icons')).toEqual([{ id: 'i9', name: 'Jet', type: 'image/png', createdAt: 2 }]);
        expect(h.invalidate).toHaveBeenCalled();
    });

    it('is a no-op when the snapshot has no atlas settings', async () => {
        await applyRemoteSnapshot({ maps: [], briefings: [] });
        expect(h.settings.size).toBe(0);
    });
});
