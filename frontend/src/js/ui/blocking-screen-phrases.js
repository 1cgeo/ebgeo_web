// Path: js/ui/blocking-screen-phrases.js

/**
 * @fileoverview O QUE A TELA DE BLOQUEIO DIZ, por CAUSA, como função pura.
 *
 * ZERO IMPORTS: ela é lida pela tela que substitui o app inteiro, inclusive nas páginas que
 * bootam sem a store.
 *
 * ================= O DEFEITO QUE ELA FECHA ===================================
 *
 * `showUnavailableScreen()` não tinha parâmetro nenhum e exportava um símbolo só. Ela nasceu para
 * UMA causa (o `GET /api/config` que não responde, sem o qual não há o que bootar) e virou o
 * catch-all do `catch` de topo das quatro páginas. Uma exceção de JavaScript no meio da montagem
 * do Drive, ou um `undefined` num handler, anunciava "Não foi possível conectar ao servidor.
 * Verifique sua conexão e tente novamente" e mandava a pessoa olhar a rede: o único conselho que
 * não pode ajudar, porque o servidor respondeu.
 *
 * O botão é o mesmo nos dois casos (recarregar), e é por isso que a distinção não é cosmética: no
 * caso de rede recarregar pode resolver, e a pessoa precisa saber que vale tentar de novo depois;
 * no caso de erro do app recarregar quase nunca resolve, e o que serve é dizer que o problema é do
 * programa e não do ambiente dela, para que ela relate em vez de reiniciar o roteador.
 */

/** As causas que a tela de bloqueio sabe distinguir. */
export const BlockingCause = Object.freeze({
    /** `GET /api/config` não respondeu. Sem ele não há o que bootar. */
    SERVER_UNREACHABLE: 'server-unreachable',
    /** Uma exceção não tratada durante a montagem da página. O servidor respondeu. */
    APP_ERROR: 'app-error'
});

/**
 * As frases de cada causa.
 *
 * `SERVER_UNREACHABLE` mantém palavra por palavra o texto que já estava em produção, porque ele
 * está certo para a causa dele e é o que os testes de e2e procuram.
 * @type {Object<string, {title: string, message: string, retryLabel: string}>}
 */
const TELAS = Object.freeze({
    [BlockingCause.SERVER_UNREACHABLE]: {
        title: 'EBGeo indisponível',
        message: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
        retryLabel: 'Tentar novamente'
    },
    [BlockingCause.APP_ERROR]: {
        title: 'O EBGeo encontrou um erro',
        // NÃO manda verificar a conexão, e essa omissão é a correção inteira: o servidor
        // respondeu. Também não promete que recarregar resolve, porque em geral não resolve.
        message: 'Algo deu errado ao abrir esta tela. O servidor respondeu normalmente, então o '
            + 'problema está no programa. Recarregar pode contornar; se voltar a acontecer, avise '
            + 'quem administra o EBGeo.',
        retryLabel: 'Recarregar'
    }
});

/**
 * O conteúdo da tela de bloqueio para uma causa.
 *
 * FALHA NA CAUSA MAIS CONSERVADORA: uma causa desconhecida cai em `APP_ERROR`, e não na de rede.
 * Errar para o lado do erro de aplicação só custa um pedido de ajuda; errar para o lado da rede
 * manda a pessoa depurar a internet dela por um defeito do programa, que é o defeito original.
 * @param {string} [cause] - Um valor de {@link BlockingCause}.
 * @returns {{title: string, message: string, retryLabel: string}}
 */
export function blockingScreenContent(cause) {
    return TELAS[cause] ?? TELAS[BlockingCause.APP_ERROR];
}

/**
 * As causas que têm tela própria. Exportado para o teste afirmar cobertura contra
 * {@link BlockingCause} em vez de contra uma lista escrita no próprio teste.
 * @returns {string[]}
 */
export function causasComTela() {
    return Object.keys(TELAS);
}
