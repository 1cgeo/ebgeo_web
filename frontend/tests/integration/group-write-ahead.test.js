// Path: tests/integration/group-write-ahead.test.js
//
// O diário de TODAS as entradas de grupo migradas no bloco B4 (`createGroup`,
// `updateGroupProperty`, `ungroupFeatures`, `combineGroups` e `removeFeatureFromAllGroups`),
// contra o despachante REAL e o IndexedDB REAL. Molde:
// tests/integration/catalog-write-ahead.test.js.
//
// QUATRO PROPRIEDADES SÃO PRÓPRIAS DESTE ARQUIVO, e nenhuma delas existia antes:
//
//  1. A escrita saiu do `setTimeout(0)`. `_saveGroupsToDBAsync` agendava a gravação para um
//     tick futuro com um `catch` que só logava, então a edição já estava na tela e na memória
//     quando o disco falhava, sem ninguém avisado. Agora a gravação está DENTRO da transação,
//     e a memória só muda depois que ela confirma.
//  2. `ungroupFeatures` registra o `group` DELETE e NADA de membresia. O servidor soft-deleta
//     a linha e remonta membro só de grupo vivo, então uma op `group_feature` por membro seria
//     trabalho sem efeito dos dois lados.
//  3. `combineGroups` declara M + 1 + N intenções numa transação só, NESSA ordem (os deletes dos
//     dissolvidos, o create do resultado, a membresia dele), e uma gravação recusada deixa os M
//     antigos VIVOS. O caminho antigo mutava o metadado deles em memória antes de qualquer coisa
//     ser durável, então a pessoa via um grupo combinado enquanto o disco guardava dois.
//  4. `removeFeatureFromAllGroups` NÃO abre transação: ela recebe a do pai, registra a intenção
//     durante o PREPARO e devolve a gravação do documento para o pai encadear. Duas chamadas na
//     MESMA transação compõem, pela sobreposição por transação, que é a forma que a exclusão de
//     uma camada inteira produz (uma chamada por feição).

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { createGroupManager } from '../../src/js/tool_manager/group_manager.js';
import { createSyncMetadata } from '../../src/js/store/sync/sync-metadata.js';
import { runTransaction } from '../../src/js/store/store-transaction.js';

let mapB;
let gm;

/** Seeds one live group with three members straight into the cache, as a snapshot would. */
function seedGroup(id = 'g1') {
    memoryStore.groups[mapB.name] = {
        [id]: {
            id,
            name: 'Grupo 1',
            features: [
                { type: 'point', id: 'f1' },
                { type: 'point', id: 'f2' },
                { type: 'point', id: 'f3' }
            ],
            visible: true,
            locked: false,
            sync: createSyncMetadata(null)
        }
    };
    return memoryStore.groups[mapB.name][id];
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
    mapB = { id: crypto.randomUUID(), name: 'Destino', features: {} };
    await localRepository.saveMap(mapB.id, mapB);
    mapResolver.registerMap(mapB.name, mapB.id);
    memoryStore.currentMap = mapB.name;
    memoryStore.groups = {};
    gm = createGroupManager({ emit: vi.fn() });
});

/** @param {string} id @returns {Object} A minimal point feature, as the selection hands it over. */
const pt = (id) => ({ properties: { id, source: 'point' } });

/**
 * Drives one or more removals inside ONE transaction, exactly as the feature-delete callers do:
 * the intentions are recorded during PREPARE and the groups write is chained onto the parent's
 * persistence function.
 *
 * @param {Array<[string, string]>} pares - `[sourceType, featureId]` pairs, in call order
 * @returns {Promise<void>}
 */
async function removerNaTransacaoDoPai(pares) {
    await runTransaction(async (tx) => {
        let persistGroups = null;
        for (const [type, featureId] of pares) {
            persistGroups = gm.removeFeatureFromAllGroups(tx, type, featureId, mapB.name) ?? persistGroups;
        }
        return async () => { await persistGroups?.(); };
    });
}

