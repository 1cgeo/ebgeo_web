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
 * A GUARDA DE REENTRÂNCIA É DE MÓDULO, e não de chamador, e essa é a parte que só aparece
 * quando existem duas portas: com uma bandeira por chamador, tocar o botão enquanto o Ctrl+Z
 * ainda roda dispara os dois, e o segundo desfaz o que o primeiro acabou de desfazer, sem que
 * nada na tela explique o salto de dois passos.
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

/** Uma operação por vez, qualquer que seja a porta. Ver o `@fileoverview`. */
let emVoo = false;

/**
 * Desfaz ou refaz, com a regra inteira.
 *
 * @param {'undo'|'redo'} direcao
 * @param {Object} deps
 * @param {Object} deps.selectionManager
 * @param {Object} [deps.baseLayerControl] - Ausente, a reconstrução do mapa base é pulada.
 * @returns {Promise<boolean>} Se algo foi de fato desfeito ou refeito.
 */
export async function runUndoRedo(direcao, { selectionManager, baseLayerControl } = {}) {
    // O GATE PRIMEIRO, e em silêncio: quem não pode escrever não recebe aviso de "nada para
    // desfazer", que seria falso, nem de "desfeito", que seria pior. A recusa por posto se
    // resolve ANTES, no desenho do comando.
    if (semEdicaoSync() || emVoo) return false;

    emVoo = true;
    try {
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
    } finally {
        emVoo = false;
    }
}
