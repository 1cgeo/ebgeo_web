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
    otherClientHoldsLock,
    noneKey,
    localAtlasKey,
    remoteAtlasKey
} from '@utils/tab-lock.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

const ATLAS_A = '11111111-1111-4111-8111-111111111111';
const ATLAS_B = '22222222-2222-4222-8222-222222222222';

// =============================================================================================
// CUTTING SOURCE AT A SYNTACTIC BOUNDARY
//
// Several cases below assert something NEGATIVE about one function ("this one does not call
// `clearAllDataStore`"), and a negative assertion is worth exactly the cut it reads. These cuts
// used to be character windows (`fn.slice(0, 800)`), which fail in BOTH directions and fail
// QUIETLY:
//
//   too short - the forbidden call moves past the end and the case stays green. Measured: a wipe
//               reintroduced INSIDE `openAtlasChooserOnBoot` and pushed past character 800 by
//               comments left the three files that could catch it at 63 passed, 0 failed.
//   too long  - the window runs into the NEXT function, so the case reports on code it never
//               meant to name. Same measurement: that function is 460 characters long, so the
//               800-character window was reading `initApp` and file-level comments.
//
// A window also rots on its own: source only ever grows, so a green window is indistinguishable
// from a window that stopped looking. So the cut is the BLOCK, brace-matched, and every cut
// asserts that what it got is what the caller named.
// =============================================================================================

/**
 * Blanks out comments and string/template bodies while PRESERVING LENGTH, so brace scanning sees
 * structure only. Offsets into the result address the same characters as in the input, which is
 * what lets the caller slice the ORIGINAL text with indices computed here.
 * @param {string} source - JavaScript source text.
 * @returns {string} Same-length text with literal and comment content replaced by spaces.
 */
function maskLiterals(source) {
    const out = [...source];
    const n = source.length;
    const blank = (at) => { if (at < n && source[at] !== '\n') out[at] = ' '; };
    let i = 0;
    while (i < n) {
        const c = source[i];
        const next = source[i + 1];
        if (c === '/' && next === '/') {
            while (i < n && source[i] !== '\n') { blank(i); i++; }
        } else if (c === '/' && next === '*') {
            blank(i); blank(i + 1); i += 2;
            while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { blank(i); i++; }
            blank(i); blank(i + 1); i += 2;
        } else if (c === '"' || c === '\'' || c === '`') {
            i++;
            while (i < n) {
                if (source[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
                if (source[i] === c) { i++; break; }
                blank(i); i++;
            }
        } else {
            i++;
        }
    }
    return out.join('');
}

/**
 * Probe of the masker, which is itself a verifier and would otherwise break quietly: a whole JS
 * file has balanced braces once comments and literals are out, and a brace left inside a masked
 * literal (a regex literal with an odd quote, say) shows up here as an imbalance instead of as a
 * silently truncated cut downstream.
 * @param {string} masked - Output of `maskLiterals`.
 * @returns {void}
 */
function expectMaskIsSane(masked) {
    let depth = 0;
    let lowest = 0;
    for (const ch of masked) {
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth < lowest) { lowest = depth; }
        }
    }
    expect(lowest, 'chaves desbalanceadas apos o mascaramento').toBe(0);
    expect(depth, 'chaves desbalanceadas apos o mascaramento').toBe(0);
}

/**
 * @param {string} masked - Output of `maskLiterals`.
 * @param {number} open - Index of the `{` that opens the block.
 * @returns {number} Index of the `}` that closes it.
 */
function matchBrace(masked, open) {
    let depth = 0;
    for (let i = open; i < masked.length; i++) {
        if (masked[i] === '{') depth++;
        else if (masked[i] === '}' && --depth === 0) return i;
    }
    throw new Error(`bloco aberto em ${open} nunca fecha`);
}

/**
 * The full text of ONE function declaration, from its header to its own closing brace.
 * @param {string} source - JavaScript source text.
 * @param {string} header - Declaration header, e.g. `async function openAtlasChooserOnBoot`.
 * @returns {string} The function's text, cut at the brace that closes it.
 */
function functionText(source, header) {
    const masked = maskLiterals(source);
    expectMaskIsSane(masked);
    const start = masked.indexOf(header);
    expect(start, `cabecalho ausente: ${header}`).toBeGreaterThan(-1);
    expect(masked.indexOf(header, start + 1), `cabecalho ambiguo: ${header}`).toBe(-1);
    // The body brace is the first `{` outside the parameter list: a destructured parameter
    // (`unmountCurrentAtlas({ clearQueue = true } = {})`) opens a brace before the body does.
    let parens = 0;
    let open = -1;
    for (let i = start + header.length; i < masked.length; i++) {
        const c = masked[i];
        if (c === '(') {
            parens++;
        } else if (c === ')') {
            parens--;
        } else if (c === '{' && parens === 0) {
            open = i;
            break;
        }
    }
    expect(open, `corpo nao encontrado: ${header}`).toBeGreaterThan(-1);
    const text = source.slice(start, matchBrace(masked, open) + 1);
    // O recorte E o que o chamador pensa que e: comeca no cabecalho pedido, fecha, e carrega UMA
    // declaracao de topo, nunca a seguinte. Sem esta conferencia o recorte errado passa
    // despercebido, que e exatamente como a janela de caracteres silenciava.
    expect(text.startsWith(header)).toBe(true);
    expect(text.endsWith('}')).toBe(true);
    const decls = maskLiterals(text).match(/^(?:export\s+)?(?:async\s+)?function\s+\w+/gm) ?? [];
    expect(decls, `o recorte transbordou a funcao: ${header}`).toHaveLength(1);
    return text;
}

/**
 * The full text of ONE object literal, addressed by the code that opens it.
 * @param {string} source - JavaScript source text.
 * @param {string} header - Text ending at (or before) the literal's `{`.
 * @returns {string} The literal's text, cut at the brace that closes it.
 */
