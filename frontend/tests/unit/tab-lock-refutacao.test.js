// Path: tests/unit/tab-lock-refutacao.test.js

/**
 * @fileoverview The tab lock's PERMANENT regression suite, born as an adversarial pass over the
 * protocol. Every property here was found by trying to break it, and each case is kept for what it
 * PINS, never for what it once reported.
 *
 * TWO LABELS, AND ONLY TWO, BECAUSE THE FILE MUST STAY EXECUTABLE AS A CONTRACT:
 *
 *   CONFIRMADO  the attack failed, or the behaviour it hit is a recorded decision. The case is the
 *               regression test of that property and fails if the property is lost.
 *   CORRIGIDO   the attack succeeded and the defect is fixed. The assertion is INVERTED and names
 *               the fix, so undoing the fix turns the case red again.
 *
 * THERE IS NO "FURO" LABEL ANY MORE, and its removal is the point of this rewrite. Cases carrying
 * it asserted the DEFECT (`expect(wipes).toEqual(['a-wipe', 'b-wipe'])` authorised both tabs to
 * erase), so closing the hole would have turned the suite red and the suite would have been
 * arguing for the bug. An open hole is not a test: it is a backlog entry. The ones still open are
 * `it.todo` markers below, each with its reproduction written out, and each mirrored in
 * `frontend/tests/TESTING-BACKLOG.md` (section "Furos abertos do tab-lock"). A todo asserts
 * nothing, so it can neither cement a defect nor go red when somebody fixes it.
 *
 * Every case that names two atlases was rewritten when the owner's rule became uniform (two tabs
 * collide only when they hold the SAME atlas). Under the old rule any two remote keys collided, so
 * a case could exercise a collision with two different ids; those cases now name one id, and the
 * ones that measured the OLD rule itself live in `tab-lock.test.js`.
 *
 * The file used to be `_refutacao-tab-lock.test.js`. The underscore marked it as scratch, which is
 * what let it hold assertions nobody would accept in the permanent suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    createTabLock,
    keysCollide,
    compareClaims,
    findBlockingPeer,
    noneKey,
    localAtlasKey,
    remoteAtlasKey
} from '@utils/tab-lock.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

const ATLAS_A = '11111111-1111-4111-8111-111111111111';
const ATLAS_B = '22222222-2222-4222-8222-222222222222';

/** Hub with buffering, per-message dropping, and delayed (busy-peer) delivery. */
function createHub() {
    const endpoints = [];
    let held = null;
    let drop = () => false;
    let delayMs = 0;

    function fanout(from, message) {
        for (const ep of endpoints) {
            if (ep === from || ep.dead || !ep.receiver) continue;
            if (drop(message, ep)) continue;
            if (delayMs > 0) {
                setTimeout(() => { if (!ep.dead && ep.receiver) ep.receiver(message); }, delayMs);
            } else {
                ep.receiver(message);
            }
        }
    }

    function deliver(from, message) {
        if (held) { held.push({ from, message }); return; }
        fanout(from, message);
    }

    return {
        connect() {
            const ep = { receiver: null, dead: false };
            endpoints.push(ep);
            return {
                kind: 'fake',
                post: (m) => deliver(ep, m),
                setReceiver: (fn) => { ep.receiver = fn; },
                close: () => { ep.dead = true; },
                _endpoint: ep
            };
        },
        hold() { held = []; },
        flush({ reverse = false } = {}) {
            const queued = reverse ? [...held].reverse() : held;
            held = null;
            for (const { from, message } of queued) fanout(from, message);
        },
        setDrop(fn) { drop = fn; },
        setDelay(ms) { delayMs = ms; },
        kill(transport) { transport._endpoint.dead = true; transport._endpoint.receiver = null; }
    };
}

