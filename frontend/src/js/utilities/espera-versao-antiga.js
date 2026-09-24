// Path: js/utilities/espera-versao-antiga.js

/**
 * @fileoverview A JANELA DA VERSÃO ANTIGA É ESPERA, NÃO FALHA (diretriz de resiliência da virada,
 * 2026-09-23, para o dono confirmar).
 *
 * Quem tinha o EBGeo antigo aberto durante a troca de versão chega à nova com uma aba velha ainda
 * viva, e é o caso mais comum da virada. Até esta data o portão de migração tratava isso como
 * FALHA: desenhava a tela de duas saídas, cujos comandos são baixar os dados ou APAGÁ-LOS, e a
 * saída certa (fechar a janela velha e recarregar) não tinha botão. Medido no navegador com o
 * build real da `main` numa aba e o desta linha na outra, 2 de 2.
 *
 * Agora o portão ESPERA: pergunta de novo, a intervalos curtos, se ainda há uma aba da versão
 * antiga respondendo, e segue sozinho quando ela some. A pergunta é a mesma que já detectava a aba
 * (`legacyPeerDetected` de `tab-lock.js`, que vê o PONG sem versão do protocolo da `main`), feita
 * por uma sonda nova a cada volta, porque a marca da sonda é permanente e o sumiço só se mede
 * perguntando de novo.
 *
 * O QUE CONTA COMO "SUMIU": {@link AUSENCIAS_PARA_SEGUIR} sondas seguidas sem resposta. Uma só não
 * basta, porque uma aba ocupada (desenhando um mapa pesado) pode perder a janela de uma sonda e
 * responder na seguinte. A aba da `main` só responde enquanto está ATIVA, então a aba antiga que
 * ela mesma bloqueou ("Usar aqui" em outra) e a que o navegador CONGELOU em segundo plano contam
 * como ausentes: ninguém fica preso para sempre, e o que uma aba congelada gravar quando voltar é
 * a alteração tardia que a transição já sabe incorporar ou resgatar.
 *
 * Sem `BroadcastChannel` a sonda nunca vê a aba antiga, e a espera termina na primeira volta, que
 * é o comportamento de antes desta mudança nesse regime.
 */

import { createTabLock, noneKey } from './tab-lock.js';

/** Quanto cada sonda escuta antes de concluir que ninguém respondeu, em ms. */
export const JANELA_DA_SONDA_MS = 600;

/** Intervalo entre duas sondas, em ms. */
export const INTERVALO_DA_ESPERA_MS = 1000;

/** Sondas seguidas sem resposta para a espera acabar. Ver o cabeçalho. */
export const AUSENCIAS_PARA_SEGUIR = 2;

/**
 * Pergunta UMA vez se há uma aba da versão antiga ativa.
 * @param {{janelaMs?: number, criarSonda?: Function}} [opcoes] - `criarSonda` é injetável para teste.
 * @returns {Promise<boolean>}
 */
export async function aVersaoAntigaResponde({ janelaMs = JANELA_DA_SONDA_MS, criarSonda = createTabLock } = {}) {
    const sonda = criarSonda({ key: noneKey(), overlayHost: null, autoPulse: false });
    try {
        await sonda.acquire(noneKey(), { settleMs: janelaMs });
        return sonda.legacyPeerDetected === true;
    } finally {
        sonda.destroy();
    }
}

/**
 * Resolve quando nenhuma aba da versão antiga responde mais. Não tem prazo, de propósito: o que
 * a pessoa vê enquanto isso é uma tela sem comando destrutivo, e o que a solta é fechar a janela.
 * @param {Object} [opcoes]
 * @param {() => Promise<boolean>} [opcoes.sondar]
 * @param {(ms: number) => Promise<void>} [opcoes.dormir]
 * @param {number} [opcoes.intervaloMs]
 * @param {number} [opcoes.ausencias]
 * @returns {Promise<{sondas: number}>} Quantas sondas foram feitas, para o relato.
 */
export async function esperarAVersaoAntigaFechar({
    sondar = aVersaoAntigaResponde,
    dormir = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    intervaloMs = INTERVALO_DA_ESPERA_MS,
    ausencias = AUSENCIAS_PARA_SEGUIR,
} = {}) {
    let seguidas = 0;
    let sondas = 0;
    for (;;) {
        sondas += 1;
        seguidas = (await sondar()) ? 0 : seguidas + 1;
        if (seguidas >= ausencias) return { sondas };
        await dormir(intervaloMs);
    }
}
