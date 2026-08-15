// Path: tests/integration/tab-lock-atlas-integration.test.js

/**
 * @fileoverview The tab lock wired to the real atlas lifecycle.
 *
 * The protocol itself is pinned by `tests/unit/tab-lock.test.js`. What is measured HERE is the
 * integration: that every collision is answered BEFORE `clearAllDataStore()` (the wipe empties the
 * databases of the atlas this tab has mounted, which are another tab's live databases whenever the
 * two hold the same atlas), that a refusal erases NOTHING, that a claim this tab cannot honour is
 * RETRACTED, and that the announced key follows the atlas through the flows that change it without
 * a reload.
 *
 * The BOOT wipes get their own section, because they had no pre-flight at all and they are the one
 * place where reading `blocked` cannot substitute for an awaited claim.
 *
 * The lock is the REAL module on a fake in-process transport, with a second instance standing in
 * for the other tab. Mocking the lock here would only prove that the mock was called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ------------------------------------------------------------------ doubles for the store side

/**
 * Shared mutable fixture. It lives in `vi.hoisted` because the `vi.mock` factories below are
 * hoisted above every other statement in this file and would otherwise read it before it exists.
 */
const fixture = vi.hoisted(() => {
    /** @type {string[]} Ordered log of the side effects the open pipeline performs. */
    const calls = [];
    const syncEngine = {
        atlasId: null,
        connect: null,
        disconnect: null,
    };
    return {
        calls,
        syncEngine,
        /** Active store scope, the second half of the key derivation. */
        scope: { value: { kind: 'local', atlasId: 'slot-a', dbSuffix: 'slot-a' } },
    };
});

const { calls } = fixture;
const syncEngineDouble = fixture.syncEngine;
syncEngineDouble.connect = vi.fn(async (atlasId) => {
    calls.push('connect');
    syncEngineDouble.atlasId = atlasId;
});
syncEngineDouble.disconnect = vi.fn(() => calls.push('disconnect'));

vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: fixture.syncEngine }));
vi.mock('@store', () => ({ getControl: vi.fn(() => null) }));
vi.mock('@store/sync/api-client.js', () => ({ apiClient: {} }));
vi.mock('@store/sync/sync-flush.js', () => ({
    startAutoFlush: vi.fn(() => calls.push('startAutoFlush')),
    stopAutoFlush: vi.fn(() => calls.push('stopAutoFlush')),
}));
vi.mock('@store/atlas-namespace.js', () => ({
    StoreScopeKind: { LOCAL: 'local', REMOTE: 'remote' },
    getActiveScope: () => fixture.scope.value,
    // Dublê do parser do sufixo. Que ele CASE com o de verdade é medido em
    // `tests/integration/namespace-remoto-fiacao.test.js`, onde a adoção roda com a fábrica de
    // namespace real; aqui o que se mede é se a derivação da chave usa o resultado.
    remoteAtlasIdFromDbSuffix: (dbSuffix) => (
        typeof dbSuffix === 'string' && dbSuffix.startsWith('remote-')
            ? dbSuffix.slice('remote-'.length) || null
            : null
    ),
}));
vi.mock('@store/repositories/local.repository.js', () => ({ ensureAtlasScope: vi.fn() }));
vi.mock('@modals/confirm.modal.js', () => ({ showChoice: vi.fn(async () => 'discard') }));
vi.mock('@modals/prompt.modal.js', () => ({ showPrompt: vi.fn(async () => 'nome') }));
vi.mock('@js/import_export/save-local-atlas.service.js', () => ({
    saveLocalAtlasToServer: vi.fn(async () => ({ stats: {}, imageStats: {} })),
}));
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
}));

vi.mock('@store/store.js', () => ({
    // O namespace do atlas remoto: registra e ativa. Aqui é dublê porque o que este arquivo mede é
    // a ORDEM em que a abertura o chama (antes do wipe); o efeito real está em
    // `tests/integration/namespace-remoto-fiacao.test.js`, com a fábrica de verdade.
    activateRemoteAtlas: vi.fn(async () => calls.push('activateRemoteAtlas')),
    clearAllDataStore: vi.fn(async () => calls.push('clearAllDataStore')),
    markStoreRemote: vi.fn(async () => calls.push('markStoreRemote')),
    markStoreLocal: vi.fn(async () => calls.push('markStoreLocal')),
    isRemoteStoreSync: vi.fn(() => false),
    hasAnyMapFeatures: vi.fn(async () => false),
    activateAtlasInitialMap: vi.fn(async () => calls.push('activateAtlasInitialMap')),
}));

