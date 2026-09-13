// Path: tests/integration/layer-write-ahead.test.js
//
// O diário das três entradas de camada migradas no bloco B4 (`_createLayerInternal`,
// `_updateLayerProperty` e `reorderLayers`), contra o despachante REAL e o IndexedDB REAL.
// Molde: tests/integration/group-write-ahead.test.js.
//
// TRÊS PROPRIEDADES SÃO PRÓPRIAS DESTE ARQUIVO, e nenhuma existia antes:
//
//  1. A ESCRITA SAIU DO DEBOUNCE. `_persistLayersAsync` adiava a gravação em 300 ms por
//     `DebouncedPersist`, então a camada já estava na memória e na tela quando o disco falhava,
//     e o `onError` do debounce só chegava depois de três tentativas. Agora a gravação está
//     DENTRO da transação e a memória só muda depois que ela confirma.
//  2. O DEBOUNCE AINDA EXISTE, e é por isso que ele é DRENADO. `deleteLayer` e `setActiveLayer`
//     continuam no caminho antigo e escrevem o MESMO documento; uma escrita pendente carrega um
//     instantâneo da memória anterior a esta edição, e se ela disparasse depois da gravação
//     direta desfaria a edição em silêncio. O caso "o debounce pendente não desfaz" é o único
//     que mediria a diferença entre drenar e não drenar.
//  3. A TRAVA É A CHAVE LATERAL 'layers', nunca `map:<id>`. Dois chamadores criam camada de
//     DENTRO de uma seção de `withMapDocument` do mesmo mapa (o composto de mover feições e a
//     importação), e a fila de `document-lock.js` é FIFO e sem reentrância: compartilhar a chave
//     do mapa travaria a interface para sempre. O caso da seção aninhada prova isso por
//     CONCLUSÃO, e não por leitura de código.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { withMapDocument } from '../../src/js/store/document-lock.js';
import { createLayerManager } from '../../src/js/layers/layer.manager.js';

let mapa;
let lm;

/** Seeds the in-memory cache with layers, as a snapshot would. */
function semear(...camadas) {
    memoryStore.layers[mapa.name] = new Map(camadas.map((l) => [l.id, l]));
    return camadas;
}

/**
 * A layer record with the five fields the manager writes.
 * @param {string} id
 * @param {number} order
 * @param {Object} [extra]
 * @returns {Object}
 */
function camada(id, order, extra = {}) {
    return {
        id, name: `Camada ${id}`, visible: true, locked: false, opacity: 1, order,
        createdAt: 1, updatedAt: 1, version: 1, ...extra
    };
}

beforeEach(async () => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    });
    activateScope(remoteScope(crypto.randomUUID()));
    // A bound repository keeps the fault injection on the method actually used by the producer.
    setRepository(new LocalRepository(getActiveScope()));
    enableOperationLogging();
    mapa = { id: crypto.randomUUID(), name: 'Destino', features: {} };
    await localRepository.saveMap(mapa.id, mapa);
    mapResolver.registerMap(mapa.name, mapa.id);
    memoryStore.currentMap = mapa.name;
    memoryStore.layers = {};
    memoryStore.activeLayerId = null;
    lm = createLayerManager({ emit: vi.fn() });
});

