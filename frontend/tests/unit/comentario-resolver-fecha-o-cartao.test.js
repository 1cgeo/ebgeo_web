// Path: tests/unit/comentario-resolver-fecha-o-cartao.test.js
/**
 * @fileoverview RESOLVER UM COMENTÁRIO FECHA A TELA DELE, e só o gesto da própria pessoa fecha.
 *
 * O PEDIDO (dono, 2026-09-22): "ao resolver comentário fechar a tela do comentário". O botão
 * Resolver é UM só, o do cartão comum (`comment_tool/comment-card.js`), montado pelas quatro
 * superfícies (mapa 2D, 360, 3D e primeira pessoa); o painel lateral não tem porta de resolver.
 *
 * O QUE ESTA SUÍTE PRENDE, e por que cada coisa:
 *
 *  1. O CARTÃO FECHA DEPOIS DO ACEITE, NUNCA ANTES. Recusa por papel ou pela barreira de logout
 *     deixa o cartão aberto (a frase da recusa chega pelo ouvinte de erro do store, como antes).
 *  2. "REABRIR" NÃO FECHA. Reabrir é o que devolve a caixa de resposta.
 *  3. O FECHAMENTO É PRESO À CONVERSA. Ele chega depois de um await, e nesse intervalo a pessoa
 *     pode ter aberto outra conversa, que não pode sumir; e uma recarga no meio troca o popup da
 *     MESMA conversa, que ainda tem de fechar.
 *  4. A RESOLUÇÃO DE UM PAR NÃO FECHA, nas quatro superfícies: o cartão se refaz no estado
 *     resolvido. No 360 e no 3D ela fechava até 2026-09-22; o caso daqueles dois reprova contra o
 *     código antigo.
 *  5. NA PRIMEIRA PESSOA, TEXTO NÃO ENVIADO NÃO SE PERDE: o cartão com rascunho não é refeito, e
 *     a resposta recusada porque a conversa foi resolvida no meio mantém o texto e diz por quê.
 *
 * Tudo roda em node puro, contra o dublê de DOM da casa, disparando o clique REAL no botão que o
 * cartão desenha: perguntar só à função pura provaria a regra, não a fiação.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeElement, fire, byTestid, allText } from '../helpers/dom-double.js';

const h = vi.hoisted(() => {
    const listeners = new Map();
    return {
        listeners,
        emit: (key, payload) => { for (const fn of [...(listeners.get(key) || [])]) fn(payload); },
        comments: {},
        allowed: true,
        canEdit: true,
        resolve: null,
        addReply: null,
        warning: null,
        popups: [],
        markers: [],
    };
});

vi.mock('@store', () => ({
    getComments: async () => h.comments,
    getCurrentMapNameSync: () => 'Mapa',
    addComment: async () => undefined,
    updateComment: async () => true,
    removeComment: async () => undefined,
    addReply: (...args) => h.addReply(...args),
    resolveComment: (...args) => h.resolve(...args),
}));
vi.mock('@store/services.js', () => ({
    getEventBus: () => ({
        on: (key, fn) => {
            if (!h.listeners.has(key)) h.listeners.set(key, []);
            h.listeners.get(key).push(fn);
            return () => {
                const bucket = h.listeners.get(key) || [];
                const i = bucket.indexOf(fn);
                if (i >= 0) bucket.splice(i, 1);
            };
        },
        emit: h.emit,
    }),
}));
vi.mock('@store/store-origin.js', () => ({ isRemoteStoreSync: () => true }));
vi.mock('@store/sync/session-context.js', () => ({
    sessionContext: {
        userId: 'me', clientId: 'self', username: 'Me',
        isAuthenticated: () => true,
        canPerformAction: () => h.canEdit,
    },
}));
vi.mock('@store/sync/permission-guard.js', () => ({
    checkPermission: () => ({ allowed: h.allowed }),
    GuardAction: { CREATE_COMMENT: 'CREATE_COMMENT' },
}));
vi.mock('@utils/toast_service.js', () => ({
    showError: vi.fn(),
    showWarning: (...args) => h.warning(...args),
}));
vi.mock('@js/presence/presence-store.js', () => ({ presenceStore: { getCursors: () => [] } }));
vi.mock('@js/map/maplibre.js', () => {
    class Popup {
        constructor() { this.removed = false; this.content = null; h.popups.push(this); }
        setLngLat() { return this; }
        setDOMContent(content) { this.content = content; return this; }
        addTo() { return this; }
        remove() { this.removed = true; return this; }
    }
    class Marker {
        constructor({ element, draggable }) { this.element = element; this.draggable = draggable; h.markers.push(this); }
        setLngLat() { return this; }
        addTo() { return this; }
        on() { return this; }
        getElement() { return this.element; }
        isDraggable() { return this.draggable; }
        setDraggable(value) { this.draggable = value; }
        remove() { this.removed = true; }
    }
    return { maplibregl: { Popup, Marker } };
});
vi.mock('@js/vendor/cesium.js', () => ({ Cesium: {
    ScreenSpaceEventHandler: class { setInputAction(fn) { h.click3d = fn; } destroy() {} },
    ScreenSpaceEventType: { LEFT_CLICK: 1 },
    Cartesian3: { fromDegrees: (lng, lat, alt) => ({ lng, lat, alt }) },
    VerticalOrigin: { CENTER: 0 },
    HeightReference: { NONE: 0 },
    defined: Boolean,
} }));

import {
    AVISO_RESPOSTA_RECUSADA,
    escrevendoNoCartao,
    fechaAoResolver,
    montarCartaoDeThread,
} from '@js/comment_tool/comment-card.js';
import { CommentOverlay } from '@js/comment_tool/comment-overlay.js';
import { iniciarComentarios360, pararComentarios360 } from '@js/street_view_tool/comments-360.js';
import { iniciarComentarios3D, pararComentarios3D } from '@js/3d_models_viewer_tool/tools/comments-3d.js';
import { FpCollaboration } from '@js/first_person_3d_tool/collaboration-fp.js';
import { EventTypes } from '@events/event_types.js';

/** The house DOM double, plus the few calls these four surfaces make on top of it. */
function element(tag) {
    const el = makeElement(tag);
    el.clientWidth = 800;
    el.clientHeight = 600;
    el.style.setProperty = (name, value) => { el.style[name] = value; };
    el.classList.toggle = (name, on) => ((on ?? !el.classList.contains(name))
        ? el.classList.add(name) : el.classList.remove(name));
    const casa = (node, seletor) => (seletor.startsWith('.')
        ? node.className.split(' ').includes(seletor.slice(1))
        : node.tagName === seletor.toUpperCase());
    el.querySelectorAll = (seletor) => el.children.flatMap((c) => [...(casa(c, seletor) ? [c] : []), ...c.querySelectorAll(seletor)]);
    el.querySelector = (seletor) => el.querySelectorAll(seletor)[0] || null;
    el.focus = () => { globalThis.document.activeElement = el; };
    if (tag === 'canvas') {
        const noop = () => {};
        el.getContext = () => ({ beginPath: noop, arc: noop, fill: noop, stroke: noop, fillText: noop });
        el.toDataURL = () => 'data:,';
    }
    return el;
}

