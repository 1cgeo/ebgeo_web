// Path: tests/unit/reivindicacao-de-atlas-remoto.test.js

/**
 * @fileoverview O ATALHO DE `claimRemoteAtlas`, que era a porta por onde a segunda aba entrava
 * num atlas que a primeira segurava (caso A2b de `tests/e2e-ui/browser-multi-tab-namespace.spec.js`).
 *
 * O DEFEITO, MEDIDO NO NAVEGADOR: duas abas do mesmo perfil no MESMO atlas de servidor. A segunda
 * mostra o overlay de bloqueio e, cerca de dois segundos depois, CONECTA assim mesmo — as duas
 * ficam online no mesmo atlas, uma delas atrás de uma tela que diz que ela está parada.
 *
 * A CAUSA, e ela não é a que a spec suspeitava. O caminho até o `connect` passa por
 * `claimRemoteAtlas`, e a primeira linha executável dele NÃO era `acquireTabLock`: era um atalho
 * que respondia "esta aba já tem esse atlas" a partir da CHAVE ANUNCIADA (`getTabLock().key`).
 * Essa chave é derivada no boot por `currentAtlasLockKey()`, do escopo que
 * `activateBootAtlasScope` montou, que por sua vez vem de `resolveTabMountOrigin` — e este cai no
 * marcador de origem da INSTALAÇÃO quando a aba não tem ponteiro próprio
 * (`store/store-origin.js`). Ou seja: uma aba recém-aberta anuncia o atlas da IRMÃ antes de ter
 * ouvido um par sequer, e o atalho lia isso como direito adquirido. O settle, a ordem total e a
 * testemunha do lock de montagem eram pulados de uma vez, e o open seguia até o `connect`.
 *
 * O QUE ESTE ARQUIVO PRENDE, e por que ele é comportamental e não uma varredura de fonte: o
 * conserto é uma CONDIÇÃO, e uma condição se prova dirigindo os dois lados dela. Os quatro casos
 * são o par de contrastes que a correção tem de sustentar ao mesmo tempo —
 *
 *   1. a aba que só HERDOU a chave arbitra de verdade (era o defeito);
 *   2. a aba que GANHOU a arbitragem reentra pelo atalho (é a razão de o atalho existir: `acquire`
 *      carimba um `claimedAt` novo, e re-carimbar entrega o atlas a quem esperava atrás);
 *   3. o replay do open adiado ("Usar aqui") continua entrando pelo atalho — sem isto o conserto
 *      quebraria o handoff, porque a aba que cede MANTÉM o lock de montagem (decisão de E2) e a
 *      testemunha recusaria o requerente;
 *   4. a testemunha do open conta a montagem DESTA aba como dela, senão um F5 numa aba sozinha no
 *      próprio atlas se recusa a si mesma.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// O ambiente do módulo. Só o tab-lock é parcialmente real (as fábricas de chave e o predicado de
// igualdade são o vocabulário que o serviço usa); todo o resto da store é dublê, porque o que se
// mede aqui é a DECISÃO de reivindicar, não o que acontece depois dela.
// ============================================================================

const { locks } = vi.hoisted(() => ({ locks: { query: vi.fn(async () => ({ held: [], pending: [] })) } }));

const tabLock = vi.hoisted(() => ({
    estado: { key: null, blocked: false },
    acquire: vi.fn(),
    otherClientHoldsLock: vi.fn(async () => false)
}));

vi.mock('@utils/tab-lock.js', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        getTabLock: () => tabLock.estado,
        acquireTabLock: tabLock.acquire,
        setTabLockKey: vi.fn((key) => { tabLock.estado.key = key; }),
        releaseTabLock: vi.fn(() => { tabLock.estado.key = real.noneKey(); }),
        otherClientHoldsLock: tabLock.otherClientHoldsLock
    };
});

const store = vi.hoisted(() => ({
    clearAllDataStore: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {}),
    activateAtlasInitialMap: vi.fn(async () => {}),
    activateRemoteAtlas: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    activeScope: null
}));

vi.mock('@store/store.js', () => ({
    clearAllDataStore: store.clearAllDataStore,
    markStoreRemote: store.markStoreRemote,
    markStoreLocal: store.markStoreLocal,
    activateAtlasInitialMap: store.activateAtlasInitialMap,
    activateRemoteAtlas: store.activateRemoteAtlas
}));

vi.mock('@store/sync/sync-engine.js', () => ({
    syncEngine: {
        get atlasId() { return store.liveAtlasId ?? null; },
        connect: store.connect,
        disconnect: store.disconnect
    }
}));

vi.mock('@store', () => ({ getControl: vi.fn(() => null), getEventBus: vi.fn(() => ({ emit: vi.fn() })) }));
// A ENTRADA EM ATLAS LOCAL AO VIVO entrou no mesmo modulo (`switchAtlas`), e ela importa a
// adocao do slot montado. Sem este duble o import real arrasta a store inteira por
// `permission-guard` -> `store-origin` -> `atlas-namespace`, e o duble estreito de
// `atlas-namespace` acima quebra o carregamento do modulo sob teste. Nenhum caso deste arquivo
// entra em atlas local: o que se mede aqui e a DECISAO de reivindicar um atlas de servidor.
vi.mock('@store/map.operations.js', () => ({ adoptMountedLocalAtlas: vi.fn(async () => 'Principal') }));
vi.mock('@store/sync/sync-flush.js', () => ({ startAutoFlush: vi.fn(), stopAutoFlush: vi.fn() }));
vi.mock('@store/local-atlas.api.js', () => ({
    createLocalAtlas: vi.fn(),
    getLocalAtlas: vi.fn(() => null),
    localAtlasAdoptingRemote: vi.fn(async () => null),
    mountLocalAtlas: vi.fn(),
    releaseAdoptedLocalAtlas: vi.fn(async () => {}),
    scopeOfLocalAtlas: vi.fn((entry) => ({ kind: 'local', atlasId: entry.id, dbSuffix: entry.dbSuffix }))
}));
vi.mock('@store/atlas-namespace.js', () => ({
    getActiveScope: () => store.activeScope,
    remoteAtlasIdFromDbSuffix: (suffix) => (String(suffix).startsWith('remote-') ? String(suffix).slice(7) : null),
    StoreScopeKind: { LOCAL: 'local', REMOTE: 'remote' },
    atlasMountLockName: (suffix) => `ebgeo-atlas:${suffix}`,
    hasMountLockSupport: () => true,
    remoteScope: (atlasId) => ({ kind: 'remote', atlasId, dbSuffix: `remote-${atlasId}` })
}));
vi.mock('@store/repositories/local.repository.js', () => ({ ensureAtlasScope: vi.fn() }));
vi.mock('@modals/confirm.modal.js', () => ({ showChoice: vi.fn(async () => 'cancel') }));
vi.mock('@utils/toast_service.js', () => ({ showError: vi.fn() }));
vi.mock('@store/atlas-appearance.service.js', () => ({ reapplyAtlasAppearance: vi.fn(async () => {}) }));

const X = '11111111-1111-4111-8111-111111111111';

let svc;
let remoteAtlasKey;

/** Grants every claim from here on. @returns {void} */
function arbitragemConcede() {
    tabLock.acquire.mockImplementation(async (key) => {
        tabLock.estado.key = key;
        return { granted: true, blockedBy: null, degraded: false, deniedBy: null };
    });
}