import { isRemoteStoreSync, hasAnyMapFeatures, clearAllDataStore } from '@store/store.js';
import { showChoice } from '@modals/confirm.modal.js';
import {
    createTabLock,
    initTabLock,
    getTabLock,
    destroyTabLock,
    localAtlasKey,
    remoteAtlasKey,
    noneKey,
} from '@utils/tab-lock.js';
import {
    openRemoteAtlas,
    currentAtlasLockKey,
    sameAtlasClaim,
    syncAtlasLockKey,
    retractAtlasClaim,
    clearMountedAtlasIfGranted,
    deferAtlasOpen,
    resumeDeferredAtlasOpen,
} from '@js/account/open-atlas.service.js';

// ------------------------------------------------------------------ transport

/**
 * In-process bus with BroadcastChannel's no-self-echo semantics.
 *
 * `delayMs` exists for one case and matters there: a real BroadcastChannel delivers
 * ASYNCHRONOUSLY, so a tab that has just been constructed knows of no peers yet. Delivering
 * synchronously would make every lock omniscient the instant it boots, which is exactly the state
 * the boot pre-flight has to work without.
 * @param {number} [delayMs=0]
 * @returns {Object} Hub.
 */
function createHub(delayMs = 0) {
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
                        if (delayMs > 0) {
                            setTimeout(() => {
                                if (!other.dead && other.receiver) other.receiver(message);
                            }, delayMs);
                        } else {
                            other.receiver(message);
                        }
                    }
                },
                setReceiver: (fn) => { endpoint.receiver = fn; },
                close: () => { endpoint.dead = true; },
            };
        },
    };
}

let hub;
let onBlocked;
/** The page tab's clock. Mutable so a test can make a re-announcement observable. */
let pageNow = 2000;

/** Lets timers and microtasks drain (the settle window is a real `setTimeout`). */
async function settle(rounds = 6) {
    for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 1));
}

/**
 * Boots the page's lock exactly as `index.js` does, minus the DOM.
 * @param {Object} key - Initial key.
 * @returns {Object} The lock instance.
 */
function bootPageLock(key, { settleMs = 1 } = {}) {
    return initTabLock({
        key,
        onBlocked,
        onResumed: resumeDeferredAtlasOpen,
        createTransport: () => hub.connect(),
        overlayHost: null,
        autoPulse: false,
        settleMs,
        now: () => pageNow,
    });
}

/**
 * The OTHER tab. `at` is its `claimedAt`: below the page tab's clock it is the incumbent, above it
 * a newcomer.
 * @param {Object} key
 * @param {number} [at=1000]
 * @returns {Object} The peer lock instance.
 */
function bootPeer(key, at = 1000) {
    return createTabLock({
        key,
        createTransport: () => hub.connect(),
        overlayHost: null,
        autoPulse: false,
        settleMs: 1,
        now: () => at,
    });
}

let peer = null;

beforeEach(() => {
    calls.length = 0;
    hub = createHub();
    peer = null;
    onBlocked = vi.fn(() => calls.push('onBlocked'));
    pageNow = 2000;
    syncEngineDouble.atlasId = null;
    fixture.scope.value = { kind: 'local', atlasId: 'slot-a', dbSuffix: 'slot-a' };
    vi.mocked(isRemoteStoreSync).mockReturnValue(false);
    vi.mocked(hasAnyMapFeatures).mockResolvedValue(false);
    vi.mocked(showChoice).mockResolvedValue('discard');
    deferAtlasOpen(null);
});

afterEach(() => {
    peer?.destroy();
    destroyTabLock();
    vi.clearAllMocks();
});

// =================================================================================================

