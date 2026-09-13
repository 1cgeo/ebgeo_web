// Path: tests/integration/reconciliacao-no-boot-do-slot.test.js

/**
 * @fileoverview O PONTEIRO DE GERAÇÃO DE UM SLOT LOCAL SE RECONSTRÓI NO BOOT (B7.3).
 *
 * O retrato do servidor entra numa GERAÇÃO, e o ponteiro dela é síncrono, logo mora no
 * `localStorage`; o dado que ele endereça mora no IndexedDB. Os dois são apagados por gestos
 * DIFERENTES do navegador, e é por isso que existe o espelho durável em `ebgeo_global`
 * (`GlobalKey.GENERATION_PREFIX`). O espelho tinha UM leitor, o `connect` remoto.
 *
 * O SLOT RESGATADO NUNCA CONECTA. `adoptRemoteAtlasAsLocal` move a reivindicação do registro
 * remoto para o local e ZERO bytes entre bancos, então um slot LOCAL pode carregar o sufixo
 * `remote-<id>` e as gerações que aquele namespace tinha. Perdido o `localStorage`, o acervo dele
 * ficava endereçado por um ponteiro que nada reconstruía: toda leitura caía nos nomes sem geração
 * e o atlas lia VAZIO. Isso é pior do que apagado, porque nada acusa.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. O primeiro caso lê o acervo DEPOIS do
 * boot, pelo escopo que o boot montou, e ele foi medido revertendo: sem a reconciliação em
 * `mountSlotScope` o mapa não aparece e a lista volta vazia. Os nomes de banco são escritos
 * ABSOLUTOS aqui e conferidos contra `resolveDbName`, porque derivar a expectativa do código sob
 * teste passa verde com disco vazio.
 *
 * E O CUSTO É MEDIDO, não estimado: o último bloco conta as leituras de espelho que um slot SEM
 * geração paga por causa desta mudança.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetIndexedDB, seedDatabase } from '../helpers/idb-helpers.js';

/** Atlas de servidor cujo namespace o resgate adotou. */
const ATLAS_ID = '7c000000-0000-4000-8000-000000000001';
/** Id do slot LOCAL que passou a reivindicar aquele namespace. */
const SLOT_RESGATADO = '7c000000-0000-4000-8000-000000000002';
/** Id de um slot local comum, que nunca viu servidor nenhum. */
const SLOT_COMUM = '7c000000-0000-4000-8000-000000000003';

const SUFIXO_RESGATADO = `remote-${ATLAS_ID}`;
const GERACAO = 'g1';
/** Nome ABSOLUTO do banco de mapas do slot resgatado, na geração ativa. */
const BANCO_DE_MAPAS = `ebgeo_maps__${SUFIXO_RESGATADO}__generation-${GERACAO}`;

/** O armazenamento síncrono que o navegador perdeu, e que os casos abaixo controlam. */
let armazenamento;

beforeEach(async () => {
    vi.resetModules();
    await resetIndexedDB();
    armazenamento = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => armazenamento.get(key) ?? null,
        setItem: (key, value) => armazenamento.set(key, String(value)),
        removeItem: key => armazenamento.delete(key),
        clear: () => armazenamento.clear()
    });
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await resetIndexedDB();
});

/**
 * Escreve no disco a instalação de um slot resgatado cujo `localStorage` sumiu: registro local
 * apontando para o namespace remoto, espelho de geração no banco global, e o acervo VIVO só sob
 * o nome com geração.
 * @param {Object} ns - Módulo `atlas-namespace.js` recém-importado.
 * @param {Object} [extras] - Entradas adicionais do banco global.
 * @returns {Promise<void>}
 */
async function semearSlotResgatado(ns, extras = {}) {
    const escopo = ns.localScope(SLOT_RESGATADO, SUFIXO_RESGATADO);
    // A premissa ("este é o nome com geração") é CHECADA, não lembrada.
    expect(ns.resolveDbName(ns.StoreName.MAPS, { ...escopo, dataGeneration: GERACAO }))
        .toBe(BANCO_DE_MAPAS);

    await seedDatabase(BANCO_DE_MAPAS, { Operacao: { features: {}, name: 'Operacao' } });
    await seedDatabase('ebgeo_global', {
        [`local_atlas:${SLOT_RESGATADO}`]: {
            version: 1, name: 'Resgate', dbSuffix: SUFIXO_RESGATADO, createdAt: 1, updatedAt: 9
        },
        current_local_atlas: SLOT_RESGATADO,
        [`generation:${SUFIXO_RESGATADO}`]: { active: GERACAO, known: [GERACAO], cursor: 5 },
        ...extras
    });
}

/**
 * O prefixo do boot que monta o slot, na ordem de `activateBootAtlasScope` (`store.js`).
 * @returns {Promise<Object>} O módulo `atlas-namespace.js` do boot.
 */
async function bootar() {
    vi.resetModules();
    const localAtlas = await import('@store/local-atlas.api.js');
    await localAtlas.initLocalAtlases({
        origin: { kind: 'local', atlasId: null },
        isAuthenticated: false,
        preferTabMountPointer: true
    });
    return import('@store/atlas-namespace.js');
}

