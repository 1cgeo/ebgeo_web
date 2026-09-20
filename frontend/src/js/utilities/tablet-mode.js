// Path: js/utilities/tablet-mode.js

/**
 * @fileoverview A FAIXA DO TABLET, que até 2026-09-20 não existia.
 *
 * O produto tinha DUAS interfaces e um corte só: telefone abaixo de 480px de largura (ou de
 * 440px de altura com ponteiro grosso, que é o celular deitado), e mesa em todo o resto. Um
 * iPad tem 768, 820 ou 1024 pontos nos dois sentidos, então NENHUM tablet, em NENHUMA
 * orientação, entrava na interface de telefone: todos recebiam a de mesa, que pressupõe
 * mouse, hover e clique direito, operada por um dedo de nove milímetros.
 *
 * A FAIXA É O COMPLEMENTO, e é assim que ela se mantém coerente: tablet é ponteiro GROSSO que
 * NÃO é telefone. Escrever uma largura própria aqui criaria um terceiro número para alguém
 * esquecer de mexer; derivando do corte de telefone, mover aquele corte move este junto.
 *
 * ELE MORA AQUI E NÃO EM `phone-layout.js` porque este arquivo é FOLHA, de zero imports: a
 * calibração, o painel de administração e qualquer página sem mapa podem perguntar pela faixa
 * sem arrastar a store, que é o que o barril de utilidades faria. `phone-layout.js` passou a
 * importar o corte daqui, para o número viver num lugar só.
 *
 * O QUE ELE NÃO FAZ: decidir aparência. Quem pinta alvo maior é o CSS, pelo `@media (pointer:
 * coarse)` que dez folhas já usam e que alcança telefone E tablet de uma vez. Este módulo
 * serve a quem precisa do LEIAUTE (o painel que empurra o mapa) ou de um caminho de código
 * diferente (o manche de toque da primeira pessoa), e não a quem só precisa de um botão maior.
 */

/**
 * O corte de TELEFONE. Fonte única: `phone-layout.js` o importa daqui.
 *
 * A segunda metade (`max-height: 440px` com ponteiro grosso) existe para o celular DEITADO,
 * que é largo e baixo; sem ela, virar o aparelho tirava a pessoa da interface de telefone.
 * @type {string}
 */
export const PHONE_QUERY = '(max-width: 480px), (max-height: 440px) and (pointer: coarse)';

/**
 * A faixa do TABLET: ponteiro grosso, e fora do corte de telefone nos dois eixos.
 *
 * Os `min-` são 481 e 441 de propósito, um a mais que os `max-` de cima: consulta de mídia
 * compara em pixels inteiros de CSS, então 480 e 481 não se sobrepõem nem deixam buraco.
 * @type {string}
 */
export const TABLET_QUERY = '(pointer: coarse) and (min-width: 481px) and (min-height: 441px)';

/**
 * PONTEIRO GROSSO, sem corte de tamanho: telefone e tablet de uma vez.
 *
 * Ele existe ao lado dos dois de cima porque nem toda decisão de código é de LEIAUTE. O arranjo
 * dos botões dentro do balão de um grupo da barra depende do DEDO e não da moldura: num telefone
 * e num tablet vale a mesma lista com rótulo, e é esta a consulta que espelha o `@media (pointer:
 * coarse)` que o CSS da barra já usa.
 * @type {string}
 */
export const COARSE_QUERY = '(pointer: coarse)';

/**
 * @param {string} consulta
 * @returns {boolean} Falso quando o navegador não tem `matchMedia` (jsdom, node).
 */
function casa(consulta) {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia(consulta).matches;
}

/**
 * O ponteiro primário é grosso, isto é, um dedo?
 * @returns {boolean}
 */
export function isCoarsePointer() {
    return casa(COARSE_QUERY);
}

/**
 * A pessoa está num telefone?
 * @returns {boolean}
 */
export function isPhoneLayout() {
    return casa(PHONE_QUERY);
}

/**
 * A pessoa está num tablet, isto é, num aparelho de toque que não é telefone?
 * @returns {boolean}
 */
export function isTabletLayout() {
    return casa(TABLET_QUERY);
}

/**
 * Observa a entrada e a saída da faixa, e devolve o cancelamento.
 *
 * A TROCA ACONTECE AO GIRAR O APARELHO, e não só ao abrir a página: um tablet de 1280 por 800
 * deitado continua na faixa ao virar para 800 por 1280, mas um de 481 por 800 sai dela em
 * retrato. Quem depender da faixa para leiaute precisa saber disso sem recarregar.
 * @param {(dentro: boolean) => void} aoMudar
 * @returns {() => void}
 */
export function watchTabletLayout(aoMudar) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
    }
    const mq = window.matchMedia(TABLET_QUERY);
    const ouvinte = (e) => aoMudar(e.matches);
    mq.addEventListener('change', ouvinte);
    return () => mq.removeEventListener('change', ouvinte);
}