describe('chave do lock: o que esta aba segura', () => {
    it('conexão viva manda: o atlas do syncEngine vira chave remota', () => {
        syncEngineDouble.atlasId = 'atlas-uuid';
        expect(currentAtlasLockKey()).toEqual({ kind: 'remote', atlasId: 'atlas-uuid' });
    });

    it('sem conexão, a chave é o ESCOPO ativo, e escopo remoto continua sendo remoto', () => {
        expect(currentAtlasLockKey()).toEqual({ kind: 'local', atlasId: 'slot-a' });
        // Origem remota antes do socket subir: a aba já segura os bancos daquele atlas, e dizer
        // "local" aqui deixaria outra aba apagá-los por baixo dela.
        fixture.scope.value = { kind: 'remote', atlasId: 'atlas-uuid', dbSuffix: 'remote-atlas-uuid' };
        expect(currentAtlasLockKey()).toEqual({ kind: 'remote', atlasId: 'atlas-uuid' });
    });

    it('borda: sem escopo nenhum a chave é `none` (não inventa um atlas)', () => {
        fixture.scope.value = null;
        expect(currentAtlasLockKey()).toEqual(noneKey());
    });

    it('sameAtlasClaim exige o id nos DOIS lados (antes o remoto ignorava o seu)', () => {
        expect(sameAtlasClaim(remoteAtlasKey('x'), remoteAtlasKey('x'))).toBe(true);
        // Esta linha respondia `true` sob a regra antiga, quando todo remoto era a mesma
        // reivindicação: a aba seguiria anunciando o atlas que já deixou.
        expect(sameAtlasClaim(remoteAtlasKey('x'), remoteAtlasKey('y'))).toBe(false);
        expect(sameAtlasClaim(localAtlasKey('a'), localAtlasKey('b'))).toBe(false);
        expect(sameAtlasClaim(localAtlasKey('a'), localAtlasKey('a'))).toBe(true);
        expect(sameAtlasClaim(localAtlasKey('a'), remoteAtlasKey('a'))).toBe(false);
        expect(sameAtlasClaim(null, localAtlasKey('a'))).toBe(false);
    });
});

describe('syncAtlasLockKey: o laço reativo dos quatro fluxos', () => {
    it('troca a chave quando o atlas muda de verdade (local → remoto)', () => {
        const lock = bootPageLock(localAtlasKey('slot-a'));
        syncEngineDouble.atlasId = 'atlas-uuid';
        syncAtlasLockKey();
        expect(lock.key.kind).toBe('remote');
    });

    it('NÃO reanuncia uma reivindicação inalterada: recarimbar entregaria o lock ao recém-chegado', async () => {
        // Esta aba entrou primeiro (2000), já conectada ao atlas.
        syncEngineDouble.atlasId = 'atlas-uuid';
        const lock = bootPageLock(remoteAtlasKey('atlas-uuid'));
        // Depois chega outra aba (3000) NO MESMO atlas. Como esta precede, quem bloqueia é a de lá.
        peer = bootPeer(remoteAtlasKey('atlas-uuid'), 3000);
        await settle();
        expect(lock.blocked).toBe(false);
        expect(peer.blocked).toBe(true);

        // CONNECTION_STATE_CHANGED dispara de novo (reconexão, troca de mapa). Reanunciar a MESMA
        // reivindicação recarimbaria `claimedAt` para 5000, jogando esta aba para trás da vizinha e
        // entregando um lock que ela já tem.
        pageNow = 5000;
        syncAtlasLockKey();
        syncAtlasLockKey();
        await settle();

        expect(lock.blocked).toBe(false);
        expect(peer.blocked).toBe(true);
    });

    it('não mexe na chave enquanto BLOQUEADA: onBlocked desconecta, e o evento voltaria aqui', async () => {
        peer = bootPeer(remoteAtlasKey('atlas-uuid'));
        syncEngineDouble.atlasId = 'atlas-uuid';
        const lock = bootPageLock(remoteAtlasKey('atlas-uuid'));
        await settle();
        expect(lock.blocked).toBe(true);

        // O onBlocked real chama syncEngine.disconnect(), que emite CONNECTION_STATE_CHANGED, que
        // chama isto. Sem a guarda, a aba se desbloquearia no meio de estar sendo parada.
        syncEngineDouble.atlasId = null;
        syncAtlasLockKey();
        expect(lock.blocked).toBe(true);
        expect(lock.key.kind).toBe('remote');
    });
});

