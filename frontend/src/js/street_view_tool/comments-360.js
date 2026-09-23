// Path: js/street_view_tool/comments-360.js

/**
 * @fileoverview O COMENTÁRIO ESPACIAL DENTRO DO PANORAMA 360.
 *
 * O dono pediu em 2026-09-17 o sistema de comentários do mapa também no 360, "com as mesmas regras
 * e funcionalidades", e decidiu que o comentário desenha SÓ na superfície onde nasceu. Este arquivo
 * é a metade do 360: ele carrega os comentários da foto aberta, alimenta o navegador (que os
 * projeta e os torna clicáveis como os POIs) e ancora o CARTÃO na tela.
 *
 * O CARTÃO E AS REGRAS NÃO MORAM AQUI, e é isso que faz "as mesmas" ser verdade em vez de promessa:
 * responder, resolver, reabrir, excluir, quem pode o quê e a aparência da conversa vêm todos de
 * `comment_tool/comment-card.js`, o mesmo módulo que o mapa 2D usa. O que é próprio do 360 são três
 * coisas, e só elas: a ÂNCORA (foto mais direção e inclinação, como o marcador 360), o DESENHO (o
 * balão no canvas do panorama) e o POSICIONAMENTO do cartão (pixel na tela, porque dentro da esfera
 * não existe coordenada onde pendurar um popup).
 *
 * POR QUE O CARTÃO É ANCORADO EM PIXEL, e não segue o balão quadro a quadro: o panorama gira, e um
 * cartão que perseguisse o balão andaria pela tela enquanto a pessoa lê e escreve. O mapa 2D tem o
 * mesmo comportamento por outro caminho (o popup do MapLibre fica na coordenada e sai de vista se a
 * pessoa arrastar), então a regra é a mesma: o cartão nasce onde o gesto aconteceu e fica lá até
 * ser fechado.
 */

import { getComments, addComment, getCurrentMapNameSync } from '@store';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import {
    SUPERFICIE,
    autoriaAtual,
    ehDaSuperficie,
    montarCartaoDeCompose,
    montarCartaoDeThread,
    escrevendoNoCartao,
    podeComentar,
    respostasDe,
} from '@js/comment_tool/comment-card.js';

/** O estado do módulo: um visualizador 360 por vez, como o resto da ferramenta. */
const estado = {
    navigator: null,
    photoName: null,
    /** A coleção inteira do mapa (as três superfícies), como o store a devolve. */
    colecao: {},
    cartao: null,
    /** O id da conversa aberta, para o cartão se refazer quando chega resposta do colega. */
    raizAberta: null,
    ativo: false,
    soltar: [],
};

/** O container onde o cartão é posicionado. */
function container() {
    return document.getElementById('street-view-container');
}

/** Fecha o cartão aberto, se houver. */
export function fecharCartao360() {
    estado.cartao?.remove();
    estado.cartao = null;
    estado.raizAberta = null;
}

/**
 * Põe um cartão na tela, preso ao pixel do gesto.
 *
 * O cartão é mantido DENTRO do container: nascendo perto da borda ele escaparia da tela, e o que a
 * pessoa veria seria meia conversa. As margens são as do próprio cartão medido, e não um palpite.
 * @private
 */
function ancorar(cartao, x, y) {
    const caixa = container();
    if (!caixa) return;
    fecharCartao360();

    cartao.classList.add('comment-card--flutuante');
    // The navigator and camera listen on the container, including pointer events.
    // Editing or replying inside a card must never become a scene gesture.
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu']) {
        cartao.addEventListener(type, (event) => event.stopPropagation());
    }
    caixa.appendChild(cartao);

    const largura = cartao.offsetWidth || 320;
    const altura = cartao.offsetHeight || 160;
    const margem = 12;
    const maxX = caixa.clientWidth - largura - margem;
    const maxY = caixa.clientHeight - altura - margem;
    cartao.style.left = `${Math.max(margem, Math.min(x - largura / 2, maxX))}px`;
    cartao.style.top = `${Math.max(margem, Math.min(y - altura - 24, maxY))}px`;

    estado.cartao = cartao;
}

