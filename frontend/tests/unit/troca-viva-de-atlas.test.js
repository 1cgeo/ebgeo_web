// Path: tests/unit/troca-viva-de-atlas.test.js

/**
 * @fileoverview A TROCA DE ATLAS SEM RECARREGAR A PAGINA (`switchAtlas`), e em especial o RAMO
 * LOCAL, que e a metade nova e a que nao tinha cobertura nenhuma.
 *
 * O QUE A ONDA COMPRA, medido no pacote de producao antes dela: trocar de atlas custava de 1,6 a
 * 2,9 s, e a causa nao era o dado — era a navegacao. Toda troca passava por `atlas.html`, que
 * volta ao mapa por `./?atlas=<uuid>`, e o boot da pagina do mapa executa 4203 kB de JavaScript.
 *
 * ============================ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ==================
 *
 * A especificacao desta onda mandava o ramo local chamar `clearAllDataStore({ markLocal: false,
 * clearQueue: false })`, por analogia com `switchToNewLocalAtlas`. A analogia NAO VALE, e o
 * proprio texto dela se contradizia: o passo seguinte era "ativar o ULTIMO mapa do slot", e um
 * slot esvaziado nao tem ultimo mapa.
 *
 * A medida esta nos casos do GRUPO 1. `clearAllDataStore` chama `unmountCurrentAtlas`, que chama
 * `repository.clearAllAtlasStores()`, que esvazia os DEZ bancos do escopo ATIVO — e a essa altura
 * o escopo ativo ja e o slot de DESTINO. `switchToNewLocalAtlas` pode fazer isso porque o slot
 * dela nasceu vazio uma linha antes (`createLocalAtlas`); um slot que ja existe carrega o
 * trabalho que a pessoa pediu para abrir. O que o wipe entregava ali, e que aqui continua sendo
 * necessario, e OUTRA COISA: derrubar o espelho EM MEMORIA do atlas que a aba deixou. Essa
 * metade, sem a destrutiva, e `adoptMountedLocalAtlas` (`store/map.operations.js`).
 *
 * O caso `o trabalho do slot de destino sobrevive a troca` fica VERMELHO com o wipe no lugar, e e
 * a unica coisa que separa "a troca funciona" de "a troca funciona e apaga o atlas".
 *
 * ============================ O ANDAIME =======================================================
 *
 * O armazenamento e REAL (`fake-indexeddb`, `tests/setup/indexeddb.setup.js`), e toda assercao de
 * dado e por NOME ABSOLUTO de banco (`tests/helpers/idb-helpers.js`): um mock de `localforage`
 * com um `Map` nao distingue banco AUSENTE de banco VAZIO, que e exatamente a distincao aqui.
 *
 * O relogio e falso pelo mesmo motivo de `tests/unit/multiaba-invariantes.test.js`: o boot da
 * store agenda um `setTimeout(..., 100)` que ninguem aguarda, ele REABRE o banco do escopo que
 * seu grafo montou, e onde ele aterrissa e decidido por relogio de parede.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetIndexedDB, readKey, listDatabases } from '../helpers/idb-helpers.js';

vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn()
}));

/**
 * O motor de sincronismo: o socket nao e o que se mede aqui.
 *
 * `disconnect` ESPELHA O CONTRATO REAL em vez de zerar sempre, e a diferenca importa: se o duble
 * esquecesse o atlas incondicionalmente, o caso da chave do tab-lock ficaria verde mesmo com
 * `switchAtlas` chamando `disconnect()` sem bandeira, que e justamente o defeito. Quem prova que
 * o motor de verdade obedece a bandeira e `tests/integration/sync-engine.test.js`.
 */
const engine = vi.hoisted(() => ({ atlasId: null }));
engine.disconnect = vi.fn((opcoes) => { if (opcoes?.forgetAtlas) engine.atlasId = null; });
engine.connect = vi.fn(async (atlasId) => { engine.atlasId = atlasId; });
engine.logoutAndDisconnect = vi.fn(async () => { engine.atlasId = null; });
vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: engine }));
vi.mock('@store/sync/sync-flush.js', () => ({ startAutoFlush: vi.fn(), stopAutoFlush: vi.fn() }));
vi.mock('@store/atlas-appearance.service.js', () => ({
    reapplyAtlasAppearance: vi.fn(async () => {})
}));