describe('ATAQUE 1 - a janela de tempo', () => {
    let hub; let clock; let locks;
    const mk = (o = {}) => {
        const l = createTabLock({
            createTransport: () => hub.connect(),
            now: () => clock, overlayHost: null, autoPulse: false,
            settleMs: 0, takeoverTimeoutMs: 500, ...o
        });
        locks.push(l); return l;
    };
    beforeEach(() => { hub = createHub(); clock = 1000; locks = []; });
    afterEach(() => { for (const l of locks) l.destroy(); });

    it('1.1 CONFIRMADO: duas sondagens simultaneas convergem para EXATAMENTE uma aba ativa, '
        + 'e a ordem de entrega nao decide qual', async () => {
        // As duas mensagens ficam presas e sao soltas juntas, entao nao ha "quem respondeu
        // primeiro": o desempate vem da ordem total, computada igual nas duas abas.
        const a = mk(); const b = mk();
        hub.hold();
        await Promise.all([
            a.acquire(remoteAtlasKey(ATLAS_A)),
            b.acquire(remoteAtlasKey(ATLAS_A))
        ]);
        hub.flush();
        expect([a.blocked, b.blocked].filter(Boolean)).toHaveLength(1);
        // E quem bloqueia e quem PERDE a ordem: com `claimedAt` empatado (relogio injetado, mesmo
        // instante) o criterio e o tabId, e nao ha outro. Sem esta metade, "exatamente uma
        // bloqueada" tambem passaria com um desempate sorteado.
        const perdedor = a.blocked ? a : b;
        const vencedor = a.blocked ? b : a;
        expect(perdedor.tabId > vencedor.tabId).toBe(true);

        // Controle: o MESMO cenario com as mensagens soltas na ordem INVERSA responde igual.
        const hub2 = createHub();
        const mk2 = () => {
            const l = createTabLock({
                createTransport: () => hub2.connect(),
                now: () => clock, overlayHost: null, autoPulse: false, settleMs: 0
            });
            locks.push(l); return l;
        };
        const c = mk2(); const d = mk2();
        hub2.hold();
        await Promise.all([
            c.acquire(remoteAtlasKey(ATLAS_A)),
            d.acquire(remoteAtlasKey(ATLAS_A))
        ]);
        hub2.flush({ reverse: true });
        expect([c.blocked, d.blocked].filter(Boolean)).toHaveLength(1);
        expect((c.blocked ? c : d).tabId > (c.blocked ? d : c).tabId).toBe(true);
    });

    // ------------------------------------------------------------------ BACKLOG (furo #1)
    // `granted: true` NAO E PROVA DE EXCLUSIVIDADE, e e ele que autoriza `clearAllDataStore()`.
    // A ordem total conserta o ESTADO depois; o wipe ja rodou. Tres reproducoes da mesma raiz:
    //   (a) duas abas com as mensagens presas: `acquire` devolve granted nas DUAS, e so o flush
    //       seguinte bloqueia uma;
    //   (b) par ocupado por mais que o settle (main thread em render/import, 200 ms contra um
    //       settle de 60 ms): a recem-chegada recebe granted por AUSENCIA DE PROVA;
    //   (c) uma unica mensagem STATE perdida (quota do barramento de localStorage) deixa as duas
    //       ativas ate o heartbeat seguinte.
    // Fechar isso exige uma segunda pergunta ao lock DEPOIS do settle e imediatamente antes do
    // wipe, ou um wipe reversivel. Nao ha teste aqui porque qualquer asercao possivel hoje exige
    // o defeito. Ver TESTING-BACKLOG.md, "Furos abertos do tab-lock" #1.
    it.todo('1.2 ABERTO (furo #1): `granted` e concedido por ausencia de prova, e autoriza o wipe');

    it('1.3 CONFIRMADO: a identidade da aba nao vem de storage nenhum, entao duplicar a aba '
        + 'produz outra identidade e nao um empate', () => {
        const code = read('utilities/tab-lock.js')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/sessionStorage/);
        // A unica leitura/escrita de localStorage e o barramento, nunca a identidade.
        const storageHits = code.match(/localStorage/g) ?? [];
        expect(storageHits.length).toBeGreaterThan(0);
        expect(code).not.toMatch(/localStorage[\s\S]{0,40}tabId/);
        const a = createTabLock({ createTransport: () => null, overlayHost: null, autoPulse: false });
        const b = createTabLock({ createTransport: () => null, overlayHost: null, autoPulse: false });
        expect(a.tabId).not.toBe(b.tabId);
        a.destroy(); b.destroy();
    });
});