describe('Layer write-ahead persistence', () => {
    it('criar registra a intenção no mapa ALVO antes do documento de camadas', async () => {
        semear(camada('l1', 0));
        const original = LocalRepository.prototype.saveLayers;
        let visto = null;
        vi.spyOn(LocalRepository.prototype, 'saveLayers').mockImplementation(async function (key, value) {
            const fila = await operationQueue.getAll();
            expect(fila).toHaveLength(1);
            visto = fila[0];
            expect(visto.entityType).toBe('layer');
            expect(visto.operationType).toBe('create');
            expect(visto.mapId).toBe(mapa.id);
            // Enfileirada, porém NÃO enviável: a marca de materialização só cai depois da
            // gravação, e é ela que `peek` respeita.
            expect(await operationQueue.peek()).toEqual([]);
            // A memória ainda mostra o estado ANTIGO: ela é espelho do disco, não da intenção.
            expect(memoryStore.layers[mapa.name].size).toBe(1);
            return original.call(this, key, value);
        });

        const nova = await lm.createLayer('Alfa', mapa.name);

        expect(visto).not.toBeNull();
        expect(visto.entityId).toBe(nova.id);
        expect(nova.name).toBe('Alfa');
        const disco = await localRepository.getLayers(mapa.id);
        expect(disco.map(l => l.id)).toEqual(['l1', nova.id]);
        expect(memoryStore.layers[mapa.name].get(nova.id).name).toBe('Alfa');
        expect(await operationQueue.peek(10)).toHaveLength(1);
    });

    it('renomear registra UMA intenção com o estado anterior e grava o documento inteiro', async () => {
        semear(camada('l1', 0), camada('l2', 1));

        const renomeada = await lm.renameLayer('l2', 'Batalhão', mapa.name);

        expect(renomeada.name).toBe('Batalhão');
        expect(renomeada.version).toBe(2);
        const fila = await operationQueue.getAll();
        expect(fila).toHaveLength(1);
        expect(fila[0].operationType).toBe('update');
        expect(fila[0].entityId).toBe('l2');
        expect(fila[0].data.name).toBe('Batalhão');
        expect(fila[0].previousData.name).toBe('Camada l2');
        const disco = await localRepository.getLayers(mapa.id);
        expect(disco.map(l => l.name)).toEqual(['Camada l1', 'Batalhão']);
    });

    it('reordenar registra UMA intenção por camada que MUDOU, numa transação só', async () => {
        semear(camada('l1', 0), camada('l2', 1), camada('l3', 2));

        let gravacoes = 0;
        const original = LocalRepository.prototype.saveLayers;
        vi.spyOn(LocalRepository.prototype, 'saveLayers').mockImplementation(async function (key, value) {
            gravacoes++;
            // As DUAS intenções antecedem a ÚNICA gravação: é isso que faz a nova pilha ser
            // recuperável inteira ou não ter acontecido.
            expect(await operationQueue.getAll()).toHaveLength(2);
            return original.call(this, key, value);
        });

        await lm.reorderLayers(['l3', 'l2', 'l1'], mapa.name);

        expect(gravacoes).toBe(1);
        const fila = await operationQueue.getAll();
        expect(fila.map(op => op.entityId).sort()).toEqual(['l1', 'l3']);
        expect(fila.every(op => op.operationType === 'update')).toBe(true);
        const disco = await localRepository.getLayers(mapa.id);
        expect(disco.map(l => [l.id, l.order])).toEqual([['l1', 2], ['l2', 1], ['l3', 0]]);
        expect(lm.getLayers(mapa.name).map(l => l.id)).toEqual(['l3', 'l2', 'l1']);
    });

    it('reordenar para a MESMA ordem não registra intenção nem grava', async () => {
        semear(camada('l1', 0), camada('l2', 1));
        const persist = vi.spyOn(LocalRepository.prototype, 'saveLayers');

        await lm.reorderLayers(['l1', 'l2'], mapa.name);

        expect(await operationQueue.getAll()).toEqual([]);
        expect(persist).not.toHaveBeenCalled();
    });

    it('gravação recusada PRESERVA a intenção e não mexe na memória', async () => {
        semear(camada('l1', 0));
        vi.spyOn(LocalRepository.prototype, 'saveLayers')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(lm.setLayerVisibility('l1', false, mapa.name)).rejects.toThrow('quota');

        const pendentes = await operationQueue.getAll();
        expect(pendentes).toHaveLength(1);
        expect(pendentes[0].data.visible).toBe(false);
        // Preparada e não materializada: o envio não a alcança.
        expect(await operationQueue.peek()).toEqual([]);
        // A metade visível NÃO sobreviveu: nem disco nem memória mudaram. Era exatamente o
        // contrário com o debounce, cujo `onError` chegava três tentativas depois.
        expect(await localRepository.getLayers(mapa.id)).toEqual([]);
        expect(memoryStore.layers[mapa.name].get('l1').visible).toBe(true);
    });

    it('falha do diário não cria a camada nem no disco nem na memória', async () => {
        semear(camada('l1', 0));
        const persist = vi.spyOn(LocalRepository.prototype, 'saveLayers');

        // Um valor não clonável reprova a escrita na fila, que é a PRIMEIRA das duas.
        await expect(lm.setLayerLocked('l1', { ao: () => {} }, mapa.name)).rejects.toThrow();

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.getAll()).toEqual([]);
        expect(await localRepository.getLayers(mapa.id)).toEqual([]);
        expect(memoryStore.layers[mapa.name].get('l1').locked).toBe(false);
    });

    it('camada ausente recusa sem escrever nada', async () => {
        semear(camada('l1', 0));
        const persist = vi.spyOn(LocalRepository.prototype, 'saveLayers');

        await expect(lm.renameLayer('fantasma', 'X', mapa.name)).rejects.toThrow('not found');

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.getAll()).toEqual([]);
    });

    it('O DEBOUNCE PENDENTE NÃO DESFAZ a gravação direta, porque ele é DRENADO na trava', async () => {
        // `deleteLayer` continua no caminho antigo: ele muda a memória e AGENDA a escrita.
        semear(camada('l1', 0), camada('l2', 1));
        await localRepository.saveLayers(mapa.id, [camada('l1', 0), camada('l2', 1)]);
        lm.deleteLayer('l2', mapa.name);

        const original = LocalRepository.prototype.saveLayers;
        let forcou = false;
        vi.spyOn(LocalRepository.prototype, 'saveLayers').mockImplementation(async function (key, value) {
            const escrito = await original.call(this, key, value);
            // SÓ depois da gravação da CRIAÇÃO, reconhecida pelo conteúdo. A gravação do próprio
            // dreno não serve de gatilho, e não por elegância: `DebouncedPersist.flush` devolve a
            // promessa em voo quando já há uma, então disparar a represa de dentro dela seria
            // esperar por si mesma (a primeira versão deste caso travou por 5 s exatamente aí).
            if (forcou || !value.some((l) => l.name === 'Alfa')) return escrito;
            // O INSTANTE PERDEDOR, FORÇADO em vez de esperado. A escrita represada só desfaz a
            // criação se disparar DEPOIS da gravação direta e ANTES de `deferSync` pôr a camada
            // nova na memória, porque é dessa memória que ela tira o documento. Esperar pelos
            // 300 ms do temporizador mediria estatística de agendador; disparar a represa aqui
            // torna a interleaving determinística. COM o dreno não há nada represado e esta
            // linha é um no-op; SEM ele, ela apaga a camada recém-criada, e é essa a diferença
            // que este caso existe para medir.
            forcou = true;
            await lm._layersPersist.flush(mapa.name);
            return escrito;
        });

        const nova = await lm.createLayer('Alfa', mapa.name);

        expect(forcou, 'a represa foi exercitada no instante perdedor').toBe(true);
        const disco = await localRepository.getLayers(mapa.id);
        expect(disco.map(l => l.id)).toEqual(['l1', nova.id]);
        // As duas metades estão no disco: a exclusão (que o dreno persistiu) e a criação.
        expect(disco.some(l => l.id === 'l2')).toBe(false);
    });

    it('a trava é a chave LATERAL, então criar camada de dentro de uma seção do mapa não trava', async () => {
        // Este é o caso real de `buildLayerMappingForMove` e da importação: as duas criam camada
        // no destino de dentro de uma seção de `withMapDocument` do MESMO mapa. Se a criação
        // tomasse `map:<id>`, ela esperaria pela seção que a chamou, para sempre, e este caso
        // estouraria por tempo em vez de reprovar.
        semear(camada('l1', 0));

        const nova = await withMapDocument(mapa.name, 'teste:secao-do-mapa', async () =>
            lm.createLayerForImport('Importada', mapa.name));

        expect(nova.name).toBe('Importada');
        expect((await localRepository.getLayers(mapa.id)).map(l => l.id)).toEqual(['l1', nova.id]);
    }, 5000);

    it('escritas concorrentes no mesmo mapa preservam todas as camadas', async () => {
        semear(...Array.from({ length: 6 }, (_, i) => camada(`l${i}`, i)));

        await Promise.all(Array.from({ length: 6 }, (_, i) =>
            lm.renameLayer(`l${i}`, `Renomeada ${i}`, mapa.name)));

        const disco = await localRepository.getLayers(mapa.id);
        expect(disco.map(l => l.name).sort())
            .toEqual(Array.from({ length: 6 }, (_, i) => `Renomeada ${i}`).sort());
        expect((await operationQueue.getAll()).map(op => op.mapId))
            .toEqual(Array.from({ length: 6 }, () => mapa.id));
    });

    it('troca de escopo durante a transação não escreve em nenhum dos dois atlas', async () => {
        semear(camada('l1', 0));
        const origem = getActiveScope();
        let libera;
        let entrou;
        const lendo = new Promise(resolve => { entrou = resolve; });
        const portao = new Promise(resolve => { libera = resolve; });
        // O ponto de espera é a escrita do DIÁRIO: é ela que abre a janela entre o preparo e a
        // gravação da entidade. O espião vai no PROTÓTIPO, e não no singleton:
        // `persistOperationIntents` trabalha sobre `operationQueue.forScope(scope)`, que devolve
        // uma instância NOVA, então um espião no singleton nunca seria chamado e o caso passaria
        // verde medindo uma transação que nunca foi interrompida.
        vi.spyOn(Object.getPrototypeOf(operationQueue), 'enqueueAll').mockImplementationOnce(async () => {
            entrou();
            await portao;
        });

        const escrita = lm.renameLayer('l1', 'Nome novo', mapa.name);
        const rejeitada = expect(escrita).rejects.toThrow('atlas mudou');
        await lendo;
        activateScope(remoteScope(crypto.randomUUID()));
        libera();
        await rejeitada;

        expect(await operationQueue.forScope(origem).getAll()).toEqual([]);
        expect(await localRepository.forScope(origem).getLayers(mapa.id)).toEqual([]);
        expect(memoryStore.layers[mapa.name].get('l1').name).toBe('Camada l1');
    });
});
