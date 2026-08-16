// Path: tests/unit/exclusao-atlas-local-espera-a-irma.test.js

/**
 * @fileoverview Excluir um atlas local em "Seus atlas" destrói onze bancos que OUTRA ABA pode ter
 * montados. Este arquivo mede a única propriedade que torna o aviso entre abas útil: a exclusão
 * ESPERA a irmã parar antes de destruir.
 *
 * POR QUE ESPERAR IMPORTA, e é diferente do lado remoto. Nada nunca reexecuta um drop local, então
 * "poupar" o namespace (o que o expurgo remoto faz quando outra aba o tem montado) abandonaria dez
 * bancos fora do registro para sempre. O drop acontece de todo jeito. O que o aviso compra é o
 * INSTANTE: se a irmã ainda estiver escrevendo quando o drop passar, o localforage dela fecha em
 * `versionchange`, e a PRÓXIMA escrita dela RECRIA os bancos sob um nome que registro nenhum
 * menciona. Resíduo inalcançável, sem erro nenhum, que é exatamente o defeito que o registro de
 * namespaces existe para impedir.
 *
 * O QUE ESTE ARQUIVO ACRESCENTA ÀS DUAS SUÍTES QUE JÁ TOCAM NISTO, e ele existe porque nenhuma das
 * duas mede o par inteiro:
 *
 *   - `tests/unit/local-atlas-api.test.js` prende "avisa antes de destruir", mas com o anunciante
 *     DUBLADO: ele resolve na hora, então a ordem que aquele arquivo mede é a de duas chamadas do
 *     mesmo processo, não a de um freio de verdade;
 *   - `tests/unit/tab-lock.test.js` prende "o ack sai depois do freio TERMINAR", mas chamando
 *     `announceTeardown` na mão, sem exclusão nenhuma por perto.
 *
 * Aqui os dois lados são reais: a API de verdade chama o protocolo de verdade, a irmã congela
 * devagar (a parada é uma promessa que o teste solta), e a asserção é sobre o DISCO — os bancos
 * ainda de pé enquanto ela está parando, e apagados só depois. Um `await` que sumisse do caminho do
 * aviso deixaria as duas suítes acima verdes e este caso vermelho.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Disco falso, keyed por nome de banco, com a ORDEM das destruições registrada.
// ============================================================================

const { databases, drops, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    const drops = [];
    function makeStore({ name, storeName = null }) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); })
        };
    }
    return {
        databases,
        drops,
        makeStore,
        resetFake: () => { databases.clear(); drops.length = 0; }
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async ({ name }) => {
            drops.push(name);
            for (const key of [...databases.keys()]) {
                if (key.startsWith(`${name}::`)) databases.delete(key);
            }
        })
    }
}));

/** Hub em processo, com a semântica do BroadcastChannel (sem eco para quem postou). */
function createHub() {
    const endpoints = [];
    return {
        connect() {
            const endpoint = { receiver: null, dead: false };
            endpoints.push(endpoint);
            return {
                kind: 'fake',
                post: (message) => {
                    for (const other of endpoints) {
                        if (other === endpoint || other.dead || !other.receiver) continue;
                        other.receiver(message);
                    }
                },
                setReceiver: (fn) => { endpoint.receiver = fn; },
                close: () => { endpoint.dead = true; }
            };
        }
    };
}

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

const espere = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let api;
let ns;
let tabLock;
let hub;
let irmas;

/** Semeia uma feição de mentira no banco de mapas de um slot, para o disco ter o que perder. */
async function semear(atlas, valor) {
    await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(atlas))
        .setItem('Principal', { nome: valor });
}

/** @returns {boolean} Se o banco de mapas daquele slot existe no disco falso. */
function bancoDeMapasExiste(atlas) {
    return databases.has(`ebgeo_maps__${atlas.dbSuffix}::keyvaluepairs`);
}

beforeEach(async () => {
    vi.resetModules();
    resetFake();
    hub = createHub();
    irmas = [];
    // O MESMO grafo para a API e para o protocolo: `local-atlas.api.js` anuncia pelo singleton de
    // `tab-lock.js`, então uma segunda cópia do módulo faria a exclusão anunciar num canal que este
    // teste não escuta, e o caso passaria por acidente.
    tabLock = await import('@utils/tab-lock.js');
    ns = await import('@store/atlas-namespace.js');
    api = await import('@store/local-atlas.api.js');
    const errors = await import('@store/store-errors.js');
    errors.setStoreErrorEventBus({ emit: vi.fn() });

    // A ABA QUE EXCLUI é a página "Seus atlas": ela segura NADA (`noneKey`), então não colide com
    // ninguém e o aviso não pode ser endereçado por colisão de chaves. É por isso que o protocolo
    // entrega a TODA aba viva e cada uma decide pelo ENDEREÇO que tem montado.
    tabLock.initTabLock({
        key: tabLock.noneKey(),
        createTransport: () => hub.connect(),
        overlayHost: null,
        autoPulse: false,
        settleMs: 0
    });

    await api.initLocalAtlases();
});

afterEach(() => {
    for (const irma of irmas) irma.destroy();
    tabLock.destroyTabLock();
});

/**
 * Uma aba irmã com o mapa aberto NAQUELE slot, que para devagar.
 * @param {string} atlasId - Slot que ela tem montado.
 * @param {{promise: Promise<void>}} portao - O freio dela só termina quando isto resolver.
 * @param {string[]} ordem - Diário compartilhado.
 * @returns {{lock: object, recebidos: Array}}
 */
