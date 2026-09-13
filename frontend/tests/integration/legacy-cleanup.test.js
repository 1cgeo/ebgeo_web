// Path: tests/integration/legacy-cleanup.test.js

/**
 * @fileoverview A poda das cópias abandonadas da transição legada (decisão D8 de 2026-09-13).
 *
 * O molde é `legacy-transition.test.js`: IndexedDB real, localforage real, um boot por
 * `vi.resetModules()`. O que estes casos medem que aquele não mede é o DEPOIS: quantas cópias
 * do mesmo acervo sobram no disco quando a atualização é interrompida, e quem tem direito de
 * apagá-las.
 *
 * O controle negativo de cada bloco é a ORIGEM: ela é lida antes e depois de toda varredura e
 * tem de sair idêntica. Uma poda que alcance a origem é a única falha desta família que o
 * usuário não consegue desfazer.
 */

import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { seedDatabase, databaseState, resetIndexedDB } from '../helpers/idb-helpers.js';

beforeEach(async () => { vi.resetModules(); await resetIndexedDB(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetIndexedDB(); });

async function seed(version = '1.7') {
    await seedDatabase('ebgeo_app_settings', { schemaVersion: version, lastActiveMap: 'Antigo' });
    await seedDatabase('ebgeo_maps', { Antigo: {
        features: { images: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] },
            properties: { id: 'old-image', source: 'image', layerId: 'old-layer', groupId: 'old-group' } }] }
    } });
    await seedDatabase('ebgeo_images', { 'old-image': new Uint8Array([1, 3, 5, 7]) });
    await seedDatabase('ebgeo_layers', { layers_Antigo: [{ id: 'old-layer' }], activeLayer_Antigo: 'old-layer' });
    await seedDatabase('ebgeo_groups', { Antigo: { 'old-group': { id: 'old-group', features: [{ id: 'old-image' }] } } });
}

async function modules() {
    return {
        ns: await import('@store/atlas-namespace.js'),
        transition: await import('@store/migration/legacy-transition.js'),
        cleanup: await import('@store/migration/legacy-cleanup.js'),
        state: await import('@store/migration/transition-state.js')
    };
}

/**
 * Deixa o disco como uma sequência de cópias interrompidas deixa: N endereços no histórico,
 * cada um com bancos escritos, e o destino ativo commitado.
 *
 * Usa o `restartLegacyCopy` REAL para empilhar o histórico, porque é ele que decide o que entra
 * ali; o que o teste escreve à mão é só o rebobinar do status, que uma interrupção faria.
 * @param {number} quantas - Quantas cópias abandonar.
 * @returns {Promise<{state: Object, abandonadas: string[]}>}
 */
async function abandonarCopias(quantas) {
    const { ns, transition, state: journal } = await modules();
    const { state } = await transition.prepareLegacyTransition();
    const global = ns.getGlobalStore();
    const abandonadas = [];
    for (let i = 0; i < quantas; i++) {
        const atual = await global.getItem(journal.LEGACY_TRANSITION_KEY);
        abandonadas.push(atual.destination);
        await ns.getStoreFor(ns.StoreName.MAPS, ns.localScope(atual.entry.id, atual.destination))
            .setItem('Antigo', { features: { points: [] } });
        await global.setItem(journal.LEGACY_TRANSITION_KEY, { ...atual, status: 'copying' });
        await transition.restartLegacyCopy();
    }
    const final = await global.getItem(journal.LEGACY_TRANSITION_KEY);
    // A cópia que VINGOU também tem bancos: sem isto o destino ativo ficaria ausente do disco e
    // "o ativo sobreviveu" passaria por vacuidade.
    await ns.getStoreFor(ns.StoreName.MAPS, ns.localScope(final.entry.id, final.destination))
        .setItem('Antigo', { features: { points: [] } });
    await global.setItem(journal.LEGACY_TRANSITION_KEY, { ...final, status: 'committed' });
    return { state, abandonadas };
}