/** Lets every pending microtask AND the next macrotask run (reloads await the store). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A promise the test settles by hand, to hold the store "in flight". */
function adiado() {
    let resolver;
    const promessa = new Promise((r) => { resolver = r; });
    return { promessa, resolver };
}

/**
 * The store as it really behaves: it persists, emits COMMENT_UPDATED (every surface reloads on
 * it), and only THEN returns `true`. The macrotask in the middle forces the reload to finish
 * first, which is the order that replaces the open card before the close arrives.
 */
async function resolverComoOStore(id, resolvido) {
    h.comments = { ...h.comments, [id]: { ...h.comments[id], status: resolvido ? 'resolved' : 'open' } };
    h.emit(EventTypes.COMMENT_UPDATED, { comment: h.comments[id] });
    await tick();
    return true;
}

/** A peer's resolution: the store changes and the event arrives, with no click here. */
async function parResolve(id) {
    h.comments = { ...h.comments, [id]: { ...h.comments[id], status: 'resolved' } };
    h.emit(EventTypes.COMMENT_UPDATED, { comment: h.comments[id] });
    await tick();
}

const raiz = (id, extra = {}) => ({ id, parentId: null, text: `Conversa ${id}`, status: 'open', authorId: 'other', createdAt: 1, ...extra });

