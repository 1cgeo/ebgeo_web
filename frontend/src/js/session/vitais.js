// Path: js/session/vitais.js

/**
 * @fileoverview Browser performance collector: CLS uses maximum session windows; INP groups interaction IDs and excludes one extreme per fifty interactions. Native interactionCount includes fast interactions; older browsers use observed IDs as an estimate. LCP accepts new candidates until the first interaction or hidden state.
 */

/** O limiar de duração das entradas de interação, em ms. */
const LIMIAR_DE_INTERACAO_MS = 16;

/** A marca do instante em que o `GET /api/config` respondeu. */
export const MARCA_CONFIG = 'config-carregada';

/** A marca do instante em que o mapa terminou de carregar. */
export const MARCA_MAPA = 'mapa-pronto';

/** A marca que o `DOMContentLoaded` de `index.js` já punha antes desta frente existir. */
export const MARCA_INICIO = 'app-init';

/** O nome da medida entre {@link MARCA_INICIO} e {@link MARCA_MAPA}. */
export const MEDIDA_ATE_MAPA = 'tempo-ate-mapa';

/**
 * Uma coleta de vitais sobre um `performance` e um `PerformanceObserver` injetados.
 *
 * FÁBRICA E SINGLETON, os dois, pelo mesmo arranjo de `sessao-id.js`: o singleton é o que o
 * produto usa (uma página, uma coleta) e a fábrica é o que torna as três propriedades testáveis em
 * node puro, onde não existe `PerformanceObserver` nenhum.
 *
 * @param {Object} [opcoes]
 * @param {*} [opcoes.performance] - O `performance` da página. `null` é legítimo.
 * @param {*} [opcoes.Observador] - O construtor de `PerformanceObserver`. `null` é legítimo.
 * @returns {{observar: () => boolean, marcar: (nome: string) => boolean,
 *   marcarMapaPronto: () => boolean, ler: () => Object, desinstalar: () => void}}
 */
