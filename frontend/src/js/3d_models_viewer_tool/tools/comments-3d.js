// Path: js/3d_models_viewer_tool/tools/comments-3d.js

/**
 * @fileoverview O COMENTÁRIO ESPACIAL DENTRO DO VISUALIZADOR 3D.
 *
 * A metade do 3D do pedido do dono (2026-09-17): o mesmo sistema de comentários do mapa, aqui sobre
 * o modelo. Gêmeo de `street_view_tool/comments-360.js`, com as mesmas três responsabilidades e
 * nenhuma a mais: carregar os comentários do modelo aberto, DESENHÁ-LOS na cena e ancorar o CARTÃO.
 *
 * O CARTÃO E AS REGRAS VÊM DE `comment_tool/comment-card.js`, o mesmo módulo do mapa 2D e do 360.
 * Responder, resolver, reabrir, excluir e os dois gates são os de lá, sem cópia.
 *
 * A ÂNCORA É A DO MARCADOR 3D: o modelo mais o ponto sobre ele (longitude, latitude e altura), que
 * é o que `scene.pickPosition` devolve. Guardamos `lng`/`lat`/`alt` porque são os nomes que o
 * comentário já usa no mapa 2D — o 3D é o mapa com uma altura a mais, e inventar um par de nomes
 * novo faria o painel ter de saber de qual superfície veio para ler a mesma coisa.
 *
 * O ÍCONE É DESENHADO AQUI, num canvas, e não é capricho: o Cesium pinta `billboard` a partir de
 * uma imagem, e o que precisamos mostrar é a COR DO AUTOR com as INICIAIS dele dentro, como o pino
 * do mapa e o balão do 360. É a mesma figura nas três superfícies, desenhada pela API de cada uma.
 */

// A biblioteca pelo ponto unico da casa (`@js/vendor/cesium.js`), como `map_3d.js` faz desde a
// adocao por npm em 2026-09-14. Os outros modulos desta ferramenta leem o `window.Cesium` que esse
// ponto publica; importar aqui deixa explicito de onde ele vem e sobrevive ao dia em que o global
// sair.
import { Cesium } from '@js/vendor/cesium.js';
import { getComments, addComment, getCurrentMapNameSync } from '@store';
import { getEventBus } from '@store/services.js';
import { escolherAlvo } from '../services/pick-de-alvo.js';
import { EventTypes } from '@events/event_types.js';
import {
    SUPERFICIE,
    autoriaAtual,
    ehDaSuperficie,
    montarCartaoDeCompose,
    montarCartaoDeThread,
    podeComentar,
    respostasDe,
} from '@js/comment_tool/comment-card.js';

/** O prefixo do id das entidades, para não colidir com o dos marcadores. */
const PREFIXO = 'comment-3d-';

const estado = {
    viewer: null,
    tilesetId: null,
    colecao: {},
    handler: null,
    cartao: null,
    raizAberta: null,
    modoAtivo: false,
    ativo: false,
    soltar: [],
};

/** O container do visualizador, onde o cartão é posicionado. */
function container() {
    return document.getElementById('map-3d') || estado.viewer?.canvas?.parentElement || null;
}

/** Fecha o cartão aberto, se houver. */
export function fecharCartao3D() {
    estado.cartao?.remove();
    estado.cartao = null;
    estado.raizAberta = null;
}

/**
 * O ícone do comentário: um círculo na cor do autor, com as iniciais e o contador de respostas.
 * @param {{authorColor?:string, authorInitials?:string}} c
 * @param {number} respostas
 * @returns {string} Data URL de um PNG.
 */
