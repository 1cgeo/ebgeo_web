// Path: js/session/email-verification-phrases.js

/**
 * @fileoverview O QUE DIZER quando alguém abre um link de confirmação de e-mail.
 *
 * ZERO IMPORTS, como as irmãs deste diretório: ela é consumida do boot do mapa, que precisa
 * decidir a frase antes de a store existir.
 *
 * ================= O DEFEITO QUE ELA FECHA =====================================
 *
 * O boot tinha `catch {` sem parâmetro e UMA frase de erro, que CHUTAVA a causa: "Não foi possível
 * confirmar o e-mail. O link pode ter expirado." O servidor distingue quatro recusas (link
 * inválido, link expirado, endereço já tomado por outra conta, conta desativada), e as quatro
 * chegavam como a mesma frase, três delas errada. "Pode ter expirado" é pior do que não dizer
 * nada: quem lê espera um link novo resolver, e para três das quatro causas nenhum link novo
 * resolve.
 *
 * O SUCESSO TAMBÉM MENTIA, e é o caso mais fácil de esquecer. A frase única era "E-mail
 * confirmado! Faça login para entrar", e o mesmo link serve à TROCA de endereço, feita por quem já
 * está logado: mandar essa pessoa fazer login é mandá-la desfazer o que ela acabou de fazer. O
 * servidor devolve o `purpose` justamente para isso, e o cliente jogava o retorno fora.
 *
 * ================= POR QUE POR CÓDIGO, E NÃO POR MENSAGEM ======================
 *
 * O servidor já manda uma frase em português em cada recusa, e seria tentador exibi-la. Isso
 * acopla a tela ao texto do servidor: qualquer ajuste de redação lá vira mudança de UI aqui, sem
 * teste que perceba, e uma recusa nova aparece na tela com vocabulário de API. O código é o
 * contrato estável; a frase é desta camada.
 *
 * O RAMO PADRÃO NÃO CHUTA. Código desconhecido (uma recusa que este build não conhece, uma falha
 * de rede que nem chegou ao servidor) recebe uma frase que diz que não deu certo e o que tentar,
 * sem nomear causa. Era exatamente o ramo padrão que produzia a mentira original.
 */

/** O desfecho, como um par de frase e tom, no formato que o toast consome. */

/**
 * Frases de RECUSA, por código do servidor (`AppError.code`).
 *
 * `EMAIL_TAKEN` e `ACCOUNT_INACTIVE` só ocorrem no propósito de TROCA de endereço, e as duas
 * dizem o que aconteceu com a conta, que é a pergunta seguinte de quem lê: no primeiro caso o
 * endereço antigo continua valendo, e dizer isso evita a impressão de que a conta ficou sem
 * endereço nenhum.
 * @type {Object<string, string>}
 */
const RECUSA = Object.freeze({
    EMAIL_TOKEN_EXPIRED: 'Este link de confirmação expirou. Peça um novo na tela de entrada.',
    EMAIL_TOKEN_INVALID: 'Este link de confirmação não é válido, ou já foi usado.',
    EMAIL_TAKEN: 'Este endereço de e-mail já está em uso por outra conta. A sua continua com o '
        + 'endereço anterior.',
    ACCOUNT_INACTIVE: 'Esta conta não está mais ativa. Procure o administrador do EBGeo.'
});

/** O que dizer quando a recusa não traz código conhecido. NÃO nomeia causa. */
export const CONFIRMACAO_INDEFINIDA = 'Não foi possível confirmar o e-mail agora. Abra o link de '
    + 'novo, ou peça um novo na tela de entrada.';

/**
 * Sucesso, por propósito do token. `change_email` é a razão de esta função existir: a frase de
 * cadastro manda fazer login, e quem troca o próprio endereço já está logado.
 * @type {Object<string, string>}
 */
const SUCESSO = Object.freeze({
    verify: 'E-mail confirmado! Faça login para entrar.',
    change_email: 'Pronto: o e-mail da sua conta foi alterado e confirmado.'
});

/** Sucesso sem propósito reconhecido: confirma sem instruir o próximo passo, que não se sabe. */
export const SUCESSO_INDEFINIDO = 'E-mail confirmado.';

/**
 * A frase e o tom para um desfecho de confirmação de e-mail.
 *
 * @param {Object} desfecho
 * @param {boolean} desfecho.ok - A rota respondeu com sucesso?
 * @param {string|null} [desfecho.purpose] - `data.purpose` do sucesso (`verify`/`change_email`).
 * @param {string|null} [desfecho.code] - `error.code` da recusa.
 * @returns {{message: string, tone: 'success'|'error'}}
 */
export function emailVerificationNotice({ ok, purpose = null, code = null } = {}) {
    if (ok) {
        const message = (typeof purpose === 'string' && SUCESSO[purpose]) || SUCESSO_INDEFINIDO;
        return { message, tone: 'success' };
    }
    const message = (typeof code === 'string' && RECUSA[code]) || CONFIRMACAO_INDEFINIDA;
    return { message, tone: 'error' };
}

/**
 * Os códigos de recusa que têm frase própria. Exportado para o teste poder afirmar cobertura
 * contra a lista real do servidor, em vez de contra uma lista escrita no próprio teste.
 * @returns {string[]}
 */
export function codigosComFrase() {
    return Object.keys(RECUSA);
}