export function criarVitais({ performance, Observador, documento = globalThis.document } = {}) {
    /** O maior conteúdo pintado, em ms desde o começo da navegação. */
    let lcpMs = null;
    /** A pior interação vista, em ms. */
    let inpMs = null;
    /** A soma dos deslocamentos de layout sem interação recente. */
    let cls = null;
    const interacoes = new Map();
    const ids = new Set();
    let janelaInicio = 0;
    let ultimoDeslocamento = -Infinity;
    let janelaCls = 0;
    let lcpFechado = documento?.visibilityState === 'hidden';
    let fecharLcp = () => {};
    /** Os observadores vivos, para poder desligá-los. */
    const observadores = [];
    /**
     * Se {@link observar} já assinou.
     *
     * ELA EXISTE CONTRA UM DOBRO SILENCIOSO, e o dobro é no CLS. `observar()` é chamado pela
     * fiação ANTES da guarda de idempotência de `configurarUso` (de propósito: com `buffered`
     * ligado, assinar cedo é o que faz o LCP existir), então uma segunda instalação da mesma
     * página, que a guarda de lá recusa em silêncio, chegaria aqui e assinaria de novo. Com dois
     * observadores de `layout-shift`, cada entrada é entregue DUAS vezes e o CLS soma o dobro:
     * uma página boa passa a se declarar ruim, e nada fica vermelho, porque o número continua
     * bem formado. O LCP e o INP não sofrem (o último e o máximo são idempotentes), o que torna a
     * assimetria ainda mais difícil de notar.
     */
    let observando = false;

    /** @returns {*} O `performance` a usar, ou `null`. */
    const perf = () => {
        try {
            const p = performance === undefined ? globalThis.performance : performance;
            return p ?? null;
        } catch {
            return null;
        }
    };

    /** @returns {*} O construtor de observador, ou `null`. */
    const ctor = () => {
        try {
            const c = Observador === undefined ? globalThis.PerformanceObserver : Observador;
            return typeof c === 'function' ? c : null;
        } catch {
            return null;
        }
    };

    /**
     * Assina UM tipo de entrada. Falha calada e devolve `false`: um tipo que este navegador não
     * conhece é o caso NORMAL, não um defeito.
     * @param {Object} opcoes - O que vai para `observe()`.
     * @param {(entradas: Array) => void} aoReceber
     * @returns {boolean}
     */
    const assinar = (opcoes, aoReceber) => {
        const C = ctor();
        if (!C) return false;
        try {
            const obs = new C((lista) => {
                try {
                    const entradas = typeof lista?.getEntries === 'function' ? lista.getEntries() : [];
                    aoReceber(Array.isArray(entradas) ? entradas : []);
                } catch {
                    // Entrada de forma inesperada: a métrica simplesmente não avança.
                }
            });
            obs.observe(opcoes);
            observadores.push(obs);
            if (opcoes.type === 'largest-contentful-paint') {
                fecharLcp = () => {
                    if (lcpFechado) return;
                    try { aoReceber(obs.takeRecords?.() ?? []); } catch { /* optional API */ }
                    lcpFechado = true;
                    obs.disconnect?.();
                };
            }
            return true;
        } catch {
            // `type` desconhecido, `buffered` não suportado, observador já desconectado.
            return false;
        }
    };

    /** @param {*} v @returns {boolean} */
    const finito = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

    return {
        /**
         * Liga as três assinaturas. IDEMPOTENTE de verdade: a segunda chamada não assina nada
         * (ver `observando`, logo acima, sobre o CLS dobrado).
         * @returns {boolean} Se ao menos uma assinatura está de pé.
         */
        observar() {
            // IDEMPOTENTE, e a razão está em `observando`: assinar duas vezes DOBRA o CLS.
            if (observando) return observadores.length > 0;
            observando = true;
            // `buffered: true` é o que faz o LCP funcionar: a maior parte das entradas acontece
            // ANTES de qualquer JavaScript nosso rodar, e sem o buffer a assinatura só veria as
            // que vierem depois — ou seja, nenhuma, na página que carrega rápido.
            const a = assinar({ type: 'largest-contentful-paint', buffered: true }, (entradas) => {
                if (lcpFechado) return;
                // A ÚLTIMA VENCE: o LCP é revisado para cima enquanto a página pinta, e o valor
                // final é o da última entrada, nunca o máximo nem o primeiro.
                const ultima = entradas[entradas.length - 1];
                if (finito(ultima?.startTime)) lcpMs = ultima.startTime;
            });
            const b = assinar(
                { type: 'event', buffered: true, durationThreshold: LIMIAR_DE_INTERACAO_MS },
                (entradas) => {
                    for (const e of entradas) {
                        if (!e?.interactionId || !finito(e.duration)) continue;
                        if (ids.size < 10000) ids.add(e.interactionId);
                        interacoes.set(e.interactionId, Math.max(interacoes.get(e.interactionId) ?? 0, e.duration));
                    }
                    const maiores = [...interacoes.entries()].sort((x, y) => y[1] - x[1]);
                    for (const [id] of maiores.slice(10)) interacoes.delete(id);
                    const total = perf()?.interactionCount ?? ids.size;
                    if (maiores.length) inpMs = maiores[Math.min(Math.floor(total / 50), 9, maiores.length - 1)][1];
                },
            );
            const c = assinar({ type: 'layout-shift', buffered: true }, (entradas) => {
                for (const e of entradas) {
                    // `hadRecentInput` É A METADE QUE NÃO SE PODE ESQUECER: um deslocamento que
                    // vem logo depois de um clique é a resposta ao clique (um painel abrindo, um
                    // acordeão), e contá-lo transformaria toda interface interativa em CLS ruim.
                    if (e?.hadRecentInput) continue;
                    if (!finito(e?.value)) continue;
                    const instante = e.startTime ?? 0;
                    if (instante - ultimoDeslocamento >= 1000 || instante - janelaInicio >= 5000) {
                        janelaInicio = instante;
                        janelaCls = 0;
                    }
                    ultimoDeslocamento = instante;
                    janelaCls += e.value;
                    cls = Math.max(cls ?? 0, janelaCls);
                }
            });
            if (c && cls === null) cls = 0;
            documento?.addEventListener?.('visibilitychange', aoOcultar);
            documento?.addEventListener?.('pointerdown', aoInteragir, { once: true, capture: true });
            documento?.addEventListener?.('keydown', aoInteragir, { once: true, capture: true });
            return a || b || c;
        },

        /**
         * Põe uma marca no `performance`. Best-effort.
         * @param {string} nome
         * @returns {boolean}
         */
        marcar(nome) {
            try {
                const p = perf();
                if (typeof p?.mark !== 'function' || typeof nome !== 'string' || !nome) {
                    return false;
                }
                p.mark(nome);
                return true;
            } catch {
                return false;
            }
        },

        /**
         * Marca o mapa como pronto e fecha a medida do tempo até ele.
         *
         * A MEDIDA PODE FALHAR SEM QUE A MARCA FALHE, e é por isso que ela tem `catch` próprio:
         * `measure` lança quando a marca de INÍCIO não existe, e {@link MARCA_INICIO} é posta no
         * `DOMContentLoaded`, que num boot muito rápido pode não ter acontecido ainda. Perder a
         * medida não pode custar a marca, que é o que {@link Vitais#ler} usa como reserva.
         * @returns {boolean} Se a marca foi posta.
         */
        marcarMapaPronto() {
            const posta = this.marcar(MARCA_MAPA);
            try {
                const p = perf();
                if (posta && typeof p?.measure === 'function') {
                    p.measure(MEDIDA_ATE_MAPA, MARCA_INICIO, MARCA_MAPA);
                }
            } catch {
                // Sem `app-init` não há medida; a reserva em `ler()` cobre o caso.
            }
            return posta;
        },

        /**
         * As vitais desta página, com SÓ os campos que existem.
         *
         * O TEMPO ATÉ O MAPA TEM DUAS FONTES, e a ordem é deliberada: a MEDIDA
         * ({@link MEDIDA_ATE_MAPA}) é a que conta o trecho certo (do início do app até o mapa
         * pronto), e a marca sozinha é a reserva, que conta desde o começo da NAVEGAÇÃO e
         * portanto inclui o download e a análise do HTML. As duas respondem à mesma pergunta com
         * limites diferentes, e a reserva erra para MAIS, o que é o lado seguro de errar.
         * @returns {{lcpMs?: number, inpMs?: number, cls?: number, tempoAteMapaMs?: number}}
         */
        ler() {
            const saida = {};
            try {
                const p = perf();
                const maiores = [...interacoes.values()].sort((a, b) => b - a);
                if (maiores.length) {
                    const total = p?.interactionCount ?? ids.size;
                    inpMs = maiores[Math.min(Math.floor(total / 50), 9, maiores.length - 1)];
                }
                if (finito(lcpMs)) saida.lcpMs = lcpMs;
                if (finito(inpMs)) saida.inpMs = inpMs;
                if (finito(cls)) saida.cls = cls;
                if (typeof p?.getEntriesByName === 'function') {
                    const medida = p.getEntriesByName(MEDIDA_ATE_MAPA)[0];
                    if (finito(medida?.duration)) {
                        saida.tempoAteMapaMs = medida.duration;
                    } else {
                        const marca = p.getEntriesByName(MARCA_MAPA)[0];
                        if (finito(marca?.startTime)) saida.tempoAteMapaMs = marca.startTime;
                    }
                }
            } catch {
                // Uma leitura que falha devolve o que já tinha, nunca zeros.
            }
            return saida;
        },

        /** Solta os observadores. Existe para o teste e para o HMR. */
        desinstalar() {
            observando = false;
            documento?.removeEventListener?.('visibilitychange', aoOcultar);
            documento?.removeEventListener?.('pointerdown', aoInteragir, true);
            documento?.removeEventListener?.('keydown', aoInteragir, true);
            for (const obs of observadores.splice(0)) {
                try {
                    obs.disconnect?.();
                } catch {
                    // Observador já morto: não há o que soltar.
                }
            }
        },
    };

    function aoInteragir() { fecharLcp(); }
    function aoOcultar() { if (documento?.visibilityState === 'hidden') fecharLcp(); }
}

/**
 * As vitais desta página. Mesmo objeto em toda chamada.
 *
 * Ele NÃO observa nada no tempo de import: `observar()` é chamado pela fiação da telemetria de
 * uso, no boot de cada página. Um efeito colateral aqui rodaria em toda suíte que tocasse este
 * arquivo por transitividade.
 */
export const vitais = criarVitais({});
