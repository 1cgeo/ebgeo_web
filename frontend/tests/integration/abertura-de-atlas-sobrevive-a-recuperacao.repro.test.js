// Path: tests/integration/abertura-de-atlas-sobrevive-a-recuperacao.repro.test.js
//
// A ABERTURA DE UM ATLAS DE SERVIDOR MORRIA NO ÚLTIMO PASSO, e o passo era gravar uma
// PREFERÊNCIA. Medido em 2026-09-13 pelo Playwright (`desempenho-do-boot-do-mapa.spec.js`,
// janela `abrir-atlas-remoto-1`), com a pilha inteira no console do navegador:
//
//   Error: O atlas está recuperando alterações. Aguarde antes de editar.
//       at beginStoreWrite (store/write-coordinator.js)
//       at runTransaction (store/store-transaction.js)
//       at BaseLayerControl.switchLayer -> setBaseLayer
//       at BaseLayerControl.switchMap
//       at openRemoteAtlas -> openAtlasFromUrl -> initApp
//
// A CADEIA DO DEFEITO, e o final dela é o que se via na tela: `connect` termina, o socket abre e
// o servidor responde o `sync_request` com um SEGUNDO retrato; `applyRemoteSnapshot` toma
// `pauseStoreWrites` para o escopo enquanto o reconstrói, e nesse instante `openRemoteAtlas`
// chega ao `switchMap`, que persiste o mapa-base saneado. Desde 2026-09-13 (`15527549`, "mapa:
// mapa-base e posição registram a intenção antes de gravar") essa gravação passa por
// `runTransaction`, logo por `beginStoreWrite`, e a recusa era um `Error` LANÇADO. Ninguém
// naquele caminho o pega: ele escapa de `switchMap`, escapa de `openRemoteAtlas` (a pintura fica
// fora do try/catch dela) e `openAtlasFromUrl` lê a abertura inteira como fracassada — a cadeia
// de boot cai em `openAtlasChooserOnBoot`, que NAVEGA para `atlas.html`. O atlas já estava
// conectado e montado, e mesmo assim a aba voltava ao seletor, levando a página do mapa junto
// (daí o `__ebgeoMap` que nunca fica `loaded()` no corredor de desempenho).
//
// O QUE ESTE ARQUIVO PRENDE: uma recuperação em curso é ESTADO REVERSÍVEL, então a recusa é
// falha esperada — `return` mais `STORE_OPERATION_BLOCKED`, a mesma forma que o gate de posto e
// o de mapa travado já usam nessas três funções — e nunca uma exceção que derruba quem chamou.
//
// A INTERLEAVING É DETERMINÍSTICA AQUI, de propósito: no navegador ela depende de o segundo
// retrato estar em voo no milissegundo do `switchMap` (medido: verde em 1 de 2 tentativas
// ingênuas). O caso final segura o `saveAtlas` do retrato REAL para que a corrida perdedora seja
// a única que este teste executa.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { pauseStoreWrites, STORE_RECOVERY_NOTICE } from '../../src/js/store/write-coordinator.js';
import { StoreErrorEvents, setStoreErrorEventBus } from '../../src/js/store/store-errors.js';
import {
    setBaseLayer,
    updateMapPosition,
    clearMapPosition,
    setMapDependencies
} from '../../src/js/store/map.operations.js';
import { applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { enabled: true }, osm: { enabled: true } },
        getValidBasemapFallback: () => 'carta-topografica'
    }
}));

let mapa;
let bloqueios;

beforeEach(async () => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    });
    activateScope(remoteScope(crypto.randomUUID()));
    setRepository(new LocalRepository(getActiveScope()));
    enableOperationLogging();
    setRemoteHandlerEventBus({ emit: vi.fn() });

    bloqueios = [];
    setStoreErrorEventBus({
        emit: (type, payload) => {
            if (type === StoreErrorEvents.STORE_OPERATION_BLOCKED) bloqueios.push(payload);
        }
    });

    setMapDependencies({
        eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
        layerManager: { loadLayersToMemory: vi.fn(async () => {}), clearLayersCache: vi.fn() }
    });

    mapa = { id: crypto.randomUUID(), name: 'Operações', features: {}, baseLayer: 'carta-topografica' };
    await localRepository.saveMap(mapa.id, mapa);
    mapResolver.registerMap(mapa.name, mapa.id);
    memoryStore.currentMap = mapa.name;
    memoryStore.lockedMaps.clear();
});