/**
 * O tab-lock CONCEDE, e so as duas funcoes que TOMAM uma reivindicacao sao dubles; as fabricas de
 * chave e o predicado ficam reais, porque `tests/unit/tab-lock.test.js` e o dono da arbitragem e
 * aqui so se pergunta o que a chave promete sobre bancos.
 *
 * NAO E CONVENIENCIA: o `TabLock` real e um singleton de modulo sobre um BroadcastChannel que
 * `vi.resetModules()` nao desmonta, entao a instancia de um caso anterior segue respondendo como
 * um PAR vivo e a reivindicacao seguinte e recusada — o fluxo nunca chegaria ao codigo sob teste.
 */
const trava = vi.hoisted(() => ({
    acquire: vi.fn(async () => ({ granted: true, blockedBy: null, degraded: false, deniedBy: null })),
    setKey: vi.fn(),
    estado: { key: null, blocked: false }
}));
vi.mock('@utils/tab-lock.js', async (importOriginal) => ({
    ...await importOriginal(),
    acquireTabLock: trava.acquire,
    getTabLock: () => trava.estado,
    setTabLockKey: trava.setKey
}));

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';

/** Chaves-sentinela distintas: uma chave para dois escritores nao diz qual deles chegou. */
const SENT_LOCAL = '__sentinela_trabalho_local__';
const SENT_SERVIDOR = '__sentinela_dado_de_servidor__';

/** O nome do mapa que so existe no slot de destino. */
const MAPA_DO_SLOT = 'Mapa do slot B';

const memoriaLocal = (() => {
    let dados = new Map();
    return {
        getItem: k => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: k => { dados.delete(k); },
        clear: () => { dados = new Map(); }
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: memoriaLocal, writable: true });
}

let ns, remoteApi, localApi, origem, servico, barramento;

/**
 * TETO DO `beforeEach`. O padrao do vitest e 10 s, e o preparo daqui roda o boot da store por
 * inteiro (container de servicos, resolvedor de mapas, registro local) sobre `fake-indexeddb`.
 * Na primeira rodada do arquivo isso soma a transformacao dos modulos e passa dos 10 s numa
 * maquina carregada. Subir o teto nao mascara defeito: um preparo que TRAVE continua reprovando,
 * agora dizendo que travou em vez de estourar por uma diferenca de carga da maquina.
 */
const TETO_DE_PREPARO_MS = 60000;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await resetIndexedDB();
    globalThis.localStorage.clear();
    engine.atlasId = null;
    trava.estado = { key: null, blocked: false };
    trava.acquire.mockImplementation(
        async () => ({ granted: true, blockedBy: null, degraded: false, deniedBy: null })
    );

    // DEPOIS de `resetIndexedDB`, que precisa de relogio real para o proprio limite de um delete.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    ns = await import('@store/atlas-namespace.js');
    remoteApi = await import('@store/remote-atlas.api.js');
    localApi = await import('@store/local-atlas.api.js');
    origem = await import('@store/store-origin.js');

    const { initServices } = await import('@store/services.js');
    const { awaitMapResolverReady } = await import('@store/services/map-resolver.service.js');
    const { disableOperationLogging } = await import('@store/sync/operation-dispatcher.js');
    initServices();
    await awaitMapResolverReady();
    disableOperationLogging();
    barramento = (await import('@store/services.js')).getEventBus();

    servico = await import('@js/account/open-atlas.service.js');
}, TETO_DE_PREPARO_MS);

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * Avanca o laco por ORDEM (voltas da fila de macrotarefas), nunca por milissegundos:
 * `fake-indexeddb` agenda o proprio trabalho em `setImmediate`, que o relogio falso nao troca.
 * @param {number} [voltas=30]
 * @returns {Promise<void>}
 */
async function voltasDoLaco(voltas = 30) {
    for (let i = 0; i < voltas; i += 1) {
        await new Promise(resolve => { globalThis.setImmediate(resolve); });
    }
}

/** @param {string} suffix @returns {string} O nome absoluto do banco de mapas de um sufixo. */
const mapsDb = suffix => (suffix ? `ebgeo_maps__${suffix}` : 'ebgeo_maps');

/**
 * @param {string} dbName @param {string} key
 * @returns {Promise<boolean>} Se a sentinela e legivel la. Nunca CRIA o banco, entao um `false`
 *   nao pode ser artefato da leitura.
 */