function iconeDeComentario(c, respostas) {
    const tamanho = 64;
    const canvas = document.createElement('canvas');
    canvas.width = tamanho;
    canvas.height = tamanho;
    const ctx = canvas.getContext('2d');
    const raio = tamanho * 0.4;
    const cor = c.authorColor || '#2563eb';

    ctx.beginPath();
    ctx.arc(tamanho / 2, tamanho / 2, raio, 0, Math.PI * 2);
    ctx.fillStyle = cor;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((c.authorInitials || '?').slice(0, 2), tamanho / 2, tamanho / 2 + 1);

    if (respostas > 0) {
        const rx = tamanho / 2 + raio * 0.75;
        const ry = tamanho / 2 - raio * 0.75;
        ctx.beginPath();
        ctx.arc(rx, ry, raio * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = cor;
        ctx.stroke();
        ctx.fillStyle = cor;
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(String(Math.min(respostas, 9)), rx, ry + 1);
    }

    return canvas.toDataURL();
}

/** Os comentários raiz DESTE modelo, abertos e com posição utilizável. */
function raizesDoModelo() {
    return Object.values(estado.colecao).filter(
        (c) => c && !c.parentId && c.status !== 'resolved'
            && ehDaSuperficie(c, SUPERFICIE.MODELO_3D, estado.tilesetId)
            && Number.isFinite(c.lng) && Number.isFinite(c.lat),
    );
}

/** Reconcilia as entidades da cena contra os comentários abertos. */
function desenhar() {
    const viewer = estado.viewer;
    if (!viewer || viewer.isDestroyed?.()) return;

    const vivos = new Set();
    for (const c of raizesDoModelo()) {
        const idEntidade = PREFIXO + c.id;
        vivos.add(idEntidade);
        const respostas = respostasDe(estado.colecao, c.id).length;

        // RECRIA EM VEZ DE MUTAR quando o contador muda: o `billboard.image` é uma imagem gerada, e
        // trocá-la em uma entidade viva deixa o Cesium com a textura antiga até o próximo quadro em
        // que algo mais a invalide. Recriar é barato aqui (são poucos comentários por modelo).
        const existente = viewer.entities.getById(idEntidade);
        if (existente) {
            if (existente.properties?.respostas?.getValue() === respostas) continue;
            viewer.entities.remove(existente);
        }

        viewer.entities.add({
            id: idEntidade,
            position: Cesium.Cartesian3.fromDegrees(c.lng, c.lat, Number.isFinite(c.alt) ? c.alt : 0),
            billboard: {
                image: iconeDeComentario(c, respostas),
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                // Sem teste de profundidade: um comentário atrás de uma parede do modelo continua
                // alcançável, que é o mesmo que o marcador 3D faz.
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: Cesium.HeightReference.NONE,
            },
            properties: { commentId: c.id, respostas },
        });
    }

    // O que saiu da lista (resolvido ou excluído) sai da cena.
    for (const entidade of [...viewer.entities.values]) {
        if (typeof entidade.id === 'string' && entidade.id.startsWith(PREFIXO) && !vivos.has(entidade.id)) {
            viewer.entities.remove(entidade);
        }
    }
}

/** Põe o cartão na tela, preso ao pixel do gesto e dentro do container. */
function ancorar(cartao, x, y) {
    const caixa = container();
    if (!caixa) return;
    fecharCartao3D();

    cartao.classList.add('comment-card--flutuante');
    caixa.appendChild(cartao);

    const largura = cartao.offsetWidth || 320;
    const altura = cartao.offsetHeight || 160;
    const margem = 12;
    cartao.style.left = `${Math.max(margem, Math.min(x - largura / 2, caixa.clientWidth - largura - margem))}px`;
    cartao.style.top = `${Math.max(margem, Math.min(y - altura - 24, caixa.clientHeight - altura - margem))}px`;

    estado.cartao = cartao;
}

/** Abre a conversa de uma raiz, ancorada no pixel indicado. */
function abrirConversa(raizId, x, y) {
    const raiz = estado.colecao[raizId];
    if (!raiz) return;
    ancorar(montarCartaoDeThread({
        raiz,
        respostas: respostasDe(estado.colecao, raizId),
        aoFechar: () => fecharCartao3D(),
    }), x, y);
    estado.raizAberta = raizId;
}

/** Relê a coleção do mapa, repinta a cena e refaz a conversa aberta. */
async function recarregar() {
    if (!estado.ativo) return;
    const mapa = getCurrentMapNameSync();
    estado.colecao = (mapa ? await getComments(mapa) : {}) || {};
    if (!estado.ativo) return;
    desenhar();

    if (estado.raizAberta) {
        const raiz = estado.colecao[estado.raizAberta];
        const onde = estado.cartao
            ? { x: parseFloat(estado.cartao.style.left) + estado.cartao.offsetWidth / 2, y: parseFloat(estado.cartao.style.top) + estado.cartao.offsetHeight + 24 }
            : null;
        if (raiz && raiz.status !== 'resolved' && onde) abrirConversa(raiz.id, onde.x, onde.y);
        else fecharCartao3D();
    }
}

/** @returns {boolean} */
export function modoComentario3DAtivo() {
    return estado.modoAtivo;
}

/**
 * Liga ou desliga o modo de comentar: o próximo clique na cena escolhe onde a conversa fica.
 * @param {boolean} ligado
 */
export function alternarModoComentario3D(ligado) {
    estado.modoAtivo = Boolean(ligado) && podeComentar();
    if (estado.viewer?.canvas) {
        estado.viewer.canvas.style.cursor = estado.modoAtivo ? 'crosshair' : '';
    }
    if (!estado.modoAtivo) fecharCartao3D();
}

/** @private O clique na cena: abre a conversa de um comentário, ou cria um no modo de comentar. */
function aoClicar(click) {
    const viewer = estado.viewer;
    if (!viewer) return;

    // Um comentário existente ganha o clique SEMPRE, mesmo no modo de comentar: clicar num balão
    // para responder é mais frequente que criar outro exatamente em cima dele.
    const escolhido = escolherAlvo(viewer.scene, click.position);
    const commentId = escolhido?.id?.properties?.commentId?.getValue?.();
    if (commentId) {
        abrirConversa(commentId, click.position.x, click.position.y);
        return;
    }

    fecharCartao3D();
    if (!estado.modoAtivo || !podeComentar()) return;

    const cartesiano = viewer.scene.pickPosition(click.position);
    if (!Cesium.defined(cartesiano)) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesiano);
    const lng = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const alt = carto.height;

    alternarModoComentario3D(false);
    const tilesetId = estado.tilesetId;
    const mapName = getCurrentMapNameSync();
    ancorar(montarCartaoDeCompose({
        aoCancelar: () => fecharCartao3D(),
        aoEnviar: async (texto) => {
            if (!estado.ativo || tilesetId !== estado.tilesetId || mapName !== getCurrentMapNameSync()) return false;
            const created = await addComment({
                surface: SUPERFICIE.MODELO_3D,
                tilesetId,
                lng,
                lat,
                alt,
                text: texto,
                ...autoriaAtual(),
            }, mapName);
            if (created) fecharCartao3D();
            return !!created;
        },
    }), click.position.x, click.position.y);
}

