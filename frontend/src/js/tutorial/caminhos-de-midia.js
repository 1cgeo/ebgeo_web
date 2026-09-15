// Path: js/tutorial/caminhos-de-midia.js

/**
 * @module tutorial/caminhos-de-midia
 * @description Reescreve para o `basePath` os caminhos relativos do HTML CRU do tutorial.
 *
 * POR QUE ISTO EXISTE, e não é estilo: o docsify só reescreve caminho relativo para imagem
 * escrita em SINTAXE MARKDOWN, no `renderer.image` do compilador dele
 * (`node_modules/docsify/src/core/render/compiler/image.js`, que chama `getPath(contentBase, ...)`
 * quando o endereço não é absoluto). HTML cru passa inteiro por marked e chega ao DOM como está.
 * As 41 mídias de `frontend/public/docs/README.md` são TODAS HTML cru (`<img>` e `<video>` com
 * `src="./images/..."`, medido: zero imagens em sintaxe markdown), então nenhuma delas passa por
 * aquele ramo.
 *
 * Enquanto o tutorial era `public/docs/doc.html`, isso não custava nada: o documento morava em
 * `/docs/`, e `./images/x.png` resolvia contra a URL da própria página. A página passou a ser
 * `/tutorial.html`, na raiz, e a mesma string passa a resolver para `/images/x.png`, que é 404 nas
 * 41. O sintoma é a pior classe possível para uma página de tutorial: ela desenha, com barra
 * lateral e texto, e só as figuras somem.
 *
 * POR QUE UMA FUNÇÃO PURA, e não um ajuste no markdown: o `README.md` é conteúdo, lido também fora
 * do produto (no GitHub, num editor), onde `./images/` é o caminho certo e `/docs/images/` não é.
 * Reescrever as 41 linhas amarraria o conteúdo a uma raiz de implantação. Aqui a reescrita
 * acontece no gancho `beforeEach` do docsify, sobre o texto, e a decisão inteira cabe num módulo
 * de ZERO imports que roda em node, com os casos de borda presos por teste.
 *
 * O QUE ELA DELIBERADAMENTE NÃO FAZ: não olha para blocos de código. Um exemplo em ``` que
 * contivesse `src="./algo"` seria reescrito junto. O tutorial de hoje não tem nenhum (medido), e o
 * remédio, se um dia tiver, é ensinar a função a pular as cercas, não é abandoná-la.
 */

/** Esquemas e formas que já são absolutos, e para os quais reescrever seria quebrar. */
const RE_ABSOLUTO = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

/** `src` e `href` de HTML cru, nas duas formas de aspas. */
const RE_ATRIBUTO = /\b(src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;

/**
 * Prefixa com `base` todo `src`/`href` relativo do texto.
 *
 * @param {string} texto - O markdown como o servidor o entregou.
 * @param {string} base - O prefixo a aplicar, tipicamente o `basePath` do docsify (`/docs/`).
 *   Barra final é acrescentada se faltar; base vazia devolve o texto intacto.
 * @returns {string} O texto com os caminhos relativos reescritos.
 */
export function reescreverMidiaRelativa(texto, base) {
    if (typeof texto !== 'string' || texto === '') return '';
    if (typeof base !== 'string' || base === '') return texto;

    const prefixo = base.endsWith('/') ? base : `${base}/`;

    return texto.replace(RE_ATRIBUTO, (inteiro, atributo, _citado, comAspasDuplas, comAspasSimples) => {
        const aspas = comAspasDuplas === undefined ? "'" : '"';
        const valor = comAspasDuplas === undefined ? comAspasSimples : comAspasDuplas;
        if (valor === '' || RE_ABSOLUTO.test(valor)) return inteiro;
        // `./x` e `x` são o mesmo endereço; cortar o `./` evita um `/docs/./images` que funciona
        // no navegador e some do diagnóstico de quem lê o HTML gerado.
        const limpo = valor.startsWith('./') ? valor.slice(2) : valor;
        return `${atributo}=${aspas}${prefixo}${limpo}${aspas}`;
    });
}