let scene;
beforeEach(() => {
    scene = element('div');
    vi.stubGlobal('document', {
        createElement: element,
        getElementById: () => scene,
        activeElement: null,
    });
    h.listeners.clear();
    h.comments = {};
    h.allowed = true;
    h.canEdit = true;
    h.popups = [];
    h.markers = [];
    h.resolve = vi.fn(resolverComoOStore);
    h.addReply = vi.fn(async () => ({ id: 'resposta' }));
    h.warning = vi.fn();
});
afterEach(() => {
    pararComentarios360();
    pararComentarios3D();
    vi.unstubAllGlobals();
});

describe('a regra: só a resolução ACEITA fecha', () => {
    it('fecha só com resolvendo e aceito exatamente true', () => {
        expect(fechaAoResolver({ resolvendo: true, aceito: true })).toBe(true);
        // Recusa (papel, autoria) e conversa que sumiu não fecham.
        expect(fechaAoResolver({ resolvendo: true, aceito: false })).toBe(false);
        expect(fechaAoResolver({ resolvendo: true, aceito: undefined })).toBe(false);
        expect(fechaAoResolver({ resolvendo: true, aceito: null })).toBe(false);
        // Um verdadeiro que não é `true` não é aceite: `resolveComment` devolve booleano.
        expect(fechaAoResolver({ resolvendo: true, aceito: 1 })).toBe(false);
        expect(fechaAoResolver({ resolvendo: true, aceito: { id: 'x' } })).toBe(false);
        // Reabrir nunca fecha, aceito ou não.
        expect(fechaAoResolver({ resolvendo: false, aceito: true })).toBe(false);
        expect(fechaAoResolver({ resolvendo: false, aceito: false })).toBe(false);
        expect(fechaAoResolver()).toBe(false);
    });

    it('"escrevendo" é ter TEXTO não enviado, não ter o foco', () => {
        expect(escrevendoNoCartao(null)).toBe(false);
        expect(escrevendoNoCartao(undefined)).toBe(false);
        expect(escrevendoNoCartao({})).toBe(false);
        const cartao = element('div');
        expect(escrevendoNoCartao(cartao)).toBe(false);
        const caixa = cartao.appendChild(element('textarea'));
        caixa.focus();
        // Foco numa caixa vazia não é escrever (a primeira pessoa foca a caixa a cada desenho).
        expect(escrevendoNoCartao(cartao)).toBe(false);
        caixa.value = '   ';
        expect(escrevendoNoCartao(cartao)).toBe(false);
        caixa.value = 'rascunho';
        expect(escrevendoNoCartao(cartao)).toBe(true);
        // A caixa de OUTRO cartão não conta.
        expect(escrevendoNoCartao(element('div'))).toBe(false);
    });
});