async function vivo(dbName, key) {
    return (await readKey(dbName, key)) !== null;
}

/**
 * O cenario de todos os casos do GRUPO 1: a aba esta num atlas de SERVIDOR (X) e existe um slot
 * LOCAL (B) com trabalho dentro dele.
 *
 * O trabalho de B e escrito PELA FABRICA de escopos, no escopo de B, e nao pelo escopo montado:
 * escrever no escopo ativo mediria outra coisa.
 * @returns {Promise<{slot: object, escopoB: object}>}
 */
async function abaEmAtlasDeServidorComSlotLocal() {
    await localApi.initLocalAtlases();
    const criado = await localApi.createLocalAtlas('Slot B');
    expect(criado.ok, 'o slot de destino foi criado').toBe(true);
    const slot = criado.atlas;
    const escopoB = localApi.scopeOfLocalAtlas(slot);

    // O TRABALHO DE B: um mapa proprio, o ponteiro de ultimo mapa ativo apontando para ele, e uma
    // sentinela em todos os dez bancos do slot. Os tres medem coisas diferentes — o mapa mede a
    // ativacao, o ponteiro mede QUAL mapa, e a sentinela mede a sobrevivencia banco a banco.
    await ns.getStoreFor(ns.StoreName.MAPS, escopoB).setItem(MAPA_DO_SLOT, {
        id: 'b0000000-0000-4000-8000-000000000001',
        name: MAPA_DO_SLOT,
        features: [], layers: [], groups: []
    });
    await ns.getStoreFor(ns.StoreName.SETTINGS, escopoB).setItem('lastActiveMap', MAPA_DO_SLOT);
    for (const { store } of ns.listAtlasStores(escopoB)) await store.setItem(SENT_LOCAL, { slot: slot.id });

    // E a aba entra num atlas de SERVIDOR, que e de onde a troca parte.
    await remoteApi.activateRemoteAtlas(X);
    await origem.markStoreRemote(X);
    for (const { store } of ns.listAtlasStores(ns.remoteScope(X))) {
        await store.setItem(SENT_SERVIDOR, { atlas: X });
    }
    engine.atlasId = X;

    return { slot, escopoB };
}

// =====================================================================================
// GRUPO 1 — o ramo LOCAL entra no slot e NAO o destroi
// =====================================================================================

