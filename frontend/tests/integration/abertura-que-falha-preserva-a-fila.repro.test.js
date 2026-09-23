// Path: tests/integration/abertura-que-falha-preserva-a-fila.repro.test.js

/**
 * @fileoverview A QUEDA DO BOOT PARA O MAPA LOCAL NAO APAGA NADA (decisao do dono Q1, 2026-09-23).
 *
 * A CAUSA RAIZ, que este arquivo documenta. Quando a abertura por `?atlas=` falhava DEPOIS de montar
 * o namespace do atlas (rede, 5xx, `AbortError` no `connect`), a cadeia de boot de `index.js` caia no
 * mapa local (intencao "Mapa local") ou no seletor, e os dois passavam por um wipe do escopo MONTADO
 * com os padroes de `clearAllDataStore` (`markLocal` e `clearQueue` verdadeiros). O escopo montado era
 * o do atlas que acabara de falhar, entao o wipe esvaziava a FILA DE SAIDA dele e os bytes de imagem
 * pendentes, que a proxima abertura bem-sucedida deveria entregar; e a aba ficava num escopo remoto
 * com a origem marcada local, onde toda escrita e recusada. O mesmo wipe era decidido pelo MARCADOR
 * de origem, que e da instalacao, e por isso apagava tambem um slot LOCAL quando outra aba tinha
 * aberto um atlas de servidor.
 *
 * O QUE SE MEDE AQUI e a funcao que substituiu o wipe, `enterLocalAtlasOnBoot`
 * (`src/js/account/open-atlas.service.js`), sobre armazenamento REAL (`fake-indexeddb`), com a leitura
 * por escopo e nunca pela memoria da store. O caminho do SELETOR nao tem funcao de servico a chamar
 * (ele so navega); o que o prende e o caso 1 de `tests/e2e-ui/abertura-remota-que-falha.repro.spec.js`
 * e o recorte estrutural de `tests/unit/tab-lock-refutacao.test.js` (3.3).
 *
 * CONTROLE NEGATIVO, feito ao escrever (2026-09-23): com o corpo antigo (o pre-voo e o wipe do escopo
 * montado, decidido pelo marcador) no lugar de `enterLocalAtlasOnBoot`, ficam vermelhos o caso da
 * fila, o do estado final e o do escopo ja local, cada um pela assercao que nomeia o que o wipe
 * levava; e sem o `contarAbertura: false` fica vermelho o caso da contagem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetIndexedDB } from '../helpers/idb-helpers.js';

vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));

/** O motor de sincronismo: o socket nao e o que se mede aqui, a abertura so precisa FALHAR nele. */
const engine = vi.hoisted(() => ({ atlasId: null }));
engine.disconnect = vi.fn((opcoes) => { if (opcoes?.forgetAtlas) engine.atlasId = null; });
engine.connect = vi.fn(async (atlasId) => { engine.atlasId = atlasId; });
vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: engine }));
vi.mock('@store/sync/sync-flush.js', () => ({ startAutoFlush: vi.fn(), stopAutoFlush: vi.fn() }));
vi.mock('@store/atlas-appearance.service.js', () => ({
    reapplyAtlasAppearance: vi.fn(async () => {}),
}));

/**
 * A CONTAGEM DE ABERTURA e observavel: a entrada do boot NAO pode contar, porque a cadeia de
 * roteamento ja conta o boot local uma vez por carga de pagina.
 */
const uso = vi.hoisted(() => ({ registrarUso: null }));
vi.mock('@js/session/uso-lote.js', async (importOriginal) => {
    const real = await importOriginal();
    uso.registrarUso = vi.fn();
    return { ...real, registrarUso: uso.registrarUso };
});

/**
 * O tab-lock CONCEDE. A arbitragem tem dono (`tests/unit/tab-lock.test.js`) e o pre-voo com par
 * vivo esta em `tests/integration/tab-lock-atlas-integration.test.js`; aqui a pergunta e o que a
 * queda do boot faz com os bancos. O singleton real sobreviveria a `vi.resetModules()` e responderia
 * como um par, pela razao escrita em `tests/unit/troca-viva-de-atlas.test.js`.
 */
const trava = vi.hoisted(() => ({
    acquire: null,
    setKey: null,
    estado: { key: null, blocked: false },
}));
vi.mock('@utils/tab-lock.js', async (importOriginal) => {
    trava.acquire = vi.fn(async () => ({ granted: true, blockedBy: null, degraded: false, deniedBy: null }));
    trava.setKey = vi.fn();
    return {
        ...await importOriginal(),
        acquireTabLock: trava.acquire,
        getTabLock: () => trava.estado,
        setTabLockKey: trava.setKey,
    };
});

const Y = '33333333-3333-4333-8333-333333333333';
const OP_PENDENTE = 'op_0000000001_000000000001_pendente';
const BYTES_PENDENTES = 'bytes-da-figura-pendente';

const memoriaLocal = (() => {
    let dados = new Map();
    return {
        getItem: k => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: k => { dados.delete(k); },
        clear: () => { dados = new Map(); },
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: memoriaLocal, writable: true });
}

let ns;
let localApi;
let origem;
let servico;

