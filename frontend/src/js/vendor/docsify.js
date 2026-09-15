// Path: js/vendor/docsify.js

/**
 * @module vendor/docsify
 * @description Ponto único de carga do docsify (5.0.0), vindo do npm.
 *
 * Até 2026-09-15 o tutorial era `frontend/public/docs/doc.html`, uma página estática servida
 * verbatim pelo `publicDir` do Vite, que carregava `frontend/public/vendors/docsify.min.js` e
 * `frontend/public/vendors/vue.css` por tag. Aqueles dois arquivos eram a **4.13.1**, resolvida por
 * hash e confirmada em runtime por `Docsify.version`, e eram os últimos vendors com consumidor da
 * pasta. A página virou a QUINTA entrada do bundler (`frontend/tutorial.html`) e os dois arquivos
 * foram APAGADOS, não deixados ao lado. A forma deste arquivo é a de `src/js/map/maplibre.js` e a
 * de `src/js/vendor/turf.js`, que são os modelos.
 *
 * Cinco cuidados, cada um medido nesta árvore e não suposto:
 *
 * 1. **A 5.0.0 é major, e o pacote ainda PUBLICA a 4.** `lib/docsify.js` e `lib/docsify.min.js`
 *    continuam dentro do tarball (o `files` do `package.json` lista `lib` e `themes` ao lado de
 *    `dist` e `src`), e o que eles contêm é o build da v4 com um `console.warn` de depreciação
 *    anexado ao fim. Importar `docsify/lib/...` roda a v4 inteira e o único sinal é uma linha no
 *    console: é a armadilha desta migração, porque o caminho VELHO continua resolvendo. A v5 mora
 *    em `dist/` e em `src/`, e é de lá que este arquivo importa.
 *
 * 2. **Classe, não auto-boot, e a configuração vai pelo CONSTRUTOR.** O `exports["."]` do pacote
 *    aponta `src/core/Docsify.js`, que exporta a classe e não sobe nada; quem sobe sozinho é
 *    `docsify/src/core/index.js`, que chama `documentReady(() => new Docsify())` e lê a
 *    configuração de `window.$docsify`. O global continua sendo a porta documentada e ele
 *    continua funcionando (o `config` do pacote faz `Object.assign(padrões, window.$docsify, ...,
 *    conf)`), mas ele impõe uma ordem que um import estático não consegue expressar: a
 *    configuração precisa existir ANTES de o módulo do docsify ser avaliado, e imports são
 *    içados. O argumento do construtor tem PRIORIDADE sobre o global naquele `Object.assign`, é
 *    explícito e não depende de ordem nenhuma. Daí `montarDocsify`.
 *
 * 3. **`initGlobalAPI()` NÃO roda, e isso tem um beneficiário nomeado.** Ele é o corpo de
 *    `src/core/index.js` e só publica `window.Docsify`, `window.DocsifyCompiler`, `window.marked`
 *    e `window.Prism`, que são a interface dos PLUGINS: o de busca do próprio pacote lê
 *    `window.marked.lexer` e `window.Docsify.slugify`. O tutorial não carrega plugin nenhum, então
 *    nada aqui lê esses globais, e publicá-los seria superfície sem consumidor. Quem acrescentar
 *    um plugin acrescenta a chamada junto, e é por isso que esta nota existe.
 *
 * 4. **O tema virou CORE mais ADDON, e só o core entra.** Na 4 o tema era um arquivo solto
 *    (`themes/vue.css`); na 5 é `dist/themes/core.css` (54 kB, autossuficiente) mais um add-on de
 *    paleta em `dist/themes/addons/vue.css` (1,5 kB, quase só custom properties). O add-on NÃO é
 *    importado, e a razão é de rede e não de gosto: a primeira linha dele é
 *    `@import url('https://fonts.googleapis.com/...')`, um pedido a um host externo que a rede
 *    fechada de destino não alcança. O `@import` sobrevive ao build (o Vite não inlina URL
 *    absoluta), então importá-lo custaria um pedido que nunca resolve e uma fonte que sempre cai
 *    no fallback. A paleta da casa mora em `frontend/src/css/tutorial.css`, que é importado DEPOIS
 *    deste módulo pelo entry, e é essa ordem que faz as custom properties de lá vencerem.
 *
 * 5. **O CSS entra pelo grafo de módulos, não por `<link>` no HTML.** É o mesmo que
 *    `map/maplibre.js` faz com `maplibre-gl/dist/maplibre-gl.css`, e aqui ele compra uma
 *    propriedade a mais: a ordem entre a folha do pacote e a da casa passa a ser a ordem de
 *    avaliação dos módulos, que o entry declara e um teste pode ler, em vez de depender de onde o
 *    Vite injeta o `<link>` que ele mesmo gera.
 */

import { Docsify } from 'docsify';
import 'docsify/dist/themes/core.css';

/**
 * Sobe uma instância do docsify sobre o elemento que a configuração nomeia (`el`, padrão `#app`).
 *
 * @param {Object} configuracao - Configuração do docsify, passada direto ao construtor.
 * @returns {Object} A instância, para quem quiser assinar ganchos depois.
 */
export function montarDocsify(configuracao) {
    return new Docsify(configuracao);
}

export { Docsify };