describe('o botão do cartão comum', () => {
    const montar = (r) => {
        const aoFechar = vi.fn();
        const card = montarCartaoDeThread({ raiz: r, respostas: [], aoFechar });
        return { card, aoFechar, botao: byTestid(card, 'comment-resolve') };
    };

    it('Resolver chama o store e fecha DEPOIS do aceite, não antes', async () => {
        const voo = adiado();
        h.resolve = vi.fn(() => voo.promessa);
        const { aoFechar, botao } = montar(raiz('a'));
        expect(botao.textContent).toBe('Resolver');
        botao.click();
        await tick();
        expect(h.resolve).toHaveBeenCalledWith('a', true);
        expect(aoFechar).not.toHaveBeenCalled();
        voo.resolver(true);
        await tick();
        expect(aoFechar).toHaveBeenCalledTimes(1);
    });

    it('recusa do store (false) ou conversa sumida (undefined) deixa o cartão aberto', async () => {
        for (const desfecho of [false, undefined]) {
            h.resolve = vi.fn(async () => desfecho);
            const { aoFechar, botao } = montar(raiz('a'));
            botao.click();
            await tick();
            expect(h.resolve).toHaveBeenCalledTimes(1);
            expect(aoFechar, String(desfecho)).not.toHaveBeenCalled();
        }
    });

    it('falha de persistência deixa o cartão aberto e não escapa como rejeição solta', async () => {
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        h.resolve = vi.fn(async () => { throw new Error('IndexedDB recusou'); });
        const { aoFechar, botao } = montar(raiz('a'));
        botao.click();
        await tick();
        expect(aoFechar).not.toHaveBeenCalled();
        expect(erro).toHaveBeenCalledTimes(1);
        erro.mockRestore();
    });

    it('Reabrir aceito NÃO fecha', async () => {
        h.resolve = vi.fn(async () => true);
        const { aoFechar, botao } = montar(raiz('a', { status: 'resolved' }));
        expect(botao.textContent).toBe('Reabrir');
        botao.click();
        await tick();
        expect(h.resolve).toHaveBeenCalledWith('a', false);
        expect(aoFechar).not.toHaveBeenCalled();
    });

    it('um segundo clique com o primeiro em voo não grava de novo', async () => {
        const voo = adiado();
        h.resolve = vi.fn(() => voo.promessa);
        const { aoFechar, botao } = montar(raiz('a'));
        botao.click();
        botao.click();
        await tick();
        expect(h.resolve).toHaveBeenCalledTimes(1);
        voo.resolver(true);
        await tick();
        expect(aoFechar).toHaveBeenCalledTimes(1);
    });

    it('quem não pode modificar não recebe o botão', () => {
        h.canEdit = false;
        const { botao } = montar(raiz('a'));
        expect(botao).toBeNull();
    });
});

describe('mapa 2D (o popup do MapLibre)', () => {
    const abertos = () => h.popups.filter((p) => !p.removed);
    let overlay;
    const map = { on() {}, off() {}, getCanvas: () => ({ style: {} }), flyTo() {}, getZoom: () => 12 };
    beforeEach(async () => {
        h.comments = { a: raiz('a', { lng: 1, lat: 2 }), b: raiz('b', { lng: 3, lat: 4 }) };
        overlay = new CommentOverlay(map, null);
        overlay.start();
        await tick();
    });
    afterEach(() => overlay.stop());

    it('Resolver fecha o popup, mesmo quando a recarga já trocou o popup da MESMA conversa', async () => {
        await overlay.focusComment('a');
        const primeiro = abertos()[0];
        byTestid(primeiro.content, 'comment-resolve').click();
        await tick();
        await tick();
        // A recarga do COMMENT_UPDATED refez o popup antes do fechamento chegar...
        expect(h.popups.length).toBeGreaterThan(1);
        // ...e mesmo assim nada ficou aberto.
        expect(abertos()).toHaveLength(0);
    });

    it('o fechamento tardio não leva embora OUTRA conversa aberta no meio', async () => {
        const voo = adiado();
        h.resolve = vi.fn(() => voo.promessa);
        await overlay.focusComment('a');
        byTestid(abertos()[0].content, 'comment-resolve').click();
        await overlay.focusComment('b');
        voo.resolver(true);
        await tick();
        expect(abertos()).toHaveLength(1);
        expect(abertos()[0].content.dataset.resolved).toBe('false');
        expect(allText(abertos()[0].content)).toContain('Conversa b');
    });

    it('recusa deixa o popup aberto; Reabrir também', async () => {
        h.resolve = vi.fn(async () => false);
        await overlay.focusComment('a');
        byTestid(abertos()[0].content, 'comment-resolve').click();
        await tick();
        expect(abertos()).toHaveLength(1);

        h.comments.a = { ...h.comments.a, status: 'resolved' };
        h.resolve = vi.fn(resolverComoOStore);
        await overlay.focusComment('a');
        byTestid(abertos()[0].content, 'comment-resolve').click();
        await tick();
        await tick();
        expect(abertos()).toHaveLength(1);
        expect(abertos()[0].content.dataset.resolved).toBe('false');
    });

    it('a resolução de um PAR refaz o popup no estado resolvido, sem fechar', async () => {
        await overlay.focusComment('a');
        await parResolve('a');
        expect(abertos()).toHaveLength(1);
        expect(abertos()[0].content.dataset.resolved).toBe('true');
        expect(byTestid(abertos()[0].content, 'comment-resolved-note')).not.toBeNull();
    });
});