describe('a troca ao vivo para um atlas local que ja existe', () => {
    // VERMELHO SE: o cenario parar de ser montado. Sem ele, "sobreviveu" abaixo nao distingue a
    // correcao de um teste que nunca escreveu nada em B nem montou X.
    it('CONTROLE: o "antes" e o que os casos afirmam — B tem trabalho e a aba esta em X', async () => {
        const { slot, escopoB } = await abaEmAtlasDeServidorComSlotLocal();

        expect(await vivo(mapsDb(escopoB.dbSuffix), SENT_LOCAL)).toBe(true);
        expect(await readKey(mapsDb(escopoB.dbSuffix), MAPA_DO_SLOT)).not.toBeNull();
        expect(await vivo(mapsDb(`remote-${X}`), SENT_SERVIDOR)).toBe(true);
        // A aba escreve, agora, nos bancos do atlas de SERVIDOR.
        expect(ns.resolveDbName(ns.StoreName.MAPS, ns.getActiveScope())).toBe(mapsDb(`remote-${X}`));
        expect(origem.isRemoteStoreSync()).toBe(true);
        expect(slot.id).toBeTruthy();
    });

    // O CASO CENTRAL DESTE ARQUIVO. Com `clearAllDataStore` no ramo local ele fica VERMELHO nas
    // tres asercoes: o wipe esvazia os dez bancos do escopo ATIVO, que a esta altura ja e B.
    it('o trabalho do slot de destino SOBREVIVE a troca', async () => {
        const { slot, escopoB } = await abaEmAtlasDeServidorComSlotLocal();

        const resultado = await servico.switchAtlas({ kind: 'local', atlasId: slot.id });
        await voltasDoLaco();

        expect(resultado).toEqual({ ok: true, changed: true });
        // Os dez bancos do slot continuam com a sentinela...
        expect(await vivo(mapsDb(escopoB.dbSuffix), SENT_LOCAL)).toBe(true);
        // ...o mapa proprio do slot continua gravado...
        expect(await readKey(mapsDb(escopoB.dbSuffix), MAPA_DO_SLOT)).not.toBeNull();
        // ...e ele e o mapa CORRENTE, que e o passo "ativar o ultimo mapa do slot". Estas duas
        // asercoes nao sao a mesma: a primeira e sobre o disco, a segunda sobre o que a tela usa.
        const { getCurrentMapNameSync } = await import('@store');
        expect(getCurrentMapNameSync()).toBe(MAPA_DO_SLOT);
    });

    it('a aba passa a ENDERECAR os bancos do slot, e declara a origem LOCAL', async () => {
        const { slot, escopoB } = await abaEmAtlasDeServidorComSlotLocal();

        await servico.switchAtlas({ kind: 'local', atlasId: slot.id });
        await voltasDoLaco();

        // A troca aconteceu de verdade: sem esta linha, "o trabalho sobreviveu" seria satisfeito
        // por uma funcao que nao faz nada.
        expect(ns.resolveDbName(ns.StoreName.MAPS, ns.getActiveScope()))
            .toBe(mapsDb(escopoB.dbSuffix));
        expect(origem.isRemoteStoreSync()).toBe(false);
        expect(ns.getActiveScope().atlasId).toBe(slot.id);
    });

    it('o namespace do atlas de SERVIDOR que a aba deixou fica intacto', async () => {
        const { slot } = await abaEmAtlasDeServidorComSlotLocal();

        await servico.switchAtlas({ kind: 'local', atlasId: slot.id });
        await voltasDoLaco();

        // Sair de um projeto do servidor nao apaga a copia local dele: ela e reaproveitada na
        // proxima abertura, e a fila de saida dele mora ali dentro.
        expect(await vivo(mapsDb(`remote-${X}`), SENT_SERVIDOR)).toBe(true);
    });

    it('a ordem: reivindica ANTES de montar, e desconecta ESQUECENDO o atlas', async () => {
        const { slot } = await abaEmAtlasDeServidorComSlotLocal();

        await servico.switchAtlas({ kind: 'local', atlasId: slot.id });
        await voltasDoLaco();

        // A reivindicacao existe e nomeia o slot: montar por cima e o passo que redireciona toda
        // escrita seguinte, e uma aba so pode montar o que reivindicou.
        expect(trava.acquire).toHaveBeenCalledTimes(1);
        const [chave, opcoes] = trava.acquire.mock.calls[0];
        expect(chave).toMatchObject({ kind: 'local', atlasId: slot.id });
        // COM TESTEMUNHA. Um `acquire` sem ela volta a ser concedido por ausencia de prova.
        expect(typeof opcoes?.witness).toBe('function');
        // E a desconexao ESQUECE o atlas, senao a chave do tab-lock sairia com o id remoto velho.
        expect(engine.disconnect).toHaveBeenCalledWith({ forgetAtlas: true });
    });

    // A CONSEQUENCIA do `forgetAtlas`, medida onde ela doi: `currentAtlasLockKey` le
    // `syncEngine.atlasId` ANTES do escopo. Sem o esquecimento, esta aba anunciaria `remote:X`
    // enquanto escreve no slot local — bloqueando outra aba por um atlas que ninguem tem aberto.
    it('a chave do tab-lock passa a nomear o SLOT LOCAL, e nao o atlas de servidor deixado', async () => {
        const { slot } = await abaEmAtlasDeServidorComSlotLocal();

        await servico.switchAtlas({ kind: 'local', atlasId: slot.id });
        await voltasDoLaco();

        expect(servico.currentAtlasLockKey()).toMatchObject({ kind: 'local', atlasId: slot.id });
    });

    it('anuncia ATLAS_SWITCHED depois de tudo pronto', async () => {
        const { slot, escopoB } = await abaEmAtlasDeServidorComSlotLocal();
        const visto = [];
        barramento.on('atlas:switched', (payload) => {
            // O ENDERECO JA TEM DE ESTAR TROCADO quando o aviso sai: um painel que releia a store
            // dentro deste handler tem de ler o atlas NOVO, senao o aviso e inutil.
            visto.push({
                payload,
                escopo: ns.resolveDbName(ns.StoreName.MAPS, ns.getActiveScope())
            });
        });

        await servico.switchAtlas({ kind: 'local', atlasId: slot.id });
        await voltasDoLaco();

        expect(visto).toHaveLength(1);
        expect(visto[0].payload).toEqual({ kind: 'local', atlasId: slot.id, mapId: null });
        expect(visto[0].escopo).toBe(mapsDb(escopoB.dbSuffix));
    });

    it('um slot que nao existe e uma recusa NOMEADA, e nada se move', async () => {
        await abaEmAtlasDeServidorComSlotLocal();

        const resultado = await servico.switchAtlas({ kind: 'local', atlasId: Y });

        expect(resultado).toEqual({ ok: false, changed: false, reason: 'not-found' });
        // Nada foi reivindicado, nada foi desconectado, e a aba continua no atlas de servidor.
        expect(trava.acquire).not.toHaveBeenCalled();
        expect(engine.disconnect).not.toHaveBeenCalled();
        expect(ns.resolveDbName(ns.StoreName.MAPS, ns.getActiveScope())).toBe(mapsDb(`remote-${X}`));
    });

    it('reivindicacao RECUSADA para a troca antes de montar qualquer coisa', async () => {
        const { slot } = await abaEmAtlasDeServidorComSlotLocal();
        trava.acquire.mockImplementation(
            async () => ({ granted: false, blockedBy: { tabId: 'irma' }, degraded: false, deniedBy: 'peer' })
        );

        const resultado = await servico.switchAtlas({ kind: 'local', atlasId: slot.id });

        expect(resultado).toEqual({ ok: false, changed: false, reason: 'peer' });
        // A aba continua exatamente onde estava: nem o escopo nem o socket foram tocados.
        expect(engine.disconnect).not.toHaveBeenCalled();
        expect(ns.resolveDbName(ns.StoreName.MAPS, ns.getActiveScope())).toBe(mapsDb(`remote-${X}`));
        expect(engine.atlasId).toBe(X);
    });
});

