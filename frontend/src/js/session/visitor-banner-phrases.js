// Path: js/session/visitor-banner-phrases.js

/**
 * @fileoverview O QUE A FAIXA DE VISITA PÚBLICA DIZ, e como ela trata o nome do atlas.
 *
 * ZERO IMPORTS por contrato, como os outros módulos de frase da casa: é o que torna a frase
 * testável em node puro, sem DOM, sem MapLibre e sem a store. A faixa que a consome
 * (`session/visitor-banner.js`) vive dentro do mapa; a decisão do que dizer, não.
 *
 * O DEFEITO QUE ELA FECHA (achado A2 da auditoria do visitante deslogado, 2026-08-24): a visita
 * por link público se anunciava UMA vez, num toast de três segundos ao fim de
 * `openPublicAtlasFromUrl` (`js/index.js`). Passados esses três segundos, o único sinal restante
 * era a AUSÊNCIA das barras de ferramenta (classe `is-view-only`), que é indistinguível de "ainda
 * está carregando" e de defeito. Nada na tela dizia que aquele documento é de outra pessoa, que o
 * modo é restrito, nem QUAL atlas está aberto: os três controles que poderiam identificá-lo
 * (`account/atlas-name.control.js`, `account/sync-status.control.js`,
 * `presence/online-users.control.js`) são gateados por `isAuthenticated()`, que é falso para o
 * visitante.
 *
 * TRÊS FATOS, E ELES SÃO TRÊS DE PROPÓSITO. Que a visita é pública (de onde a pessoa veio), QUAL
 * atlas (o que ela está vendo) e que é somente leitura (o que ela pode fazer). Colapsar qualquer
 * par produz a faixa que já existia em forma de toast: verdadeira e inútil.
 *
 * O NOME DO ATLAS É DADO DE USUÁRIO, escrito por outra pessoa, e este módulo NÃO o escapa: quem
 * o desenha usa `textContent`, que é a defesa que não depende de ninguém lembrar de escapar. O
 * que este módulo faz com ele é outra coisa, e são duas: colapsa espaço em branco (um nome com
 * quebra de linha rebentaria a faixa em três linhas) e TRUNCA, porque um nome de 300 caracteres
 * empurraria o botão de saída para fora da tela, e a saída é a única coisa da faixa que a pessoa
 * tem de conseguir alcançar.
 *
 * E ELE FALHA FECHADO NO NOME: nome ausente, vazio, só espaço ou de outro tipo não vira
 * `"undefined"` nem `"null"` na tela, vira uma faixa que simplesmente não nomeia atlas nenhum.
 * Sem nome é melhor que nome errado, porque a faixa existe justamente para ser a coisa em que se
 * confia quando todo o resto da tela está mudo.
 */

/** Comprimento máximo do nome de atlas na faixa. Acima disso, trunca. */
const NOME_MAX = 60;

/** Reticências de truncamento (um caractere, não três pontos). */
const RETICENCIAS = '…';

/**
 * O título quando o nome do atlas não chegou. Não nomeia nada e não finge que sabe.
 * @type {string}
 */
const TITULO_SEM_NOME = 'Visita pública a um atlas compartilhado';

/**
 * A frase do MODO. Ela diz três coisas na ordem em que a pessoa precisa delas: o que ela pode
 * fazer, de quem é o documento, e por que ela está vendo isso sem ter entrado em conta nenhuma.
 * @type {string}
 */
const MENSAGEM = 'Somente leitura. Você está vendo o atlas de outra pessoa por um link '
    + 'compartilhado, sem ter entrado numa conta.';

/**
 * O rótulo da saída.
 *
 * "Sair" sozinho (o esboço aprovado) colide com o vocabulário de CONTA do produto, onde sair é o
 * logout ("Você saiu da conta.", `ENDED_SESSION_MESSAGES` em `js/index.js`). O visitante não tem
 * conta de que sair, e um botão que parecesse oferecer logout a quem nunca entrou é exatamente o
 * tipo de rótulo que faz a pessoa não clicar. "Sair da visita" nomeia o que termina.
 * @type {string}
 */
const ROTULO_SAIDA = 'Sair da visita';

/**
 * A dica da saída, e ela existe para responder a única pergunta cara: "eu perco o link?".
 *
 * NÃO PERDE, e isso é propriedade do código: a saída NAVEGA (empilha uma entrada no histórico),
 * nunca `replace`, e não toca no `?atlasPublico=`. `buildAtlasSearch`
 * (`js/deep-link/atlas-link.js`) preserva esse parâmetro em todo `clearAtlasUrl` justamente para
 * que um visitante anônimo não perca num disconnect a única coisa que ele tem.
 * @type {string}
 */
const DICA_SAIDA = 'Leva você para a tela de atlas. O link desta visita não é apagado: '
    + 'o botão Voltar do navegador traz você de volta a este atlas.';

/**
 * O nome do atlas como a faixa pode desenhá-lo, ou `null` quando não há nome em que confiar.
 *
 * @param {*} atlasName - O `name` cru vindo de `GET /atlas/public/:link`.
 * @returns {string|null} Espaço colapsado e truncado, ou null.
 */
export function visitorAtlasLabel(atlasName) {
    if (typeof atlasName !== 'string') return null;
    // Colapsa TODO branco (quebra de linha e tabulação inclusive) antes de medir: um nome com
    // `\n` mede curto e desenha alto.
    const limpo = atlasName.replace(/\s+/g, ' ').trim();
    if (!limpo) return null;
    if (limpo.length <= NOME_MAX) return limpo;
    return `${limpo.slice(0, NOME_MAX - 1)}${RETICENCIAS}`;
}

/**
 * O texto inteiro da faixa de visita pública.
 *
 * @param {*} [atlasName] - O nome do atlas visitado (pode faltar; ver o cabeçalho).
 * @returns {{title: string, message: string, exitLabel: string, exitHint: string}}
 */
export function visitorBannerNotice(atlasName) {
    const nome = visitorAtlasLabel(atlasName);
    return Object.freeze({
        title: nome ? `Visita pública: "${nome}"` : TITULO_SEM_NOME,
        message: MENSAGEM,
        exitLabel: ROTULO_SAIDA,
        exitHint: DICA_SAIDA,
    });
}