function objectText(source, header) {
    const masked = maskLiterals(source);
    expectMaskIsSane(masked);
    const start = masked.indexOf(header);
    expect(start, `entrada ausente: ${header}`).toBeGreaterThan(-1);
    expect(masked.indexOf(header, start + 1), `entrada ambigua: ${header}`).toBe(-1);
    const open = masked.indexOf('{', start);
    expect(open, `entrada sem bloco: ${header}`).toBeGreaterThan(-1);
    const text = source.slice(start, matchBrace(masked, open) + 1);
    expect(text.startsWith(header)).toBe(true);
    expect(text.endsWith('}')).toBe(true);
    return text;
}

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

describe('ATAQUE 0 - o recorte, sondado contra si mesmo', () => {
    // O recorte e um verificador, e verificador quebra calado: enquanto ele foi uma janela de
    // caracteres, ninguem tinha medido o que ele lia. Estas asercoes rodam o MESMO helper que os
    // casos de baixo, sobre um fonte sintetico onde a resposta certa e conhecida.
    const FONTE = [
        '// Path: js/falso.js',
        '',
        '/** Doc com chave solta { e apostrofo de prosa: don\'t. */',
        'async function alvo() {',
        `    // ${'x'.repeat(900)}`,
        '    const s = "}}} nada disso fecha bloco {{{";',
        '    await clearAllDataStore();',
        '}',
        '',
        'async function vizinha() {',
        '    await clearAllDataStore();',
        '}',
        ''
    ].join('\n');

    it('0.1: o recorte alcanca o fim da funcao, e a janela de 800 caracteres NAO alcancava', () => {
        const alvo = functionText(FONTE, 'async function alvo');
        expect(alvo).toMatch(/await clearAllDataStore\(\)/);
        // CONTROLE NEGATIVO, e e o defeito que este helper existe para fechar: o mesmo recorte,
        // truncado como antes, nao ve a chamada, entao o `not.toMatch` passava verde.
        expect(alvo.slice(0, 800)).not.toMatch(/await clearAllDataStore\(\)/);
    });

    it('0.2: o recorte para no fecho da funcao e nao le a seguinte, mesmo quando ela e curta', () => {
        expect(functionText(FONTE, 'async function alvo')).not.toMatch(/vizinha/);
        const curto = 'function a() {\n    return 1;\n}\n\nfunction b() {\n    clearAllDataStore();\n}\n';
        // Uma janela de 800 aqui leria as DUAS funcoes; o recorte le uma.
        expect(curto.slice(curto.indexOf('function a'), 800)).toMatch(/clearAllDataStore/);
        expect(functionText(curto, 'function a')).not.toMatch(/clearAllDataStore/);
        expect(functionText(curto, 'function b')).toMatch(/clearAllDataStore/);
    });

    it('0.3: chave dentro de comentario, de string e de parametro desestruturado nao desloca o corte', () => {
        const params = 'function f({ a = 1 } = {}) {\n    return "{";\n}\nfunction g() { return 2; }\n';
        expect(functionText(params, 'function f')).toBe('function f({ a = 1 } = {}) {\n    return "{";\n}');
        expect(objectText('const x = Object.freeze({ id: Q, flag: false });\n',
            'Object.freeze({ id: Q')).toBe('Object.freeze({ id: Q, flag: false }');
    });

    it('0.4: cabecalho ausente ou ambiguo FALHA, em vez de devolver um recorte qualquer', () => {
        expect(() => functionText(FONTE, 'async function inexistente')).toThrow();
        expect(() => functionText(`${FONTE}\nasync function alvo() {}\n`, 'async function alvo')).toThrow();
    });
});

/**
 * Dublê do LOCK DE MONTAGEM da store (`store/atlas-namespace.js`, Decisão 5), que é o fato que a
 * testemunha lê: um cliente com um namespace MONTADO segura um Web Lock COMPARTILHADO com o nome
 * daquele namespace.
 *
 * O formato é o do `LockManager.query()` de verdade, e não uma invenção conveniente: medido neste
 * runtime (node v24) o retorno é `{held: [{name, mode, clientId}], pending: []}`, e duas posses do
 * MESMO cliente aparecem como duas entradas. É por isso que a contagem funciona sem conhecer o
 * `clientId` de ninguém. O caso 1.2c abaixo confere essa forma contra o `navigator.locks` real,
 * para que este dublê não vire um sujeito diferente do que a produção lê.
 * @returns {{manager: Object, mount: (name: string, clientId: string) => void}}
 */
