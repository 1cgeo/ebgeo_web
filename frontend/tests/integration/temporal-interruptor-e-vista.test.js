// Path: tests/integration/temporal-interruptor-e-vista.test.js
//
// O INTERRUPTOR TEMPORAL É ESTADO DE VISTA DA PESSOA (decisão do dono, 2026-09-20).
//
// O DEFEITO QUE ESTE ARQUIVO PRENDE: ligar ou desligar a linha do tempo gravava `ativo` na config
// do mapa e enfileirava uma op `mapTemporal`, de modo que o gesto de UMA pessoa ligava a linha do
// tempo na tela de TODAS. O conserto separa dois valores. O da TELA mora em
// `memoryStore.temporalView`, não persiste e não enfileira nada. O SALVO continua dentro da
// config, viaja com ela e só é escrito por `setMapTemporalSaved`, que o gesto de salvar a vista
// chama.
//
// A ARMADILHA QUE A SEPARAÇÃO TEM, e que os dois últimos casos prendem: o servidor REGRAVA
// `temporal_config` com as chaves que a op traz, então o payload precisa continuar levando
// `ativo`, e ele tem de ser o SALVO. Um patch de config que carregasse o da tela devolveria a
// propagação inteira sem que nenhum outro teste ficasse vermelho.
//
// ELE DIRIGE `temporal.operations.js` DE VERDADE, com a fila real, no molde de
// `tests/integration/temporal-operations-real.test.js`. O QUE NÃO ALCANÇA: o controlador da
// barra, o servidor e o par; isso é do Playwright.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: { UPDATE_MAP: 'UPDATE_MAP' },
}));

// A TRAVA DO MAPA É ENTRADA DESTE ARQUIVO, e por isso ela é mock. `temporal.operations.js` passou
// a perguntar `isMapLocked` (achado C2), e importar o módulo real arrastaria `map.operations.js`
// inteiro (repositório, config, 3D, 360) para uma suíte que dirige uma folha. O padrão é
// "destravado", que é o estado em que todos os casos abaixo já estavam.
vi.mock('../../src/js/store/map.operations.js', () => ({
    isMapLocked: vi.fn(async () => false),
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    emitStoreError: vi.fn(),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operationBlocked' },
}));

vi.mock('../../src/js/store/map-revision.js', () => ({
    readMapRevision: vi.fn(async () => ({})),
}));

const settingStore = new Map();
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getSettingCompat: vi.fn(async (key) => settingStore.get(key) ?? null),
    setSettingCompat: vi.fn(async (key, value) => { settingStore.set(key, value); }),
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: vi.fn(() => MAP_UUID),
        getMapId: vi.fn((m) => m),
    },
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: { temporalConfigs: new Map(), temporalView: new Map() },
}));

let eventBus;
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: vi.fn(() => eventBus),
}));

import {
    setMapTemporalConfig,
    setMapTemporalSaved,
    setMapTemporalView,
    toggleMapTemporal,
    isMapTemporalEnabled,
    isMapTemporalEnabledSync,
    isMapTemporalSavedEnabled,
    applySavedMapTemporalView,
    getMapTemporalConfig,
} from '../../src/js/store/temporal.operations.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { enableOperationLogging, disableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { EntityType } from '../../src/js/store/sync/operation-types.js';
import { EventTypes } from '../../src/js/events/event_types.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';

const MAP_UUID = '4a22f7df-df6d-47df-80bb-f26df86d31ec';

function emitidos(evento) {
    return eventBus.emit.mock.calls.filter(([nome]) => nome === evento).map(([, payload]) => payload);
}

beforeEach(async () => {
    settingStore.clear();
    memoryStore.temporalConfigs.clear();
    memoryStore.temporalView.clear();
    eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    checkPermission.mockReturnValue({ allowed: true });
    enableOperationLogging();
    await operationQueue.clear();
});

