// Path: js/first_person_3d_tool/walk/touch-stick.js

/**
 * @fileoverview O MANCHE DE TOQUE, sem o qual a cena caminhável não se caminha num tablet.
 *
 * ANDAR ERA SÓ WASD (mais as setas), pular era `Space` e agachar era `Shift`. Num aparelho de
 * toque não existe nenhum dos três, e o teclado virtual só sobe sobre um campo de texto: a pessoa
 * abria a cena, conseguia girar a visão com o dedo e ficava parada no ponto de entrada. Metade do
 * produto, portanto, não existia ali, e ao contrário dos outros defeitos desta onda este não é um
 * alvo pequeno nem um gesto que falha: é a ausência da única forma de se locomover.
 *
 * ELE É ANALÓGICO, e essa é a diferença que justifica um manche em vez de quatro botões de seta.
 * A inclinação vira intensidade, então dá para encostar num item do acervo em vez de bater nele:
 * `walk-mode.js` passou a escalar a velocidade pela magnitude do vetor, e o teclado continua
 * idêntico porque duas teclas somam hipotenusa maior que um e são aparadas no teto.
 *
 * O VETOR É EM COORDENADA DE CÂMERA, nunca de mundo: `forward` e `strafe` são "para onde a pessoa
 * está olhando" e "para o lado", exatamente o que as teclas produzem. Quem os converte para o
 * mundo é o caminhador, com o yaw do instante, e é por isso que este arquivo não sabe nada de
 * geometria e roda em node.
 *
 * O QUE ELE NÃO FAZ, declarado para a próxima leitura: não gira a visão (isso é o arrasto de um
 * dedo na cena, em `walk-mode.js`), não tem zona morta configurável e não guarda preferência. O
 * raio da base é o limite do curso, e a inclinação satura nele.
 */

