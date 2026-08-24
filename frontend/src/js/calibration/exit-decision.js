// Path: js/calibration/exit-decision.js

/**
 * @fileoverview O que fazer com calibração não salva quando a tela vai embora.
 *
 * ZERO IMPORTS, e isso é contrato, não estilo. O módulo é lido por dois lados que não se
 * encontram: a página de calibração (`calibracao-page.js`, que boota sem `initServices()`) e o
 * MAPA (`index.js`), que precisa da FRASE para explicar o que aconteceu depois do `replace`.
 * Qualquer import aqui arrastaria um dos dois grafos para dentro do outro.
 *
 * POR QUE A DECISÃO É PURA E MORA FORA DAS TELAS. Havia três saídas da calibração e cada uma
 * decidia sozinha o que fazer com trabalho sujo: `navigateToPhoto` perguntava, o `beforeunload`
 * bloqueava, e as outras duas (o botão "← Projetos" e o fim de sessão) descartavam em silêncio.
 * Três implementações da mesma pergunta é como duas delas ficam erradas. Aqui a pergunta é uma
 * função, e as telas só obedecem.
 *
 * A DISTINÇÃO QUE DECIDE TUDO É "TEM ALGUÉM NO TECLADO", não a gravidade da perda. Perguntar a
 * quem já saiu não é cuidado, é um diálogo que ninguém lê e que atrasa uma navegação que já
 * aconteceu:
 *
 *   - saída VOLUNTÁRIA (clicar "← Projetos", clicar "Sair agora"): a pessoa está ali, o gesto é
 *     dela, e ela pode salvar. PERGUNTAR.
 *   - saída INVOLUNTÁRIA (expiração por inatividade, sessão encerrada pelo servidor, papel
 *     perdido): não há ninguém para responder. O que se pode fazer é não mentir depois, então a
 *     saída carrega o fato e a tela seguinte o diz. AVISAR.
 *
 * O AVISO VIAJA COMO PARÂMETRO E NÃO COMO TOAST, pela mesma razão que o desfecho do resgate de
 * trabalho não enviado viaja assim: quem sai chama `window.location.replace`, e um toast levantado
 * um instante antes morre com o documento. O parâmetro é próprio (`?calibracao=`) e NÃO se mistura
 * com `?trabalho=`, que carrega o vocabulário de `ExitOutcome` (fila de sync). São duas perdas
 * diferentes, de dois subsistemas diferentes, e colapsá-las num parâmetro só produziria a frase
 * errada para uma das duas.
 */

/** O que a tela deve fazer antes de ir embora. */
export const CalibrationExit = Object.freeze({
    /** Há trabalho sujo e alguém para responder: abra o diálogo de salvar/descartar. */
    PERGUNTAR: 'perguntar',
    /** Há trabalho sujo e ninguém para responder: siga, e diga na tela seguinte. */
    AVISAR: 'avisar',
    /** Nada a perder: siga em silêncio. */
    SEGUIR: 'seguir',
});

/**
 * Os valores de `?calibracao=`, o parâmetro com que a página de calibração se explica no MAPA.
 *
 * Os três dizem coisas diferentes e por isso são três, e não um 'erro': perder alinhamento é
 * uma perda, e ser recusado na porta não é perda nenhuma. Colapsá-los faria a tela lamentar um
 * trabalho que ninguém tinha feito, ou calar sobre um que se perdeu.
 */
export const CalibrationExitParam = Object.freeze({
    /** A sessão terminou com alinhamento editado e não gravado. */
    NAO_SALVA: 'nao-salva',
    /** A pessoa está numa conta que não calibra (nem `admin` global, nem `producer`). */
    SEM_PAPEL: 'sem-papel',
    /** Ninguém está logado: a página exige sessão e não tem como pedir uma. */
    SEM_SESSAO: 'sem-sessao',
});

/** Atalho histórico do valor de perda. Mantido porque é o mais citado. */
export const CALIBRATION_LOST_PARAM = CalibrationExitParam.NAO_SALVA;

/**
 * Decide o que fazer com a calibração aberta quando a tela vai embora.
 *
 * FALHA PARA O LADO DE PERGUNTAR quando a vontade é desconhecida: `voluntary` ausente é tratado
 * como voluntário. Perguntar a quem não queria sair custa um clique; não perguntar a quem queria
 * ficar custa o trabalho, e a assimetria decide o default.
 *
 * @param {Object} [entrada]
 * @param {boolean} [entrada.dirty] - Se há edição de calibração não gravada (`isDirty()`).
 * @param {boolean} [entrada.voluntary] - Se a saída partiu de um gesto de quem está na tela.
 * @returns {string} Um valor de {@link CalibrationExit}.
 */
export function calibrationExitDecision({ dirty = false, voluntary = true } = {}) {
    if (dirty !== true) return CalibrationExit.SEGUIR;
    return voluntary === false ? CalibrationExit.AVISAR : CalibrationExit.PERGUNTAR;
}

/**
 * A frase que o MAPA mostra quando a calibração foi perdida por saída involuntária.
 *
 * NÃO PROMETE RECUPERAÇÃO, porque não há: o alinhamento vivia só na memória da outra página. Ela
 * diz o que se perdeu e o que fazer da próxima vez, que é o máximo honesto neste ponto. E nomeia o
 * ALINHAMENTO, não "alterações", porque é o que o operador reconhece como o trabalho dele.
 *
 * @param {string|null} [valor] - O valor cru de `?calibracao=`.
 * @returns {{message: string, tone: string}|null} Nulo quando o parâmetro não é o esperado, para
 *   que uma URL montada à mão não gere aviso de perda que não houve.
 */
export function calibrationExitNotice(valor) {
    if (valor === CalibrationExitParam.NAO_SALVA) {
        return {
            message: 'A sessão terminou com alinhamento de calibração não salvo, e ele não pôde '
                + 'ser gravado. Ao voltar à calibração, salve antes de deixar a tela parada.',
            tone: 'warning',
        };
    }
    if (valor === CalibrationExitParam.SEM_PAPEL) {
        return {
            // NOMEIA OS DOIS PAPÉIS QUE CALIBRAM, porque a recusa anterior não nomeava nenhum e
            // a pessoa não tinha o que pedir. E não manda recarregar: recarregar não muda papel.
            message: 'A calibração 360 é de quem administra o sistema ou produz para uma OM. '
                + 'Sua conta não tem nenhum dos dois; peça o papel a um administrador.',
            tone: 'warning',
        };
    }
    if (valor === CalibrationExitParam.SEM_SESSAO) {
        return {
            message: 'A calibração 360 exige entrar na conta. Entre e abra o mesmo endereço de '
                + 'novo: a foto que você pediu continua guardada para esta aba.',
            tone: 'info',
        };
    }
    return null;
}