/** Os comentários RAIZ desta foto, já com a contagem de respostas que o balão mostra. */
function raizesDaFoto() {
    return Object.values(estado.colecao)
        .filter((c) => c && !c.parentId && c.status !== 'resolved'
            && ehDaSuperficie(c, SUPERFICIE.FOTO_360, estado.photoName)
            && Number.isFinite(c.heading) && Number.isFinite(c.pitch))
        .map((c) => ({
            id: c.id,
            heading: c.heading,
            pitch: c.pitch,
            authorInitials: c.authorInitials,
            authorColor: c.authorColor,
            respostas: respostasDe(estado.colecao, c.id).length,
        }));
}

/** Relê a coleção do mapa e repinta os balões. */
async function recarregar() {
    if (!estado.ativo) return;
    const mapa = getCurrentMapNameSync();
    estado.colecao = (mapa ? await getComments(mapa) : {}) || {};
    if (!estado.ativo) return;
    estado.navigator?.setComments(raizesDaFoto());

    // A CONVERSA ABERTA SE REFAZ, e é o que faz a resposta do colega aparecer sem fechar e
    // reabrir. Se ela sumiu (excluída), o cartão fecha em vez de ficar mentindo.
    //
    // RESOLVED BY A PEER, it is redrawn in the resolved state and does NOT close (2026-09-22).
    // Until then this branch closed resolved threads too, and the card vanished under the reader
    // with no word of why; the 2D map already redrew. Only the person's own gesture closes it,
    // from inside the card (comment_tool/comment-card.js), the same rule on all four surfaces.
    if (estado.raizAberta) {
        const raiz = estado.colecao[estado.raizAberta];
        if (raiz && escrevendoNoCartao(estado.cartao)) return;
        const onde = estado.cartao
            ? { x: parseFloat(estado.cartao.style.left) + (estado.cartao.offsetWidth / 2), y: parseFloat(estado.cartao.style.top) + estado.cartao.offsetHeight + 24 }
            : null;
        if (raiz && onde) abrirConversa(raiz.id, onde.x, onde.y);
        else fecharCartao360();
    }
}

/** Abre a conversa de uma raiz, ancorada no pixel indicado. */
function abrirConversa(raizId, x, y) {
    const raiz = estado.colecao[raizId];
    if (!raiz) return;
    const cartao = montarCartaoDeThread({
        aoAtualizar: recarregar,
        raiz,
        respostas: respostasDe(estado.colecao, raizId),
        // Scoped to THIS thread: after a resolution the card calls it only once the store accepted
        // the write, and by then the person may have opened another balloon.
        aoFechar: () => { if (estado.raizAberta === raizId) fecharCartao360(); },
    });
    ancorar(cartao, x, y);
    estado.raizAberta = raizId;
}

/**
 * Liga ou desliga o modo de comentar (o próximo clique escolhe onde a conversa fica).
 * @param {boolean} ligado
 */
export function alternarModoComentario360(ligado) {
    if (!estado.navigator) return;
    estado.navigator.setCommentToolActive(Boolean(ligado) && podeComentar());
    if (!ligado) fecharCartao360();
}

/** @returns {boolean} */
export function modoComentario360Ativo() {
    return Boolean(estado.navigator?.commentToolActive);
}

/**
 * Monta a camada de comentários do 360 sobre uma foto.
 *
 * Idempotente por construção: cada chamada solta os ouvintes da anterior. A troca de foto passa por
 * aqui, e sem isso cada panorama aberto deixaria um ouvinte a mais.
 *
 * @param {Object} navigator - O navegador do panorama.
 * @param {string} photoName - A foto aberta (a CHAVE canônica, `data.camera.img`).
 * @returns {Promise<void>}
 */