/** Teto do preparo: o boot da store inteira sobre `fake-indexeddb`, frio. Ver troca-viva. */
const TETO_DE_PREPARO_MS = 60000;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await resetIndexedDB();
    globalThis.localStorage.clear();
    engine.atlasId = null;
    engine.connect.mockImplementation(async (atlasId) => { engine.atlasId = atlasId; });
    trava.estado = { key: null, blocked: false };

    ns = await import('@store/atlas-namespace.js');
    localApi = await import('@store/local-atlas.api.js');
    origem = await import('@store/store-origin.js');

    const { initServices } = await import('@store/services.js');
    const { awaitMapResolverReady } = await import('@store/services/map-resolver.service.js');
    const { disableOperationLogging } = await import('@store/sync/operation-dispatcher.js');
    initServices();
    await awaitMapResolverReady();
    disableOperationLogging();

    servico = await import('@js/account/open-atlas.service.js');
}, TETO_DE_PREPARO_MS);

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * O estado que a abertura que falha deixa: o namespace de Y montado, a origem REMOTA, uma operacao
 * na fila de Y e bytes de figura no banco de imagens de Y. Montado pelo caminho REAL da abertura
 * (`openRemoteAtlas`), com o `connect` falhando, e nao escrito a mao: a pergunta e o que sobra
 * DEPOIS daquele caminho.
 * @returns {Promise<{queue: Object, images: Object, localId: string}>}
 */
async function aberturaQueFalhou() {
    await localApi.initLocalAtlases();
    const localId = ns.getActiveScope().atlasId;
    const scope = ns.remoteScope(Y);
    const queue = ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, scope);
    const images = ns.getStoreFor(ns.StoreName.IMAGES, scope);
    await queue.setItem(OP_PENDENTE, { id: 'nao-confirmada' });
    await images.setItem(BYTES_PENDENTES, { bytes: 'ainda nao subiram' });

    engine.connect.mockRejectedValueOnce(new DOMException('rede indisponível', 'AbortError'));
    await expect(servico.openRemoteAtlas(Y)).rejects.toThrow('rede indisponível');
    // O PONTO DE PARTIDA E O ESTADO QUE A QUEDA DO BOOT RECEBE, conferido antes de ela rodar: sem
    // isto, um caso verde poderia estar medindo uma abertura que nem montou o atlas.
    expect(ns.getActiveScope()).toMatchObject({ kind: 'remote', atlasId: Y });
    expect(origem.isRemoteStoreSync()).toBe(true);
    expect(await queue.getItem(OP_PENDENTE)).toEqual({ id: 'nao-confirmada' });
    return { queue, images, localId };
}

describe('a queda do boot para o mapa local, depois de uma abertura de servidor que falhou', () => {
    it('a fila de saida do atlas que falhou SOBREVIVE, e os bytes pendentes tambem', async () => {
        const { queue, images } = await aberturaQueFalhou();

        const entrada = await servico.enterLocalAtlasOnBoot();

        expect(entrada.ok).toBe(true);
        expect(await queue.getItem(OP_PENDENTE), 'a queda do boot apagou a fila do atlas')
            .toEqual({ id: 'nao-confirmada' });
        expect(await images.getItem(BYTES_PENDENTES), 'a queda do boot apagou os bytes pendentes')
            .toEqual({ bytes: 'ainda nao subiram' });
    });

    it('a aba termina num atlas LOCAL de verdade: escopo local, origem local, nada de estado morto', async () => {
        const { localId } = await aberturaQueFalhou();

        const entrada = await servico.enterLocalAtlasOnBoot();

        expect(entrada).toEqual({ ok: true, changed: true });
        expect(ns.getActiveScope(), 'a aba ficou no escopo remoto do atlas que falhou')
            .toMatchObject({ kind: 'local', atlasId: localId });
        expect(origem.isRemoteStoreSync()).toBe(false);
    });

    it('a entrada do boot NAO conta abertura: quem conta e a cadeia de roteamento', async () => {
        await aberturaQueFalhou();
        uso.registrarUso.mockClear();

        await servico.enterLocalAtlasOnBoot();

        expect(uso.registrarUso).not.toHaveBeenCalled();
    });

    it('CONTROLE DA CONTAGEM: a troca viva para o mesmo slot continua contando', async () => {
        // Sem este caso, o de cima passaria com a contagem removida do produto inteiro.
        const { localId } = await aberturaQueFalhou();
        uso.registrarUso.mockClear();

        await servico.switchAtlas({ kind: 'local', atlasId: localId });

        expect(uso.registrarUso).toHaveBeenCalledTimes(1);
    });
});

describe('um escopo JA local nao e tocado, diga o marcador da instalacao o que disser', () => {
    it('o F5 de uma aba num atlas local nao apaga o atlas por causa do marcador de outra aba', async () => {
        await localApi.initLocalAtlases();
        const local = ns.getActiveScope();
        const mapas = ns.getStoreFor(ns.StoreName.MAPS, local);
        await mapas.setItem('trabalho-local', { nome: 'LOCAL DA ABA A' });
        // OUTRA aba abriu um atlas de servidor: o marcador e da INSTALACAO, e e ela que o escreve.
        await ns.getGlobalStore().setItem(ns.GlobalKey.STORE_ORIGIN, { kind: 'remote', atlasId: Y });
        await origem.loadStoreOrigin();
        expect(origem.isRemoteStoreSync(), 'controle: o marcador fala de servidor').toBe(true);

        const entrada = await servico.enterLocalAtlasOnBoot();

        expect(entrada).toEqual({ ok: true, changed: false });
        expect(await mapas.getItem('trabalho-local'), 'o boot apagou o atlas LOCAL da aba')
            .toEqual({ nome: 'LOCAL DA ABA A' });
        expect(ns.getActiveScope()).toBe(local);
        // O marcador desta aba e realinhado ao escopo que ela montou.
        expect(origem.isRemoteStoreSync()).toBe(false);
    });
});