describe('360 e 3D (o cartão flutuante)', () => {
    const cartaoAberto = () => byTestid(scene, 'comment-thread');

    async function abrir360(id) {
        const nav = { setComments: vi.fn(), setCommentToolActive: vi.fn(), commentToolActive: false };
        await iniciarComentarios360(nav, 'foto');
        h.emit(EventTypes.COMMENT_360_CLICKED, { comment: { id }, screenX: 200, screenY: 200 });
    }

    async function abrir3D(id) {
        const viewer = {
            canvas: { style: {} },
            entities: { values: [], getById: () => null, add() {}, remove() {} },
            scene: { pick: () => ({ id: { properties: { commentId: { getValue: () => id } } } }) },
        };
        await iniciarComentarios3D(viewer, 'modelo');
        h.click3d({ position: { x: 200, y: 200 } });
    }

    const superficies = [
        ['360', abrir360, { surface: '360', photoName: 'foto', heading: 10, pitch: 0 }],
        ['3D', abrir3D, { surface: '3d', tilesetId: 'modelo', lng: 1, lat: 2, alt: 3 }],
    ];

    for (const [nome, abrir, ancora] of superficies) {
        it(`${nome}: Resolver fecha o cartão`, async () => {
            h.comments = { a: raiz('a', ancora) };
            await abrir('a');
            expect(cartaoAberto()).not.toBeNull();
            byTestid(cartaoAberto(), 'comment-resolve').click();
            await tick();
            await tick();
            expect(h.resolve).toHaveBeenCalledWith('a', true);
            expect(cartaoAberto()).toBeNull();
        });

        it(`${nome}: recusa deixa o cartão aberto`, async () => {
            h.resolve = vi.fn(async () => false);
            h.comments = { a: raiz('a', ancora) };
            await abrir('a');
            byTestid(cartaoAberto(), 'comment-resolve').click();
            await tick();
            expect(cartaoAberto()).not.toBeNull();
            expect(cartaoAberto().dataset.resolved).toBe('false');
        });

        it(`${nome}: a resolução de um PAR refaz o cartão resolvido, sem fechar`, async () => {
            // Até 2026-09-22 este ramo FECHAVA: o cartão sumia debaixo de quem lia.
            h.comments = { a: raiz('a', ancora) };
            await abrir('a');
            await parResolve('a');
            expect(cartaoAberto()).not.toBeNull();
            expect(cartaoAberto().dataset.resolved).toBe('true');
        });

        it(`${nome}: Reabrir mantém o cartão, agora aberto`, async () => {
            h.comments = { a: raiz('a', { ...ancora, status: 'resolved' }) };
            await abrir('a');
            byTestid(cartaoAberto(), 'comment-resolve').click();
            await tick();
            await tick();
            expect(h.resolve).toHaveBeenCalledWith('a', false);
            expect(cartaoAberto()).not.toBeNull();
            expect(cartaoAberto().dataset.resolved).toBe('false');
        });

        it(`${nome}: conversa excluída ainda fecha`, async () => {
            h.comments = { a: raiz('a', ancora) };
            await abrir('a');
            h.comments = {};
            h.emit(EventTypes.COMMENT_DELETED, { commentId: 'a' });
            await tick();
            expect(cartaoAberto()).toBeNull();
        });
    }
});