describe('ATAQUE 2 - a regra do dono, caso a caso', () => {
    it('2.1: as cinco linhas da matriz, com remoto x remoto ja SEM a espera', () => {
        expect(keysCollide(localAtlasKey('s1'), localAtlasKey('s1'))).toBe(true);
        expect(keysCollide(localAtlasKey('s1'), localAtlasKey('s2'))).toBe(false);
        expect(keysCollide(remoteAtlasKey(ATLAS_A), remoteAtlasKey(ATLAS_A))).toBe(true);
        // A ESPERA SAIU EM E7 (2026-08-15), e esta linha e o seu registro. Ela devolvia `true`
        // aqui enquanto quatro furos so alcancaveis com duas abas remotas estavam abertos
        // (`saveLocalToServer` sem namespace, o logout desregistrando o namespace vivo da irma,
        // o link publico apagando o que registrou, e a fila de saida GLOBAL). Os quatro foram
        // fechados por nome; a lista e as guardas de cada um estao em `keysCollide`. A linha
        // acima e o controle negativo desta: o MESMO atlas continua colidindo.
        expect(keysCollide(remoteAtlasKey(ATLAS_A), remoteAtlasKey(ATLAS_B))).toBe(false);
        expect(keysCollide(remoteAtlasKey(ATLAS_A), localAtlasKey('s1'))).toBe(false);
        expect(keysCollide(noneKey(), remoteAtlasKey(ATLAS_A))).toBe(false);
        expect(keysCollide(noneKey(), localAtlasKey('s1'))).toBe(false);
    });

    it('2.1b CORRIGIDO: o slot ADOTADO e a excecao da linha `remoto x local`, e ela colide', () => {
        // O refutador anterior levantou e ninguem tinha fechado: depois de `adoptRemoteAtlasAsLocal`
        // o slot local guarda o sufixo `remote-<atlasId>`, isto e, os MESMOS dez bancos do atlas de
        // servidor. Comparar (kind, id) respondia `false` para o unico par que divide um disco, e a
        // aba do resgate assistiria outra aba abrir aquele atlas e apagar, no caminho de entrada, o
        // trabalho que o resgate existe para salvar. O predicado compara ENDERECO.
        const resgatado = localAtlasKey('slot-resgatado', { adoptedFrom: ATLAS_A });
        expect(keysCollide(resgatado, remoteAtlasKey(ATLAS_A))).toBe(true);
        // Controle negativo: sem a adocao (a chave que a derivacao antiga produzia) nao colide.
        expect(keysCollide(localAtlasKey('slot-resgatado'), remoteAtlasKey(ATLAS_A))).toBe(false);
        expect(keysCollide(resgatado, remoteAtlasKey(ATLAS_B))).toBe(false);
        // E a derivacao da chave a partir do escopo passa o campo, senao o predicado nunca o ve.
        const svc = read('account/open-atlas.service.js');
        expect(svc).toMatch(/adoptedFrom: remoteAtlasIdFromDbSuffix\(scope\.dbSuffix\)/);
        expect(svc).toMatch(/return localKeyOfScope\(scope\);/);
    });

    it('2.2 CORRIGIDO: chave de tipo desconhecido FALHA FECHADA, e chave remota sem id nao existe', () => {
        // O predicado deixou de ser um switch por `kind` e passou a comparar o ENDERECO: mesmo
        // kind, mesmo id. Uma mensagem de peer com `kind` corrompido ou de um deploy futuro que
        // nomeie o mesmo atlas volta a bloquear.
        const bogus = { kind: 'atlas', atlasId: 's1' };
        expect(keysCollide(bogus, bogus)).toBe(true);
        expect(keysCollide(bogus, { kind: 'atlas', atlasId: 's2' })).toBe(false);
        expect(keysCollide(bogus, remoteAtlasKey(ATLAS_A))).toBe(false);
        // ...e a chave sem id nenhum, que era o normal do link publico, hoje nem se constroi.
        expect(() => remoteAtlasKey()).toThrow();
    });

    it('2.3 CORRIGIDO: a fila deixou de ser o recurso compartilhado, e o open remoto nao a '
        + 'apaga mais', () => {
        // Este caso AFIRMAVA o contrario ate 2026-08-15, e afirmava certo para o codigo de
        // entao: `remote x local` nao colide (os bancos de DADO sao disjuntos) e a fila era o
        // unico recurso que as duas abas dividiam, entao uma aba local perdia trabalho nao
        // sincronizado quando a irma abria um atlas do servidor. Era o furo #5.
        //
        // A fila virou o 11o banco POR ATLAS (`atlas-namespace.js`, Decisao 2b), logo nao ha
        // mais recurso compartilhado a arbitrar, e o wipe de entrada deixou de alcanca-la.
        const store = read('store/store.js');
        const unmount = store.slice(store.indexOf('async function unmountCurrentAtlas'));
        // Controle positivo do recorte: a funcao foi mesmo lida.
        expect(unmount.slice(0, 400)).toMatch(/clearAllAtlasStores\(\)/);
        // O `clear` da fila existe, mas so sob a decisao do chamador.
        expect(unmount.slice(0, 400)).toMatch(/if \(clearQueue\) \{\s*await operationQueue\.clear\(\)/);

        const ns = read('store/atlas-namespace.js');
        expect(ns).not.toMatch(/queue stays global/);
        const fila = ns.slice(ns.indexOf('id: StoreName.OPERATION_QUEUE'));
        expect(fila.slice(0, 200)).toMatch(/perAtlas: true, atlasData: false/);

        const openSvc = read('account/open-atlas.service.js');
        expect(openSvc).toMatch(/await clearAllDataStore\(/);
        expect(keysCollide(remoteAtlasKey(ATLAS_A), localAtlasKey('s1'))).toBe(false);
    });

    it('2.4 CONFIRMADO (decisao): o wipe do open remoto roda ANTES de markStoreRemote, logo '
        + 'esvazia o escopo ATUAL e nunca o namespace do atlas de destino', () => {
        const svc = read('account/open-atlas.service.js');
        const fn = svc.slice(svc.indexOf('export async function openRemoteAtlas'));
        const iWipe = fn.indexOf('await clearAllDataStore(');
        const iMark = fn.indexOf('await markStoreRemote(atlasId);');
        expect(iWipe).toBeGreaterThan(-1);
        expect(iMark).toBeGreaterThan(iWipe);
        // Com um namespace por atlas isso deixou de ser contradicao e virou o comportamento certo
        // (abrir um projeto do servidor SUBSTITUI o que esta montado), mas segue sendo o motivo de
        // a colisao a arbitrar aqui ser a do atlas MONTADO, e nao a do atlas de destino.
        expect(svc).not.toMatch(/single `__remote` scratch/);
    });
});

describe('ATAQUE 3 - a ordem contra o clearAllDataStore', () => {
    it('3.1 CONFIRMADO: openRemoteAtlas reivindica ANTES do wipe', () => {
        // Recortado na FUNCAO: o arquivo tem outro `clearAllDataStore()` (o do pre-voo do boot),
        // e um `indexOf` no arquivo inteiro passaria a medir aquele.
        const svc = read('account/open-atlas.service.js');
        const fn = svc.slice(svc.indexOf('export async function openRemoteAtlas'));
        const iClaim = fn.indexOf('if (!await claimRemoteAtlas(atlasId))');
        const iWipe = fn.indexOf('await clearAllDataStore(');
        expect(iClaim).toBeGreaterThan(-1);
        expect(iWipe).toBeGreaterThan(iClaim);
    });

    it('3.2 CORRIGIDO: enterLocalMapOnBoot passa pelo pre-voo aguardavel, no lugar do wipe cru', () => {
        const index = read('index.js');
        const fn = index.slice(index.indexOf('async function enterLocalMapOnBoot'),
            index.indexOf('async function openAtlasFromUrl'));
        expect(fn).not.toMatch(/await clearAllDataStore\(/);
        expect(fn).toMatch(/await clearMountedAtlasIfGranted\(\(\) => enterLocalMapOnBoot\(\)\)/);
        // Controle positivo do recorte: a funcao foi mesmo lida.
        expect(fn).toMatch(/hasLocalMapIntent\(\)/);
    });

    it('3.3 CORRIGIDO: openAtlasChooserOnBoot idem, e nao abre o seletor se foi recusado', () => {
        const index = read('index.js');
        const fn = index.slice(index.indexOf('async function openAtlasChooserOnBoot'));
        expect(fn.slice(0, 800)).not.toMatch(/await clearAllDataStore\(/);
        expect(fn.slice(0, 800)).toMatch(/!await clearMountedAtlasIfGranted\(/);
        expect(fn.slice(0, 800)).toMatch(/openProjectPicker/);
    });

    it('3.4 CORRIGIDO no comportamento: o pre-voo recusa e nao apaga (o ponteiro para a prova)', () => {
        // A prova comportamental dos dois wipes esta na integracao, com o lock REAL e um par no
        // mesmo atlas; aqui fica so o ponteiro, para que a inversao acima nao pareca so textual.
        const spec = readFileSync(
            resolve(SRC, '../../tests/integration/tab-lock-atlas-integration.test.js'), 'utf8');
        expect(spec).toMatch(/os DOIS wipes do boot: clearMountedAtlasIfGranted/);
        expect(spec).toMatch(/expect\(calls\)\.not\.toContain\('clearAllDataStore'\)/);
    });

    it('3.5 CORRIGIDO: no boot o lock ainda nao decidiu, e e por isso que o pre-voo ESPERA em vez '
        + 'de ler a flag', async () => {
        // Modela o boot: A ja segura o atlas; B constroi o lock e agiria no mesmo tick.
        const hub = createHub();
        let clock = 1000;
        const mk = (o = {}) => createTabLock({
            createTransport: () => hub.connect(), now: () => clock,
            overlayHost: null, autoPulse: false, settleMs: 0, ...o
        });
        const a = mk();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 10;
        hub.setDelay(1);                     // entrega assincrona, como BroadcastChannel real
        const b = mk({ key: remoteAtlasKey(ATLAS_A) });
        // A leitura sincrona que o boot usava continua respondendo o que sempre respondeu:
        expect(b.blocked).toBe(false);
        // ...e e por isso que o pre-voo nao le, reivindica e AGUARDA:
        const res = await b.acquire(remoteAtlasKey(ATLAS_A), { settleMs: 30 });
        expect(res.granted).toBe(false);
        expect(b.blocked).toBe(true);
        a.destroy(); b.destroy();
    });

    it('3.6 CONFIRMADO: a cadeia de alcance da aba duplicada segue toda no codigo, e e por isso '
        + 'que o pre-voo tem de ficar', () => {
        // (a) "Mapa local" em projetos.html grava a intencao e navega para o mapa.
        expect(read('projects/projects-page.js'))
            .toMatch(/sessionStorage\.setItem\(LOCAL_INTENT_KEY, '1'\)/);
        // (b) origem REMOTE + sessao viva -> a aba nova ATIVA o namespace daquele atlas remoto.
        // (Era "o scratch COMPARTILHADO": todo atlas remoto caia num rascunho unico. Agora cada um
        // tem o seu, e a ativacao passa por activateRemoteAtlas, que registra o namespace ANTES de
        // ativa-lo. O alcance descrito neste ataque nao mudou: a aba duplicada segue ativando o
        // mesmo namespace que a original esta usando.)
        expect(read('store/local-atlas.api.js'))
            .toMatch(/if \(isRemoteOrigin && options\.isAuthenticated && atlasId\.length > 0\)[\s\S]{0,160}?activateRemoteAtlas\(atlasId\)/);
        // (c) e clearAllDataStore limpa o ESCOPO ATIVO, mais a fila global.
        expect(read('store/repository.js'))
            .toMatch(/export async function clearAllAtlasStores\(\)\s*\{[\s\S]{0,300}?ensureAtlasScope\(\)/);
        // (d) o unico elo que mudou: o caminho agora consulta o lock antes de apagar.
        const index = read('index.js');
        const fn = index.slice(index.indexOf('async function enterLocalMapOnBoot'),
            index.indexOf('async function openAtlasFromUrl'));
        expect(fn).toMatch(/clearMountedAtlasIfGranted/);
    });
});

describe('ATAQUE 4 - liberacao', () => {
    let hub; let clock; let locks;
    const mk = (o = {}) => {
        const l = createTabLock({
            createTransport: () => hub.connect(), now: () => clock,
            overlayHost: null, autoPulse: false, settleMs: 0, takeoverTimeoutMs: 500, ...o
        });
        locks.push(l); return l;
    };
    beforeEach(() => { hub = createHub(); clock = 1000; locks = []; });
    afterEach(() => { for (const l of locks) l.destroy(); });

    it('4.1 CONFIRMADO: aba fechada (RELEASE no pagehide) libera a bloqueada na hora', async () => {
        const a = mk(); const b = mk();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);
        a.destroy();
        expect(b.blocked).toBe(false);
    });

    it('4.2 CONFIRMADO: aba morta em silencio (crash/kill) libera por TTL, sem mensagem nenhuma', async () => {
        const a = mk({ peerTtlMs: 7000 }); const b = mk({ peerTtlMs: 7000 });
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);
        hub.kill(a._transport);
        // Controle negativo: ANTES do TTL a bloqueada continua bloqueada.
        clock += 6000; b.pulse();
        expect(b.blocked).toBe(true);
        clock += 1500; b.pulse();
        expect(b.blocked).toBe(false);
    });

    // ------------------------------------------------------------------ BACKLOG (furo #2)
    // NAO HA FENCING: o despejo por TTL nao chega a quem foi despejado. Uma aba apenas TRAVADA
    // (main thread ocupado, nao morta) para de pulsar, o par a expira, assume o atlas e roda o
    // wipe; quando ela destrava, ela pulsa com o `claimedAt` ANTIGO, volta a preceder na ordem
    // total, e retoma o lock sem NUNCA ter rodado o proprio `onBlocked`. Ela segue escrevendo
    // sobre bancos que a outra ja limpou. Fechar exige uma epoca monotonica por atlas, ou um
    // `onBlocked` disparado pela propria aba ao notar que ficou muda por mais que o TTL.
    // Ver TESTING-BACKLOG.md, "Furos abertos do tab-lock" #2.
    it.todo('4.3 ABERTO (furo #2): aba despejada por TTL retoma o lock sem saber que foi despejada');

    // ------------------------------------------------------------------ BACKLOG (furo #3)
    // BFCACHE: o handler de `pagehide` e `const leave = () => this._postLeave();`, que nao olha
    // `event.persisted`. Uma aba que entra no bfcache posta RELEASE, o par assume e limpa, e ela
    // volta do cache achando-se dona (a chave em memoria segue remota) porque nao ha handler de
    // `pageshow` para re-anunciar; ela so se corrige no heartbeat seguinte, depois do estrago.
    // Ver TESTING-BACKLOG.md, "Furos abertos do tab-lock" #3.
    it.todo('4.4 ABERTO (furo #3): pagehide de bfcache libera a chave e a volta nao a re-anuncia');

    // ------------------------------------------------------------------ BACKLOG (furo #4)
    // UMA ABA QUE CEDEU NUNCA REASSUME, e o mesmo `_yielded` produz os dois sintomas:
    //   (a) a aba que cedeu fica bloqueada PARA SEMPRE se a vencedora fecha, porque `_evaluate`
    //       so sai do bloqueio com `!this._yielded`, e o overlay passa a mentir ("ja esta aberto
    //       em outra aba") sem par nenhum vivo;
    //   (b) um TAKEOVER de UMA aba encalha TODAS as outras que seguravam a mesma chave, porque
    //       `_handleTakeover` e por colisao de chave, nao por destinatario: quem nem clicou perde
    //       a chave e fica sem caminho de volta.
    // Fechar os dois e a mesma linha: ao cair para zero par vivo em colisao, re-adotar
    // `_yieldedKey` em vez de continuar cedido. Ver TESTING-BACKLOG.md #4.
    it.todo('4.5 ABERTO (furo #4): a aba que cedeu (YIELD) nunca re-adota a chave, e encalha');

    it('4.6 CONFIRMADO (decisao): sem transporte nenhum o lock desliga, concede, e AVISA', async () => {
        // "Off and audible, never off and quiet" (tab-lock.js, secao 8). Fail-open e deliberado:
        // um navegador sem BroadcastChannel E sem localStorage nao pode arbitrar, e travar o app
        // seria pior que arbitrar mal. O que falta e alguem LER `degraded` para badgear a UI, e
        // isso e o furo #6 do TESTING-BACKLOG, nao uma asercao daqui.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const lock = createTabLock({ createTransport: () => null, overlayHost: null, autoPulse: false });
        locks.push(lock);
        const res = await lock.acquire(remoteAtlasKey(ATLAS_A));
        expect(res.degraded).toBe(true);
        expect(res.granted).toBe(true);
        expect(lock.transportKind).toBe('none');
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('ATAQUE 5 - o bloqueio para mesmo?', () => {
    it('5.1 CONFIRMADO: o efeito do bloqueio para o flush e o socket, e nao apaga nada', () => {
        // O handler inline do index.js virou uma chamada ao freio, que e quem para e quem restaura.
        const index = read('index.js');
        expect(index).toMatch(/await installTabLockSyncBrake\(\{ replay: resumeDeferredAtlasOpen \}\)/);
        expect(index).not.toMatch(/onBlocked: \(\) => \{/);
        const brake = read('store/sync/tab-lock-sync-brake.js');
        expect(brake).toMatch(/stopAutoFlush\(\)/);
        expect(brake).toMatch(/syncEngine\.disconnect\(\)/);
        expect(brake.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
            .not.toMatch(/clearAllDataStore|markStoreLocal|dropAtlas/);
    });

    it('5.2 CONFIRMADO: o modulo do lock nao alcanca a store, que e o que o mantem usavel nas '
        + 'paginas sem mapa', () => {
        const code = read('utilities/tab-lock.js')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/from\s+'@store/);
        expect(code).not.toMatch(/clearAllDataStore/);
    });

    it('5.3 CORRIGIDO: o freio esta LIGADO, exatamente uma vez e so na pagina que segura atlas', () => {
        // O modulo ja existiu com ZERO chamadores em src/: 163 linhas e 30 testes verdes sobre
        // codigo que nao rodava, enquanto o fileoverview do lock dizia que era assim que o
        // bloqueio se aplicava. Esta e a asercao que impede aquilo de voltar.
        expect(read('index.js')).toMatch(/import \{ installTabLockSyncBrake \} from '@store\/sync\/tab-lock-sync-brake\.js'/);
        expect(read('index.js')).toMatch(/await installTabLockSyncBrake\(/);
        // E em nenhuma das paginas sem mapa, que nao tem store nem sync para frear.
        for (const f of ['projects/projects-page.js', 'admin/admin-page.js',
            'calibration/calibracao-page.js', 'map_sig.js']) {
            const src = read(f);
            expect(src.length).toBeGreaterThan(500);          // controle positivo da leitura
            expect(src).toMatch(/^\/\/ Path: js\//);
            expect(src).not.toMatch(/installTabLockSyncBrake|applySyncBrake|releaseSyncBrake/);
        }
        // E `isAutoFlushRunning`, que so o freio consome, deixou de ser codigo morto junto.
        expect(read('store/sync/tab-lock-sync-brake.js')).toMatch(/isAutoFlushRunning\(\)/);
    });

    it('5.4 CORRIGIDO: a retomada restaura o sync; com o onResumed antigo a aba ficava zumbi', () => {
        // O `onResumed` do index.js era `resumeDeferredAtlasOpen` sozinho, que nao faz nada quando
        // nao houve abertura adiada, que e justamente o caso de quem CEDE o proprio atlas. O
        // comportamento novo (e o controle negativo com os handlers de entao) esta medido em
        // tests/unit/tab-lock-sync-brake.test.js; aqui fica so a fiacao.
        const index = read('index.js');
        expect(index).not.toMatch(/onResumed: resumeDeferredAtlasOpen,/);
        expect(index).toMatch(/installTabLockSyncBrake\(\{ replay: resumeDeferredAtlasOpen \}\)/);
        const brake = read('store/sync/tab-lock-sync-brake.js');
        expect(brake).toMatch(/await releaseSyncBrake\(\);/);
        expect(brake).toMatch(/syncEngine\.connect\(atlasId, \{ initialPull: true \}\)/);
        const svc = read('account/open-atlas.service.js');
        const fn = svc.slice(svc.indexOf('export async function resumeDeferredAtlasOpen'));
        expect(fn.slice(0, 600)).not.toMatch(/startAutoFlush|syncEngine\.connect/);
        const spec = readFileSync(
            resolve(SRC, '../../tests/unit/tab-lock-sync-brake.test.js'), 'utf8');
        expect(spec).toMatch(/A ABA ZUMBI/);
        expect(spec).toMatch(/CONTROLE NEGATIVO/);
    });

    it('5.5 CORRIGIDO: o efeito do bloqueio e aguardavel, que e o que o handoff espera', () => {
        // O handler inline era sincrono, entao o YIELD acusava uma parada que so tinha COMECADO.
        expect(read('store/sync/tab-lock-sync-brake.js'))
            .toMatch(/export async function applySyncBrake/);
        expect(read('index.js')).not.toMatch(/onBlocked:/);
    });
});

describe('ATAQUE 6 - regressao', () => {
    it('6.1 CONFIRMADO: as tres paginas sem mapa entram com chave nula e sem overlay', () => {
        for (const f of ['projects/projects-page.js', 'admin/admin-page.js', 'calibration/calibracao-page.js']) {
            expect(read(f)).toMatch(/initTabLock\(\{ key: noneKey\(\), overlayHost: null \}\)/);
        }
    });

    it('6.2 CONFIRMADO: pagina sem mapa nunca bloqueia nem e bloqueada', async () => {
        const hub = createHub();
        const clock = 1000;
        const mk = (o = {}) => createTabLock({
            createTransport: () => hub.connect(), now: () => clock,
            overlayHost: null, autoPulse: false, settleMs: 0, ...o
        });
        const admin = mk({ key: noneKey() });
        const mapa = mk();
        const res = await mapa.acquire(remoteAtlasKey(ATLAS_A));
        expect(res.granted).toBe(true);
        expect(admin.blocked).toBe(false);
        expect(mapa.blocked).toBe(false);
        admin.destroy(); mapa.destroy();
    });

    it('6.3 CONFIRMADO: duas abas anonimas caem no MESMO slot local, e por isso a segunda E '
        + 'bloqueada, que e a regra e nao um efeito colateral', () => {
        // Este caso ja se leu como defeito ("N atlas locais nao se realiza no caso comum"). Sob a
        // regra uniforme ele e a regra: o ponteiro do atlas local corrente e GLOBAL
        // (`GlobalKey.CURRENT_LOCAL_ATLAS`), as duas abas derivam a MESMA chave, mesmo atlas,
        // colisao. Bloquear a segunda e exatamente o que protege o namespace compartilhado.
        expect(read('store/atlas-namespace.js')).toMatch(/CURRENT_LOCAL_ATLAS/);
        // A derivação da chave local (era o `localAtlasKey(scope.atlasId)` inline, hoje
        // `localKeyOfScope`, que ainda cai em `none` quando o escopo não nomeia atlas nenhum).
        expect(read('account/open-atlas.service.js'))
            .toMatch(/function localKeyOfScope\(scope\) \{\s*if \(!scope\?\.atlasId\) return noneKey\(\);/);
        expect(keysCollide(localAtlasKey('slot-corrente'), localAtlasKey('slot-corrente'))).toBe(true);
    });

    it('6.3b CONFIRMADO: e o bloqueio da segunda aba local acontece de fato, no protocolo', async () => {
        const hub = createHub();
        let clock = 1000;
        const mk = () => createTabLock({
            createTransport: () => hub.connect(), now: () => clock,
            overlayHost: null, autoPulse: false, settleMs: 0
        });
        const a = mk(); const b = mk();
        await a.acquire(localAtlasKey('slot-corrente'));
        clock += 5;
        const res = await b.acquire(localAtlasKey('slot-corrente'));
        expect(res.granted).toBe(false);
        // Controle: em slots DIFERENTES a segunda passa, que e a metade nova da regra.
        const c = mk();
        clock += 5;
        expect((await c.acquire(localAtlasKey('outro-slot'))).granted).toBe(true);
        a.destroy(); b.destroy(); c.destroy();
    });

    it('6.4 CORRIGIDO: o fileoverview descreve quem chama o que, em vez de negar as chamadas', () => {
        const doc = read('utilities/tab-lock.js');
        expect(doc).not.toMatch(/no page calls `acquire` yet/);
        expect(doc).not.toMatch(/NOT DONE HERE/);
        expect(doc).toMatch(/WHO CALLS WHAT/);
        // E as chamadas que ele descreve existem mesmo, nos tres arquivos citados.
        expect(read('index.js')).toMatch(/await acquireTabLock\(remoteAtlasKey\(atlas\.id\)\)/);
        expect(read('index.js')).toMatch(/installTabLockSyncBrake/);
        expect(read('account/open-atlas.service.js')).toMatch(/await acquireTabLock\(key\)/);
    });

    it('6.5 CONFIRMADO: todo furo aberto citado aqui existe no TESTING-BACKLOG, e o fileoverview '
        + 'do modulo aponta para la', () => {
        // O que este caso impede: um `it.todo` orfao (buraco que so este arquivo conhece) e uma
        // linha de backlog apagada sem que o todo correspondente saia junto. Sem ele, "esta no
        // backlog" seria uma promessa que ninguem cobra.
        const spec = readFileSync(resolve(SRC, '../../tests/unit/tab-lock-refutacao.test.js'), 'utf8');
        const backlog = readFileSync(resolve(SRC, '../../tests/TESTING-BACKLOG.md'), 'utf8');
        expect(backlog).toMatch(/## Furos abertos do tab-lock/);

        const citados = [...spec.matchAll(/it\.todo\('[^']*furo #(\d+)/g)].map((m) => Number(m[1]));
        expect(citados.length).toBeGreaterThan(0);          // controle positivo do regex
        expect(citados).toEqual([...new Set(citados)]);      // sem numero repetido
        const secao = backlog.slice(backlog.indexOf('## Furos abertos do tab-lock'));
        for (const n of citados) {
            expect(secao.slice(0, secao.indexOf('\n---'))).toMatch(new RegExp(`^\\| ${n} \\|`, 'm'));
        }
        // E o modulo manda o leitor para o mesmo lugar, em vez de descrever so as garantias.
        const doc = read('utilities/tab-lock.js');
        expect(doc).toMatch(/WHAT THIS PROTOCOL DOES NOT DO/);
        expect(doc).toMatch(/tests\/TESTING-BACKLOG\.md/);
    });

    it('6.6 CONFIRMADO: a ordem total e mesmo uma ordem (antissimetrica, com empate neutro)', () => {
        const c = (t, at) => ({ tabId: t, claimedAt: at, key: remoteAtlasKey(ATLAS_A) });
        expect(compareClaims(c('a', 1), c('b', 2))).toBeLessThan(0);
        expect(compareClaims(c('b', 2), c('a', 1))).toBeGreaterThan(0);
        // claimedAt manda; tabId so desempata.
        expect(compareClaims(c('z', 1), c('a', 2))).toBeLessThan(0);
        expect(compareClaims(c('a', 1), c('b', 1))).toBeLessThan(0);
        expect(findBlockingPeer(c('b', 2), [c('a', 1)]).tabId).toBe('a');
        expect(findBlockingPeer(c('a', 1), [c('b', 2)])).toBeNull();
        // Empate perfeito: ninguem precede ninguem.
        expect(findBlockingPeer(c('a', 1), [c('a', 1)])).toBeNull();
    });
});
