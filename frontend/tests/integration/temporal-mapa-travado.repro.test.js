// Path: tests/integration/temporal-mapa-travado.repro.test.js
//
// DEFEITO C2 — A CONFIGURAÇÃO TEMPORAL ERA GRAVÁVEL COM O MAPA TRAVADO.
//
// `writeMapTemporalConfig` (`store/temporal.operations.js`) perguntava SÓ pelo papel
// (`checkPermission(GuardAction.UPDATE_MAP)`) e nenhuma linha do arquivo consultava a trava, ao
// contrário de todo irmão que edita o mesmo documento: `setBaseLayer`, `renameMap` e
// `clearMapPosition` (`map.operations.js`), `saveMapView` e `clearMapView`
// (`map-view.operations.js`). O servidor também não cobre, porque a op `mapTemporal` tem o
// PRÓPRIO mapa como alvo e mapa não está em `LOCKABLE_CHILD_TARGETS`, de modo que o cliente é o
// único ponto de imposição que esta escrita tem. O efeito: um Editor trocava unidade, janela e
// lente de um mapa que o dono tinha travado, e a mudança viajava.
//
// A PERGUNTA CERTA É A ASSÍNCRONA. `memoryStore.lockedMaps` só é completo em atlas de SERVIDOR;
// em atlas local apenas o mapa corrente chega a entrar nele, então o conjunto responde
// "destravado" sobre OUTRO mapa travado, calado (ver `.claude/rules/architecture.md`, "A TRAVA DE
// OUTRO MAPA"). Daí `isMapLocked`, que lê o app setting do disco, e daí o caso do mapa que NÃO é
// o corrente com o conjunto de memória vazio.
//
// DEFEITO S2 — REAGENDAR NUM MAPA TRAVADO MOVIA O DIA D DE TODO MUNDO. O modal pedia o
// deslocamento das feições, ignorava o retorno e gravava a nova origem incondicionalmente. A
// composição virou `rescheduleMapTemporal`, aqui, que lê o retorno e mantém as duas metades num
// LOTE LÓGICO só (`withGestureBatch`): sem isso o disparo de 1,5 s caindo entre elas manda as ops
// de feição sozinhas e o par recebe o exercício deslocado com o Dia D antigo.
//
// O QUE ESTE ARQUIVO NÃO ALCANÇA: o modal (DOM), o servidor e o par. Isso é do Playwright.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: { UPDATE_MAP: 'UPDATE_MAP' },
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    emitStoreError: vi.fn(),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operationBlocked' },
}));

vi.mock('../../src/js/store/map-revision.js', () => ({
    readMapRevision: vi.fn(async () => ({})),
}));

// A TRAVA É A ENTRADA DESTE ARQUIVO. O módulo real arrastaria `map.operations.js` inteiro
// (repositório, config, 3D, 360) para uma suíte que dirige uma folha; o que importa é QUE a
// pergunta seja feita, por NOME de mapa, e que a resposta seja obedecida.
const travados = new Set();
vi.mock('../../src/js/store/map.operations.js', () => ({
    isMapLocked: vi.fn(async (nome) => travados.has(nome)),
}));

const settingStore = new Map();
vi.mock('../../src/js/store/repositories/index.js', () => ({
    getSettingCompat: vi.fn(async (key) => settingStore.get(key) ?? null),
    setSettingCompat: vi.fn(async (key, value) => { settingStore.set(key, value); }),
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: vi.fn(() => MAPA_CORRENTE),
        getMapId: vi.fn((m) => m),
    },
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    // O conjunto de memória fica VAZIO de propósito: é o estado do atlas LOCAL, em que ele nunca
    // conheceu a trava de outro mapa. Se o gate voltasse a consultá-lo, os casos de OUTRO mapa
    // passariam verdes sobre um mapa travado.
    memoryStore: { temporalConfigs: new Map(), temporalView: new Map(), lockedMaps: new Set() },
}));

let eventBus;
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: vi.fn(() => eventBus),
}));