function irmaQueParaDevagar(atlasId, portao, ordem) {
    const recebidos = [];
    const lock = tabLock.createTabLock({
        key: tabLock.localAtlasKey(atlasId),
        createTransport: () => hub.connect(),
        overlayHost: null,
        autoPulse: false,
        settleMs: 0,
        onTeardown: async (enderecos, contexto) => {
            recebidos.push({ enderecos, contexto });
            ordem.push('freio-comecou');
            await portao.promise;
            ordem.push('freio-terminou');
            return true;
        }
    });
    irmas.push(lock);
    return { lock, recebidos };
}

describe('excluir atlas local: a irmã para ANTES de os bancos irem embora', () => {
    it('a destruição espera o freio TERMINAR, e não apenas começar', async () => {
        const ordem = [];
        const portao = deferred();
        const alvo = (await api.createLocalAtlas('Alvo')).atlas;
        const { recebidos } = irmaQueParaDevagar(alvo.id, portao, ordem);

        // Positiva ANTES: sem ela, "o banco não existe mais" no fim seria indistinguível de um
        // banco que nunca existiu.
        await semear(alvo, 'trabalho da irmã');
        expect(bancoDeMapasExiste(alvo)).toBe(true);

        const exclusao = api.deleteLocalAtlas(alvo.id).then((r) => { ordem.push('excluiu'); return r; });

        // A irmã já está parando, e o disco ainda está inteiro. Este é o instante que o aviso
        // existe para criar: sem ele, o drop já teria passado por cima de uma aba escrevendo.
        await espere(80);
        expect(ordem).toEqual(['freio-comecou']);
        expect(bancoDeMapasExiste(alvo)).toBe(true);
        expect(drops).toEqual([]);

        portao.resolve();
        const resultado = await exclusao;

        expect(ordem).toEqual(['freio-comecou', 'freio-terminou', 'excluiu']);
        expect(resultado.ok).toBe(true);
        expect(bancoDeMapasExiste(alvo)).toBe(false);
        // Onze bancos: os dez do atlas mais a fila de saída daquele slot.
        expect(resultado.droppedDatabases).toHaveLength(11);
        expect(drops).toHaveLength(11);

        // E o aviso chegou endereçado pelo SUFIXO do slot (não pelo id), com o motivo do atlas
        // local — o que faz a irmã congelar com o texto certo em vez do de sessão encerrada.
        expect(recebidos).toHaveLength(1);
        expect(recebidos[0].enderecos).toEqual([alvo.dbSuffix]);
        expect(recebidos[0].contexto.reason).toBe(tabLock.TeardownReason.LOCAL_ATLAS_DELETED);
        expect(tabLock.TeardownReason.LOCAL_ATLAS_DELETED)
            .not.toBe(tabLock.TeardownReason.SESSION_ENDED);
    });

    it('a irmã fica FREADA, e o freio não tem volta', async () => {
        const ordem = [];
        const portao = deferred();
        portao.resolve();
        const alvo = (await api.createLocalAtlas('Alvo')).atlas;
        const { lock } = irmaQueParaDevagar(alvo.id, portao, ordem);

        await api.deleteLocalAtlas(alvo.id);

        expect(lock.frozen).toBe(true);
        // Nem "Usar aqui" traz de volta: não há o que retomar de uma destruição.
        expect(await lock.requestTakeover()).toBe(false);
        expect(lock.frozen).toBe(true);
    });

    it('CONTROLE NEGATIVO: a irmã em OUTRO slot recebe o aviso e NÃO freia', async () => {
        // Mesmo canal, mesma fiação, só o endereço muda. Sem este par, o caso acima passaria também
        // contra um freio que congela ao primeiro aviso que chega.
        const ordem = [];
        const portao = deferred();
        portao.resolve();
        const alvo = (await api.createLocalAtlas('Alvo')).atlas;
        const vizinho = (await api.createLocalAtlas('Vizinho')).atlas;
        const { lock, recebidos } = irmaQueParaDevagar(vizinho.id, portao, ordem);
        await semear(alvo, 'trabalho do alvo');
        await semear(vizinho, 'trabalho do vizinho');
        // A irmã real deste caso responde "não é comigo" comparando o endereço montado.
        lock.setEffects({
            onTeardown: async (enderecos) => {
                recebidos.push({ enderecos });
                return enderecos.includes(vizinho.dbSuffix);
            }
        });

        await api.deleteLocalAtlas(alvo.id);

        expect(recebidos.at(-1).enderecos).toEqual([alvo.dbSuffix]);
        expect(lock.frozen).toBe(false);
        // E o dado dela continua onde estava: o aviso é sobre UM endereço, e a exclusão também.
        expect(bancoDeMapasExiste(vizinho)).toBe(true);
        expect(await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(vizinho))
            .getItem('Principal')).toEqual({ nome: 'trabalho do vizinho' });
        expect(bancoDeMapasExiste(alvo)).toBe(false);
    });

    it('uma irmã MUDA custa o tempo limite e nada mais: a exclusão acontece', async () => {
        // O silêncio degrada para o comportamento anterior ao aviso. Quem autoriza a destruição é o
        // gesto do usuário, não o ack: uma aba travada não pode tomar refém a exclusão.
        const alvo = (await api.createLocalAtlas('Alvo')).atlas;
        const muda = tabLock.createTabLock({
            key: tabLock.localAtlasKey(alvo.id),
            createTransport: () => hub.connect(),
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            teardownTimeoutMs: 60,
            onTeardown: () => new Promise(() => {})   // nunca resolve
        });
        irmas.push(muda);

        const resultado = await api.deleteLocalAtlas(alvo.id);

        expect(resultado.ok).toBe(true);
        expect(drops).toHaveLength(11);
        expect(muda.frozen).toBe(false);
    }, 10000);
});
