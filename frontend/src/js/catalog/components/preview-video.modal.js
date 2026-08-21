// Path: js/catalog/components/preview-video.modal.js

/**
 * @fileoverview A SUPERFÍCIE DE LEITURA do vídeo de prévia.
 *
 * Ela existe porque a metade de escrita passou a valer para quatro tipos de recurso
 * (tileset, camada de dados, camada de análise e projeto 360) e antes só havia UM leitor
 * no produto inteiro: o popup do marcador 3D (`add_3d_models_viewer_control.js`), que só
 * abre quando o modelo já está carregado no mapa. Estender a escrita sem estender a
 * leitura entregaria um campo que nada mostra — o administrador preenche a URL, salva, e
 * ninguém nunca vê o vídeo. É por isso que este arquivo e o campo do painel entram no
 * MESMO commit.
 *
 * O CARTÃO DO CATÁLOGO É A SUPERFÍCIE COMUM dos quatro tipos, e é a única: o basemap não
 * tem cartão (ele vive no seletor de camada base, uma lista compacta), e é por isso que o
 * quinto tipo ficou de fora do eixo inteiro, escrita inclusive.
 *
 * DUAS DECISÕES QUE NÃO SE DEDUZEM LENDO O CÓDIGO:
 *
 *   - `preload="none"`. O vídeo é mídia fora de banda, servida pelo mesmo prefixo dos
 *     tilesets, e um catálogo com vinte modelos abriria vinte conexões só por existir. O
 *     download começa quando a pessoa aperta play.
 *   - NENHUM `autoplay`. Abrir um modal que começa a tocar som é a afordância que o
 *     usuário desfaz fechando a janela, e a prévia existe para ser escolhida.
 *
 * O `src` vem do catálogo (escrito por um administrador, validado na borda do servidor,
 * que recusa `data:`), e ele entra por propriedade do elemento, nunca por interpolação de
 * HTML. O título entra por `textContent`.
 *
 * O CARIMBO DE ESCOPO NÃO É OPCIONAL AQUI, e foi a primeira coisa que faltou: um `<video
 * src>` é buscado pelo NAVEGADOR, e requisição de navegador não carrega `Authorization`.
 * Para um recurso PRIVADO alcançado por empréstimo do atlas em foco, o `?atlasId=` é a
 * única autorização que atravessa (`assets3d-request.js` diz isso por extenso, e nomeia o
 * `<video src>`). Sem ele, o operador via o botão "Prévia", abria o modal, levava 404 e lia
 * a frase de erro como "a URL está errada". Ver {@link enderecoDaPrevia}.
 *
 * O ESCAPE SAI EM FASE DE CAPTURA, e isso também não é estilo: `ModalBase` registra o
 * Escape dele no MESMO `document`, e o registro dele é anterior (o catálogo foi construído
 * antes desta prévia existir). Ordem em `document` é ordem de registro, então um Escape
 * fechava o catálogo inteiro por baixo e a prévia por cima. `stopPropagation` não resolve
 * (são dois ouvintes no mesmo nó) e `stopImmediatePropagation` na fase de bolha chega
 * tarde: só a captura roda antes.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { escoparUrlDeAsset } from '@store/sync/assets3d-request.js';

/** Fechamento com a mesma duração da animação dos outros modais da casa. */
const DURACAO_SAIDA_MS = 200;

/**
 * Modal de prévia em vídeo de um item do catálogo.
 */
class PreviewVideoModal {
    /**
     * @param {Object} config
     * @param {string} config.url - Endereço do vídeo.
     * @param {string} config.titulo - Nome do recurso, para o cabeçalho.
     */
    constructor({ url, titulo }) {
        this._url = url;
        this._titulo = titulo || 'Prévia';
        this._overlay = null;
        this._video = null;
        this._anterior = null;
        setupCleanup(this);
    }

    /** Monta, insere e anima a entrada. */
    show() {
        this._anterior = document.activeElement;
        this._render();
        document.body.appendChild(this._overlay);
        requestAnimationFrame(() => {
            this._overlay.dataset.visible = 'true';
        });
    }