import {
    setMapTemporalConfig,
    setMapTemporalSaved,
    getMapTemporalConfig,
    rescheduleMapTemporal,
} from '../../src/js/store/temporal.operations.js';
import { isMapLocked } from '../../src/js/store/map.operations.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';
import { enableOperationLogging, disableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { openGestureBatchId } from '../../src/js/store/sync/gesture-batch.js';
import { EntityType } from '../../src/js/store/sync/operation-types.js';
import { MOTIVO_REAGENDAMENTO } from '../../src/js/temporal/temporal-settings.model.js';

const MAPA_CORRENTE = '4a22f7df-df6d-47df-80bb-f26df86d31ec';
const OUTRO_MAPA = '11111111-1111-4111-8111-111111111111';
const DIA_MS = 86400000;

function bloqueios() {
    return emitStoreError.mock.calls.map(([, payload]) => payload);
}

beforeEach(async () => {
    settingStore.clear();
    travados.clear();
    eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    checkPermission.mockReturnValue({ allowed: true });
    isMapLocked.mockClear();
    emitStoreError.mockClear();
    enableOperationLogging();
    await operationQueue.clear();
});

describe('C2 — mapa travado recusa a escrita da config temporal', () => {
    it('o mapa CORRENTE travado: nada no disco, nada na fila, e a recusa nomeia a trava', async () => {
        travados.add(MAPA_CORRENTE);

        await expect(setMapTemporalConfig(MAPA_CORRENTE, { unidade: 'DIA', inicio: 1000, fim: 5000 }))
            .resolves.toBeNull();

        expect(settingStore.has(`temporal_${MAPA_CORRENTE}`)).toBe(false);
        expect(await operationQueue.count()).toBe(0);
        expect(bloqueios()).toEqual([
            { operation: 'setMapTemporalConfig', reason: 'map_locked' },
        ]);
    });

    it('OUTRO mapa travado, com o conjunto de memória vazio: a pergunta vai ao DISCO, por nome', async () => {
        // A armadilha do atlas local: `memoryStore.lockedMaps` não conhece este mapa, então um
        // gate síncrono o daria por destravado e gravaria.
        travados.add(OUTRO_MAPA);

        await expect(setMapTemporalConfig(OUTRO_MAPA, { unidade: 'HORA' })).resolves.toBeNull();

        expect(isMapLocked).toHaveBeenCalledWith(OUTRO_MAPA);
        expect(settingStore.has(`temporal_${OUTRO_MAPA}`)).toBe(false);
        expect(await operationQueue.count()).toBe(0);
    });

    it('`setMapTemporalSaved` passa pelo MESMO gate: o valor salvo não escapa da trava', async () => {
        travados.add(MAPA_CORRENTE);

        await expect(setMapTemporalSaved(MAPA_CORRENTE, true)).resolves.toBeNull();

        expect(settingStore.has(`temporal_${MAPA_CORRENTE}`)).toBe(false);
        expect(bloqueios()).toEqual([
            { operation: 'setMapTemporalSaved', reason: 'map_locked' },
        ]);
    });

    it('CONTROLE: destravado, a mesma escrita grava e enfileira normalmente', async () => {
        const config = await setMapTemporalConfig(MAPA_CORRENTE, { unidade: 'DIA', inicio: 1000, fim: 5000 });

        expect(config).toMatchObject({ unidade: 'DIA', inicio: 1000, fim: 5000 });
        expect(settingStore.has(`temporal_${MAPA_CORRENTE}`)).toBe(true);
        expect(await operationQueue.count()).toBe(1);
        expect(bloqueios()).toEqual([]);
    });

    it('o PAPEL é perguntado antes da trava: uma recusa só, e o disco nem é consultado', async () => {
        travados.add(MAPA_CORRENTE);
        checkPermission.mockReturnValue({ allowed: false, reason: 'somente leitura', required: 'canEdit' });

        await expect(setMapTemporalConfig(MAPA_CORRENTE, { unidade: 'DIA' })).resolves.toBeNull();

        // Dois eventos de bloqueio para um gesto só seriam dois toasts contando histórias
        // diferentes sobre a mesma recusa.
        expect(bloqueios()).toEqual([
            { operation: 'setMapTemporalConfig', reason: 'somente leitura', required: 'canEdit' },
        ]);
        expect(isMapLocked).not.toHaveBeenCalled();
    });
});

describe('S2 — reagendar: a origem só anda se as feições andaram', () => {
    it('deslocamento RECUSADO (mapa travado): nem origem, nem janela, nem op de config', async () => {
        await setMapTemporalConfig(MAPA_CORRENTE, { origem: 1000, inicio: 1000, fim: 9000 });
        await operationQueue.clear();

        const { decisao, gravou, config } = await rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: DIA_MS,
            novaOrigem: 1000 + DIA_MS,
            // É o que `TemporalControl.shiftFeatureTimes` devolve quando a store recusa: havia
            // candidata e nenhuma andou.
            deslocarFeicoes: async () => ({ changed: 0, hadCandidates: true }),
        });

        expect(decisao.motivo).toBe(MOTIVO_REAGENDAMENTO.RECUSADO);
        expect(gravou).toBeNull();
        expect(config).toBeNull();
        // O Dia D ficou onde estava: é o defeito inteiro.
        const guardada = await getMapTemporalConfig(MAPA_CORRENTE);
        expect(guardada).toMatchObject({ origem: 1000, inicio: 1000, fim: 9000 });
        expect(await operationQueue.count()).toBe(0);
    });

    it('feições deslocadas: origem e janela andam pelo MESMO delta', async () => {
        await setMapTemporalConfig(MAPA_CORRENTE, { origem: 1000, inicio: 1000, fim: 9000 });
        await operationQueue.clear();

        const { gravou } = await rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: DIA_MS,
            novaOrigem: 1000 + DIA_MS,
            deslocarFeicoes: async () => ({ changed: 3, hadCandidates: true }),
        });

        expect(gravou).toBe(true);
        expect(await getMapTemporalConfig(MAPA_CORRENTE)).toMatchObject({
            origem: 1000 + DIA_MS, inicio: 1000 + DIA_MS, fim: 9000 + DIA_MS,
        });
    });

    it('janela em branco continua em branco: o delta não inventa borda', async () => {
        await setMapTemporalConfig(MAPA_CORRENTE, { origem: 1000 });
        await operationQueue.clear();

        await rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: -DIA_MS,
            novaOrigem: 1000 - DIA_MS,
            deslocarFeicoes: async () => ({ changed: 1, hadCandidates: true }),
        });

        const config = await getMapTemporalConfig(MAPA_CORRENTE);
        expect(config.inicio).toBeNull();
        expect(config.fim).toBeNull();
        expect(config.origem).toBe(1000 - DIA_MS);
    });

    it('mapa sem nada cronometrado: só a lente anda, e ela anda', async () => {
        const { decisao, gravou } = await rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: DIA_MS,
            novaOrigem: DIA_MS,
            deslocarFeicoes: async () => ({ changed: 0, hadCandidates: false }),
        });

        expect(decisao.motivo).toBe(MOTIVO_REAGENDAMENTO.NADA_A_DESLOCAR);
        expect(gravou).toBe(true);
        expect((await getMapTemporalConfig(MAPA_CORRENTE)).origem).toBe(DIA_MS);
    });

    it('mapa travado: mesmo um deslocamento que diga ter andado não consegue gravar a origem', async () => {
        // O gate do C2 é o que fecha a porta de trás: a metade da config é recusada por conta
        // própria, e o desfecho vira `gravou: false` em vez de uma gravação silenciosa.
        travados.add(MAPA_CORRENTE);

        const { decisao, gravou } = await rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: DIA_MS,
            novaOrigem: DIA_MS,
            deslocarFeicoes: async () => ({ changed: 5, hadCandidates: true }),
        });

        expect(decisao.motivo).toBe(MOTIVO_REAGENDAMENTO.DESLOCADAS);
        expect(gravou).toBe(false);
        expect(settingStore.has(`temporal_${MAPA_CORRENTE}`)).toBe(false);
    });

    it('sem controle temporal montado: nada é deslocado e nada é gravado', async () => {
        const { decisao, gravou } = await rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: DIA_MS, novaOrigem: DIA_MS, deslocarFeicoes: null,
        });

        expect(decisao.motivo).toBe(MOTIVO_REAGENDAMENTO.SEM_CONTROLE);
        expect(gravou).toBeNull();
        expect(settingStore.has(`temporal_${MAPA_CORRENTE}`)).toBe(false);
    });

    it('AS DUAS METADES SÃO UM LOTE LÓGICO SÓ', async () => {
        let loteVistoPeloDeslocamento = null;

        await rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: DIA_MS,
            novaOrigem: DIA_MS,
            deslocarFeicoes: async () => {
                // Quem desloca corre DENTRO do gesto: é assim que as ops de feição herdam o
                // mesmo `batchId` que a op de config recebe depois.
                loteVistoPeloDeslocamento = openGestureBatchId();
                return { changed: 2, hadCandidates: true };
            },
        });

        expect(loteVistoPeloDeslocamento).toBeTruthy();
        const [op] = await operationQueue.peek(10);
        expect(op.entityType).toBe(EntityType.MAP_TEMPORAL);
        expect(op.batchId).toBe(loteVistoPeloDeslocamento);
        // E o gesto FECHA: um lote aberto seguraria o envio pelo resto da sessão.
        expect(openGestureBatchId()).toBeNull();
    });

    it('o gesto fecha mesmo quando o deslocamento LANÇA', async () => {
        await expect(rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: DIA_MS,
            novaOrigem: DIA_MS,
            deslocarFeicoes: async () => { throw new Error('boom'); },
        })).rejects.toThrow('boom');

        expect(openGestureBatchId()).toBeNull();
    });

    it('delta nulo ou não finito é bug do chamador: lança, não recusa em silêncio', async () => {
        for (const delta of [0, NaN, undefined, Infinity]) {
            await expect(rescheduleMapTemporal(MAPA_CORRENTE, {
                delta, novaOrigem: 10, deslocarFeicoes: async () => ({ changed: 1, hadCandidates: true }),
            })).rejects.toThrow(/rescheduleMapTemporal/);
        }
        await expect(rescheduleMapTemporal(MAPA_CORRENTE, {
            delta: DIA_MS, novaOrigem: NaN, deslocarFeicoes: async () => ({ changed: 1, hadCandidates: true }),
        })).rejects.toThrow(/rescheduleMapTemporal/);
    });
});

describe('fora de um atlas remoto nada muda', () => {
    it('sem log de operação, a escrita destravada continua gravando no disco', async () => {
        disableOperationLogging();

        const config = await setMapTemporalConfig(MAPA_CORRENTE, { unidade: 'SEMANA' });

        expect(config.unidade).toBe('SEMANA');
        expect(await operationQueue.count()).toBe(0);
    });
});
