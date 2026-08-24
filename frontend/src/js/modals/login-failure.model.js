// Path: js/modals/login-failure.model.js

/**
 * @fileoverview O QUE ESCREVER NO CAMPO DE ERRO DO LOGIN, por classe de falha.
 *
 * UM IMPORT SÓ, e ele é a folha `@utils/request-failure.js`. Manter esta camada separada do modal
 * é o que a torna testável em node: o modal monta DOM no import.
 *
 * ================= O DEFEITO QUE ELE FECHA ===================================
 *
 * O modal fazia `error?.message || 'Falha ao entrar. Tente novamente.'`, e as duas metades disso
 * falham no mesmo lugar. `buildApiErrorMessage` (`store/sync/api-client.js`) cai no código HTTP
 * cru quando o corpo não traz mensagem, e o erro de rede do navegador nem passa por lá: quem
 * derrubasse o backend lia **"HTTP 502"** ou **"Failed to fetch"**, em inglês, logo abaixo de um
 * campo de senha. No contexto, isso lê como "errei a senha", que é a conclusão mais cara possível:
 * a pessoa tenta de novo, erra de novo, e passa a duvidar da própria credencial.
 *
 * ================= A REGRA ===================================================
 *
 * A recusa do SERVIDOR sobre a identidade continua vindo do servidor, palavra por palavra: senha
 * inválida, conta desativada, e-mail não confirmado e OM inativa já são distinguíveis e já estão
 * escritas em português, e reescrevê-las aqui criaria uma segunda fonte que envelhece.
 *
 * O que ganha frase local é a falha que NÃO é sobre a identidade de quem pede. `CREDENTIAL` é
 * justamente a classe que o servidor respondeu por si mesmo, então ela cai na mensagem dele; todas
 * as outras (rede, 5xx, 429, e o status que ninguém classificou) recebem uma frase que diz que o
 * problema não é a senha. Essa é a informação que faltava.
 */

import { classifyRequestFailure, RequestFailure } from '@utils/request-failure.js';

/** Frases por classe de falha que NÃO é o servidor respondendo sobre a identidade de quem pede. */
const POR_CLASSE = Object.freeze({
    [RequestFailure.NETWORK]: 'Não foi possível falar com o servidor. Verifique sua conexão e '
        + 'tente de novo; sua senha não está em questão.',
    [RequestFailure.SERVER]: 'O servidor teve um problema ao responder. Tente de novo em '
        + 'instantes; sua senha não está em questão.',
    [RequestFailure.RATE_LIMITED]: 'Muitas tentativas em pouco tempo. Espere alguns minutos antes '
        + 'de tentar de novo.',
    [RequestFailure.MISSING]: 'O servidor respondeu que este endereço não existe. Avise quem '
        + 'administra o EBGeo.'
});

/** Última linha, quando nem a classe nem o servidor dizem algo utilizável. */
export const FALHA_INDEFINIDA = 'Não foi possível entrar agora. Tente de novo em instantes.';

/**
 * A mensagem para o campo de erro do login.
 *
 * @param {*} error - O erro rejeitado pelo submit (tipicamente um `ApiError`).
 * @returns {string} Sempre uma frase em pt-BR, nunca um código HTTP nem texto do navegador.
 */
export function loginFailureMessage(error) {
    const classe = classifyRequestFailure(error);

    // A recusa sobre a identidade é do servidor, e é ele que a escreve.
    if (classe === RequestFailure.CREDENTIAL) {
        return mensagemDoServidor(error) ?? FALHA_INDEFINIDA;
    }

    const local = POR_CLASSE[classe];
    if (local) return local;

    // `UNKNOWN`: um status que este build não classifica. Se o servidor mandou uma frase legível,
    // ela é melhor que qualquer suposição daqui; senão, a última linha.
    return mensagemDoServidor(error) ?? FALHA_INDEFINIDA;
}

/**
 * A mensagem do servidor, quando ela é utilizável por um humano.
 *
 * RECUSA O ECO DO CÓDIGO HTTP e o texto do `fetch`. Ambos chegam como `error.message` e passariam
 * por qualquer teste de "tem mensagem"; são exatamente as duas strings que o defeito produzia.
 * @param {*} error
 * @returns {string|null}
 */
function mensagemDoServidor(error) {
    const texto = typeof error?.message === 'string' ? error.message.trim() : '';
    if (!texto) return null;
    if (/^HTTP\s+\d{3}\b/i.test(texto)) return null;
    if (/^(Failed to fetch|NetworkError|Load failed|The user aborted a request)/i.test(texto)) {
        return null;
    }
    return texto;
}