// =====================================================================================
// GRUPO 2 — a guarda de no-op
//
// `acquire()` carimba um `claimedAt` novo e a ordem total do tab-lock e `claimedAt` primeiro,
// entao re-reivindicar o atlas que esta aba JA tem montado a manda para o fim da fila e entrega
// o proprio atlas a quem esperava atras dela. A guarda nao e otimizacao.
// =====================================================================================

describe('a guarda de no-op', () => {
    it('trocar para o atlas de SERVIDOR ja conectado nao toca em nada', async () => {
        await abaEmAtlasDeServidorComSlotLocal();

        const resultado = await servico.switchAtlas({ kind: 'remote', atlasId: X });

        expect(resultado).toEqual({ ok: true, changed: false });
        expect(trava.acquire).not.toHaveBeenCalled();
        expect(engine.disconnect).not.toHaveBeenCalled();
        expect(engine.connect).not.toHaveBeenCalled();
    });

    it('trocar para o slot LOCAL ja montado nao toca em nada', async () => {
        const { slot } = await abaEmAtlasDeServidorComSlotLocal();
        await servico.switchAtlas({ kind: 'local', atlasId: slot.id });
        await voltasDoLaco();
        vi.clearAllMocks();

        const resultado = await servico.switchAtlas({ kind: 'local', atlasId: slot.id });

        expect(resultado).toEqual({ ok: true, changed: false });
        expect(trava.acquire).not.toHaveBeenCalled();
    });

    // DISCRIMINACAO: a guarda tem de deixar passar o que E uma troca, senao ela seria um `return`
    // incondicional e os casos acima ficariam verdes com a funcao inteira desligada.
    it('DISCRIMINACAO: um destino DIFERENTE atravessa a guarda', async () => {
        const { slot } = await abaEmAtlasDeServidorComSlotLocal();

        const resultado = await servico.switchAtlas({ kind: 'local', atlasId: slot.id });
        await voltasDoLaco();

        expect(resultado.changed).toBe(true);
        expect(trava.acquire).toHaveBeenCalledTimes(1);
    });

    it('um destino sem id, ou de tipo desconhecido, FALHA ALTO em vez de virar no-op', async () => {
        await abaEmAtlasDeServidorComSlotLocal();

        await expect(servico.switchAtlas({ kind: 'local' })).rejects.toThrow(/atlasId/);
        await expect(servico.switchAtlas({ kind: 'inventado', atlasId: X }))
            .rejects.toThrow(/unknown destination kind/);
    });
});

