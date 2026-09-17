// Path: js/utilities/copiar-ao-clicar.js
/**
 * @fileoverview O GESTO DE COPIAR UM VALOR CLICANDO NELE, num lugar só.
 *
 * POR QUE ELE EXISTE. A seção "Localização" do painel de feição (2D) e o painel do ponto 3D já
 * traziam este gesto, cada um com a sua CÓPIA das mesmas duas funções, idênticas linha a linha:
 * a escrita na área de transferência com a queda para `execCommand`, e o "Copiado!" por um segundo
 * e meio. O painel do ponto 360 seria a terceira cópia, e três cópias do mesmo gesto divergem no
 * dia em que uma delas mudar, que é o mecanismo que o repositório já pagou para aprender.
 *
 * O QUE ELE ACRESCENTA ÀS CÓPIAS QUE SUBSTITUI, e não é enfeite:
 *
 *  - O TECLADO. As duas cópias ouviam só o clique, então o valor era inalcançável para quem navega
 *    por tabulação. Aqui o elemento vira um `button` de verdade aos olhos do leitor de tela, com
 *    `tabindex`, e Enter e Espaço fazem o mesmo que o clique.
 *
 *  - O CLIQUE DUPLO NÃO CONGELA A LINHA. As cópias guardavam `element.textContent` no início do
 *    feedback e o devolviam 1500 ms depois. Clicando duas vezes dentro dessa janela, a segunda
 *    guardava a palavra "Copiado!" como se fosse o valor, e a linha ficava com ela PARA SEMPRE.
 *    Aqui o valor original é guardado no elemento enquanto o feedback dura, e o segundo clique só
 *    reinicia o relógio.
 *
 *  - O QUE SE COPIA E O QUE SE MOSTRA PODEM DIFERIR. A linha do 360 mostra "Foto: -30.03..., ..."
 *    e o que serve para colar é só a coordenada, sem o rótulo.
 *
 * SOBRE A ÁREA DE TRANSFERÊNCIA. `navigator.clipboard` só existe em contexto seguro (HTTPS ou
 * localhost): servido por `http://<ip>` na rede do quartel, ele não está lá, e é por isso que a
 * queda para o `textarea` mais `execCommand` fica, mesmo sendo API obsoleta. As duas podem falhar,
 * e a função DIZ qual foi o desfecho em vez de fingir que copiou.
 */

/** Quanto tempo a palavra "Copiado!" fica no lugar do valor. */
const FEEDBACK_MS = 1500;

/** Onde o valor original espera enquanto o feedback está na tela. */
const ORIGINAL = Symbol('texto-original');

/** O relógio em curso, para o segundo clique reiniciá-lo em vez de abrir outro. */
const RELOGIO = Symbol('relogio-do-feedback');

/**
 * Escreve o texto na área de transferência, com a queda para navegadores e contextos sem a API.
 *
 * @param {string} texto - O que vai para a área de transferência.
 * @returns {Promise<boolean>} `true` se alguma das duas vias aceitou; `false` se as duas falharam.
 */
export async function copiarTexto(texto) {
    if (typeof texto !== 'string' || texto === '') return false;

    try {
        if (globalThis.navigator?.clipboard?.writeText) {
            await globalThis.navigator.clipboard.writeText(texto);
            return true;
        }
    } catch {
        // Contexto inseguro, permissão negada ou aba sem foco: sobra a via antiga.
    }

    try {
        const caixa = document.createElement('textarea');
        caixa.value = texto;
        // Fora da vista e sem rolar a página: `position: fixed` mais a saída pela esquerda.
        caixa.style.position = 'fixed';
        caixa.style.left = '-9999px';
        caixa.setAttribute('readonly', 'readonly');
        document.body.appendChild(caixa);
        caixa.select();
        const aceitou = document.execCommand('copy');
        document.body.removeChild(caixa);
        return Boolean(aceitou);
    } catch {
        return false;
    }
}

/**
 * Troca o texto do elemento por "Copiado!" e devolve o original depois.
 *
 * @param {HTMLElement} elemento - O nó que mostra o valor.
 * @param {string} [palavra='Copiado!'] - O que aparece no lugar.
 * @returns {void}
 */
export function mostrarCopiado(elemento, palavra = 'Copiado!') {
    if (!elemento) return;

    // O ORIGINAL SÓ SE GUARDA UMA VEZ: sem isto, o segundo clique dentro da janela guardaria a
    // própria palavra de feedback, e ela ficaria na linha para sempre.
    if (elemento[ORIGINAL] === undefined) elemento[ORIGINAL] = elemento.textContent;
    if (elemento[RELOGIO]) clearTimeout(elemento[RELOGIO]);

    elemento.textContent = palavra;
    elemento.classList.add('copied');

    elemento[RELOGIO] = setTimeout(() => {
        elemento.textContent = elemento[ORIGINAL];
        elemento.classList.remove('copied');
        elemento[ORIGINAL] = undefined;
        elemento[RELOGIO] = null;
    }, FEEDBACK_MS);
}

/**
 * Faz um elemento copiar um valor quando a pessoa o aciona, pelo ponteiro ou pelo teclado.
 *
 * @param {HTMLElement} elemento - O nó que mostra o valor.
 * @param {string|(() => string)} valor - O que copiar. Função quando o valor muda com o tempo.
 * @param {Object} [opcoes]
 * @param {string} [opcoes.titulo='Clique para copiar'] - O `title` e o rótulo acessível.
 * @param {(ok: boolean) => void} [opcoes.aoCopiar] - Chamado com o desfecho, para quem quiser avisar.
 * @returns {() => void} Desfaz a fiação (o painel que se reconstrói não precisa, mas o que vive sim).
 */
export function copiarAoClicar(elemento, valor, opcoes = {}) {
    if (!elemento) return () => {};
    const { titulo = 'Clique para copiar', aoCopiar } = opcoes;

    elemento.classList.add('feature-location-text--clickable');
    elemento.title = titulo;
    // Ele PASSA a ser um comando, e quem usa leitor de tela precisa ouvir isso: sem `role` e
    // `tabindex` o valor fica inalcançável por tabulação, que era o caso das duas cópias antigas.
    elemento.setAttribute('role', 'button');
    elemento.setAttribute('tabindex', '0');
    elemento.setAttribute('aria-label', `${titulo}: ${typeof valor === 'function' ? valor() : valor}`);

    const acionar = async () => {
        const texto = typeof valor === 'function' ? valor() : valor;
        const ok = await copiarTexto(texto);
        if (ok) mostrarCopiado(elemento);
        aoCopiar?.(ok);
    };

    const noClique = () => { acionar(); };
    const naTecla = (evento) => {
        // Só as duas teclas de ativação, e a barra de espaço não pode rolar a página.
        if (evento.key !== 'Enter' && evento.key !== ' ') return;
        evento.preventDefault();
        acionar();
    };

    elemento.addEventListener('click', noClique);
    elemento.addEventListener('keydown', naTecla);

    return () => {
        elemento.removeEventListener('click', noClique);
        elemento.removeEventListener('keydown', naTecla);
        if (elemento[RELOGIO]) clearTimeout(elemento[RELOGIO]);
    };
}