import { setupCleanup, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';

/**
 * Raio do curso do manche, em pixels.
 *
 * O NÚMERO NÃO É LIVRE, e a primeira versão errou nele: ele tem de ser o raio da base MENOS o
 * raio do botão, senão o botão sai por fora do anel no fim do curso. Com base de 120 px (raio
 * 60) e botão de 40 px (raio 20), o curso fecha exatamente em 40. Isso foi visto LENDO a captura,
 * e não é coisa que um teste de unidade pegue: a aritmética estava certa, o desenho é que
 * denunciava.
 *
 * O CSS repete os três números e cita este comentário; mudar um exige mudar os três.
 */
const RAIO_PX = 40;

/**
 * Fração do raio abaixo da qual o manche não anda.
 *
 * ZONA MORTA EXISTE PORQUE O DEDO NÃO PARA: apoiado na base, ele oscila alguns pixels, e sem ela
 * a cena deriva sozinha enquanto a mão descansa. Um décimo do curso é pequeno o bastante para não
 * se sentir e grande o bastante para absorver o tremor.
 */
const ZONA_MORTA = 0.1;

/**
 * Um manche virtual mais os dois comandos verticais.
 */
export class TouchStick {
    /**
     * @param {HTMLElement} container - Onde o manche é desenhado (o container da cena).
     * @param {Object} acoes
     * @param {(frente: number, lado: number) => void} acoes.onMover - Vetor de -1 a 1 em cada eixo.
     * @param {() => void} acoes.onPular
     * @param {(agachado: boolean) => void} acoes.onAgachar
     */
    constructor(container, { onMover, onPular, onAgachar } = {}) {
        setupCleanup(this);

        this._onMover = typeof onMover === 'function' ? onMover : () => {};
        this._onPular = typeof onPular === 'function' ? onPular : () => {};
        this._onAgachar = typeof onAgachar === 'function' ? onAgachar : () => {};

        /** O ponteiro que está conduzindo o manche agora, ou null. */
        this._pointerId = null;

        this._root = document.createElement('div');
        this._root.className = 'fp3d-stick';
        this._root.innerHTML = `
            <div class="fp3d-stick__base" role="application"
                 aria-label="Manche de caminhada: arraste para andar">
                <div class="fp3d-stick__knob"></div>
            </div>
            <div class="fp3d-stick__verticals">
                <button type="button" class="fp3d-stick__btn fp3d-stick__btn--jump"
                        aria-label="Pular">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round"
                         stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
                </button>
                <button type="button" class="fp3d-stick__btn fp3d-stick__btn--crouch"
                        aria-label="Agachar" aria-pressed="false">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round"
                         stroke-linejoin="round"><path d="M12 5v14"/><path d="m5 12 7 7 7-7"/></svg>
                </button>
            </div>
        `;

        this._base = this._root.querySelector('.fp3d-stick__base');
        this._knob = this._root.querySelector('.fp3d-stick__knob');
        const pular = this._root.querySelector('.fp3d-stick__btn--jump');
        const agachar = this._root.querySelector('.fp3d-stick__btn--crouch');

        // O MANCHE CAPTURA O PONTEIRO, e sem isso o dedo que sai da base no meio do gesto
        // simplesmente para de mandar evento: a cena continuaria andando na última direção até
        // alguém tocar de novo. Com a captura, os eventos seguem chegando aqui onde quer que o
        // dedo vá, e a soltura sempre chega.
        addDomListener(this, this._base, 'pointerdown', (e) => this._iniciar(e));
        addDomListener(this, this._base, 'pointermove', (e) => this._mover(e));
        addDomListener(this, this._base, 'pointerup', (e) => this._soltar(e));
        addDomListener(this, this._base, 'pointercancel', (e) => this._soltar(e));

        addDomListener(this, pular, 'click', () => this._onPular());

        // AGACHAR É UM INTERRUPTOR e não um botão que se segura, porque segurar um botão com um
        // dedo e conduzir o manche com o outro já são dois dedos, e agachar para passar por baixo
        // de alguma coisa leva mais tempo que um toque.
        addDomListener(this, agachar, 'click', () => {
            const ligado = agachar.getAttribute('aria-pressed') !== 'true';
            agachar.setAttribute('aria-pressed', String(ligado));
            this._onAgachar(ligado);
        });

        container.appendChild(this._root);
    }

    /**
     * @param {PointerEvent} e
     * @private
     */
    _iniciar(e) {
        if (this._pointerId !== null) return;
        this._pointerId = e.pointerId;
        this._base.setPointerCapture?.(e.pointerId);
        this._mover(e);
    }

    /**
     * @param {PointerEvent} e
     * @private
     */
    _mover(e) {
        if (e.pointerId !== this._pointerId) return;

        const r = this._base.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);

        const { frente, lado, x, y } = vetorDoManche(dx, dy);
        this._knob.style.transform = `translate(${x}px, ${y}px)`;
        this._onMover(frente, lado);
    }

    /**
     * @param {PointerEvent} e
     * @private
     */
    _soltar(e) {
        if (e.pointerId !== this._pointerId) return;
        this._base.releasePointerCapture?.(e.pointerId);
        this._pointerId = null;
        this._knob.style.transform = '';
        this._onMover(0, 0);
    }

    /** Tira o manche da tela e solta tudo. */
    destroy() {
        this._onMover(0, 0);
        this._onAgachar(false);
        cleanup(this);
        removeElement(this._root);
        this._root = null;
    }
}

/**
 * A MATEMÁTICA DO MANCHE, pura e sem DOM, que é o que se exercita em node.
 *
 * @param {number} dx - Deslocamento do dedo em relação ao centro, em pixels.
 * @param {number} dy - Idem, no eixo vertical da TELA (positivo para baixo).
 * @returns {{frente: number, lado: number, x: number, y: number}} O vetor em coordenada de
 *   câmera (`frente` positivo é para onde a pessoa olha) e a posição do botão na base.
 */
export function vetorDoManche(dx, dy) {
    const distancia = Math.hypot(dx, dy);
    // SATURA NO RAIO em vez de crescer sem fim: arrastar o dedo para o outro lado da tela não
    // anda mais rápido, e o botão não sai da base.
    const escala = distancia > RAIO_PX ? RAIO_PX / distancia : 1;
    const x = dx * escala;
    const y = dy * escala;

    const intensidade = Math.min(1, distancia / RAIO_PX);
    if (!Number.isFinite(intensidade) || intensidade < ZONA_MORTA) {
        // A posição do botão ainda segue o dedo dentro da zona morta, senão ele parece travado.
        return { frente: 0, lado: 0, x, y };
    }

    // O SINAL VERTICAL INVERTE: no eixo da tela, para CIMA é `dy` negativo, e para cima é andar
    // para FRENTE. Esquecer esta linha entrega uma cena que anda de ré.
    const unidade = Math.max(RAIO_PX, distancia);
    return { frente: -dy / unidade, lado: dx / unidade, x, y };
}
