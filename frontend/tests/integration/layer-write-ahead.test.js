// Path: tests/integration/layer-write-ahead.test.js
//
// O diário de TODAS as entradas de camada migradas no bloco B4 (`_createLayerInternal`,
// `_updateLayerProperty`, `reorderLayers` e `deleteLayer`), contra o despachante REAL e o
// IndexedDB REAL. Molde: tests/integration/group-write-ahead.test.js.
//
// QUATRO PROPRIEDADES SÃO PRÓPRIAS DESTE ARQUIVO, e nenhuma existia antes:
//
//  1. A ESCRITA SAIU DO DEBOUNCE. A gravação era adiada em 300 ms por `DebouncedPersist`, então a
//     camada já estava na memória e na tela quando o disco falhava, e o `onError` do debounce só
//     chegava depois de três tentativas. Agora a gravação está DENTRO da transação e a memória só
//     muda depois que ela confirma.
//  2. O DEBOUNCE DO DOCUMENTO DE CAMADAS DEIXOU DE EXISTIR, e com ele o dreno. Ele existia porque
//     `deleteLayer` ainda agendava uma escrita carregando um instantâneo anterior da memória, que
//     disparando depois da gravação direta desfaria a edição em silêncio. Com a exclusão migrada há
//     UM escritor, e o caso que media o dreno virou o caso que afirma a ausência do agendador.
//  3. A TRAVA É A CHAVE LATERAL 'layers', nunca `map:<id>`. Dois chamadores criam camada de
//     DENTRO de uma seção de `withMapDocument` do mesmo mapa (o composto de mover feições e a
//     importação), e a fila de `document-lock.js` é FIFO e sem reentrância: compartilhar a chave
//     do mapa travaria a interface para sempre. O caso da seção aninhada prova isso por
//     CONCLUSÃO, e não por leitura de código. É a MESMA razão pela qual a exclusão das feições da
//     camada continua numa seção separada, antes desta: a ordem inversa (segurar 'layers' e pedir
//     'map') fecharia o ciclo.
//  4. A SUBSTITUTA DA ÚLTIMA CAMADA É ASSUNTO LOCAL. Em atlas de servidor ela não é criada aqui: o
//     servidor a cria e o ack a devolve em `replacementLayers`. Em atlas local ela é intenção
//     própria, na mesma transação do DELETE.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, localScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
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

    // A REVISÃO CONFIRMADA ATRAVESSA A EDIÇÃO LOCAL, e é isso que dá base à SEGUNDA edição.
    // `_updateLayerProperty` monta a camada nova espalhando a antiga, então o campo sobrevive de
    // graça; o caso existe porque "de graça" é exatamente o tipo de propriedade que uma reescrita
    // do construtor apaga sem nada ficar vermelho. Sem ela a segunda edição sai sem base e o
    // servidor volta a aplicar por ordem de chegada.
    it('editar duas vezes seguidas PRESERVA a revisão confirmada no documento e na intenção', async () => {
        semear(camada('l1', 0, { confirmedVersion: 5 }));

        await lm.renameLayer('l1', 'Primeira', mapa.name);
        await lm.renameLayer('l1', 'Segunda', mapa.name);

        const disco = await localRepository.getLayers(mapa.id);
        expect(disco[0].confirmedVersion).toBe(5);
        // O contador LOCAL de escritas andou duas vezes; a revisão do servidor não se move sem o
        // servidor. São dois números diferentes de propósito.
        expect(disco[0].version).toBe(3);
        const fila = await operationQueue.getAll();
        expect(fila.map(op => op.previousData.confirmedVersion)).toEqual([5, 5]);
        expect(fila.map(op => op.data.confirmedVersion)).toEqual([5, 5]);
        // E as DUAS declaram a base: é isso que liga a verificação por entidade no servidor.
        expect(fila.map(op => op.baseVersion)).toEqual([5, 5]);
        expect(fila.map(op => op.patch)).toEqual([
            [{ op: 'set', path: ['name'], value: 'Primeira' }],
            [{ op: 'set', path: ['name'], value: 'Segunda' }],
        ]);
    });

    // O CONTRÁRIO, e ele é a degradação declarada: camada que nunca voltou do servidor não tem
    // revisão confirmada, a op sai SEM base e o servidor volta a aplicar por ordem de chegada.
    // Sem este caso, "declara a base" passaria verde sobre um envelope que a declara sempre, que
    // é o defeito oposto e o mais caro: base inventada é recusa de escrita que ninguém pediu.
    it('camada sem revisão confirmada sai SEM base e SEM patch', async () => {
        semear(camada('l1', 0));

        await lm.renameLayer('l1', 'Bravo', mapa.name);

        const [envelope] = await operationQueue.getAll();
        expect(envelope.baseVersion).toBeNull();
        expect(envelope.patch).toBeNull();
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

    it('O DOCUMENTO DE CAMADAS TEM UM ÚNICO ESCRITOR: não há mais escrita represada para drenar', async () => {
        // Este caso SUBSTITUI o do dreno do debounce, e a substituição é a mudança de desenho.
        // `deleteLayer` era o último a agendar por `DebouncedPersist`, então existia um instante
        // perdedor (a escrita represada disparando depois da gravação direta, carregando um
        // instantâneo anterior da memória) que o dreno convertia em ordenação comum. Com a exclusão
        // migrada, a represa deixou de existir: quem afirma isso é a ausência do agendador, e
        // reintroduzi-lo sem o dreno traria o defeito de volta em silêncio.
        semear(camada('l1', 0), camada('l2', 1));
        await localRepository.saveLayers(mapa.id, [camada('l1', 0), camada('l2', 1)]);

        expect(lm._persistLayersAsync, 'o agendador do documento de camadas não existe mais')
            .toBeUndefined();
        expect(lm._layersPersist, 'nem a represa dele').toBeUndefined();

        // As duas escritas em sequência, sem dreno nenhum no meio, e o disco tem as duas metades.
        const excluida = await lm.deleteLayer('l2', mapa.name);
        const nova = await lm.createLayer('Alfa', mapa.name);

        expect(excluida.success).toBe(true);
        const disco = await localRepository.getLayers(mapa.id);
        expect(disco.map(l => l.id)).toEqual(['l1', nova.id]);
        expect(disco.some(l => l.id === 'l2')).toBe(false);
    });

    it('excluir registra o `layer` DELETE antes de gravar, e a memória só perde a camada depois', async () => {
        semear(camada('l1', 0), camada('l2', 1));
        await localRepository.saveLayers(mapa.id, [camada('l1', 0), camada('l2', 1)]);
        memoryStore.activeLayerId = 'l1';

        const original = LocalRepository.prototype.saveLayers;
        let filaNaGravacao = null;
        vi.spyOn(LocalRepository.prototype, 'saveLayers').mockImplementation(async function (key, value) {
            filaNaGravacao = await operationQueue.getAll();
            // Enfileirada e NÃO enviável: a marca de materialização cai depois desta gravação.
            expect(await operationQueue.peek()).toEqual([]);
            // A memória ainda tem as duas: ela é espelho do disco, não da intenção.
            expect(memoryStore.layers[mapa.name].has('l2')).toBe(true);
            return original.call(this, key, value);
        });

        const resultado = await lm.deleteLayer('l2', mapa.name);

        expect(resultado).toEqual({ success: true, deletedLayerId: 'l2', createdDefaultLayer: null });
        expect(filaNaGravacao).toHaveLength(1);
        expect(filaNaGravacao[0].entityType).toBe('layer');
        expect(filaNaGravacao[0].operationType).toBe('delete');
        expect(filaNaGravacao[0].entityId).toBe('l2');
        expect(filaNaGravacao[0].mapId).toBe(mapa.id);
        expect(filaNaGravacao[0].data).toBeNull();
        // O estado anterior viaja para o undo.
        expect(filaNaGravacao[0].previousData.name).toBe('Camada l2');
        // NENHUMA op de feição: o servidor cascateia as feições da camada na mesma transação e o
        // par espelha isso em `cascadeRemoteLayerDelete`. Uma op de feição aqui apagaria, por LWW
        // de chegada, a feição que `transferLayerToMap` acabou de mudar de mapa com o mesmo id.
        expect(filaNaGravacao.some(op => op.entityType === 'feature')).toBe(false);

        expect((await localRepository.getLayers(mapa.id)).map(l => l.id)).toEqual(['l1']);
        expect(memoryStore.layers[mapa.name].has('l2')).toBe(false);
        expect(await operationQueue.peek(10)).toHaveLength(1);
    });

    it('excluir a ÚLTIMA camada em atlas de SERVIDOR não cria substituta nenhuma', async () => {
        // O servidor cria a substituta e o ack a devolve em `data.replacementLayers`, então
        // registrar uma criação local aqui produziria DUAS camadas padrão.
        semear(camada('so-esta', 0));
        await localRepository.saveLayers(mapa.id, [camada('so-esta', 0)]);

        const resultado = await lm.deleteLayer('so-esta', mapa.name);

        expect(resultado.createdDefaultLayer).toBeNull();
        const fila = await operationQueue.getAll();
        expect(fila).toHaveLength(1);
        expect(fila[0].operationType).toBe('delete');
        expect(await localRepository.getLayers(mapa.id)).toEqual([]);
        expect(memoryStore.layers[mapa.name].size).toBe(0);
    });

    it('excluir a ÚLTIMA camada em atlas LOCAL registra o DELETE e o CREATE da substituta', async () => {
        activateScope(localScope(crypto.randomUUID(), 'b4d'));
        setRepository(new LocalRepository(getActiveScope()));
        const repo = localRepository.forScope(getActiveScope());
        // O documento do mapa TAMBÉM precisa existir neste escopo: `_resolveMapKey` resolve o nome
        // pelo registro de mapas do escopo ativo, e sem ele as camadas cairiam sob a chave NOME.
        await repo.saveMap(mapa.id, mapa);
        mapResolver.registerMap(mapa.name, mapa.id);
        semear(camada('default', 0, { id: 'default' }));
        await repo.saveLayers(mapa.id, [camada('default', 0)]);

        const resultado = await lm.deleteLayer('default', mapa.name);

        // A substituta nasce com id NOVO quando a excluída era a `default`, senão o documento
        // teria a mesma chave excluída e recriada.
        expect(resultado.createdDefaultLayer.id).not.toBe('default');
        expect(resultado.createdDefaultLayer.name).toBe('Padrão');
        const fila = await operationQueue.forScope(getActiveScope()).getAll();
        expect(fila.map(op => `${op.entityType}:${op.operationType}`)).toEqual(['layer:delete', 'layer:create']);
        expect(fila[1].entityId).toBe(resultado.createdDefaultLayer.id);
        // As duas metades de "a última camada saiu e esta tomou o lugar" são recuperáveis juntas.
        expect((await repo.getLayers(mapa.id)).map(l => l.id)).toEqual([resultado.createdDefaultLayer.id]);
        expect(memoryStore.activeLayerId).toBe(resultado.createdDefaultLayer.id);
    });

    it('excluir a ATIVA quando TODAS as outras estão travadas desbloqueia a que assume, com op', async () => {
        // Caminho raro e real: `_pickActiveLayerOnDelete` só desbloqueia quando não sobra nenhuma
        // destravada. O desbloqueio chegava ao disco e NUNCA a um par, porque nenhuma op o
        // descrevia; agora ele viaja como a edição de propriedade que sempre foi.
        semear(camada('ativa', 0), camada('travada', 1, { locked: true }));
        await localRepository.saveLayers(mapa.id, [camada('ativa', 0), camada('travada', 1, { locked: true })]);
        memoryStore.activeLayerId = 'ativa';

        await lm.deleteLayer('ativa', mapa.name);

        const fila = await operationQueue.getAll();
        expect(fila.map(op => `${op.entityType}:${op.operationType}`)).toEqual(['layer:delete', 'layer:update']);
        expect(fila[1].entityId).toBe('travada');
        expect(fila[1].data.locked).toBe(false);
        expect(fila[1].previousData.locked).toBe(true);
        expect((await localRepository.getLayers(mapa.id))[0].locked).toBe(false);
        expect(memoryStore.activeLayerId).toBe('travada');
    });

    it('excluir com gravação recusada PRESERVA a intenção e não perde a camada', async () => {
        semear(camada('l1', 0), camada('l2', 1));
        await localRepository.saveLayers(mapa.id, [camada('l1', 0), camada('l2', 1)]);
        memoryStore.activeLayerId = 'l2';
        vi.spyOn(LocalRepository.prototype, 'saveLayers')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(lm.deleteLayer('l2', mapa.name)).rejects.toThrow('quota');

        const pendentes = await operationQueue.getAll();
        expect(pendentes).toHaveLength(1);
        expect(pendentes[0].operationType).toBe('delete');
        expect(await operationQueue.peek()).toEqual([]);
        expect((await localRepository.getLayers(mapa.id)).map(l => l.id)).toEqual(['l1', 'l2']);
        expect(memoryStore.layers[mapa.name].has('l2')).toBe(true);
        // A camada ativa não migrou: a troca vive em `tx.deferSync`.
        expect(memoryStore.activeLayerId).toBe('l2');
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