    /** @private */
    _render() {
        this._overlay = document.createElement('div');
        this._overlay.className = 'modal-overlay preview-video-overlay';
        this._overlay.setAttribute('role', 'dialog');
        this._overlay.setAttribute('aria-modal', 'true');
        this._overlay.setAttribute('aria-label', `Prévia de ${this._titulo}`);
        this._overlay.dataset.visible = 'false';
        this._overlay.dataset.testid = 'preview-video-modal';

        const container = document.createElement('div');
        container.className = 'modal-container preview-video-container';

        const header = document.createElement('div');
        header.className = 'preview-video-header';
        const titulo = document.createElement('h3');
        titulo.className = 'preview-video-title';
        titulo.textContent = this._titulo;
        const fechar = document.createElement('button');
        fechar.type = 'button';
        fechar.className = 'preview-video-close';
        fechar.setAttribute('aria-label', 'Fechar prévia');
        fechar.dataset.testid = 'preview-video-close';
        fechar.textContent = '×';
        addDomListener(this, fechar, 'click', () => this._close());
        header.append(titulo, fechar);

        this._video = document.createElement('video');
        this._video.className = 'preview-video-player';
        this._video.controls = true;
        this._video.preload = 'none';
        this._video.playsInline = true;
        this._video.src = enderecoDaPrevia(this._url);

        // O ERRO DE MÍDIA PRECISA APARECER. O `<video>` falha em silêncio (uma caixa
        // preta), e o caso realista não é raro: a URL foi digitada à mão no painel, ou o
        // arquivo saiu do servidor de mídia. Sem esta linha o operador não distingue "o
        // vídeo não carrega" de "o vídeo é preto no começo".
        const erro = document.createElement('p');
        erro.className = 'preview-video-error';
        erro.hidden = true;
        erro.textContent = 'Não foi possível carregar o vídeo de prévia deste item.';
        addDomListener(this, this._video, 'error', () => { erro.hidden = false; });

        container.append(header, this._video, erro);
        this._overlay.appendChild(container);

        addDomListener(this, this._overlay, 'click', (e) => {
            if (e.target === this._overlay) this._close();
        });
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key !== 'Escape') return;
            // Barra o Escape do modal de baixo ANTES que ele rode. Ver o `fileoverview`.
            e.stopImmediatePropagation();
            this._close();
        }, { capture: true });
    }

    /** @private */
    _close() {
        if (!this._overlay) return;
        // PAUSAR ANTES DE REMOVER não é zelo: um `<video>` removido do documento sem
        // pausa continua baixando e continua tocando o áudio em alguns navegadores, e o
        // usuário fica sem nenhum controle para pará-lo.
        if (this._video) {
            this._video.pause();
            this._video.removeAttribute('src');
            this._video.load();
        }
        this._overlay.dataset.visible = 'false';
        const overlay = this._overlay;
        this._overlay = null;
        setTimeout(() => {
            cleanup(this);
            removeElement(overlay);
            this._anterior?.focus?.();
        }, DURACAO_SAIDA_MS);
    }
}

/**
 * O ENDEREÇO QUE O NAVEGADOR VAI BUSCAR, com o carimbo de escopo do atlas em foco.
 *
 * Existe como função exportada, e não como uma linha dentro do construtor de DOM, porque é
 * a única parte desta tela que se verifica em node: o ambiente de teste do frontend não tem
 * DOM, e sem esta costura o carimbo só teria guarda de Playwright. `escoparUrlDeAsset`
 * devolve a URL INTACTA para endereço de outra origem e para quem não tem atlas em foco,
 * então o recurso público não regride, e carimbar duas vezes não duplica o parâmetro (a
 * cena indoor já chega carimbada por `resolveSceneAssets`).
 *
 * @param {string} url
 * @returns {string}
 */
export function enderecoDaPrevia(url) {
    return escoparUrlDeAsset(url);
}

/**
 * Abre a prévia em vídeo de um recurso.
 *
 * Sem URL não abre nada: é o mesmo estado do item que nunca teve vídeo, e um modal vazio
 * seria pior que a ausência do botão.
 * @param {{url: string, titulo: string}} params
 * @returns {boolean} `true` quando abriu.
 */
export function abrirPreviaDeVideo({ url, titulo }) {
    if (!url) return false;
    new PreviewVideoModal({ url, titulo }).show();
    return true;
}