/** Refuses every claim from here on, as a peer that precedes would. @returns {void} */
function arbitragemRecusa() {
    tabLock.acquire.mockImplementation(async (key) => {
        tabLock.estado.key = key;
        tabLock.estado.blocked = true;
        return { granted: false, blockedBy: { tabId: 'irma' }, degraded: false, deniedBy: 'peer' };
    });
}

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { locks });
    store.liveAtlasId = null;
    store.activeScope = null;
    tabLock.estado = { key: null, blocked: false };
    tabLock.otherClientHoldsLock.mockResolvedValue(false);
    svc = await import('@js/account/open-atlas.service.js');
    ({ remoteAtlasKey } = await import('@utils/tab-lock.js'));
});

describe('o atalho de reivindicação distingue arbitragem GANHA de chave HERDADA', () => {
    // VERMELHO ANTES DA CORREÇÃO: com o atalho lendo só a chave anunciada, `acquireTabLock` nunca
    // era chamado, `openRemoteAtlas` devolvia true e o open ia até `connect` — que é exatamente a
    // aba bloqueada aparecendo online no atlas da irmã.
    it('a aba que só HERDOU a chave no boot arbitra de verdade, e a recusa PARA o open', async () => {
        // O estado que o boot produz numa segunda aba: escopo e chave já nomeiam o atlas da irmã
        // (marcador de origem da instalação), sem uma única mensagem de par trocada.
        store.activeScope = { kind: 'remote', atlasId: X, dbSuffix: `remote-${X}` };
        tabLock.estado = { key: remoteAtlasKey(X), blocked: false };
        arbitragemRecusa();

        const abriu = await svc.openRemoteAtlas(X);

        expect(tabLock.acquire, 'a chave herdada não dispensa a arbitragem').toHaveBeenCalledTimes(1);
        expect(abriu).toBe(false);
        // E a recusa para ANTES de qualquer coisa destrutiva ou visível.
        expect(store.activateRemoteAtlas).not.toHaveBeenCalled();
        expect(store.clearAllDataStore).not.toHaveBeenCalled();
        expect(store.connect, 'a aba recusada não conecta').not.toHaveBeenCalled();
    });

    // CONTROLE POSITIVO DO MESMO CAMINHO: sem ele, "não abriu" seria indistinguível de um
    // `openRemoteAtlas` que parou de abrir para todo mundo.
    it('CONTROLE: concedida a arbitragem, a MESMA aba herdeira abre e conecta', async () => {
        store.activeScope = { kind: 'remote', atlasId: X, dbSuffix: `remote-${X}` };
        tabLock.estado = { key: remoteAtlasKey(X), blocked: false };
        arbitragemConcede();

        expect(await svc.openRemoteAtlas(X)).toBe(true);
        expect(tabLock.acquire).toHaveBeenCalledTimes(1);
        expect(store.activateRemoteAtlas).toHaveBeenCalledWith(X);
        expect(store.connect).toHaveBeenCalledWith(X, { initialPull: true });
    });

    // A RAZÃO DE O ATALHO EXISTIR, e ela continua valendo: `acquire` carimba um `claimedAt` novo e
    // a ordem é por `claimedAt`, então uma aba que reabre o atlas em que já está se jogaria para o
    // fim da fila e entregaria o próprio atlas a quem esperava atrás dela.
    it('a aba que GANHOU a arbitragem reentra no MESMO atlas sem re-carimbar a ordem', async () => {
        tabLock.estado = { key: null, blocked: false };
        arbitragemConcede();
        expect(await svc.openRemoteAtlas(X)).toBe(true);
        expect(tabLock.acquire).toHaveBeenCalledTimes(1);

        // A reentrada (replay de deep link, troca de mapa que reabre o atlas).
        expect(await svc.openRemoteAtlas(X)).toBe(true);
        expect(tabLock.acquire, 'a reentrada não volta para o fim da ordem').toHaveBeenCalledTimes(1);
    });

    // A OUTRA METADE DA EVIDÊNCIA, e ela cobre um caminho que não passa por `claimRemoteAtlas`:
    // `saveLocalToServer` reivindica o atlas novo direto no lock (`account.control.js`) e conecta.
    // Uma aba VIVA num atlas ganhou o direito a ele por definição — `syncEngine.atlasId` só é
    // escrito por um open que já passou por este mesmo pré-voo.
    it('a aba VIVA no atlas reentra pelo atalho mesmo sem ter passado por aqui antes', async () => {
        store.liveAtlasId = X;
        store.activeScope = { kind: 'remote', atlasId: X, dbSuffix: `remote-${X}` };
        tabLock.estado = { key: remoteAtlasKey(X), blocked: false };

        expect(await svc.openRemoteAtlas(X)).toBe(true);

        expect(tabLock.acquire, 'a aba viva no atlas não volta para o fim da ordem')
            .not.toHaveBeenCalled();
    });

    // O HANDOFF, e este caso é o que impede o conserto de virar uma regressão em "Usar aqui". A
    // aba que cede MANTÉM o lock de montagem (decisão de E2 em `tab-lock-sync-brake.js`), então a
    // testemunha recusaria o requerente se o replay tivesse de arbitrar de novo. O desbloqueio JÁ
    // É a arbitragem: o lock só o executa quando nenhum par vivo em colisão precede esta aba.
    it('o replay do open adiado entra pelo atalho, porque o desbloqueio é a arbitragem', async () => {
        store.activeScope = { kind: 'remote', atlasId: X, dbSuffix: `remote-${X}` };
        tabLock.estado = { key: remoteAtlasKey(X), blocked: false };
        arbitragemRecusa();
        expect(await svc.openRemoteAtlas(X)).toBe(false);
        expect(tabLock.acquire).toHaveBeenCalledTimes(1);

        // "Usar aqui": a irmã parou e retratou, o lock desbloqueia esta aba e chama `onResumed`.
        tabLock.estado.blocked = false;
        expect(await svc.resumeDeferredAtlasOpen()).toBe(true);

        expect(tabLock.acquire, 'o replay não re-arbitra o que o desbloqueio já decidiu')
            .toHaveBeenCalledTimes(1);
        expect(store.connect).toHaveBeenCalledWith(X, { initialPull: true });
    });

    // CONTROLE NEGATIVO DO CASO ACIMA: o desbloqueio credencia UM atlas, não a aba inteira. Sem
    // isto, gravar a vitória no resume seria um cheque em branco para o próximo open.
    it('o desbloqueio credencia só o atlas da chave, e outro atlas volta a arbitrar', async () => {
        const Y = '22222222-2222-4222-8222-222222222222';
        tabLock.estado = { key: remoteAtlasKey(X), blocked: false };
        svc.deferAtlasOpen(async () => true);
        expect(await svc.resumeDeferredAtlasOpen()).toBe(true);

        arbitragemConcede();
        expect(await svc.openRemoteAtlas(Y)).toBe(true);
        expect(tabLock.acquire, 'abrir OUTRO atlas é outra reivindicação').toHaveBeenCalledTimes(1);
    });
});

describe('a testemunha do open não lê a própria montagem como um par', () => {
    // O 0 fixo que havia aqui valia sob a premissa de que a aba já montada nunca chegava à
    // testemunha, porque o atalho respondia antes. Com o atalho exigindo arbitragem ganha, um F5
    // numa aba SOZINHA no próprio atlas chega aqui segurando o lock que a testemunha conta.
    it('conta 1 quando o escopo ATIVO é o mesmo endereço', async () => {
        store.activeScope = { kind: 'remote', atlasId: X, dbSuffix: `remote-${X}` };

        await svc.remoteMountWitness(X)();

        expect(tabLock.otherClientHoldsLock)
            .toHaveBeenCalledWith(locks, `ebgeo-atlas:remote-${X}`, 1);
    });

    it('conta 0 quando esta aba tem OUTRO endereço montado', async () => {
        store.activeScope = { kind: 'local', atlasId: 'slot-1', dbSuffix: 'slot-1' };

        await svc.remoteMountWitness(X)();

        expect(tabLock.otherClientHoldsLock)
            .toHaveBeenCalledWith(locks, `ebgeo-atlas:remote-${X}`, 0);
    });
});
