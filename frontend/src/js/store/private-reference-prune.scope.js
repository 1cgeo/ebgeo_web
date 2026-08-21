// Path: js/store/private-reference-prune.scope.js

/**
 * @fileoverview O adaptador de I/O da poda de saída para um ESCOPO que NÃO é o ativo.
 *
 * POR QUE ISTO NÃO PODE USAR AS OPERAÇÕES DE STORE. Toda operação de store resolve contra
 * o escopo ATIVO, e no caminho "Salvar como local" o escopo ativo é o atlas REMOTO de
 * origem: podar por elas apagaria o acervo do atlas do SERVIDOR, que é a perda mais cara
 * que esta arquitetura convida. Aqui o escopo é sempre EXPLÍCITO (`getStoreFor(nome,
 * escopo)`), como em `duplicateLocalAtlas`.
 *
 * NUNCA `localforage.createInstance`: a fábrica é `atlas-namespace.js`, e
 * `frontend/tests/unit/repository-namespace.test.js` varre esta pasta inteira e reprova
 * chamador novo.
 *
 * A REGRA da poda não mora aqui: as quatro funções puras vêm de
 * `@catalog/private-reference-pruner.js`, e este arquivo só sabe ler documento, aplicar e
 * regravar. Ele atravessa o documento CRU do disco, que carrega lápides de sync e
 * metadado que as funções de exportação filtram antes de devolver — o podador preserva
 * tudo o que não é referência, então a travessia é indiferente a isso.
 */

import { getStoreFor, StoreName } from './atlas-namespace.js';
import {
    podarBriefing,
    podarDocumentoCesium3d,
    podarDocumentoDeMapa,
    podarDocumentoSv360,
    relatorioVazio,
    somarRelatorios,
} from '@catalog/private-reference-pruner.js';

/**
 * As quatro famílias de documento, cada uma com a store em que mora e a função pura que a
 * poda. Uma tabela e não quatro laços, para que uma família nova entre como linha.
 */
const FAMILIAS = [
    { store: StoreName.MAPS, podar: podarDocumentoDeMapa },
    { store: StoreName.CESIUM3D, podar: podarDocumentoCesium3d },
    { store: StoreName.STREETVIEW360, podar: podarDocumentoSv360 },
    { store: StoreName.BRIEFINGS, podar: podarBriefing },
];

/**
 * Poda TODOS os documentos de um escopo, no lugar.
 *
 * @param {{kind: string, atlasId: string, dbSuffix: string}} escopo - O escopo DESTINO.
 * @param {Function} resolver - `(grupo, id) => RefVerdict`.
 * @returns {Promise<Object>} O relatório somado de todas as famílias.
 */
export async function podarEscopo(escopo, resolver) {
    if (!escopo) throw new Error('podarEscopo: escopo é obrigatório');
    const relatorio = relatorioVazio();

    for (const familia of FAMILIAS) {
        const store = getStoreFor(familia.store, escopo);
        // Colhe primeiro e escreve depois: reescrever de dentro do `iterate` mexe no
        // cursor que está sendo percorrido, e o comportamento disso varia por driver.
        const pendentes = [];
        await store.iterate((valor, chave) => {
            if (!valor || typeof valor !== 'object') return;
            const { documento, relatorio: parcial } = familia.podar(valor, resolver);
            if (parcial.total === 0) return;
            pendentes.push({ chave, documento, parcial });
        });
        for (const { chave, documento, parcial } of pendentes) {
            await store.setItem(chave, documento);
            somarRelatorios(relatorio, parcial);
        }
    }

    return relatorio;
}