function createMountLocks() {
    const held = [];
    return {
        manager: { query: async () => ({ held: [...held], pending: [] }) },
        mount(name, clientId) { held.push({ name, mode: 'shared', clientId }); }
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

    // ------------------------------------------------------------------ furo #1, FECHADO
    // `granted: true` ERA CONCEDIDO POR AUSENCIA DE PROVA, e e ele que autoriza
    // `clearAllDataStore()`. A ordem total conserta o ESTADO depois; o wipe ja rodou. As tres
    // faces da mesma raiz estao reproduzidas abaixo, cada uma com o seu CONTROLE NEGATIVO (a
    // MESMA cena sem a testemunha, que segue devolvendo granted: e isso que prova que a cena
    // reproduz o furo, e nao que o teste e frouxo).
    //
    // O que fechou: `acquire` passou a exigir DUAS concordancias, a ordem total (o canal) e uma
    // TESTEMUNHA (um fato do navegador). A testemunha le o lock de montagem COMPARTILHADO que a
    // store toma em todo namespace montado, e um Web Lock so e solto pela MORTE do cliente, nunca
    // pelo seu silencio: aba congelada, aba estrangulada e mensagem perdida continuam segurando.
    // A fiacao das duas chamadas destrutivas esta no caso 1.4.
    it('1.2 CORRIGIDO (furo #1): a concessao deixou de ser decidida por silencio, nas TRES faces '
        + 'que produziam silencio com o par vivo', async () => {
        const NOME = `ebgeo-atlas:#remote-${ATLAS_A}`;

        // ---------------------------------------------------------------- face (a)
        // Duas abas NO MESMO atlas, ja montado pelas duas, com as mensagens presas: nenhuma
        // ouve ninguem. E a cena do wipe de boot (`clearMountedAtlasIfGranted`), onde cada aba
        // segura UMA posse do lock de montagem, logo `selfHolds` e 1 e a segunda posse e o par.
        const montadoPelasDuas = createMountLocks();
        montadoPelasDuas.mount(NOME, 'aba-1');
        montadoPelasDuas.mount(NOME, 'aba-2');
        const testemunhaMontada = () => otherClientHoldsLock(montadoPelasDuas.manager, NOME, 1);

        const a = mk(); const b = mk();
        hub.hold();
        const [ra, rb] = await Promise.all([
            a.acquire(remoteAtlasKey(ATLAS_A), { witness: testemunhaMontada }),
            b.acquire(remoteAtlasKey(ATLAS_A), { witness: testemunhaMontada })
        ]);
        hub.flush();
        expect(ra.granted).toBe(false);
        expect(rb.granted).toBe(false);
        expect([ra.deniedBy, rb.deniedBy]).toEqual(['witness', 'witness']);

        // CONTROLE NEGATIVO da face (a): a MESMA cena sem testemunha concede as duas, que e o
        // furo. Sem esta metade, "as duas recusadas" tambem passaria com um `acquire` que nunca
        // concede, e passaria com uma cena que nem chega a disputar.
        hub = createHub();
        const a2 = mk(); const b2 = mk();
        hub.hold();
        const [ra2, rb2] = await Promise.all([
            a2.acquire(remoteAtlasKey(ATLAS_A)),
            b2.acquire(remoteAtlasKey(ATLAS_A))
        ]);
        hub.flush();
        expect([ra2.granted, rb2.granted]).toEqual([true, true]);

        // ---------------------------------------------------------------- face (b)
        // Par OCUPADO por mais que o settle (main thread em render ou import). Aqui a aba nova
        // ainda nao montou o atlas de destino, que e a cena de `claimRemoteAtlas`: `selfHolds` 0.
        const montadoPeloPar = createMountLocks();
        montadoPeloPar.mount(NOME, 'aba-estabelecida');
        const testemunhaDoAlvo = () => otherClientHoldsLock(montadoPeloPar.manager, NOME, 0);

        hub = createHub();
        hub.setDelay(200);                       // 200 ms medidos contra um settle de 20
        mk({ key: remoteAtlasKey(ATLAS_A) });     // a estabelecida, viva e muda a tempo
        const lenta = mk();
        const rLenta = await lenta.acquire(remoteAtlasKey(ATLAS_A), {
            settleMs: 20, witness: testemunhaDoAlvo
        });
        expect(rLenta.granted).toBe(false);
        expect(rLenta.deniedBy).toBe('witness');
        // ...e ela nao ouviu ninguem mesmo: o bloqueio nao veio da ordem.
        expect(lenta.blocked).toBe(false);
        expect(lenta.peers()).toHaveLength(0);

        // CONTROLE NEGATIVO da face (b).
        hub = createHub();
        hub.setDelay(200);
        mk({ key: remoteAtlasKey(ATLAS_A) });
        const lenta2 = mk();
        expect((await lenta2.acquire(remoteAtlasKey(ATLAS_A), { settleMs: 20 })).granted).toBe(true);

        // ---------------------------------------------------------------- face (c)
        // UMA mensagem perdida (quota do barramento de localStorage): o STATE com que a
        // estabelecida responde ao HELLO nunca chega, e a recem-chegada se ve sozinha.
        hub = createHub();
        hub.setDrop((m) => m.type === 'STATE');
        mk({ key: remoteAtlasKey(ATLAS_A) });
        const surda = mk();
        const rSurda = await surda.acquire(remoteAtlasKey(ATLAS_A), { witness: testemunhaDoAlvo });
        expect(rSurda.granted).toBe(false);
        expect(rSurda.deniedBy).toBe('witness');
        expect(surda.peers()).toHaveLength(0);

        // CONTROLE NEGATIVO da face (c).
        hub = createHub();
        hub.setDrop((m) => m.type === 'STATE');
        mk({ key: remoteAtlasKey(ATLAS_A) });
        const surda2 = mk();
        expect((await surda2.acquire(remoteAtlasKey(ATLAS_A))).granted).toBe(true);
    });

    it('1.2b CONTROLE: a concessao LEGITIMA continua acontecendo, senao o conserto seria '
        + '"nunca conceder"', async () => {
        const NOME = `ebgeo-atlas:#remote-${ATLAS_A}`;
        const vazio = createMountLocks();

        // (i) ninguem montou nada: a testemunha nao ve nada e a aba passa.
        const livre = mk();
        const r1 = await livre.acquire(remoteAtlasKey(ATLAS_A), {
            witness: () => otherClientHoldsLock(vazio.manager, NOME, 0)
        });
        expect(r1.granted).toBe(true);
        expect(r1.deniedBy).toBeNull();

        // (ii) alguem montou OUTRO endereco: nao e este atlas, e a aba passa.
        const outro = createMountLocks();
        outro.mount(`ebgeo-atlas:#remote-${ATLAS_B}`, 'aba-vizinha');
        hub = createHub();
        const vizinha = mk();
        expect((await vizinha.acquire(remoteAtlasKey(ATLAS_A), {
            witness: () => otherClientHoldsLock(outro.manager, NOME, 0)
        })).granted).toBe(true);

        // (iii) a UNICA posse e a desta propria aba (`selfHolds` 1): montar o proprio atlas nao
        // pode bloquear a si mesmo, que e a forma de errar que travaria todo boot.
        const soEu = createMountLocks();
        soEu.mount(NOME, 'esta-aba');
        hub = createHub();
        const sozinha = mk();
        expect((await sozinha.acquire(remoteAtlasKey(ATLAS_A), {
            witness: () => otherClientHoldsLock(soEu.manager, NOME, 1)
        })).granted).toBe(true);

        // (iv) e a recusa pela ORDEM continua sendo pela ordem, com o par nomeado: a testemunha
        // nao substituiu o canal, que e quem sabe QUEM bloqueia e alimenta o "Usar aqui".
        hub = createHub();
        const primeira = mk();
        await primeira.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        const segunda = mk();
        const r4 = await segunda.acquire(remoteAtlasKey(ATLAS_A), {
            witness: () => otherClientHoldsLock(vazio.manager, NOME, 0)
        });
        expect(r4.granted).toBe(false);
        expect(r4.deniedBy).toBe('peer');
        expect(r4.blockedBy?.tabId).toBe(primeira.tabId);
    });

    it('1.2c CONTROLE DO INSTRUMENTO: o dublê de `query()` tem a forma do LockManager REAL, e a '
        + 'contagem responde o mesmo sobre ele', async () => {
        // O dublê acima poderia ser um sujeito diferente do que a produção lê. Este caso roda a
        // MESMA função sobre o `navigator.locks` deste runtime, que é o objeto que
        // `open-atlas.service.js` passa.
        expect(typeof navigator?.locks?.query).toBe('function');
        const NOME = `ebgeo-teste-testemunha:${Math.random().toString(36).slice(2)}`;

        expect(await otherClientHoldsLock(navigator.locks, NOME, 0)).toBe(false);

        let soltar;
        const posse = navigator.locks.request(NOME, { mode: 'shared' },
            () => new Promise((resolve) => { soltar = resolve; }));
        // Uma posse: é "outro cliente" para quem não tem nenhuma, e não é para quem tem a sua.
        expect(await otherClientHoldsLock(navigator.locks, NOME, 0)).toBe(true);
        expect(await otherClientHoldsLock(navigator.locks, NOME, 1)).toBe(false);

        let soltar2;
        const posse2 = navigator.locks.request(NOME, { mode: 'shared' },
            () => new Promise((resolve) => { soltar2 = resolve; }));
        // Duas posses: agora há alguém além da sua, que é a leitura do wipe do atlas MONTADO.
        expect(await otherClientHoldsLock(navigator.locks, NOME, 1)).toBe(true);

        soltar(); soltar2();
        await posse; await posse2;
        // E a morte do dono devolve o endereço, que é a propriedade toda: um par CALADO segue
        // segurando, um par MORTO não.
        expect(await otherClientHoldsLock(navigator.locks, NOME, 0)).toBe(false);

        // Sem LockManager (contexto não seguro, HTTP puro) a resposta é "não sei", nunca "livre":
        // é o que faz o `acquire` cair de volta no settle em vez de inventar um fato.
        expect(await otherClientHoldsLock(null, NOME, 0)).toBeNull();
        expect(await otherClientHoldsLock({}, NOME, 0)).toBeNull();
        expect(await otherClientHoldsLock(navigator.locks, '', 0)).toBeNull();
        expect(await otherClientHoldsLock(
            { query: async () => { throw new Error('sem permissao'); } }, NOME, 0)).toBeNull();
    });

    it('1.2d: "nao sei" cai de volta no settle, e nao vira nem bloqueio nem prova', async () => {
        // Contexto não seguro: a testemunha responde null. O comportamento tem de ser EXATAMENTE
        // o do deploy que não tinha testemunha, senão HTTP puro viraria um app que não abre nada.
        const a = mk();
        expect((await a.acquire(remoteAtlasKey(ATLAS_A), { witness: () => Promise.resolve(null) }))
            .granted).toBe(true);
        // ...e uma testemunha QUEBRADA responde o mesmo: evidência de presença que falhou não é
        // presença. O contrário transformaria um defeito de runtime em app que nunca abre projeto.
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        hub = createHub();
        const b = mk();
        expect((await b.acquire(remoteAtlasKey(ATLAS_A), {
            witness: () => { throw new Error('query explodiu'); }
        })).granted).toBe(true);
        expect(erro).toHaveBeenCalledTimes(1);
        erro.mockRestore();

        // E o par ouvido continua bloqueando mesmo com a testemunha muda: as duas recusas são
        // independentes, e é a recusa de QUALQUER uma que recusa a concessão.
        hub = createHub();
        const c = mk();
        await c.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        const d = mk();
        expect((await d.acquire(remoteAtlasKey(ATLAS_A), { witness: () => Promise.resolve(null) }))
            .granted).toBe(false);
    });

    it('1.4: as TRES chamadas destrutivas deste repo passam a testemunha, e ela vem do lock de '
        + 'montagem da store', () => {
        // Uma testemunha que ninguem passa e uma opcao morta. Este caso e o que impede o conserto
        // de existir so no modulo do lock: o recorte e a FUNCAO, pelo motivo do ATAQUE 0.
        //
        // ERAM DUAS, E SAO TRES. `openPublicAtlasFromUrl` (`index.js`) e o quarto sitio que
        // reivindica e destroi, e ficou de fora quando os outros foram ligados, porque `index.js`
        // nao estava na lista de arquivos daquela frente. Um sitio destrutivo sem testemunha e o
        // furo inteiro de volta, num caminho so, e nada apontava para ele: por isso a contagem
        // agora esta no NOME do caso, onde um quarto sitio novo obriga alguem a mexer aqui.
        const svc = read('account/open-atlas.service.js');

        const claim = functionText(svc, 'async function claimRemoteAtlas');
        expect(claim).toMatch(/witness: remoteMountWitness\(atlasId\)/);

        const boot = functionText(svc, 'export async function clearMountedAtlasIfGranted');
        expect(boot).toMatch(/witness: mountWitness\(getActiveScope\(\)\?\.dbSuffix, 1\)/);

        // A testemunha le o lock de montagem DA STORE, e nao um nome inventado aqui: e isso que
        // faz dela um fato mantido por toda aba, inclusive as que nunca falam com o tab-lock.
        const fabrica = functionText(svc, 'function mountWitness');
        expect(fabrica).toMatch(/atlasMountLockName\(dbSuffix\)/);
        expect(fabrica).toMatch(/hasMountLockSupport\(\)/);
        expect(fabrica).toMatch(/otherClientHoldsLock\(navigator\.locks, lockName, selfHolds\)/);
        // E os dois `selfHolds` sao os dois casos, nao um so repetido: 0 para o atlas que a aba
        // ainda NAO montou, 1 para o que ela montou. Trocar os dois passa despercebido sem isto.
        expect(functionText(svc, 'export function remoteMountWitness'))
            .toMatch(/mountWitness\(remoteScope\(atlasId\)\.dbSuffix, 0\)/);

        // O TERCEIRO SITIO: o visitante de link publico. Ele reivindica e chama
        // `clearAllDataStore` tres linhas depois, igual aos outros dois.
        const idx = read('index.js');
        const publico = functionText(idx, 'async function openPublicAtlasFromUrl');
        expect(publico, 'o link publico reivindica sem testemunha: `granted` volta a ser '
            + 'concedido por ausencia de prova num caminho que destroi bancos')
            .toMatch(/witness: remoteMountWitness\(atlas\.id\)/);
        // E a testemunha tem de estar na chamada que REIVINDICA, nao solta em outro lugar da
        // funcao: sem isto, um `remoteMountWitness` importado e nunca usado passaria.
        expect(publico).toMatch(/acquireTabLock\(remoteAtlasKey\(atlas\.id\)[\s\S]{0,120}?witness:/);

        // E o modulo do lock segue sem alcancar a store, que e o que mantem a testemunha injetada
        // em vez de importada (a razao inteira de ela ser um parametro).
        const lock = read('utilities/tab-lock.js')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(lock).not.toMatch(/from\s+'@store/);
        expect(lock).not.toMatch(/atlasMountLockName/);
    });

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
        const unmount = functionText(store, 'async function unmountCurrentAtlas');
        expect(unmount).toMatch(/clearAllAtlasStores\(\)/);
        // O `clear` da fila existe, mas so sob a decisao do chamador.
        expect(unmount).toMatch(/if \(clearQueue\) \{\s*await operationQueue\.clear\(\)/);

        const ns = read('store/atlas-namespace.js');
        expect(ns).not.toMatch(/queue stays global/);
        // Recortado na PROPRIA entrada do descritor: uma janela de caracteres a partir do `id`
        // atravessa para a entrada seguinte assim que alguem inserir um campo.
        const fila = objectText(ns, 'Object.freeze({ id: StoreName.OPERATION_QUEUE');
        expect(fila).toMatch(/perAtlas: true, atlasData: false/);

        const openSvc = read('account/open-atlas.service.js');
        expect(openSvc).toMatch(/await clearAllDataStore\(/);
        expect(keysCollide(remoteAtlasKey(ATLAS_A), localAtlasKey('s1'))).toBe(false);
    });

    it('2.4 CONFIRMADO (decisao): o wipe do open remoto roda ANTES de markStoreRemote, logo '
        + 'esvazia o escopo ATUAL e nunca o namespace do atlas de destino', () => {
        const svc = read('account/open-atlas.service.js');
        const fn = functionText(svc, 'export async function openRemoteAtlas');
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
        // Recortado na FUNCAO, e ate o fecho dela: o arquivo tem outro `clearAllDataStore()` (o do
        // pre-voo do boot), e tanto um `indexOf` no arquivo inteiro quanto um recorte que segue ate
        // o fim do arquivo podem acabar medindo aquele.
        const svc = read('account/open-atlas.service.js');
        const fn = functionText(svc, 'export async function openRemoteAtlas');
        const iClaim = fn.indexOf('if (!await claimRemoteAtlas(atlasId))');
        const iWipe = fn.indexOf('await clearAllDataStore(');
        expect(iClaim).toBeGreaterThan(-1);
        expect(iWipe).toBeGreaterThan(iClaim);
    });

    it('3.2 CORRIGIDO: enterLocalMapOnBoot passa pelo pre-voo aguardavel, no lugar do wipe cru', () => {
        const index = read('index.js');
        const fn = functionText(index, 'async function enterLocalMapOnBoot');
        expect(fn).not.toMatch(/await clearAllDataStore\(/);
        expect(fn).toMatch(/await clearMountedAtlasIfGranted\(\(\) => enterLocalMapOnBoot\(\)\)/);
        // Controle positivo do recorte: a funcao foi mesmo lida ate o fim (o `return` final).
        expect(fn).toMatch(/hasLocalMapIntent\(\)/);
        expect(fn).toMatch(/return true;\s*\}$/);
    });

    it('3.3 CORRIGIDO: openAtlasChooserOnBoot idem, e nao abre o seletor se foi recusado', () => {
        // A asercao NEGATIVA daqui morava numa janela de 800 caracteres sobre uma funcao de 460:
        // ela nao alcancava um wipe empurrado para o fim da funcao por comentarios, e de quebra
        // lia `initApp` e o rodape do arquivo. Agora o recorte e a funcao (ver ATAQUE 0).
        const index = read('index.js');
        const fn = functionText(index, 'async function openAtlasChooserOnBoot');
        expect(fn).not.toMatch(/await clearAllDataStore\(/);
        expect(fn).toMatch(/!await clearMountedAtlasIfGranted\(/);
        expect(fn).toMatch(/openProjectPicker/);
        // ...e o recorte parou na funcao, em vez de continuar pelo resto do arquivo.
        expect(fn).not.toMatch(/initApp\(\)/);
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
        // (a) "Mapa local" em atlas.html grava a intencao e navega para o mapa.
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
        const fn = functionText(read('index.js'), 'async function enterLocalMapOnBoot');
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

    it('4.3 CORRIGIDO (furo #2): a aba TRAVADA e despejada por TTL volta como RECEM-CHEGADA, '
        + 'para de verdade, e nao expulsa quem assumiu', async () => {
        // O furo: o despejo por TTL nunca chegava a quem foi despejado. Uma aba apenas TRAVADA
        // (SO suspenso, maquina hibernada) para de pulsar, o par a expira, assume o atlas e limpa;
        // quando ela destrava, ela fala com o `claimedAt` ANTIGO, volta a preceder na ordem total,
        // e retoma o lock sem NUNCA ter rodado o proprio `onBlocked`.
        //
        // Sao DUAS metades, e este caso mede as duas separadamente: a despejada mede o proprio
        // silencio e re-entra como recem-chegada (`_fenceAfterSilence`), e a que despejou recusa
        // UMA vez a reapresentacao daquela reivindicacao (`_standingPeers`), que e o que impede o
        // pisca-pisca durante a viagem de ida e volta.
        const paradasA = []; const paradasB = []; const retomadasB = [];
        const a = mk({ peerTtlMs: 7000, onBlocked: () => { paradasA.push('a'); } });
        const b = mk({
            peerTtlMs: 7000,
            onBlocked: () => { paradasB.push('b'); },
            onResumed: () => { retomadasB.push('b'); }
        });
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);
        expect(paradasB).toEqual(['b']);          // controle positivo: B parou ao perder a ordem
        expect(paradasA).toEqual([]);

        // A TRAVA, sem morrer: para de pulsar E para de RECEBER. Modelar so o silencio de SAIDA
        // (a aba congelada continuando a ouvir os pares) mediria uma aba atenta, que e o oposto
        // do sujeito: ela acordaria com o registro de pares em dia.
        hub.setDrop((_msg, ep) => ep === a._transport._endpoint);

        // B fica VIVA o tempo todo, pulsando no passo do heartbeat. Isto nao e decoracao: um salto
        // unico de 60 s no relogio injetado faria a PROPRIA B se dar por ausente (a cerca de
        // silencio e dela tambem), e o caso passaria a medir a cerca errada.
        for (let t = 0; t < 30; t += 1) { clock += 2000; b.pulse(); }
        expect(b.blocked).toBe(false);            // despejou A por TTL e assumiu o atlas

        // A destrava 60 s depois e fala pela primeira vez. O primeiro STATE ainda carrega o
        // `claimedAt` antigo, que e exatamente o que reprecedia B.
        hub.setDrop(() => false);
        a.pulse();

        expect(a.blocked).toBe(true);             // ...e ela NAO retoma o lock
        expect(paradasA).toEqual(['a']);          // rodou o proprio onBlocked, que era o que faltava
        expect(a.key.atlasId).toBe(ATLAS_A);      // com a chave na mao, so que atras na ordem
        // E a que assumiu nao piscou: nem parou de novo, nem retomou de novo, por causa do retorno.
        expect(b.blocked).toBe(false);
        expect(paradasB).toEqual(['b']);
        expect(retomadasB).toEqual(['b']);
    });

    it('4.4 CORRIGIDO (furo #3): entrar no bfcache nao entrega o atlas, e a volta re-anuncia', async () => {
        // O furo: `const leave = () => this._postLeave()` nao olhava `event.persisted`, entao a
        // aba postava RELEASE ao ENTRAR no cache (o par assumia e limpava) e voltava achando-se
        // dona, porque nao havia `pageshow` para re-anunciar, so o heartbeat seguinte.
        //
        // O QUE ESTE CASO NAO PROVA, e a distincao importa: o runner do Playwright sobe o Chromium
        // com o bfcache DESLIGADO (medido pelo caso B0 de
        // tests/e2e-ui/browser-multi-tab-teardown-queue.spec.js), entao nao existe prova de
        // navegador para esta janela em lugar nenhum deste repositorio. Aqui os eventos sao
        // disparados A MAO sobre uma janela falsa: o que fica medido e o HANDLER, nao o
        // comportamento do cache real.
        const janelas = [];
        const criarJanela = () => {
            const ouvintes = new Map();
            const janela = {
                addEventListener: (tipo, fn) => {
                    if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
                    ouvintes.get(tipo).push(fn);
                },
                removeEventListener: (tipo, fn) => {
                    const lista = ouvintes.get(tipo) ?? [];
                    const i = lista.indexOf(fn);
                    if (i >= 0) lista.splice(i, 1);
                },
                conta: (tipo) => (ouvintes.get(tipo) ?? []).length,
                dispara: (tipo, evento) => { for (const fn of [...(ouvintes.get(tipo) ?? [])]) fn(evento); }
            };
            janelas.push(janela);
            return janela;
        };
        // Uma janela POR aba: o lock guarda a referencia que existia na construcao, entao trocar o
        // global entre as duas construcoes e o que faz cada `dispara` atingir uma aba so. Uma
        // janela compartilhada mandaria o `pagehide` para as duas e mediria outra coisa.
        const janelaA = criarJanela();
        const janelaB = criarJanela();
        const original = globalThis.window;
        try {
            globalThis.window = janelaA;
            const a = mk({ peerTtlMs: 7000 });
            globalThis.window = janelaB;
            const b = mk({ peerTtlMs: 7000 });
            // Controle positivo do stub: os handlers foram MESMO instalados nesta janela, e um por
            // aba. Sem isto, um `dispara` que nao chama ninguem passaria como "nao liberou".
            expect(janelaA.conta('pagehide')).toBe(1);
            expect(janelaA.conta('pageshow')).toBe(1);

            await a.acquire(remoteAtlasKey(ATLAS_A));
            clock += 5;
            await b.acquire(remoteAtlasKey(ATLAS_A));
            expect(b.blocked).toBe(true);

            // ENTRAR NO CACHE NAO E SAIR DA ABA.
            janelaA.dispara('pagehide', { persisted: true });
            expect(b.blocked).toBe(true);

            // E a volta CURTA nao custa nada: nada pode ter expirado em 1 s, entao a chave fica.
            clock += 1000;
            janelaA.dispara('pageshow', { persisted: true });
            expect(a.blocked).toBe(false);
            expect(a.key.atlasId).toBe(ATLAS_A);
            expect(b.blocked).toBe(true);

            // CONTROLE NEGATIVO, no mesmo handler e na mesma aba: um `pagehide` de VERDADE (sem
            // `persisted`) segue entregando o atlas na hora. Se a correcao tivesse silenciado o
            // handler inteiro em vez de olhar o campo, esta linha ficaria vermelha.
            janelaA.dispara('pagehide', { persisted: false });
            expect(b.blocked).toBe(false);
            a.destroy(); b.destroy();

            // ------------------------------------------------- estadia LONGA, com o par assumindo
            const janelaC = criarJanela();
            globalThis.window = janelaC;
            const c = mk({ peerTtlMs: 7000 });
            globalThis.window = janelaB;
            const d = mk({ peerTtlMs: 7000 });
            await c.acquire(remoteAtlasKey(ATLAS_A));
            clock += 5;
            await d.acquire(remoteAtlasKey(ATLAS_A));
            expect(d.blocked).toBe(true);

            // C entra no cache e congela de verdade: nao posta e nao recebe.
            janelaC.dispara('pagehide', { persisted: true });
            hub.setDrop((_msg, ep) => ep === c._transport._endpoint);
            for (let t = 0; t < 6; t += 1) { clock += 2000; d.pulse(); }
            expect(d.blocked).toBe(false);        // passado o TTL, D assume, que e a regra

            // C volta do cache: fala AGORA, em vez de esperar o heartbeat, e volta atras na ordem.
            hub.setDrop(() => false);
            janelaC.dispara('pageshow', { persisted: true });
            expect(c.blocked).toBe(true);
            expect(d.blocked).toBe(false);
        } finally {
            if (original === undefined) delete globalThis.window;
            else globalThis.window = original;
        }
    });

    it('4.5 CORRIGIDO (furo #4): a aba que cedeu re-adota a chave quando ninguem mais a segura, '
        + 'e um TAKEOVER de UMA aba nao encalha a terceira', async () => {
        // (a) A ABA QUE CEDEU FICAVA BLOQUEADA PARA SEMPRE se a vencedora fechava: `_evaluate` so
        // saia do bloqueio com `!this._yielded`, e o overlay passava a citar uma aba que nao
        // existia mais.
        const retomadas = [];
        const a = mk({ onResumed: () => retomadas.push('a') });
        const b = mk();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(await b.requestTakeover()).toBe(true);
        expect(a.blocked).toBe(true);
        expect(a.key.atlasId).toBe(null);          // cedeu a chave, que e o handoff de verdade

        b.destroy();

        expect(a.blocked).toBe(false);
        expect(a.key.atlasId).toBe(ATLAS_A);       // re-adotou a chave cedida
        expect(retomadas).toEqual(['a']);          // e o sync voltou, em vez de so o overlay sumir
        a.destroy();

        // (b) UM TAKEOVER DE UMA ABA ENCALHAVA TODAS as que seguravam a chave. O pedido continua
        // indo a todas de proposito (mandar so para a bloqueadora entregaria o atlas a segunda da
        // fila, que nem clicou); o que faltava era o caminho de volta de quem nao pediu nada.
        const x = mk(); const y = mk(); const z = mk();
        await x.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await y.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await z.acquire(remoteAtlasKey(ATLAS_A));
        expect([x.blocked, y.blocked, z.blocked]).toEqual([false, true, true]);

        expect(await z.requestTakeover()).toBe(true);
        expect(z.blocked).toBe(false);
        // Y nao clicou em nada e mesmo assim cedeu a chave: e o preco do endereco por colisao.
        expect(y.key.atlasId).toBe(null);
        expect(y.blocked).toBe(true);

        // A VENCEDORA FECHA. Antes, X e Y ficavam bloqueadas para sempre, as duas.
        z.destroy();

        // Exatamente uma re-adota e fica ativa; a ordem comum decide qual, porque as duas voltam
        // com carimbo novo.
        expect([x.blocked, y.blocked].filter(Boolean)).toHaveLength(1);
        const ativa = x.blocked ? y : x;
        const bloqueada = x.blocked ? x : y;
        expect(ativa.key.atlasId).toBe(ATLAS_A);
        // E a que segue bloqueada NAO esta encalhada: quem a bloqueia existe e esta viva...
        expect(bloqueada.blocker.tabId).toBe(ativa.tabId);
        // ...e o "Usar aqui" ainda a traz de volta, que e o caminho de volta que faltava.
        expect(await bloqueada.requestTakeover()).toBe(true);
        expect(bloqueada.blocked).toBe(false);
        expect(ativa.blocked).toBe(true);
        x.destroy(); y.destroy(); z.destroy();

        // (c) E O REGISTRO DE QUEM BLOQUEIA acompanha a troca de dono, que e a outra metade do
        // "o overlay mente": `_enterBlocked` volta cedo quando a aba ja esta bloqueada, entao o
        // campo continuava apontando para quem venceu PRIMEIRO, e depois de uma troca isso e uma
        // aba que ja retratou a chave (ou fechou). Aqui a terceira aba nunca sai do bloqueio, o
        // que e exatamente a condicao em que o registro congelava.
        const p = mk(); const q = mk(); const r = mk();
        await p.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await q.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await r.acquire(remoteAtlasKey(ATLAS_A));
        expect(r.blocker.tabId).toBe(p.tabId);

        p.release();

        expect(q.blocked).toBe(false);
        expect(r.blocked).toBe(true);          // R segue bloqueada, sem transicao nenhuma...
        expect(r.blocker.tabId).toBe(q.tabId); // ...e mesmo assim quem a bloqueia agora e Q
    });

    it('4.6 CONFIRMADO (decisao): sem transporte nenhum o lock desliga, concede, e AVISA', async () => {
        // "Off and audible, never off and quiet" (tab-lock.js, secao 8). Fail-open e deliberado:
        // um navegador sem BroadcastChannel E sem localStorage nao pode arbitrar, e travar o app
        // seria pior que arbitrar mal. O que faltava era alguem LER `degraded` para avisar o
        // usuario, e isso FOI FECHADO: o proprio modulo monta um banner (`_degradedNotice`),
        // porque o unico consumidor natural nao existia e o sinal ficava so no console.
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

    // ------------------------------------------------------------------ furo #6, FECHADO
    // PROMOVIDO de `it.todo` em 2026-08-16: o furo #6 fechou. Ele estava marcado como "nenhum
    // chamador propaga o `degraded`", e a solucao nao foi arranjar um chamador: foi o proprio
    // modulo montar o aviso, porque o consumidor natural nao existia e a espera por ele deixou o
    // unico sinal no console de desenvolvedor por meses.
    //
    // POR QUE ISTO PESA MAIS DEPOIS DE E7: com a retencao remoto x remoto removida, o modo
    // degradado e o UNICO mecanismo que separa duas abas no MESMO atlas. Degradado em silencio e
    // um usuario com duas abas escrevendo nos mesmos bancos sem forma de saber.
    it('4.7: o modo degradado monta um aviso VISIVEL, e nao so um console.warn', () => {
        const fonte = read('utilities/tab-lock.js');

        // Recorte do METODO por indice, e nao por `functionText`: aquele helper e para funcoes de
        // TOPO (ele exige exatamente uma declaracao no recorte) e um metodo de classe nao passa.
        const ini = fonte.indexOf('    _buildDegradedNotice() {');
        expect(ini, 'o construtor do aviso sumiu').toBeGreaterThan(-1);
        const construtor = fonte.slice(ini, fonte.indexOf('\n    }', ini));

        // O aviso e DOM de verdade: um `degraded: true` que ninguem transforma em pixel e a
        // omissao original com outro nome.
        expect(construtor).toMatch(/createElement/);
        // ...e fala com o usuario, em pt-BR. Um banner mudo seria a mesma omissao de novo.
        expect(construtor).toMatch(/[A-Za-zÀ-ú]{4,}\s+[A-Za-zÀ-ú]{4,}/);

        // E ele so aparece quando a aba SEGURA um atlas: uma chave `none` nao colide com
        // ninguem, entao as tres paginas sem mapa nao herdam um aviso que nao as descreve.
        const iniSync = fonte.indexOf('    _syncDegradedNotice(');
        expect(iniSync, 'o gatilho do aviso sumiu').toBeGreaterThan(-1);
        expect(fonte.slice(iniSync, fonte.indexOf('\n    }', iniSync))).toMatch(/degraded/);
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
        const fn = functionText(svc, 'export async function resumeDeferredAtlasOpen');
        expect(fn).not.toMatch(/startAutoFlush|syncEngine\.connect/);
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
        // A chamada segue existindo; o que mudou e que ela agora leva a testemunha, entao o
        // recorte nao pode exigir o par de parenteses fechando logo apos o argumento. Casar a
        // FORMA exata de uma chamada e a mesma fragilidade que o ATAQUE 0 deste arquivo trata:
        // ela silencia sozinha quando um argumento novo aparece.
        expect(read('index.js')).toMatch(/await acquireTabLock\(remoteAtlasKey\(atlas\.id\)/);
        expect(read('index.js')).toMatch(/installTabLockSyncBrake/);
        // `acquireTabLock(key, { witness })`: a chamada segue existindo, agora com a testemunha
        // do caso 1.4 junto. Casar o parenteses de fechar aqui era casar a AUSENCIA de argumento.
        expect(read('account/open-atlas.service.js')).toMatch(/await acquireTabLock\(key, \{/);
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
        expect(citados).toEqual([...new Set(citados)]);      // sem numero repetido
        const secao = backlog.slice(backlog.indexOf('## Furos abertos do tab-lock'));
        const tabela = secao.slice(0, secao.indexOf('\n---'));
        for (const n of citados) {
            expect(tabela).toMatch(new RegExp(`^\\| ${n} \\|`, 'm'));
        }

        // A COERENCIA VALE NOS DOIS SENTIDOS, INCLUSIVE NO VAZIO. Este caso exigia
        // `citados.length > 0` como controle positivo do regex, o que era razoavel enquanto
        // houvesse furo aberto e virou falso em 2026-08-16, quando o ultimo fechou: um arquivo
        // sem `it.todo` reprovava por nao ter defeito. O controle positivo do regex passou a ser
        // o outro lado da mesma pergunta, que existe sempre: toda linha da tabela ou esta
        // RISCADA (fechada, com o registro do fechamento) ou tem um `it.todo` citando o numero
        // dela. Assim um furo reaberto sem todo, e um todo orfao, continuam vermelhos.
        const linhas = [...tabela.matchAll(/^\| (\d+) \| (.*)$/gm)];
        expect(linhas.length, 'a tabela de furos sumiu ou mudou de forma').toBeGreaterThan(0);
        for (const [, num, corpo] of linhas) {
            const fechado = corpo.trimStart().startsWith('~~');
            const temTodo = citados.includes(Number(num));
            expect(
                fechado || temTodo,
                `o furo #${num} do TESTING-BACKLOG nao esta riscado como fechado e nao tem `
                + '`it.todo` neste arquivo: ou ele voltou a ser aberto sem reproducao, ou o '
                + 'registro do fechamento nao foi escrito',
            ).toBe(true);
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