describe('Group write-ahead persistence', () => {
    it('criar registra o GRUPO e um membro por feição, nessa ordem, antes de gravar', async () => {
        memoryStore.groups[mapB.name] = {};
        const original = LocalRepository.prototype.saveGroups;
        let filaNaGravacao = null;
        vi.spyOn(LocalRepository.prototype, 'saveGroups').mockImplementation(async function (key, value) {
            filaNaGravacao = await operationQueue.getAll();
            // Nenhuma das quatro é enviável ainda: a marca de materialização só cai depois desta
            // gravação, e é ela que `peek` respeita.
            expect(await operationQueue.peek()).toEqual([]);
            expect(memoryStore.groups[mapB.name]).toEqual({});
            return original.call(this, key, value);
        });

        const grupo = await gm.createGroup([pt('f1'), pt('f2'), pt('f3')], mapB.name);

        // 1 grupo + 3 membresias, e a do grupo é a PRIMEIRA. A ordem é contrato: o INSERT da
        // tabela de junção é gateado por EXISTS sobre a linha do grupo, então a membresia que
        // chega antes escreve ZERO linhas e volta acked como sucesso.
        expect(filaNaGravacao).toHaveLength(4);
        expect(filaNaGravacao.map(op => op.entityType))
            .toEqual(['group', 'group_feature', 'group_feature', 'group_feature']);
        expect(filaNaGravacao.every(op => op.operationType === 'create')).toBe(true);
        expect(filaNaGravacao.every(op => op.mapId === mapB.id)).toBe(true);
        expect(filaNaGravacao[0].entityId).toBe(grupo.id);
        expect(filaNaGravacao[0].data.features.map(m => m.id)).toEqual(['f1', 'f2', 'f3']);

        // O id de cada membresia é DESCARTÁVEL e único: `operations.entity_id` é coluna UUID
        // (chave composta está fora) e a compactação agrupa por entidade mantendo UMA op, então
        // reusar o id do GRUPO colapsaria as três numa só.
        const membros = filaNaGravacao.slice(1);
        expect(new Set(membros.map(op => op.entityId)).size).toBe(3);
        expect(membros.some(op => op.entityId === grupo.id)).toBe(false);
        expect(membros.map(op => op.data)).toEqual([
            { group_id: grupo.id, feature_id: 'f1', feature_type: 'point' },
            { group_id: grupo.id, feature_id: 'f2', feature_type: 'point' },
            { group_id: grupo.id, feature_id: 'f3', feature_type: 'point' }
        ]);

        expect((await localRepository.getGroups(mapB.id))[grupo.id].name).toBe('Grupo 1');
        expect(gm.getGroupById(grupo.id, mapB.name).features).toHaveLength(3);
        expect(await operationQueue.peek(10)).toHaveLength(4);
    });

    it('criar com gravação recusada preserva as QUATRO intenções e não cria o grupo', async () => {
        memoryStore.groups[mapB.name] = {};
        vi.spyOn(LocalRepository.prototype, 'saveGroups')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(gm.createGroup([pt('f1'), pt('f2'), pt('f3')], mapB.name)).rejects.toThrow('quota');

        // A criação é recuperável INTEIRA: grupo e membresia, ou nada. Metade dela seria um
        // grupo sem membro no servidor, que é o desfecho que a ordem acima existe para evitar.
        expect(await operationQueue.getAll()).toHaveLength(4);
        expect(await operationQueue.peek()).toEqual([]);
        expect(await localRepository.getGroups(mapB.id)).toEqual({});
        expect(memoryStore.groups[mapB.name]).toEqual({});
    });

    it('criar recusa por regra sem registrar intenção nem gravar', async () => {
        seedGroup();
        const persist = vi.spyOn(LocalRepository.prototype, 'saveGroups');

        // A ORDEM das duas recusas é a do código: a de feição já agrupada vem ANTES da contagem,
        // então o caso de "menos de duas" precisa de uma feição solta para chegar até ela.
        await expect(gm.createGroup([pt('solta')], mapB.name)).rejects.toThrow('pelo menos 2');
        // `f1` está no grupo semeado, e é essa a outra recusa.
        await expect(gm.createGroup([pt('f1'), pt('nova')], mapB.name)).rejects.toThrow('já estão agrupadas');

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.getAll()).toEqual([]);
    });

    it('a propriedade registra a intenção no mapa ALVO antes do documento de grupos', async () => {
        seedGroup();
        const original = LocalRepository.prototype.saveGroups;
        let visto = null;
        vi.spyOn(LocalRepository.prototype, 'saveGroups').mockImplementation(async function (key, value) {
            const fila = await operationQueue.getAll();
            expect(fila).toHaveLength(1);
            visto = fila[0];
            expect(visto.entityType).toBe('group');
            expect(visto.operationType).toBe('update');
            expect(visto.mapId).toBe(mapB.id);
            // Enfileirada, porém NÃO enviável: a marca de materialização só cai depois da
            // gravação, e é ela que `peek` respeita.
            expect(await operationQueue.peek()).toEqual([]);
            // A memória ainda mostra o estado ANTIGO: ela é espelho do disco, não da intenção.
            expect(memoryStore.groups[mapB.name].g1.visible).toBe(true);
            return original.call(this, key, value);
        });

        const atualizado = await gm.updateGroupProperty('g1', 'visible', false, mapB.name);

        expect(visto).not.toBeNull();
        expect(atualizado.visible).toBe(false);
        expect((await localRepository.getGroups(mapB.id)).g1.visible).toBe(false);
        expect(memoryStore.groups[mapB.name].g1.visible).toBe(false);
        expect(await operationQueue.peek(10)).toHaveLength(1);
    });

    // A DECLARAÇÃO DE BASE DO GRUPO. O documento vem do snapshot com a revisão confirmada da
    // linha, e a edição local a preserva, então a intenção declara `baseVersion` e o patch nomeia
    // a unidade que mudou. Sem a revisão (grupo que nunca voltou do servidor) ela sai sem base, e
    // as duas metades estão aqui porque só o par prova que a declaração é CONDICIONAL: um
    // envelope que declarasse base sempre inventaria recusa, que é o defeito oposto e o pior.
    it('a propriedade declara a base observada e a unidade mudada', async () => {
        const grupo = seedGroup();
        grupo.confirmedVersion = 12;

        await gm.updateGroupProperty('g1', 'visible', false, mapB.name);

        const [envelope] = await operationQueue.getAll();
        expect(envelope.baseVersion).toBe(12);
        expect(envelope.patch).toEqual([{ op: 'set', path: ['visible'], value: false }]);
        expect((await localRepository.getGroups(mapB.id)).g1.confirmedVersion).toBe(12);
    });

    it('grupo sem revisão confirmada sai SEM base e SEM patch', async () => {
        seedGroup();

        await gm.updateGroupProperty('g1', 'visible', false, mapB.name);

        const [envelope] = await operationQueue.getAll();
        expect(envelope.baseVersion).toBeNull();
        expect(envelope.patch).toBeNull();
    });

    it('desagrupar registra o `group` DELETE e NENHUMA op de membresia', async () => {
        const group = seedGroup();
        const features = await gm.ungroupFeatures('g1', mapB.name);

        expect(features.map(f => f.id)).toEqual(['f1', 'f2', 'f3']);
        const fila = await operationQueue.getAll();
        expect(fila).toHaveLength(1);
        expect(fila[0].entityType).toBe('group');
        expect(fila[0].operationType).toBe('delete');
        expect(fila[0].mapId).toBe(mapB.id);
        expect(fila[0].data).toBeNull();
        // O estado anterior viaja para o undo, com os três membros e ainda vivo.
        expect(fila[0].previousData.features).toHaveLength(3);
        expect(fila[0].previousData.sync.deleted).toBe(false);
        // Soft delete dos dois lados.
        expect((await localRepository.getGroups(mapB.id)).g1.sync.deleted).toBe(true);
        expect(gm.getGroupById('g1', mapB.name)).toBeNull();
        expect(group.sync.deleted, 'o documento anterior não é mutado no lugar').toBe(false);
    });

    it('gravação recusada PRESERVA a intenção e não mexe na memória', async () => {
        seedGroup();
        vi.spyOn(LocalRepository.prototype, 'saveGroups')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(gm.updateGroupProperty('g1', 'locked', true, mapB.name)).rejects.toThrow('quota');

        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(pending[0].data.locked).toBe(true);
        // Preparada e não materializada: o envio não a alcança.
        expect(await operationQueue.peek()).toEqual([]);
        // A metade visível NÃO sobreviveu: nem disco nem memória mudaram. Era exatamente o
        // contrário com `_saveGroupsToDBAsync`, cujo `catch` só escrevia no console.
        expect(await localRepository.getGroups(mapB.id)).toEqual({});
        expect(memoryStore.groups[mapB.name].g1.locked).toBe(false);
    });

    it('falha do diário não muda o documento de grupos nem a memória', async () => {
        seedGroup();
        const persist = vi.spyOn(LocalRepository.prototype, 'saveGroups');

        // Um valor não clonável reprova a escrita na fila, que é a PRIMEIRA das duas.
        await expect(gm.updateGroupProperty('g1', 'style', { ao: () => {} }, mapB.name)).rejects.toThrow();

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect(await localRepository.getGroups(mapB.id)).toEqual({});
        expect(memoryStore.groups[mapB.name].g1.style).toBeUndefined();
    });

    it('grupo ausente ou já dissolvido recusa sem escrever nada', async () => {
        seedGroup();
        await gm.ungroupFeatures('g1', mapB.name);
        await operationQueue.clear();

        await expect(gm.updateGroupProperty('g1', 'visible', false, mapB.name)).rejects.toThrow('não encontrado');
        await expect(gm.ungroupFeatures('fantasma', mapB.name)).rejects.toThrow('não encontrado');
        expect(await operationQueue.count()).toBe(0);
    });

    it('escritas concorrentes no mesmo mapa preservam todas as propriedades', async () => {
        memoryStore.groups[mapB.name] = {};
        for (let i = 0; i < 6; i++) {
            memoryStore.groups[mapB.name][`g${i}`] = {
                id: `g${i}`, name: `Grupo ${i}`, features: [{ type: 'point', id: `f${i}` }],
                visible: true, locked: false, sync: createSyncMetadata(null)
            };
        }

        await Promise.all(Array.from({ length: 6 }, (_, i) =>
            gm.updateGroupProperty(`g${i}`, 'name', `Renomeado ${i}`, mapB.name)));

        const stored = await localRepository.getGroups(mapB.id);
        expect(Object.keys(stored).sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5']);
        expect(Object.values(stored).map(g => g.name).sort())
            .toEqual(Array.from({ length: 6 }, (_, i) => `Renomeado ${i}`));
        expect((await operationQueue.getAll()).map(op => op.mapId)).toEqual(Array.from({ length: 6 }, () => mapB.id));
    });

    it('combinar registra os DELETES, o create e a membresia, nessa ordem, antes de gravar', async () => {
        memoryStore.groups[mapB.name] = {};
        const g1 = await gm.createGroup([pt('a'), pt('b')], mapB.name);
        const g2 = await gm.createGroup([pt('c'), pt('d')], mapB.name);
        await operationQueue.clear();

        const original = LocalRepository.prototype.saveGroups;
        let filaNaGravacao = null;
        vi.spyOn(LocalRepository.prototype, 'saveGroups').mockImplementation(async function (key, value) {
            filaNaGravacao = await operationQueue.getAll();
            // Os dois antigos ainda estão VIVOS na memória enquanto a gravação não confirma.
            expect(memoryStore.groups[mapB.name][g1.id].sync.deleted).toBe(false);
            expect(memoryStore.groups[mapB.name][g2.id].sync.deleted).toBe(false);
            return original.call(this, key, value);
        });

        const combinado = await gm.combineGroups([g1.id, g2.id], [], mapB.name);

        // 2 deletes + 1 create + 4 membresias, NESSA ordem. A membresia depois do create porque o
        // INSERT da junção é gateado por EXISTS sobre a linha do grupo; os deletes antes para que
        // o servidor nunca guarde a mesma feição em dois grupos vivos.
        expect(filaNaGravacao.map(op => `${op.entityType}:${op.operationType}`)).toEqual([
            'group:delete', 'group:delete', 'group:create',
            'group_feature:create', 'group_feature:create',
            'group_feature:create', 'group_feature:create'
        ]);
        expect(filaNaGravacao.slice(0, 2).map(op => op.entityId).sort()).toEqual([g1.id, g2.id].sort());
        expect(filaNaGravacao[2].entityId).toBe(combinado.id);
        expect(filaNaGravacao.slice(3).map(op => op.data.feature_id).sort()).toEqual(['a', 'b', 'c', 'd']);
        expect(filaNaGravacao.slice(3).every(op => op.data.group_id === combinado.id)).toBe(true);
        // O id de cada membresia é descartável e único, pela mesma razão de `createGroup`.
        expect(new Set(filaNaGravacao.slice(3).map(op => op.entityId)).size).toBe(4);
        expect(filaNaGravacao.every(op => op.mapId === mapB.id)).toBe(true);

        const gravados = await localRepository.getGroups(mapB.id);
        expect(gravados[g1.id].sync.deleted).toBe(true);
        expect(gravados[g2.id].sync.deleted).toBe(true);
        expect(gravados[combinado.id].features.map(m => m.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(gm.getGroupById(combinado.id, mapB.name)).toBeTruthy();
    });

    it('combinar com gravação recusada NÃO dissolve os grupos antigos e preserva as intenções', async () => {
        memoryStore.groups[mapB.name] = {};
        const g1 = await gm.createGroup([pt('a'), pt('b')], mapB.name);
        const g2 = await gm.createGroup([pt('c'), pt('d')], mapB.name);
        await operationQueue.clear();
        vi.spyOn(LocalRepository.prototype, 'saveGroups')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(gm.combineGroups([g1.id, g2.id], [], mapB.name)).rejects.toThrow('quota');

        expect(await operationQueue.getAll()).toHaveLength(7);
        expect(await operationQueue.peek()).toEqual([]);
        // O CONTRÁRIO do caminho antigo, que mutava `sync` dos antigos em memória antes de
        // qualquer coisa ser durável: a pessoa via um grupo combinado e o disco guardava dois.
        expect(memoryStore.groups[mapB.name][g1.id].sync.deleted).toBe(false);
        expect(memoryStore.groups[mapB.name][g2.id].sync.deleted).toBe(false);
        expect(Object.keys(memoryStore.groups[mapB.name]).sort()).toEqual([g1.id, g2.id].sort());
    });

    it('a saída de um membro viaja na transação do PAI, antes de o documento ser gravado', async () => {
        const group = seedGroup();
        const original = LocalRepository.prototype.saveGroups;
        let filaNaGravacao = null;
        vi.spyOn(LocalRepository.prototype, 'saveGroups').mockImplementation(async function (key, value) {
            filaNaGravacao = await operationQueue.getAll();
            // A memória ainda tem os três: ela é espelho do disco, não da intenção.
            expect(memoryStore.groups[mapB.name].g1.features).toHaveLength(3);
            return original.call(this, key, value);
        });

        await removerNaTransacaoDoPai([['point', 'f2']]);

        expect(filaNaGravacao).toHaveLength(1);
        expect(filaNaGravacao[0].entityType).toBe('group_feature');
        expect(filaNaGravacao[0].operationType).toBe('delete');
        expect(filaNaGravacao[0].mapId).toBe(mapB.id);
        expect(filaNaGravacao[0].data)
            .toEqual({ group_id: 'g1', feature_id: 'f2', feature_type: 'point' });
        // O id da op é descartável: nunca o do grupo, senão a compactação colapsaria remoções.
        expect(filaNaGravacao[0].entityId).not.toBe('g1');

        expect((await localRepository.getGroups(mapB.id)).g1.features.map(m => m.id))
            .toEqual(['f1', 'f3']);
        expect(gm.getGroupById('g1', mapB.name).features.map(m => m.id)).toEqual(['f1', 'f3']);
        expect(group.features, 'o documento anterior não é mutado no lugar').toHaveLength(3);
    });

    it('DUAS saídas na MESMA transação compõem: o segundo dissolve o grupo e o documento tem as duas', async () => {
        // O caso que a sobreposição por transação existe para prender. A memória só muda depois da
        // gravação, então sem ela a segunda chamada leria o documento de três membros outra vez e
        // gravaria um grupo que perdeu SÓ a segunda feição, em silêncio. É a forma que a exclusão
        // de uma camada inteira produz: uma chamada por feição, uma transação só.
        seedGroup();

        await removerNaTransacaoDoPai([['point', 'f1'], ['point', 'f2']]);

        const fila = await operationQueue.getAll();
        expect(fila.map(op => `${op.entityType}:${op.operationType}`))
            .toEqual(['group_feature:delete', 'group_feature:delete', 'group:delete']);
        expect(fila.slice(0, 2).map(op => op.data.feature_id)).toEqual(['f1', 'f2']);
        // O `group` DELETE nasce da SEGUNDA remoção, quando o grupo cai a um membro.
        expect(fila[2].entityId).toBe('g1');
        expect(fila[2].previousData.features.map(m => m.id)).toEqual(['f2', 'f3']);

        const gravado = (await localRepository.getGroups(mapB.id)).g1;
        expect(gravado.features.map(m => m.id)).toEqual(['f3']);
        expect(gravado.sync.deleted).toBe(true);
        expect(gm.getGroupById('g1', mapB.name)).toBeNull();
    });

    it('saída de membro com gravação recusada preserva a intenção e não mexe na memória', async () => {
        seedGroup();
        vi.spyOn(LocalRepository.prototype, 'saveGroups')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(removerNaTransacaoDoPai([['point', 'f2']])).rejects.toThrow('quota');

        expect(await operationQueue.getAll()).toHaveLength(1);
        expect(await operationQueue.peek()).toEqual([]);
        expect(await localRepository.getGroups(mapB.id)).toEqual({});
        expect(memoryStore.groups[mapB.name].g1.features).toHaveLength(3);
    });

    it('troca de escopo durante a transação não escreve em nenhum dos dois atlas', async () => {
        seedGroup();
        const source = getActiveScope();
        let release;
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        // O ponto de espera é a escrita do DIÁRIO: é ela que abre a janela entre o preparo e a
        // gravação da entidade, que é onde o atlas pode ser desmontado. O espião vai no
        // PROTÓTIPO, e não no singleton: `persistOperationIntents` trabalha sobre
        // `operationQueue.forScope(scope)`, que devolve uma instância NOVA, então um espião no
        // singleton nunca é chamado e o caso passaria verde medindo uma transação inteira que
        // nunca foi interrompida (foi o que aconteceu na primeira versão deste caso).
        vi.spyOn(Object.getPrototypeOf(operationQueue), 'enqueueAll').mockImplementationOnce(async () => {
            entered();
            await gate;
        });

        const write = gm.updateGroupProperty('g1', 'visible', false, mapB.name);
        const rejected = expect(write).rejects.toThrow('atlas mudou');
        await reading;
        activateScope(remoteScope(crypto.randomUUID()));
        release();
        await rejected;

        expect(await operationQueue.forScope(source).getAll()).toEqual([]);
        expect(await localRepository.forScope(source).getGroups(mapB.id)).toEqual({});
        expect(memoryStore.groups[mapB.name].g1.visible).toBe(true);
    });
});