describe('openRemoteAtlas: a colisão é respondida ANTES do clearAllDataStore', () => {
    it('caminho livre: a chave já é remota no instante em que o scratch é apagado', async () => {
        bootPageLock(localAtlasKey('slot-a'));
        let keyAtWipe = null;
        vi.mocked(clearAllDataStore).mockImplementation(async () => {
            calls.push('clearAllDataStore');
            keyAtWipe = getTabLock().key;
        });

        const opened = await openRemoteAtlas('atlas-uuid');

        expect(opened).toBe(true);
        // Se o acquire viesse depois do wipe, aqui se leria `local`.
        expect(keyAtWipe).toEqual({ kind: 'remote', atlasId: 'atlas-uuid' });
        expect(calls).toEqual([
            'activateRemoteAtlas', 'clearAllDataStore', 'markStoreRemote', 'connect',
            'activateAtlasInitialMap', 'startAutoFlush',
        ]);
    });

    it('outra aba NO MESMO projeto: NADA é apagado e nada é desconectado do lado de lá', async () => {
        peer = bootPeer(remoteAtlasKey('atlas-uuid'));
        bootPageLock(localAtlasKey('slot-a'));
        await settle();

        const opened = await openRemoteAtlas('atlas-uuid');

        expect(opened).toBe(false);
        // A recusa acontece ANTES de qualquer passo destrutivo: as duas abas endereçam os mesmos
        // dez bancos e a mesma fila de saída, então um wipe aqui seria trabalho das DUAS.
        expect(calls).not.toContain('clearAllDataStore');
        expect(calls).not.toContain('markStoreRemote');
        expect(calls).not.toContain('connect');
        expect(peer.blocked).toBe(false);
        expect(getTabLock().blocked).toBe(true);
    });

    it('a aba perdedora é PARADA de verdade (onBlocked), não só coberta', async () => {
        peer = bootPeer(remoteAtlasKey('atlas-uuid'));
        bootPageLock(localAtlasKey('slot-a'));
        await settle();
        await openRemoteAtlas('atlas-uuid');
        expect(onBlocked).toHaveBeenCalled();
    });

    it('a abertura recusada é RETOMADA quando a outra aba solta a chave', async () => {
        peer = bootPeer(remoteAtlasKey('atlas-uuid'));
        bootPageLock(localAtlasKey('slot-a'));
        await settle();
        expect(await openRemoteAtlas('atlas-uuid')).toBe(false);
        expect(calls).not.toContain('connect');

        // "Usar aqui" (ou a morte do detentor) termina em retratação; o desbloqueio roda o thunk.
        peer.release();
        await settle(10);

        expect(calls).toContain('clearAllDataStore');
        expect(syncEngineDouble.atlasId).toBe('atlas-uuid');
    });

    it('reabrir o MESMO projeto não entra de novo na fila atrás de quem esperava', async () => {
        // Esta aba já está no atlas-x (reivindicou em 2000).
        syncEngineDouble.atlasId = 'atlas-x';
        const lock = bootPageLock(remoteAtlasKey('atlas-x'));
        // Outra aba pediu o MESMO atlas depois (3000) e está esperando, bloqueada.
        peer = bootPeer(remoteAtlasKey('atlas-x'), 3000);
        await settle();
        expect(peer.blocked).toBe(true);
        expect(lock.blocked).toBe(false);

        // Reabrir o atlas em que já se está (replay de deep link, retomada de abertura) NÃO é entrar
        // de novo na fila. Um `acquire` cego recarimbaria a reivindicação para 5000, jogaria esta aba
        // para trás da que esperava, e reabrir o próprio projeto viraria perda do lock.
        pageNow = 5000;
        const opened = await openRemoteAtlas('atlas-x');
        await settle();

        expect(opened).toBe(true);
        expect(lock.blocked).toBe(false);
        expect(peer.blocked).toBe(true);
        expect(calls).toContain('connect');
    });

    // A PROMOCAO DA ESPERA, FEITA EM E7 (2026-08-15). Este caso afirmava a recusa ("abrir OUTRO
    // projeto de servidor ao lado e RECUSADO"), que era o ramo `REMOTE x REMOTE` de `keysCollide`
    // e nunca a regra do dono: com um unico bloco de bancos para todos os remotos, deixar a
    // segunda aba entrar era deixa-la apagar o mapa vivo da primeira. Primeiro veio a fiacao do
    // namespace (`activateRemoteAtlas` nas TRES entradas, medida com a fabrica real em
    // `tests/integration/namespace-remoto-fiacao.test.js`), depois a fila fisica por atlas, e so
    // entao a espera saiu. O que este caso afere agora e o requisito do dono: a abertura segue
    // ATE o fim, e a aba vizinha nao e tocada.
    it('abrir OUTRO projeto de servidor ao lado de uma aba remota e PERMITIDO', async () => {
        peer = bootPeer(remoteAtlasKey('atlas-do-vizinho'));
        const lock = bootPageLock(localAtlasKey('slot-a'));
        await settle();

        const opened = await openRemoteAtlas('atlas-uuid');

        expect(opened).toBe(true);
        // A abertura rodou inteira, na ordem que o contrato exige.
        expect(calls).toContain('clearAllDataStore');
        expect(calls).toContain('connect');
        expect(syncEngineDouble.atlasId).toBe('atlas-uuid');
        // E a vizinha nao pagou por isso: nem bloqueada, nem deslocada da propria chave.
        expect(peer.blocked).toBe(false);
        expect(peer.key).toEqual(remoteAtlasKey('atlas-do-vizinho'));
        expect(lock.blocked).toBe(false);
        expect(lock.key).toEqual(remoteAtlasKey('atlas-uuid'));
    });

    it('CONTROLE NEGATIVO da promocao: o MESMO projeto do vizinho continua recusado', async () => {
        // Sem esta metade, o caso acima passaria tambem contra um predicado que parou de arbitrar.
        peer = bootPeer(remoteAtlasKey('atlas-uuid'));
        bootPageLock(localAtlasKey('slot-a'));
        await settle();

        expect(await openRemoteAtlas('atlas-uuid')).toBe(false);
        expect(calls).not.toContain('clearAllDataStore');
        expect(calls).not.toContain('connect');
        expect(peer.blocked).toBe(false);
    });

    it('o slot local ADOTADO anuncia o atlas de servidor de onde veio, e colide com ele', async () => {
        // Depois do resgate do logout (`adoptRemoteAtlasAsLocal`), a aba esta num atlas LOCAL cujos
        // bancos ainda sao `remote-<atlasId>`. Uma aba que abre AQUELE atlas de servidor apaga esses
        // bancos na entrada, entao ela tem de ser recusada, embora as duas chaves tenham `kind`
        // diferente.
        fixture.scope.value = {
            kind: 'local', atlasId: 'slot-resgatado', dbSuffix: 'remote-atlas-uuid',
        };
        expect(currentAtlasLockKey())
            .toEqual({ kind: 'local', atlasId: 'slot-resgatado', adoptedFrom: 'atlas-uuid' });

        peer = bootPeer(currentAtlasLockKey());
        bootPageLock(localAtlasKey('slot-a'));
        await settle();

        expect(await openRemoteAtlas('atlas-uuid')).toBe(false);
        expect(calls).not.toContain('clearAllDataStore');
    });

    it('CONTROLE NEGATIVO: o MESMO slot sem a adocao nao colide, e a abertura passa', async () => {
        // A chave que a derivacao antiga produzia para os dois casos. Sem este par, o teste acima
        // tambem passaria contra um lock que recusa tudo.
        fixture.scope.value = { kind: 'local', atlasId: 'slot-resgatado', dbSuffix: 'slot-resgatado' };
        expect(currentAtlasLockKey()).toEqual({ kind: 'local', atlasId: 'slot-resgatado' });

        peer = bootPeer(currentAtlasLockKey());
        bootPageLock(localAtlasKey('slot-a'));
        await settle();

        expect(await openRemoteAtlas('atlas-uuid')).toBe(true);
        expect(calls).toContain('clearAllDataStore');
        expect(peer.blocked).toBe(false);
    });

    it('duas abas locais em atlas DIFERENTES não colidem (o caminho anônimo não regride)', async () => {
        peer = bootPeer(localAtlasKey('slot-b'));
        const lock = bootPageLock(localAtlasKey('slot-a'));
        await settle();
        expect(lock.blocked).toBe(false);
        expect(peer.blocked).toBe(false);
        // ... e o mesmo atlas local em duas abas colide, porque são os mesmos bancos.
        peer.setKey(localAtlasKey('slot-a'));
        await settle();
        expect(lock.blocked).toBe(true);
    });
});

