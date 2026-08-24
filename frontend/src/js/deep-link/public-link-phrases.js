// Path: js/deep-link/public-link-phrases.js

/**
 * @fileoverview O QUE SE DIZ quando um link público (`?atlasPublico=`) não abre, por classe de
 * falha, e SE aquele link deve sair da barra de endereços.
 *
 * O DEFEITO, medido em 2026-08-23: o ramo de falha de `openPublicAtlasFromUrl` era
 * `console.warn` mais `retractAtlasClaim()` mais `return false`. A cadeia de boot seguia e o
 * visitante caía num mapa local genérico, sem uma palavra. Quatro situações distintas (link
 * revogado, link expirado, link digitado errado, atlas excluído) colapsavam na mesma tela muda,
 * e o F5 repetia o silêncio. Isto é o funil de aquisição inteiro do produto: alguém compartilha
 * um mapa, a outra pessoa clica.
 *
 * AS QUATRO SITUAÇÕES CONTINUAM COLAPSADAS, E ISSO É A DECISÃO, NÃO O DEFEITO. O servidor
 * responde 404 para todas elas (`getAtlasByPublicLink` lança `NotFoundError` quando a consulta
 * não devolve linha), e a cláusula 5.6 da constituição trata "não encontrado" contra "proibido"
 * como decisão anti-enumeração. Distinguir aqui no cliente reintroduziria, um degrau acima, o
 * oráculo que o servidor fecha: quem varresse links saberia quais tokens já existiram. Então a
 * frase NOMEIA AS POSSIBILIDADES SEM AFIRMAR QUAL, que é a forma de ser útil sem confirmar
 * existência. O que ela não pode fazer é dizer "este atlas foi excluído" (afirma que existiu)
 * nem "este atlas não existe" (afirma que nunca existiu, e é mentira no caso revogado).
 *
 * POR ISSO 401/403 CAEM NA MESMA FRASE DO 404. A rota é anônima e sem gate de permissão, então
 * esses status não deveriam sair dela; se saírem, tê-los com frase PRÓPRIA seria construir no
 * cliente exatamente o canal de diferença que a 5.6 fecha no servidor. Colapsar custa uma frase
 * menos precisa num caso que não acontece, e fechar o canal vale mais.
 *
 * O 429 NÃO COLAPSA, e não é exceção à regra acima: ele fala de QUEM PEDE (este computador fez
 * pedidos demais), não do atlas. Não há nada a enumerar numa frase sobre o próprio requisitante,
 * e trocá-la pela frase de link morto mandaria alguém jogar fora um link bom.
 */

import { RequestFailure } from '@utils/request-failure.js';

/**
 * A frase do link que o servidor recusou. Uma só para todas as recusas de 4xx (menos o 429),
 * pelo motivo anti-enumeração do cabeçalho.
 *
 * Ela termina numa AÇÃO, e a ação é pedir outro link em vez de tentar de novo: repetir um 404 é
 * o único desfecho que com certeza não muda, e mandar tentar de novo ali gastaria a credibilidade
 * das outras frases, que mandam tentar de novo porque ali adianta.
 * @type {string}
 */
const LINK_RECUSADO = 'Este link de visualização não abre nenhum atlas. Ele pode ter sido '
    + 'revogado, ter expirado ou estar incompleto. Peça um link novo a quem compartilhou.';

/**
 * AS CLASSES EM QUE O PRÓPRIO SERVIDOR RECUSOU O LINK.
 *
 * É um predicado e não duas listas porque ele decide DUAS coisas que não podem discordar: a
 * frase de beco sem saída e o descarte do parâmetro da URL. Escritas separadas, uma frase que
 * manda pedir outro link conviveria com uma URL que o F5 volta a tentar, e o usuário leria a
 * contradição como tela quebrada.
 * @param {string} kind
 * @returns {boolean}
 */
function serverRefusedLink(kind) {
    return kind === RequestFailure.MISSING || kind === RequestFailure.CREDENTIAL;
}

/**
 * O que dizer sobre um link público que não abriu.
 *
 * @param {string} kind - um valor de {@link RequestFailure}.
 * @returns {{message: string, tone: string}} `tone` é a severidade do toast ('error' para um
 *   beco sem saída, 'warning' para o que um recarregamento pode resolver).
 */
export function publicLinkFailureNotice(kind) {
    if (serverRefusedLink(kind)) {
        return { message: LINK_RECUSADO, tone: 'error' };
    }
    if (kind === RequestFailure.RATE_LIMITED) {
        return {
            message: 'Houve tentativas demais de abrir links de visualização a partir deste '
                + 'computador. Espere um instante e recarregue a página.',
            tone: 'warning',
        };
    }
    if (kind === RequestFailure.SERVER) {
        return {
            // Diz que o LINK pode estar bom, porque a pessoa acabou de receber a frase oposta de
            // um servidor caído e não tem como saber que os dois casos são diferentes.
            message: 'O servidor falhou ao abrir este link de visualização. O link pode estar '
                + 'correto: tente novamente em instantes.',
            tone: 'warning',
        };
    }
    if (kind === RequestFailure.NETWORK) {
        return {
            message: 'Não foi possível falar com o servidor para abrir este link de visualização. '
                + 'Verifique sua conexão e tente novamente.',
            tone: 'warning',
        };
    }
    // UNKNOWN: um status que ninguém previu não autoriza declarar o link morto, que é a
    // afirmação cara e irreversível deste conjunto. Fica no genérico que manda tentar de novo.
    return {
        message: 'Não foi possível abrir este link de visualização agora. Tente novamente em instantes.',
        tone: 'warning',
    };
}

/**
 * SE o `?atlasPublico=` deve sair da barra de endereços depois desta falha.
 *
 * `buildAtlasSearch` (`deep-link/atlas-link.js`) PRESERVA `atlasPublico` de propósito em todo
 * `clearAtlasUrl`, para que um visitante anônimo não perca o link compartilhável num
 * disconnect. Esta função é a exceção estreita a isso, e ela é estreita por medida: só a recusa
 * do próprio servidor prova que o link está morto.
 *
 * Nas outras classes o link pode estar perfeitamente bom, e o F5 é a tentativa natural de quem
 * leva "tente novamente": tirá-lo da URL ali destruiria um link válido por causa de um piscar de
 * rede, que é a mesma direção de erro do defeito da credencial.
 *
 * O que se perde ao tirar é o TEXTO do link da barra de endereços, e é uma perda de verdade:
 * quem quisesse mandá-lo de volta a quem compartilhou para conferir precisa do histórico. Foi
 * comprado em troca de três coisas: o F5 deixa de repetir um pedido que com certeza falha (e de
 * alimentar o limitador da rota), a frase não se repete a cada recarregamento, e ninguém
 * re-compartilha, da própria barra, um link que o servidor já recusou.
 *
 * @param {string} kind - um valor de {@link RequestFailure}.
 * @returns {boolean}
 */
export function shouldForgetPublicLink(kind) {
    return serverRefusedLink(kind);
}