it('o histórico guarda UMA reserva, as cópias anteriores saem do disco e a origem não é tocada', async () => {
    await seed();
    const { ns, transition, cleanup, state: journal } = await modules();
    const origem = ns.localScope('origem', '');
    const { abandonadas } = await abandonarCopias(3);
    const antes = await transition.inventoryScope(origem);
    const entryId = (await ns.getGlobalStore().getItem(journal.LEGACY_TRANSITION_KEY)).entry.id;
    const nomeDoMapa = sufixo => ns.resolveDbName(ns.StoreName.MAPS, ns.localScope(entryId, sufixo));

    // A pré-condição é o sujeito: sem as três no disco, tudo abaixo passaria por vacuidade.
    for (const sufixo of abandonadas) expect(await databaseState(nomeDoMapa(sufixo))).toBe('populated');

    const report = await cleanup.pruneAbandonedCopies();

    const reserva = abandonadas[abandonadas.length - 1];
    expect(report.copies.sort()).toEqual(abandonadas.slice(0, -1).sort());
    expect(report.blocked).toEqual([]);
    for (const sufixo of abandonadas.slice(0, -1)) expect(await databaseState(nomeDoMapa(sufixo))).toBe('absent');
    expect(await databaseState(nomeDoMapa(reserva))).toBe('populated');

    const depois = await ns.getGlobalStore().getItem(journal.LEGACY_TRANSITION_KEY);
    expect(depois.history).toEqual([reserva]);
    expect(await databaseState(nomeDoMapa(depois.destination))).toBe('populated');
    expect(await transition.inventoryScope(origem)).toEqual(antes);
    expect(antes.length).toBeGreaterThan(4);
});

it('a poda é idempotente: a segunda varredura não acha nada e não reescreve o histórico', async () => {
    await seed();
    const { ns, cleanup, state: journal } = await modules();
    await abandonarCopias(2);
    await cleanup.pruneAbandonedCopies();
    const depoisDaPrimeira = await ns.getGlobalStore().getItem(journal.LEGACY_TRANSITION_KEY);

    const report = await cleanup.pruneAbandonedCopies();

    expect(report).toEqual({ copies: [], recoveries: [], kept: [], blocked: [] });
    expect(await ns.getGlobalStore().getItem(journal.LEGACY_TRANSITION_KEY)).toEqual(depoisDaPrimeira);
});

it('uma única cópia abandonada É a reserva e sobrevive', async () => {
    await seed();
    const { ns, cleanup, state: journal } = await modules();
    const { abandonadas } = await abandonarCopias(1);
    const entryId = (await ns.getGlobalStore().getItem(journal.LEGACY_TRANSITION_KEY)).entry.id;

    const report = await cleanup.pruneAbandonedCopies();

    expect(report.copies).toEqual([]);
    expect(await databaseState(ns.resolveDbName(ns.StoreName.MAPS, ns.localScope(entryId, abandonadas[0]))))
        .toBe('populated');
    expect((await ns.getGlobalStore().getItem(journal.LEGACY_TRANSITION_KEY)).history).toEqual(abandonadas);
});

/**
 * Escreve o que uma restauração interrompida deixa: a chave pendente mais os bancos dela.
 * @param {Object} ns - Módulo de namespace.
 * @param {Object} journal - Módulo do estado da transição.
 * @param {{id: string, createdAt: number|null, dbSuffix?: string}} pendente - Registro a gravar.
 * @returns {Promise<string>} Nome do banco de mapas daquela restauração.
 */
async function semearRestauracao(ns, journal, pendente) {
    const dbSuffix = pendente.dbSuffix ?? journal.recoveryDbSuffix(pendente.id);
    const escopo = ns.localScope(pendente.id, dbSuffix);
    await ns.getStoreFor(ns.StoreName.MAPS, escopo).setItem('Antigo', { features: { points: [] } });
    await ns.getGlobalStore().setItem(journal.recoveryPendingKey(pendente.id), {
        id: pendente.id, dbSuffix, name: 'Recuperado', version: 1, status: 'copying', copied: 1,
        createdAt: pendente.createdAt, updatedAt: pendente.createdAt, inventory: []
    });
    return ns.resolveDbName(ns.StoreName.MAPS, escopo);
}

it('a restauração abandonada há mais de sete dias sai; a de hoje fica inteira', async () => {
    await seed();
    const { ns, cleanup, state: journal } = await modules();
    const agora = 1757700000000;
    const velha = await semearRestauracao(ns, journal, { id: 'velha', createdAt: agora - cleanup.ABANDONED_RECOVERY_MAX_AGE_MS - 1 });
    const recente = await semearRestauracao(ns, journal, { id: 'recente', createdAt: agora - cleanup.ABANDONED_RECOVERY_MAX_AGE_MS + 60000 });

    const report = await cleanup.pruneAbandonedCopies({ now: agora });

    expect(report.recoveries).toEqual([{ id: 'velha', outcome: 'abandoned' }]);
    expect(report.kept).toEqual(['recente']);
    expect(await databaseState(velha)).toBe('absent');
    expect(await databaseState(recente)).toBe('populated');
    expect(await ns.getGlobalStore().getItem(journal.recoveryPendingKey('velha'))).toBeNull();
    expect(await ns.getGlobalStore().getItem(journal.recoveryPendingKey('recente'))).toBeTruthy();
});