describe('retratação: chave anunciada que não se consegue honrar', () => {
    it('403/404 no connect solta a chave, e a próxima aba passa', async () => {
        bootPageLock(localAtlasKey('slot-a'));
        syncEngineDouble.connect.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 403 }));

        await expect(openRemoteAtlas('atlas-uuid')).rejects.toThrow('nope');

        expect(calls).toContain('markStoreLocal');
        expect(getTabLock().key.kind).not.toBe('remote');
    });

    it('cancelar o aviso de trabalho local devolve a chave e não apaga nada', async () => {
        vi.mocked(hasAnyMapFeatures).mockResolvedValue(true);
        vi.mocked(showChoice).mockResolvedValue(null); // Esc/backdrop
        bootPageLock(localAtlasKey('slot-a'));

        expect(await openRemoteAtlas('atlas-uuid')).toBe(false);
        expect(calls).not.toContain('clearAllDataStore');
        expect(getTabLock().key).toEqual({ kind: 'local', atlasId: 'slot-a' });
    });

    it('retractAtlasClaim volta para o slot local quando existe um, em vez de ficar em `none`', () => {
        const lock = bootPageLock(remoteAtlasKey('atlas-uuid'));
        retractAtlasClaim();
        // `none` nunca colide: parar aí seria um buraco numa aba que ainda segura bancos locais.
        expect(lock.key).toEqual({ kind: 'local', atlasId: 'slot-a' });
    });

    it('sem slot local (escopo ainda remoto), a retratação para em `none`', () => {
        fixture.scope.value = { kind: 'remote', atlasId: 'atlas-uuid', dbSuffix: 'remote-atlas-uuid' };
        const lock = bootPageLock(remoteAtlasKey('atlas-uuid'));
        retractAtlasClaim();
        expect(lock.key).toEqual(noneKey());
    });
});