describe('o interruptor da TELA não grava e não viaja', () => {
    it('alternar liga na tela, avisa o barramento e NÃO enfileira operação nenhuma', async () => {
        await expect(toggleMapTemporal(MAP_UUID)).resolves.toBe(true);

        expect(isMapTemporalEnabledSync(MAP_UUID)).toBe(true);
        expect(emitidos(EventTypes.MAP_TEMPORAL_CHANGED)).toEqual([{ mapName: MAP_UUID, enabled: true }]);
        // O sinal que separa vista de escrita: a fila de saída e o disco continuam vazios.
        expect(await operationQueue.count()).toBe(0);
        expect(settingStore.has(`temporal_${MAP_UUID}`)).toBe(false);
    });

    it('o LEITOR alterna: o gesto não pergunta nada ao guarda', async () => {
        checkPermission.mockReturnValue({ allowed: false, reason: 'somente leitura', required: 'write' });

        await expect(toggleMapTemporal(MAP_UUID)).resolves.toBe(true);
        await expect(toggleMapTemporal(MAP_UUID)).resolves.toBe(false);

        expect(checkPermission).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
    });

    it('repetir o mesmo valor não reemite o evento', () => {
        setMapTemporalView(MAP_UUID, true);
        setMapTemporalView(MAP_UUID, true);

        expect(emitidos(EventTypes.MAP_TEMPORAL_CHANGED)).toHaveLength(1);
    });

    it('sem estado de vista, a tela responde o valor SALVO do mapa', async () => {
        settingStore.set(`temporal_${MAP_UUID}`, { ativo: true });

        await expect(isMapTemporalEnabled(MAP_UUID)).resolves.toBe(true);
        // `getMapTemporalConfig` aqueceu o cache que o leitor síncrono consulta.
        expect(isMapTemporalEnabledSync(MAP_UUID)).toBe(true);
    });

    it('a vista VENCE o salvo: desligar na tela não mexe no que foi salvo', async () => {
        settingStore.set(`temporal_${MAP_UUID}`, { ativo: true });
        await getMapTemporalConfig(MAP_UUID);

        setMapTemporalView(MAP_UUID, false);

        expect(isMapTemporalEnabledSync(MAP_UUID)).toBe(false);
        await expect(isMapTemporalSavedEnabled(MAP_UUID)).resolves.toBe(true);
    });
});

describe('o valor SALVO viaja, e só por uma porta', () => {
    it('setMapTemporalSaved grava `ativo` e enfileira UMA op mapTemporal', async () => {
        const config = await setMapTemporalSaved(MAP_UUID, true);

        expect(config.ativo).toBe(true);
        expect(settingStore.get(`temporal_${MAP_UUID}`).ativo).toBe(true);
        const ops = await operationQueue.peek(10);
        expect(ops).toHaveLength(1);
        expect(ops[0].entityType).toBe(EntityType.MAP_TEMPORAL);
        expect(ops[0].data.ativo).toBe(true);
    });

    it('salvar NÃO troca a tela de quem salvou, nem anuncia troca de interruptor', async () => {
        setMapTemporalView(MAP_UUID, false);
        eventBus.emit.mockClear();

        await setMapTemporalSaved(MAP_UUID, true);

        expect(isMapTemporalEnabledSync(MAP_UUID)).toBe(false);
        expect(emitidos(EventTypes.MAP_TEMPORAL_CHANGED)).toEqual([]);
    });

    it('aplicar a vista salva liga a tela, carimbado como automático (não é gesto)', async () => {
        settingStore.set(`temporal_${MAP_UUID}`, { ativo: true });
        setMapTemporalView(MAP_UUID, false);
        eventBus.emit.mockClear();

        await expect(applySavedMapTemporalView(MAP_UUID)).resolves.toBe(true);

        expect(emitidos(EventTypes.MAP_TEMPORAL_CHANGED)).toEqual([
            { mapName: MAP_UUID, enabled: true, automatico: true },
        ]);
    });
});

describe('a config do mapa não deixa o interruptor da tela vazar', () => {
    it('um patch com `ativo` é aceito SEM o `ativo`: o salvo fica como estava', async () => {
        const config = await setMapTemporalConfig(MAP_UUID, { ativo: true, unidade: 'DIA' });

        expect(config.unidade).toBe('DIA');
        expect(config.ativo).toBe(false);
        const [op] = await operationQueue.peek(10);
        expect(op.data.ativo).toBe(false);
    });

    it('editar a janela com a tela LIGADA e o salvo DESLIGADO manda `ativo: false`', async () => {
        // A interleaving que devolveria a propagação: a pessoa liga na própria tela e depois
        // ajusta a janela pelo modal. O payload tem de levar o SALVO, nunca o da tela.
        setMapTemporalView(MAP_UUID, true);

        await setMapTemporalConfig(MAP_UUID, { inicio: 1000, fim: 5000 });

        const [op] = await operationQueue.peek(10);
        expect(op.data).toMatchObject({ ativo: false, inicio: 1000, fim: 5000 });
        expect(settingStore.get(`temporal_${MAP_UUID}`).ativo).toBe(false);
        // E a tela de quem editou continua ligada.
        expect(isMapTemporalEnabledSync(MAP_UUID)).toBe(true);
    });

    it('editar a janela PRESERVA um `ativo` salvo verdadeiro (o servidor regrava a coluna inteira)', async () => {
        await setMapTemporalSaved(MAP_UUID, true);
        await operationQueue.clear();

        await setMapTemporalConfig(MAP_UUID, { unidade: 'hora' });

        const [op] = await operationQueue.peek(10);
        expect(op.data).toMatchObject({ ativo: true, unidade: 'hora' });
    });
});

describe('fora de um atlas remoto nada muda para o interruptor', () => {
    it('sem log de operação a vista alterna igual', async () => {
        disableOperationLogging();

        await expect(toggleMapTemporal(MAP_UUID)).resolves.toBe(true);
        await expect(toggleMapTemporal(MAP_UUID)).resolves.toBe(false);
    });
});
