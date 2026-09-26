// Path: e2e-ui/helpers/valor-escolhido.js

/**
 * @fileoverview O que os specs de cobertura de desenho comparam entre o autor, o par e o servidor:
 * o VALOR QUE A PESSOA ESCOLHEU, nunca a escrituração nem o que o cliente deriva do zoom.
 *
 * Folha sem imports, para ser testada em node (`tests/unit/valor-escolhido.test.js`): o helper que a
 * reexporta (`cobertura-desenho.js`) importa o Playwright e não carrega fora dele.
 *
 * AS PROPRIEDADES DERIVADAS DO ZOOM FICAM DE FORA (decisão do dono de 2026-09-26, "só o spec
 * muda"). `calculatedSize`, `calculatedLineWidth`, os irmãos `calculated*` e `labelCalculatedSize`
 * são o tamanho que o estilo mostra no zoom corrente, e `selectionBox` é a caixa desenhada a partir
 * deles. O autor as recalcula DEPOIS de a op partir, e o servidor guarda a derivação que a op
 * levou: as duas diferem na quarta casa decimal. Compará-las media o relógio da máquina, não o
 * sync, e reprovava em 7 de 12 rodadas numa máquina carregada e em 0 de 39 numa quieta. O valor
 * escolhido (`size`, `lineWidth`, a alternância de correção de zoom) é o que viaja, e é ele que se
 * compara.
 */

/** Chaves de escrituração que cada cliente carimba por conta própria. */
export const ESCRITURACAO = Object.freeze(['confirmedVersion', 'version', 'createdAt', 'updatedAt', 'sync']);

/**
 * Se a chave é uma propriedade que o cliente deriva do zoom corrente.
 * @param {string} chave
 * @returns {boolean}
 */
export function derivadaDoZoom(chave) {
    return chave === 'selectionBox' || /^(label)?[cC]alculated[A-Z]/.test(chave);
}

/** As propriedades sem a escrituração, para comparar clientes e servidor. */
export function semEscrituracao(props) {
    const copia = { ...(props ?? {}) };
    for (const chave of ESCRITURACAO) delete copia[chave];
    return copia;
}

/** As propriedades sem a escrituração e sem o que se deriva do zoom: o que a pessoa escolheu. */
export function valorEscolhido(props) {
    const copia = semEscrituracao(props);
    for (const chave of Object.keys(copia)) if (derivadaDoZoom(chave)) delete copia[chave];
    return copia;
}

/** As chaves de valor escolhido cujo valor mudou entre dois retratos. */
export function chavesMudadas(antes, depois) {
    const a = valorEscolhido(antes);
    const d = valorEscolhido(depois);
    return [...new Set([...Object.keys(a), ...Object.keys(d)])]
        .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(d[k]))
        .sort();
}