describe('abertura adiada', () => {
    it('roda uma única vez e engole o erro do thunk', async () => {
        const run = vi.fn(async () => { throw new Error('falhou'); });
        deferAtlasOpen(run);
        expect(await resumeDeferredAtlasOpen()).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
        // Segunda chamada não tem nada a retomar: o desbloqueio comum não pode reabrir atlas.
        expect(await resumeDeferredAtlasOpen()).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
    });
});

describe('os DOIS wipes do boot: clearMountedAtlasIfGranted', () => {
    it('recusa o wipe quando outra aba segura o atlas montado, e guarda a retomada', async () => {
        // A aba duplicada herda `ebgeo_local_intent` do sessionStorage e boota com a origem remota
        // da original: sem pré-voo, o `clearAllDataStore()` do boot cairia nos bancos vivos de lá.
        fixture.scope.value = { kind: 'remote', atlasId: 'atlas-uuid', dbSuffix: 'remote-atlas-uuid' };
        peer = bootPeer(remoteAtlasKey('atlas-uuid'));
        const lock = bootPageLock(remoteAtlasKey('atlas-uuid'));

        const replay = vi.fn(async () => 'replayed');
        const wiped = await clearMountedAtlasIfGranted(replay);

        expect(wiped).toBe(false);
        expect(calls).not.toContain('clearAllDataStore');
        expect(lock.blocked).toBe(true);
        // A retomada foi guardada: o "Usar aqui" do overlay termina o passo do boot em vez de
        // apenas descobrir a aba.
        expect(await resumeDeferredAtlasOpen()).toBe(true);
        expect(replay).toHaveBeenCalledTimes(1);
    });

    it('CONTROLE NEGATIVO: sem par no mesmo atlas, o mesmo caminho apaga normalmente', async () => {
        fixture.scope.value = { kind: 'remote', atlasId: 'atlas-uuid', dbSuffix: 'remote-atlas-uuid' };
        // O par e uma aba em OUTRO atlas de servidor, que e o controle que nomeia a propria
        // causa: mesmo tipo de chave, endereco diferente. Ele so voltou a valer com a saida da
        // espera da ROW 4 (E7); enquanto dois remotos colidiam por KIND, este caminho era barrado
        // pela espera em vez de seguir, e o controle media outra coisa.
        peer = bootPeer(remoteAtlasKey('atlas-do-vizinho'));
        bootPageLock(remoteAtlasKey('atlas-uuid'));

        const replay = vi.fn(async () => 'replayed');
        const wiped = await clearMountedAtlasIfGranted(replay);

        expect(wiped).toBe(true);
        expect(calls).toContain('clearAllDataStore');
        expect(replay).not.toHaveBeenCalled();
        expect(await resumeDeferredAtlasOpen()).toBe(false);
    });

    it('é o AWAIT que pega o par: no instante do boot o lock ainda não decidiu', async () => {
        // O par já está no ar, mas a aba acabou de construir o lock e o canal entrega em outro
        // tick, então ela não ouviu ninguém. Uma leitura de `blocked` (ou de `isTabLockBlocked()`)
        // responde `false` aqui, e era exatamente isso que o boot tinha de informação: nada.
        hub = createHub(1);
        fixture.scope.value = { kind: 'remote', atlasId: 'atlas-uuid', dbSuffix: 'remote-atlas-uuid' };
        peer = bootPeer(remoteAtlasKey('atlas-uuid'));
        const lock = bootPageLock(remoteAtlasKey('atlas-uuid'), { settleMs: 40 });
        expect(lock.blocked).toBe(false);          // a leitura síncrona, mentindo

        const wiped = await clearMountedAtlasIfGranted();

        expect(lock.blocked).toBe(true);           // a resposta, depois do settle
        expect(wiped).toBe(false);
        expect(calls).not.toContain('clearAllDataStore');
    });

    it('uma aba que não segura atlas nenhum apaga sem pedir licença a ninguém', async () => {
        fixture.scope.value = null;                // `none`: nada resolvido, nada a arbitrar
        peer = bootPeer(remoteAtlasKey('atlas-uuid'));
        const lock = bootPageLock(noneKey());

        expect(await clearMountedAtlasIfGranted()).toBe(true);
        expect(calls).toContain('clearAllDataStore');
        expect(lock.blocked).toBe(false);
    });
});