export async function iniciarComentarios360(navigator, photoName) {
    pararComentarios360();
    estado.navigator = navigator;
    estado.photoName = photoName;
    estado.ativo = true;

    const bus = getEventBus();
    const assinar = (tipo, fn) => { estado.soltar.push(bus.on(tipo, fn)); };
    assinar(EventTypes.STREETVIEW_360_SCENE_CLICKED, fecharCartao360);

    // As três escritas chegam pelos MESMOS eventos, venham daqui ou do colega: o aplicador remoto
    // emite os mesmos `COMMENT_*` que a operação local emite.
    for (const tipo of [EventTypes.COMMENT_CREATED, EventTypes.COMMENT_UPDATED, EventTypes.COMMENT_DELETED]) {
        assinar(tipo, () => { recarregar(); });
    }

    // A FOTO MUDA SEM A CAMADA SER REMONTADA, e era o defeito do relato do dono (2026-09-18: "ao no
    // mapa principal clicar num comentario do 360 ele abre na foto errada"). `iniciarComentarios360`
    // roda na ABERTURA do visualizador; andar pela seta troca a foto por `loadPhoto` e nao passa
    // por aqui. Sem isto, a camada continuava com a foto da abertura: os baloes desenhados eram os
    // da foto ERRADA, e o comentario criado depois de andar era GRAVADO com ela, o que fazia o
    // painel abrir noutra foto mais tarde.
    assinar(EventTypes.STREETVIEW_360_PHOTO_CHANGED, ({ currentPhoto }) => {
        if (!currentPhoto || currentPhoto === estado.photoName) return;
        estado.photoName = currentPhoto;
        fecharCartao360();
        recarregar();
    });

    assinar(EventTypes.COMMENT_360_CLICKED, ({ comment, screenX, screenY }) => {
        if (!comment?.id) return;
        abrirConversa(comment.id, screenX, screenY);
    });

    assinar(EventTypes.COMMENT_360_POSITION_CLICKED, ({ position, screenX, screenY }) => {
        alternarModoComentario360(false);
        if (!podeComentar() || !position) return;
        const photoName = estado.photoName;
        const mapName = getCurrentMapNameSync();
        const cartao = montarCartaoDeCompose({
            aoCancelar: () => fecharCartao360(),
            aoEnviar: async (texto) => {
                if (!estado.ativo || photoName !== estado.photoName || mapName !== getCurrentMapNameSync()) return false;
                const created = await addComment({
                    surface: SUPERFICIE.FOTO_360,
                    photoName,
                    heading: position.heading,
                    pitch: position.pitch,
                    text: texto,
                    ...autoriaAtual(),
                }, mapName);
                if (created) fecharCartao360();
                return !!created;
            },
        });
        ancorar(cartao, screenX, screenY);
    });

    await recarregar();
}

/**
 * Abre a conversa de um comentário DESTA foto, no centro da tela.
 *
 * O CENTRO, e não o pixel do balão, e a razão é o chamador: quem chama é o painel de comentários,
 * depois de girar a câmera para o comentário (`targetOrientation`). Nesse instante o balão ESTÁ no
 * centro, e ancorar ali é o mesmo ponto sem depender de um quadro já projetado.
 *
 * @param {string} raizId
 * @returns {boolean} Se a conversa foi aberta.
 */
export function focarComentario360(raizId) {
    if (!estado.ativo || !estado.colecao[raizId]) return false;
    const caixa = container();
    if (!caixa) return false;
    abrirConversa(raizId, caixa.clientWidth / 2, caixa.clientHeight / 2);
    return true;
}

/** Desmonta a camada: solta os ouvintes, fecha o cartão e limpa os balões. */
export function pararComentarios360() {
    for (const soltar of estado.soltar) soltar?.();
    estado.soltar = [];
    estado.ativo = false;
    fecharCartao360();
    estado.navigator?.setCommentToolActive(false);
    estado.navigator?.setComments([]);
    estado.navigator = null;
    estado.photoName = null;
    estado.colecao = {};
}