/**
 * Monta a camada de comentários sobre um modelo aberto. Idempotente: solta o que a chamada
 * anterior registrou, porque a troca de modelo passa por aqui.
 *
 * @param {Object} viewer - O viewer do Cesium.
 * @param {string} tilesetId - O modelo aberto.
 * @returns {Promise<void>}
 */
export async function iniciarComentarios3D(viewer, tilesetId) {
    pararComentarios3D();
    if (!viewer || !tilesetId) return;
    estado.viewer = viewer;
    estado.tilesetId = tilesetId;
    estado.ativo = true;

    estado.handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    estado.handler.setInputAction(aoClicar, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    const bus = getEventBus();
    for (const tipo of [EventTypes.COMMENT_CREATED, EventTypes.COMMENT_UPDATED, EventTypes.COMMENT_DELETED]) {
        estado.soltar.push(bus.on(tipo, () => { recarregar(); }));
    }

    await recarregar();
}

/**
 * Voa até um comentário DESTE modelo e abre a conversa dele.
 *
 * O voo e o cartao no centro sao o par: quem chama e o painel de comentarios, e a pessoa que clicou
 * numa linha da lista espera chegar ao ponto e ver a conversa, nao procurar o balao na cena.
 *
 * @param {string} raizId
 * @returns {boolean} Se a conversa foi aberta.
 */
export function focarComentario3D(raizId) {
    const raiz = estado.colecao[raizId];
    const viewer = estado.viewer;
    if (!estado.ativo || !raiz || !viewer || viewer.isDestroyed?.()) return false;

    const alvo = Cesium.Cartesian3.fromDegrees(raiz.lng, raiz.lat, Number.isFinite(raiz.alt) ? raiz.alt : 0);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(alvo, 30), {
        duration: 1,
        offset: new Cesium.HeadingPitchRange(viewer.camera.heading || 0, Cesium.Math.toRadians(-25), 60),
    });

    const caixa = container();
    if (!caixa) return false;
    abrirConversa(raizId, caixa.clientWidth / 2, caixa.clientHeight / 2);
    return true;
}

/** Desmonta a camada: solta o handler e os ouvintes, fecha o cartão e limpa as entidades. */
export function pararComentarios3D() {
    for (const soltar of estado.soltar) soltar?.();
    estado.soltar = [];
    estado.handler?.destroy?.();
    estado.handler = null;
    estado.ativo = false;
    estado.modoAtivo = false;
    fecharCartao3D();

    const viewer = estado.viewer;
    if (viewer && !viewer.isDestroyed?.()) {
        for (const entidade of [...viewer.entities.values]) {
            if (typeof entidade.id === 'string' && entidade.id.startsWith(PREFIXO)) {
                viewer.entities.remove(entidade);
            }
        }
    }
    estado.viewer = null;
    estado.tilesetId = null;
    estado.colecao = {};
}