// ==========================================================================================
// O AVISO DE DESMONTAGEM NO LOGOUT
// ==========================================================================================

/**
 * Esta seção é ESTRUTURAL, e a limitação está escrita porque ela importa: o comportamento do
 * aviso (entrega sem colisão, ack como evidência, freio que para de escrever sem soltar a
 * montagem) é medido em `tests/unit/tab-lock.test.js` e `tests/unit/tab-lock-sync-brake.test.js`,
 * e o aviso do BOOT em `tests/unit/wipe-unificado-de-atlas.test.js`, todos com módulos reais. O
 * que NÃO é medido em lugar nenhum é o SÍTIO DE CHAMADA do logout, porque `_handleLogout` é
 * método de um IControl do MapLibre e o harness que o constrói vive em arquivos de outra frente.
 * Um teste estrutural sozinho não prova que o portão faz a coisa certa; prova só que a ordem das
 * três chamadas não inverteu, que é exatamente o defeito que tornaria o aviso inútil (avisar
 * DEPOIS de esvaziar é não avisar). Fica anotado como dívida em `_PENDENCIAS.md`.
 *
 * A DERIVAÇÃO DA LISTA MUDOU DE CASA (2026-08-15) e este arquivo seguiu junto: ela era
 * `announceRemoteTeardown` em `account.control.js`, com UM chamador, e a guarda de boot rodava a
 * mesma varredura destrutiva sem avisar ninguém. Agora ela é `announceRemoteNamespaceTeardown` em
 * `store/store.js`, ao lado do expurgo e chamada por ele, então os dois caminhos avisam por
 * construção em vez de por memória.
 */