describe('primeira pessoa', () => {
    let layer;
    const cartaoAberto = () => byTestid(scene, 'comment-thread');
    const ancora = { surface: 'fp', tilesetId: 'museu', x: 1, y: 2, z: 0 };

    async function montar() {
        layer = new FpCollaboration({
            container: scene, sceneId: 'museu', collision: null,
            releasePointer: () => {}, onContextLost: () => layer.destroy(),
        });
        await layer.ready;
        return layer;
    }
    afterEach(() => layer?.destroy());

    it('Resolver fecha o cartão, mesmo com o foco no botão', async () => {
        h.comments = { a: raiz('a', ancora) };
        await montar();
        expect(layer.focus('a')).toBe(true);
        const botao = byTestid(cartaoAberto(), 'comment-resolve');
        botao.focus();
        botao.click();
        await tick();
        await tick();
        expect(cartaoAberto()).toBeNull();
    });

    it('Reabrir refaz o cartão aberto em vez de congelá-lo com o foco no botão', async () => {
        // O guarda antigo ("o foco está dentro do cartão") deixava o cartão no estado de ANTES do
        // clique, porque o botão clicado guarda o foco.
        h.comments = { a: raiz('a', { ...ancora, status: 'resolved' }) };
        await montar();
        layer.focus('a');
        const botao = byTestid(cartaoAberto(), 'comment-resolve');
        botao.focus();
        botao.click();
        await tick();
        await tick();
        expect(cartaoAberto()).not.toBeNull();
        expect(cartaoAberto().dataset.resolved).toBe('false');
    });

    it('a resolução de um PAR refaz o cartão sem rascunho no estado resolvido', async () => {
        h.comments = { a: raiz('a', ancora) };
        await montar();
        layer.focus('a');
        // A caixa de resposta nasce focada, e vazia: isso não é escrever.
        expect(globalThis.document.activeElement?.tagName).toBe('TEXTAREA');
        await parResolve('a');
        expect(cartaoAberto()).not.toBeNull();
        expect(cartaoAberto().dataset.resolved).toBe('true');
    });

    it('com rascunho, o cartão fica; a resposta recusada mantém o texto e diz por quê', async () => {
        h.comments = { a: raiz('a', ancora) };
        await montar();
        layer.focus('a');
        const cartao = cartaoAberto();
        const caixa = cartao.querySelector('textarea');
        caixa.value = 'Minha resposta';
        fire(caixa, 'input');

        await parResolve('a');
        // O mesmo cartão, com o texto intacto.
        expect(cartaoAberto()).toBe(cartao);
        expect(caixa.value).toBe('Minha resposta');

        // O store recusa a resposta a uma conversa resolvida devolvendo nada.
        h.addReply = vi.fn(async () => undefined);
        byTestid(cartao, 'comment-reply-submit').click();
        await tick();
        expect(h.addReply).toHaveBeenCalledTimes(1);
        expect(caixa.value).toBe('Minha resposta');
        expect(h.warning).toHaveBeenCalledWith(AVISO_RESPOSTA_RECUSADA);
    });

    it('a resposta aceita limpa a caixa e não avisa nada', async () => {
        h.comments = { a: raiz('a', ancora) };
        await montar();
        layer.focus('a');
        const caixa = cartaoAberto().querySelector('textarea');
        caixa.value = 'Ok';
        fire(caixa, 'input');
        byTestid(cartaoAberto(), 'comment-reply-submit').click();
        await tick();
        expect(h.addReply).toHaveBeenCalledTimes(1);
        expect(caixa.value).toBe('');
        expect(h.warning).not.toHaveBeenCalled();
    });

    it('a recusa por PAPEL não ganha um segundo aviso (o ouvinte do store já fala)', async () => {
        h.comments = { a: raiz('a', ancora) };
        await montar();
        layer.focus('a');
        const caixa = cartaoAberto().querySelector('textarea');
        caixa.value = 'Sem permissão';
        fire(caixa, 'input');
        h.addReply = vi.fn(async () => { h.allowed = false; return undefined; });
        byTestid(cartaoAberto(), 'comment-reply-submit').click();
        await tick();
        expect(caixa.value).toBe('Sem permissão');
        expect(h.warning).not.toHaveBeenCalled();
    });
});