describe('o boot reconstrói o ponteiro de geração do slot que monta', () => {
    it('o acervo de um slot RESGATADO continua alcançável sem o localStorage', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        await semearSlotResgatado(ns0);
        expect(armazenamento.size).toBe(0);

        const ns = await bootar();

        // A pergunta é a que o produto faz: o que o escopo MONTADO enxerga.
        expect(await ns.getStore(ns.StoreName.MAPS).keys()).toEqual(['Operacao']);
        expect(ns.getActiveScope().dbSuffix).toBe(SUFIXO_RESGATADO);

        // E a cópia autoritativa voltou, com o cursor, que é o que a próxima leitura síncrona usa.
        const { readGeneration } = await import('@store/namespace-generation.js');
        expect(readGeneration(ns.localScope(SLOT_RESGATADO, SUFIXO_RESGATADO)))
            .toEqual({ active: GERACAO, known: [GERACAO], cursor: 5 });
    });

    it('CONTROLE: sem espelho no banco global o boot não inventa geração nenhuma', async () => {
        // Sem esta linha, o caso acima ficaria verde contra uma reconciliação que carimba
        // qualquer coisa: aqui o disco tem o mesmo acervo sob o mesmo nome e NENHUM espelho, e a
        // resposta certa é o atlas vazio, porque não há de onde reconstruir o endereço.
        const ns0 = await import('@store/atlas-namespace.js');
        const escopo = ns0.localScope(SLOT_RESGATADO, SUFIXO_RESGATADO);
        expect(ns0.resolveDbName(ns0.StoreName.MAPS, { ...escopo, dataGeneration: GERACAO }))
            .toBe(BANCO_DE_MAPAS);
        await seedDatabase(BANCO_DE_MAPAS, { Operacao: { features: {}, name: 'Operacao' } });
        await seedDatabase('ebgeo_global', {
            [`local_atlas:${SLOT_RESGATADO}`]: {
                version: 1, name: 'Resgate', dbSuffix: SUFIXO_RESGATADO, createdAt: 1, updatedAt: 9
            },
            current_local_atlas: SLOT_RESGATADO
        });

        const ns = await bootar();

        expect(await ns.getStore(ns.StoreName.MAPS).keys()).toEqual([]);
        expect(armazenamento.has(`ebgeo_atlas_generation:${SUFIXO_RESGATADO}`)).toBe(false);
    });

    it('a TROCA de slot reconcilia também, não só o boot', async () => {
        // O slot resgatado pode não ser o corrente: quem o abre depois é `mountLocalAtlas`, e um
        // ponto de entrada que só cobrisse o boot deixaria esse caminho lendo o atlas vazio.
        const ns0 = await import('@store/atlas-namespace.js');
        await semearSlotResgatado(ns0, {
            [`local_atlas:${SLOT_COMUM}`]: {
                version: 1, name: 'Comum', dbSuffix: 'slot-comum', createdAt: 2, updatedAt: 20
            },
            current_local_atlas: SLOT_COMUM
        });

        vi.resetModules();
        const localAtlas = await import('@store/local-atlas.api.js');
        await localAtlas.initLocalAtlases({
            origin: { kind: 'local', atlasId: null },
            isAuthenticated: false,
            preferTabMountPointer: true
        });
        const ns = await import('@store/atlas-namespace.js');
        expect(ns.getActiveScope().dbSuffix).toBe('slot-comum');

        expect(await localAtlas.mountLocalAtlas(SLOT_RESGATADO)).toMatchObject({ ok: true });

        expect(ns.getActiveScope().dbSuffix).toBe(SUFIXO_RESGATADO);
        expect(await ns.getStore(ns.StoreName.MAPS).keys()).toEqual(['Operacao']);
    });
});

describe('o que um slot SEM geração paga por esta reconciliação', () => {
    it('exatamente UMA leitura de espelho, e nenhuma da época de descarte', async () => {
        // A MEDIDA, e não uma estimativa. A metade da época só existe para escopo REMOTE
        // (`adoptMirroredDiscardState` responde `absent` para os outros), então lê-la no boot de
        // um slot local seria uma leitura cujo resultado se joga fora.
        await seedDatabase('ebgeo_global', {
            [`local_atlas:${SLOT_COMUM}`]: {
                version: 1, name: 'Comum', dbSuffix: 'slot-comum', createdAt: 2, updatedAt: 20
            },
            current_local_atlas: SLOT_COMUM
        });

        vi.resetModules();
        const ns = await import('@store/atlas-namespace.js');
        const globalStore = ns.getGlobalStore();
        // O `ready()` NAO e cerimonia, e o que faz este instrumento medir. O localforage
        // RE-EMBRULHA os metodos da instancia quando o driver inicializa (`setDriver` ->
        // `_wrapLibraryMethodsWithReady`), entao uma espionagem instalada antes da primeira
        // operacao e substituida e o contador fica em ZERO, com cara de "nao ha leitura extra".
        // Foi exatamente o que a primeira versao deste caso mediu.
        await globalStore.ready();
        const lidas = [];
        const original = globalStore.getItem.bind(globalStore);
        vi.spyOn(globalStore, 'getItem').mockImplementation(async (key) => {
            lidas.push(key);
            return original(key);
        });

        const localAtlas = await import('@store/local-atlas.api.js');
        await localAtlas.initLocalAtlases({
            origin: { kind: 'local', atlasId: null },
            isAuthenticated: false,
            preferTabMountPointer: true
        });

        // O instrumento e afirmado ANTES do resultado: um filtro sobre lista vazia passa verde.
        expect(lidas).toEqual([
            `local_atlas:${SLOT_COMUM}`,
            'local_atlases',
            'current_local_atlas',
            'legacy_transition_v1',
            'generation:slot-comum'
        ]);
        // O CUSTO, em numero: UMA leitura a mais no banco global, a quinta da lista acima.
        expect(lidas.filter(k => k.startsWith('generation:'))).toEqual(['generation:slot-comum']);
        expect(lidas.filter(k => k.startsWith('write_epoch:'))).toEqual([]);
    });
});