describe('logout: o aviso vem ANTES de esvaziar e destruir', () => {
    const fonte = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js/account/account.control.js'),
        'utf8'
    );
    const fonteDaStore = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js/store/store.js'),
        'utf8'
    );
    // A prosa do arquivo NOMEIA as três chamadas (é o ponto do comentário), então o guarda lê o
    // código e não a documentação sobre o código.
    const codigo = fonte
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    /** @returns {string} O corpo de `_handleLogout`, isolado do resto do arquivo. */
    function corpoDoLogout() {
        const inicio = codigo.indexOf('async _handleLogout(');
        expect(inicio).toBeGreaterThan(-1);
        const fim = codigo.indexOf('\n    /**', inicio);
        const corpo = fim > inicio ? codigo.slice(inicio, fim) : codigo.slice(inicio);
        // Sem esta asserção, um recorte vazio (o método renomeado, o marcador de fim mudando de
        // forma) faria todos os `indexOf` abaixo devolverem -1 e a comparação de ordem passar.
        expect(corpo.length).toBeGreaterThan(500);
        return corpo;
    }

    it('as três chamadas existem no logout, e o aviso precede as duas destrutivas', () => {
        const corpo = corpoDoLogout();
        const aviso = corpo.indexOf('announceRemoteNamespaceTeardown(');
        const esvazia = corpo.indexOf('clearAllDataStore(');
        const destroi = corpo.indexOf('discardRemoteAtlasNamespaces(');

        // Cada marco é asserido como ENCONTRADO antes de qualquer comparação de índice: -1 < N é
        // verdadeiro, e um marco ausente passaria por "veio antes".
        expect(aviso).toBeGreaterThan(-1);
        expect(esvazia).toBeGreaterThan(-1);
        expect(destroi).toBeGreaterThan(-1);
        expect(aviso).toBeLessThan(esvazia);
        expect(esvazia).toBeLessThan(destroi);
    });

    it('o aviso é AGUARDADO: um `await` esquecido faria a corrida voltar inteira', () => {
        expect(corpoDoLogout()).toMatch(/await\s+announceRemoteNamespaceTeardown\(\)/);
    });

    it('a lista anunciada exclui o que um atlas LOCAL reivindica, como o expurgo faz', () => {
        // O slot resgatado conserva o sufixo `remote-<id>` e muda de registro, e o expurgo o pula.
        // Anunciar o registro cru condenaria um endereço que ninguém vai tocar, e a aba que o
        // segura freiaria à toa.
        const inicio = fonteDaStore.indexOf('export async function announceRemoteNamespaceTeardown');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = fonteDaStore.slice(inicio, inicio + 900);
        expect(corpo).toMatch(/readLocalAtlasRegistry\(\)/);
        expect(corpo).toMatch(/claimed\.has\(dbSuffix\)/);
    });

    // O ACHADO QUE FECHOU ESTA SEÇÃO: o aviso morava só aqui, e a guarda de boot
    // (`enforceLocalStoreWhenLoggedOut` -> `discardRemoteAtlasNamespaces`) roda a MESMA varredura
    // destrutiva sem passar por este arquivo. Dois chamadores e um deles lembrando é a forma de
    // defeito que volta, então o aviso passou a ser do expurgo. O comportamento está medido em
    // `tests/unit/wipe-unificado-de-atlas.test.js`; o que este caso guarda é o acoplamento, para
    // que separar os dois de novo exija apagar uma linha que diz por que ela existe.
    it('o EXPURGO avisa por conta própria, que é o que cobre a guarda de boot', () => {
        const codigoDaStore = fonteDaStore
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        const inicio = codigoDaStore.indexOf('export async function discardRemoteAtlasNamespaces');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = codigoDaStore.slice(inicio, codigoDaStore.indexOf('\n}', inicio));

        const aviso = corpo.indexOf('announceRemoteNamespaceTeardown(');
        const varre = corpo.indexOf('purgeAllRemoteAtlases(');
        expect(aviso).toBeGreaterThan(-1);
        expect(varre).toBeGreaterThan(-1);
        expect(aviso).toBeLessThan(varre);
    });
});