it('a restauração que TERMINOU perde só a chave: o atlas registrado continua no disco', async () => {
    await seed();
    const { ns, cleanup, state: journal } = await modules();
    const banco = await semearRestauracao(ns, journal, { id: 'pronta', createdAt: 1 });
    await ns.getGlobalStore().setItem(ns.localAtlasRegistryKey('pronta'), {
        id: 'pronta', dbSuffix: journal.recoveryDbSuffix('pronta'), name: 'Recuperado', version: 1,
        createdAt: 1, updatedAt: 1
    });

    const report = await cleanup.pruneAbandonedCopies({ now: 1 + cleanup.ABANDONED_RECOVERY_MAX_AGE_MS * 10 });

    expect(report.recoveries).toEqual([{ id: 'pronta', outcome: 'finished' }]);
    expect(await databaseState(banco)).toBe('populated');
    expect(await ns.getGlobalStore().getItem(journal.recoveryPendingKey('pronta'))).toBeNull();
    expect(await ns.readLocalAtlasRegistry()).toHaveLength(1);
});

it('registro pendente com endereço que não é o derivado do id não dirige exclusão nenhuma', async () => {
    await seed();
    const { ns, cleanup, state: journal } = await modules();
    const alheio = ns.localScope('outro', 'outro');
    await ns.getStoreFor(ns.StoreName.MAPS, alheio).setItem('Intacto', { value: 1 });
    await ns.getGlobalStore().setItem(journal.recoveryPendingKey('outro'), {
        id: 'outro', dbSuffix: 'outro', status: 'copying', copied: 0, createdAt: 1, inventory: []
    });

    const report = await cleanup.pruneAbandonedCopies({ now: 1 + cleanup.ABANDONED_RECOVERY_MAX_AGE_MS * 10 });

    expect(report.recoveries).toEqual([{ key: journal.recoveryPendingKey('outro'), outcome: 'unreadable' }]);
    expect(await databaseState(ns.resolveDbName(ns.StoreName.MAPS, alheio))).toBe('populated');
    expect(await ns.getGlobalStore().getItem(journal.recoveryPendingKey('outro'))).toBeNull();
});

it('registro pendente sem carimbo de tempo é recolhido em vez de ficar preso para sempre', async () => {
    await seed();
    const { ns, cleanup, state: journal } = await modules();
    const banco = await semearRestauracao(ns, journal, { id: 'sem-tempo', createdAt: null });

    const report = await cleanup.pruneAbandonedCopies({ now: 1757700000000 });

    expect(report.recoveries).toEqual([{ id: 'sem-tempo', outcome: 'abandoned' }]);
    expect(await databaseState(banco)).toBe('absent');
});

it('sem coordenação entre janelas a varredura ainda roda, e o diário ilegível não a derruba', async () => {
    await seed();
    const { ns, cleanup, state: journal } = await modules();
    const banco = await semearRestauracao(ns, journal, { id: 'orfa', createdAt: 1 });
    await ns.getGlobalStore().setItem(journal.LEGACY_TRANSITION_KEY, { version: 9, destination: 'outro' });
    vi.stubGlobal('navigator', { locks: undefined });

    const report = await cleanup.pruneAbandonedCopies({ now: 1 + cleanup.ABANDONED_RECOVERY_MAX_AGE_MS * 10 });

    expect(report.recoveries).toEqual([{ id: 'orfa', outcome: 'abandoned' }]);
    expect(await databaseState(banco)).toBe('absent');
});

it('a poda não alcança a origem nem o destino ativo quando NÃO há nada abandonado', async () => {
    await seed();
    const { ns, transition, cleanup } = await modules();
    const origem = ns.localScope('origem', '');
    const { state } = await transition.prepareLegacyTransition();
    const antesDaOrigem = await transition.inventoryScope(origem);
    const antesDoDestino = await transition.inventoryScope(ns.localScope(state.entry.id, state.destination));

    const report = await cleanup.pruneAbandonedCopies();

    expect(report).toEqual({ copies: [], recoveries: [], kept: [], blocked: [] });
    expect(await transition.inventoryScope(origem)).toEqual(antesDaOrigem);
    expect(await transition.inventoryScope(ns.localScope(state.entry.id, state.destination))).toEqual(antesDoDestino);
});