// =====================================================================================
// GRUPO 3 — o ramo REMOTO delega, e nao reimplementa
//
// A regra vem do proprio repositorio: o comentario de `AccountControl.openProjectPicker` conta
// que o pipeline de abertura vivia em DOIS ramos duplicados e que a navegacao foi o preco pago
// para ter um dono unico. Uma quarta copia dos passos aqui desfaz essa compra. O recorte e a
// FUNCAO, pelo motivo do ATAQUE 0 de `tests/unit/tab-lock-refutacao.test.js`.
// =====================================================================================

describe('o ramo remoto nao ganha um pipeline proprio', () => {
    /**
     * O corpo de `switchAtlas`, sem comentario, do cabecalho ate a proxima declaracao de topo.
     * @returns {Promise<string>}
     */
    async function corpoDeSwitchAtlas() {
        const { readFileSync } = await import('node:fs');
        const { dirname, resolve } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');
        const fonte = readFileSync(resolve(raiz, 'account/open-atlas.service.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(/\r?\n/).map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
        const inicio = fonte.indexOf('export async function switchAtlas');
        expect(inicio, 'a funcao existe').toBeGreaterThan(-1);
        const fim = fonte.indexOf('\nfunction isMountedAtlas', inicio);
        expect(fim, 'o recorte para no fim da funcao').toBeGreaterThan(inicio);
        return fonte.slice(inicio, fim);
    }

    it('ele chama `openRemoteAtlas` e mais nada do pipeline', async () => {
        const corpo = await corpoDeSwitchAtlas();

        // CONTROLE POSITIVO DO RECORTE: sem ele, um `indexOf` que casasse um trecho vazio faria
        // todo `not.toMatch` abaixo passar provando nada.
        expect(corpo).toMatch(/(^|[^\w.])openRemoteAtlas\s*\(/m);

        // E nenhum dos passos que ela ja da: repeti-los aqui seria a quarta copia.
        for (const passo of ['clearAllDataStore', 'markStoreRemote', 'activateRemoteAtlas',
            'activateAtlasInitialMap', 'startAutoFlush']) {
            expect(corpo, `switchAtlas reimplementa ${passo}`)
                .not.toMatch(new RegExp(`(^|[^\\w.])${passo}\\s*\\(`, 'm'));
        }
    });

    it('e o ramo local reusa `adoptMountedLocalAtlas` em vez de esvaziar a store', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, resolve } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');
        const fonte = readFileSync(resolve(raiz, 'account/open-atlas.service.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(/\r?\n/).map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
        const inicio = fonte.indexOf('async function switchToExistingLocalAtlas');
        expect(inicio, 'a funcao existe').toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\nexport async function switchToNewLocalAtlas', inicio));
        expect(corpo.length, 'o recorte nao ficou vazio').toBeGreaterThan(100);

        expect(corpo).toMatch(/(^|[^\w.])adoptMountedLocalAtlas\s*\(/m);
        // A ASERCAO QUE PROTEGE O DADO. O comportamento ja e medido no GRUPO 1; esta linha diz
        // POR QUE, para que quem reintroduzir o wipe leia a razao no lugar em que ele reprova.
        expect(corpo, 'o wipe esvazia o escopo ATIVO, que aqui ja e o slot de destino')
            .not.toMatch(/(^|[^\w.])clearAllDataStore\s*\(/m);
    });

    // CONTROLE DA VARREDURA: os mesmos nomes EXISTEM no arquivo, entao "nao achei em switchAtlas"
    // nao e "esse nome sumiu do modulo".
    it('CONTROLE: os passos do pipeline continuam existindo no arquivo, so que em outra funcao', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, resolve } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');
        const fonte = readFileSync(resolve(raiz, 'account/open-atlas.service.js'), 'utf8');

        for (const passo of ['clearAllDataStore', 'markStoreRemote', 'activateRemoteAtlas']) {
            expect(fonte).toMatch(new RegExp(`(^|[^\\w.])${passo}\\s*\\(`, 'm'));
        }
    });
});

// =====================================================================================
// GRUPO 4 — higiene do andaime
// =====================================================================================

describe('higiene', () => {
    it('CONTROLE DO ANDAIME: os bancos que os casos leem existem mesmo no fake-indexeddb', async () => {
        const { escopoB } = await abaEmAtlasDeServidorComSlotLocal();
        const bancos = await listDatabases();

        expect(bancos).toContain(mapsDb(escopoB.dbSuffix));
        expect(bancos).toContain(mapsDb(`remote-${X}`));
    });
});
