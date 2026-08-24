// Path: js/session/session-restore-phrases.js

/**
 * @fileoverview O QUE SE DIZ quando a restauração da sessão falha no boot, por classe de falha.
 *
 * A frase existe por causa de uma distinção que a tela apagava: "você saiu" e "não consegui
 * perguntar quem é você" produziam a MESMA página deslogada, e a diferença é toda. A segunda é
 * temporária e a credencial continua no disco; a primeira não. Enquanto as duas eram mudas e
 * iguais, o usuário lia a segunda como a primeira e ia digitar a senha de novo, que é
 * exatamente o gesto que ele pode não conseguir fazer (não há redefinição de senha por conta
 * própria neste produto).
 *
 * A METADE QUE MAIS IMPORTA DA FRASE É "sua conta continua ativa". Sem ela, dizer que houve uma
 * falha ainda deixa a pessoa achando que precisa entrar de novo, e ela é a única coisa que a
 * tela sabe e o usuário não: os tokens NÃO foram apagados.
 *
 * O único import é o vocabulário de classes, de um módulo folha: esta frase é consumida por
 * `atlas.html`, que boota sem a store.
 *
 * O `tone` sai daqui, e não do chamador, porque ele é parte da afirmação: um dead end
 * (credencial morta) e um "tente de novo" não podem ter a mesma cor, e escolher a cor no ponto
 * de uso é como duas telas passam a discordar sobre a gravidade do mesmo fato.
 */

import { RequestFailure } from '@utils/request-failure.js';

/**
 * A ressalva comum a toda falha que NÃO é de credencial. Escrita uma vez porque as quatro
 * classes transitórias dizem a mesma coisa sobre a conta, e quatro cópias divergem na primeira
 * revisão.
 * @type {string}
 */
const CONTA_INTACTA = 'Sua conta continua ativa e nada foi apagado: recarregue a página para '
    + 'tentar de novo.';

/**
 * O que dizer sobre uma restauração de sessão que falhou.
 *
 * @param {string} kind - um valor de {@link RequestFailure}.
 * @returns {{message: string, tone: string}} `tone` é a severidade do toast ('warning' ou 'error').
 */
export function sessionRestoreNotice(kind) {
    if (kind === RequestFailure.CREDENTIAL) {
        return {
            // O único ramo em que a sessão de fato terminou, e o único que manda entrar de novo.
            // Não diz "expirou": desde o corte de sessão do servidor (`users.sessions_valid_from`)
            // ela também pode ter sido ENCERRADA de propósito (troca de senha, reset por
            // administrador, reuso de refresh token detectado), e chamar isso de expiração é a
            // coisa errada de ler logo depois de alguém ter mexido na conta.
            message: 'Sua sessão terminou. Entre novamente para ver os atlas do servidor.',
            tone: 'warning',
        };
    }
    if (kind === RequestFailure.NETWORK) {
        return {
            message: `Não foi possível confirmar sua sessão: o servidor não respondeu. ${CONTA_INTACTA}`,
            tone: 'warning',
        };
    }
    if (kind === RequestFailure.SERVER) {
        return {
            message: `Não foi possível confirmar sua sessão: o servidor falhou ao responder. ${CONTA_INTACTA}`,
            tone: 'warning',
        };
    }
    if (kind === RequestFailure.RATE_LIMITED) {
        return {
            // O 429 é o único ramo que pede ESPERA antes do recarregamento, e dizer isso importa:
            // recarregar na hora recarrega o limitador junto.
            message: 'Não foi possível confirmar sua sessão: houve pedidos demais em pouco tempo. '
                + 'Sua conta continua ativa e nada foi apagado: espere um instante e recarregue a página.',
            tone: 'warning',
        };
    }
    // MISSING e UNKNOWN caem aqui, e o ramo é deliberadamente vago: um 404 no `/auth/me` ou um
    // status que ninguém previu não autorizam afirmar nem que a sessão acabou nem qual foi o
    // problema. O que a frase pode afirmar com certeza é que a credencial continua no disco.
    return {
        message: `Não foi possível confirmar sua sessão agora. ${CONTA_INTACTA}`,
        tone: 'warning',
    };
}