/** O retrato mínimo que `applyRemoteSnapshot` aceita para este escopo. */
const retrato = () => ({
    atlas: { ...createAtlas('Atlas'), id: getActiveScope().atlasId },
    maps: [mapa],
    briefings: [],
    currentVersion: 1
});

describe('gravação de configuração de mapa durante uma recuperação', () => {
    it('as três recusam sem lançar, anunciam o estado e não gravam nada', async () => {
        const persist = vi.spyOn(LocalRepository.prototype, 'saveMap');
        const pausa = pauseStoreWrites(getActiveScope());

        // A prova é o `resolves`: até este conserto as três REJEITAVAM, e é a rejeição que
        // derrubava a abertura do atlas.
        await expect(setBaseLayer('osm', mapa.name)).resolves.toBeUndefined();
        await expect(updateMapPosition(-22.9, -43.17, 12, 0, 0, mapa.name)).resolves.toBeUndefined();
        await expect(clearMapPosition(mapa.name)).resolves.toBeUndefined();

        pausa.resume();

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect((await localRepository.getMap(mapa.id)).baseLayer).toBe('carta-topografica');

        // A recusa FALA, e a frase nomeia o ESTADO, nunca o papel.
        expect(bloqueios.map(b => b.operation))
            .toEqual(['setBaseLayer', 'updateMapPosition', 'clearMapPosition']);
        expect(new Set(bloqueios.map(b => b.reason))).toEqual(new Set([STORE_RECOVERY_NOTICE]));
    });

    it('terminada a recuperação, a mesma chamada grava', async () => {
        // O CONTROLE do caso acima: sem ele, "não gravou" seria indistinguível de uma função que
        // parou de gravar em qualquer circunstância.
        const pausa = pauseStoreWrites(getActiveScope());
        await setBaseLayer('osm', mapa.name);
        pausa.resume();

        await setBaseLayer('osm', mapa.name);

        expect((await localRepository.getMap(mapa.id)).baseLayer).toBe('osm');
        expect((await operationQueue.getAll()).map(op => op.entityType)).toEqual(['baseLayer']);
        expect(bloqueios).toHaveLength(1);
    });

    it('o retrato EM VOO não derruba a gravação do mapa-base que a pintura faz', async () => {
        // A corrida real, tornada determinística: o retrato de verdade toma a pausa e fica preso
        // no `saveAtlas` da preparação enquanto a pintura chama `setBaseLayer`.
        const originalSaveAtlas = LocalRepository.prototype.saveAtlas;
        let liberar;
        let chegou;
        const preso = new Promise(resolve => { liberar = resolve; });
        const preparando = new Promise(resolve => { chegou = resolve; });
        vi.spyOn(LocalRepository.prototype, 'saveAtlas').mockImplementationOnce(async function (atlas) {
            chegou();
            await preso;
            return originalSaveAtlas.call(this, atlas);
        });

        const recuperacao = applyRemoteSnapshot(retrato());
        await preparando;

        await expect(setBaseLayer('osm', mapa.name)).resolves.toBeUndefined();

        liberar();
        await recuperacao;

        expect(bloqueios.map(b => b.operation)).toEqual(['setBaseLayer']);
        // O documento é o do SERVIDOR: a preferência recusada não deixou meia gravação para trás.
        expect((await localRepository.getMap(mapa.id)).baseLayer).toBe('carta-topografica');
        expect(await operationQueue.count()).toBe(0);
    });

    it('erro que NÃO é a recusa de recuperação continua subindo', async () => {
        // O alcance do catch é estreito de propósito: um erro que não é a recusa de recuperação
        // continua reprovando. O exemplo era o mapa remoto sem identidade, que ESTOURAVA até
        // 2026-09-21; ele passou a ser recusa com voz (`map_missing`), então o erro que sobe aqui é
        // outro, a quota do disco na gravação do documento.
        vi.spyOn(LocalRepository.prototype, 'saveMap')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
        await expect(setBaseLayer('osm', mapa.id)).rejects.toThrow('quota');
        expect(bloqueios).toHaveLength(0);
    });

    it('mapa remoto inexistente é RECUSA COM VOZ, e não erro que sobe', async () => {
        await expect(setBaseLayer('osm', crypto.randomUUID())).resolves.toBeUndefined();
        expect(bloqueios.map(b => `${b.operation}:${b.reason}`)).toEqual(['setBaseLayer:map_missing']);
        expect(await operationQueue.count()).toBe(0);
    });
});
