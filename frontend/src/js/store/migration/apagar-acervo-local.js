// Path: js/store/migration/apagar-acervo-local.js

/**
 * @fileoverview "Continuar": the one gesture that empties this origin so the product can open.
 *
 * ===========================================================================================
 * WHY IT EXISTS, AND WHAT IT REPLACED (owner's decision, 2026-09-22)
 * ===========================================================================================
 * The recovery screen used to offer a deletion of the pre-namespace ORIGIN only (decision D8),
 * next to six other commands. The owner's rule now is that a failed update leaves exactly two
 * ways out: save the data, or move on. "Move on" is only true if the product actually opens
 * afterwards, and it does not while ANY database of a broken acervo is still on disk: the boot
 * gate reads the journal and the registry again and lands on the same screen. So the gesture is
 * the whole origin, not one half of it.
 *
 * ===========================================================================================
 * THE LIST IS DERIVED, NEVER ENUMERATED BY THE BROWSER
 * ===========================================================================================
 * `indexedDB.databases()` is not available everywhere (see the header of `atlas-namespace.js`)
 * and is a different source of truth from the one the store writes through, so it is not asked.
 * What is deleted is what the product itself RECORDS: the legacy origin, every slot in the local
 * registry, every namespace in the remote registry, the transition's destination and its history,
 * a restoration in flight, and finally the global database that named all of them. The global one
 * goes LAST, because until it does it is the only thing that can name the rest.
 *
 * A DELETE THAT DOES NOT CONFIRM STOPS THE GESTURE, and that is the opposite of the sweep's rule
 * in `legacy-cleanup.js`, on purpose. There a blocked delete costs disk and nothing else, so it is
 * reported and forgotten. Here a blocked delete means another window is holding that acervo open:
 * carrying on would destroy what the other window has, and forget the registry that names what
 * survived. So the global database is kept, the screen says which state it is in, and the command
 * stays on the screen for the person to retry after closing the other window.
 */

import {
    atlasIdFromRemoteRegistryKey, dropAtlasDatabases, getGlobalStore,
    isRemoteAtlasRegistryKey, localScope, readLocalAtlasRegistry, remoteScope
} from '../atlas-namespace.js';
import { legacyScope } from './migration-scope.js';
import { RECOVERY_PENDING_PREFIX, readLegacyTransition } from './transition-state.js';
import { contarRegistros } from './ebgeo-de-recuperacao.js';

/**
 * Every scope this origin knows about, in the order they are destroyed.
 *
 * @returns {Promise<Array<{ scope: Object, label: string }>>} Distinct scopes, by `dbSuffix`.
 */
async function escoposConhecidos() {
    const vistos = new Set();
    const escopos = [];
    const add = (scope, label) => {
        if (!scope || typeof scope.dbSuffix !== 'string' || vistos.has(scope.dbSuffix)) return;
        vistos.add(scope.dbSuffix);
        escopos.push({ scope, label });
    };

    add(legacyScope(), 'Dados da versão antiga');
    for (const entry of await readLocalAtlasRegistry()) {
        if (typeof entry?.dbSuffix === 'string') add(localScope(entry.id, entry.dbSuffix), entry.name || 'Atlas local');
    }

    const global = getGlobalStore();
    for (const key of await global.keys()) {
        if (isRemoteAtlasRegistryKey(key)) {
            add(remoteScope(atlasIdFromRemoteRegistryKey(key)), 'Atlas de servidor');
            continue;
        }
        if (typeof key === 'string' && key.startsWith(RECOVERY_PENDING_PREFIX)) {
            const pending = await global.getItem(key);
            if (pending?.id && pending.dbSuffix) add(localScope(pending.id, pending.dbSuffix), 'Recuperação inacabada');
        }
    }

    // The journal LAST, because its copies are the least likely to be the person's work and the
    // most likely to be blocked: a staging scope of an absorption that died mid-flight.
    let state = null;
    try { state = await readLegacyTransition(); } catch { state = null; }
    if (state?.entry?.id) {
        for (const suffix of [state.destination, ...(state.history || []), state.late?.staging].filter(Boolean)) {
            add(localScope(state.entry.id, suffix), 'Cópia da atualização');
        }
    }
    return escopos;
}

/**
 * @typedef {Object} InventarioParaApagar
 * @property {number} registros - Records across every scope this origin knows about.
 * @property {number} atlas - Local atlas slots in the registry, which is the count a person
 *   recognises: "cópia da atualização" is bookkeeping they never named.
 * @property {number} escopos - How many namespaces the deletion will visit.
 */

/**
 * What the confirmation names, counted at the moment it is asked.
 *
 * @returns {Promise<InventarioParaApagar>}
 */
export async function inventarioParaApagar(escopos = null) {
    const alvos = escopos ?? await escoposConhecidos();
    const totais = await Promise.all(alvos.map(({ scope }) => contarRegistros(scope)));
    return {
        registros: totais.reduce((soma, n) => soma + n, 0),
        atlas: (await readLocalAtlasRegistry()).length,
        escopos: alvos.length
    };
}

/**
 * @typedef {Object} ResultadoDeApagar
 * @property {number} registros - How many records were on disk when the gesture started.
 * @property {string[]} apagados - Database names confirmed deleted.
 * @property {string[]} bloqueados - Database names another window is still holding. When this is
 *   not empty NOTHING else was destroyed after it, and the global registry is intact.
 */

/**
 * Empties this origin of everything the product knows how to name.
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs] - Per-database bound, for a test that does not want to wait
 *   out a held connection.
 * @returns {Promise<ResultadoDeApagar>}
 */
export async function apagarAcervoLocal({ timeoutMs } = {}) {
    const escopos = await escoposConhecidos();
    const inventario = await inventarioParaApagar(escopos);
    const opcoes = timeoutMs === undefined ? {} : { timeoutMs };
    const apagados = [];

    for (const { scope } of escopos) {
        const { dropped, blocked } = await dropAtlasDatabases(scope, opcoes);
        apagados.push(...dropped);
        if (blocked.length > 0) return { registros: inventario.registros, apagados, bloqueados: blocked };
    }

    // THE GLOBAL DATABASE IS EMPTIED, NOT DELETED. Deleting it needs exclusive access and can be
    // blocked by a sister tab, which would leave the data gone and the registry that named it
    // standing; `clear()` cannot be blocked. What it costs is an empty shell, which the next boot
    // writes into as if it were new.
    // AND THE ORIGIN MARKER GOES WITH IT, which is what makes the next boot a FRESH INSTALL and
    // not an installation that lost its registry: an absent marker is the state of a browser that
    // has never opened the product, and every boot path already answers that one.
    const global = getGlobalStore();
    await global.clear();
    console.info(`Acervo local apagado a pedido: ${inventario.registros} registros, ${apagados.length} bancos.`);
    return { registros: inventario.registros, apagados, bloqueados: [] };
}
