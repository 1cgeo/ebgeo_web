// Path: js/map/undo-redo.runner.js

/**
 * @fileoverview DESFAZER E REFAZER, NUM LUGAR SÓ, porque agora há duas portas.
 *
 * ATÉ 2026-09-20 A ÚNICA PORTA ERA O TECLADO (Ctrl+Z e Ctrl+Y), o que num tablet significa
 * que não havia porta nenhuma: não há teclado físico, e o virtual só sobe sobre um campo de
 * texto. Desfazer um traço errado exigia apagar a feição à mão, se ela ainda fosse
 * alcançável. A barra de ferramentas ganhou os dois botões, e a regra que o atalho carregava
 * mudou de casa para cá em vez de ser copiada.
 *
 * O QUE ESTA REGRA TEM, e é por isso que ela não pode viver em duas cópias:
 *   - o GATE DE ESCRITA (`semEdicaoSync`), porque desfazer ESCREVE. Quem está em somente
 *     leitura via o aviso do que "foi desfeito" enquanto nada mudava no servidor;
 *   - a DESSELEÇÃO com `skipSave`, porque salvar antes criaria uma entrada fantasma de
 *     desfazer justo antes do desfazer de verdade;
 *   - o RETORNO, que distingue "desfiz isto" de "não havia o que desfazer", e sem o qual o
 *     botão fica mudo nos dois desfechos;
 *   - a RECONSTRUÇÃO do mapa base depois da mudança.
 *
 * A FILA É DE MÓDULO, e não de chamador, e essa é a parte que só aparece quando existem duas
 * portas: com uma por chamador, tocar o botão enquanto o Ctrl+Z ainda roda dispararia os dois
 * JUNTOS, sobre a mesma pilha e o mesmo redesenho.
 *
 * O SEGUNDO PEDIDO ESPERA A VEZ, e não é mais descartado (decisão do dono de 2026-09-26). Até
 * então a guarda era uma bandeira que devolvia falso a quem chegasse com outro em curso, e ela
 * engolia também o segundo Ctrl+Z de quem aperta duas vezes: a janela era de 3 a 5 ms num mapa
 * pequeno e cresce com o redesenho do mapa base num mapa pesado, e a pessoa via um passo desfeito
 * onde pediu dois. Agora cada pedido roda depois de o anterior terminar, redesenho incluído, e o
 * gate de escrita é perguntado na VEZ dele, porque a trava pode chegar durante a espera. O que
 * continua filtrado é o duplo disparo de um MESMO gesto, e a plataforma é quem diz qual é: a
 * autorrepetição da tecla segurada (`KeyboardEvent.repeat`) não entra com a fila ocupada. O
 * botão não tem duplo disparo (um `click` só), e dois toques nele são dois pedidos.
 *
 * AS DEPENDÊNCIAS CHEGAM POR ARGUMENTO, nunca pelo registro de controles daqui: o teclado já
 * as tem em mãos, e a barra as resolve preguiçosamente, como já faz para compartilhar a vista.
 * Um `getControl` dentro deste módulo o amarraria ao registro e o tiraria do alcance de um
 * teste em node.
 */

import { undoLastAction, redoLastAction } from '@store';
import { semEdicaoSync } from '@store/edicao-indisponivel.js';
import { showInChannel } from '@utils/toast_service.js';
import { describeUndoRedoAction } from '@store/undo-redo-messages.js';

/** O fim do último pedido aceito, qualquer que seja a porta. Ver o `@fileoverview`. */
let fila = Promise.resolve();

/** Pedidos aceitos e ainda não terminados, em curso ou esperando a vez. */
let pendentes = 0;

/**
 * Desfaz ou refaz, com a regra inteira.
 *
 * @param {'undo'|'redo'} direcao
 * @param {Object} deps
 * @param {Object} deps.selectionManager
 * @param {Object} [deps.baseLayerControl] - Ausente, a reconstrução do mapa base é pulada.
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.repeticao] - O pedido é a autorrepetição de uma tecla segurada: com
 *   outro pedido na fila ele é o mesmo gesto, e não entra.
 * @returns {Promise<boolean>} Se algo foi de fato desfeito ou refeito.
 */
export function runUndoRedo(direcao, deps = {}, { repeticao = false } = {}) {
    // O GATE PRIMEIRO, e em silêncio: quem não pode escrever não recebe aviso de "nada para
    // desfazer", que seria falso, nem de "desfeito", que seria pior. A recusa por posto se
    // resolve ANTES, no desenho do comando.
    if (semEdicaoSync() || (repeticao && pendentes > 0)) return Promise.resolve(false);

    pendentes += 1;
    const vez = fila.then(() => executar(direcao, deps));
    // A fila segue pelo FIM do pedido, não pelo resultado: um que falha não trava os seguintes.
    fila = vez.catch(() => {}).finally(() => { pendentes -= 1; });
    return vez;
}

/**
 * Um pedido, na vez dele.
 * @param {'undo'|'redo'} direcao
 * @param {Object} deps - Ver {@link runUndoRedo}.
 * @returns {Promise<boolean>}
 */
async function executar(direcao, { selectionManager, baseLayerControl } = {}) {
    // DE NOVO NA VEZ: a trava ou o rebaixamento podem ter chegado enquanto o pedido esperava.
    if (semEdicaoSync()) return false;

    selectionManager?.deselectAllFeatures?.({ skipSave: true });
    const acao = direcao === 'undo' ? await undoLastAction() : await redoLastAction();
    // NULL IS A REFUSAL (a client lock holds a feature of the entry), and it has already been
    // said: "Nada para desfazer" over it would be false, the entry is still there.
    if (acao === null) return false;
    if (!acao) {
        showInChannel(
            'undo-redo',
            direcao === 'undo' ? 'Nada para desfazer' : 'Nada para refazer',
            'info',
            { duration: 1500 },
        );
        return false;
    }
    showInChannel('undo-redo', describeUndoRedoAction(acao, direcao), 'info', { duration: 1500 });
    await baseLayerControl?.switchMap?.(false);
    return true;
}
