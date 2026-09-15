// Path: js/vendor/gdal.js

/**
 * @module vendor/gdal
 * @description Ponto único de carga do gdal3.js (2.8.1), vindo do npm.
 *
 * Até 2026-09-14 a biblioteca era `frontend/public/vendors/gdal/`, três arquivos copiados à mão
 * (o wrapper de 191 kB, o WebAssembly de 28,2 MB e o pacote de dados de 11,6 MB), servidos como
 * estáticos e alcançados por uma tag `<script>` injetada em runtime por `utilities/gdal-loader.js`.
 * Os três são byte a byte os de gdal3.js 2.8.1 no npm (conferido por `cmp` nos dois binários; o
 * wrapper difere em um byte, o fim de linha final que o checkout acrescenta), então a troca não é
 * de conteúdo, é de PROCEDÊNCIA: passa a haver versão declarada no `package.json` e no lockfile, e
 * portanto um canal a que perguntar por aviso de segurança. A decisão é a mesma que o MapLibre
 * recebeu em 2026-09-04 (`src/js/map/maplibre.js`) e o Three.js em 2026-09-14
 * (`src/js/vendor/three.js`), e aquele arquivo é o modelo deste.
 *
 * Cinco cuidados, cada um com a razão medida nesta árvore:
 *
 * 1. **O `import()` é o desenho, não uma preferência de estilo.** `map_sig.js` importa
 *    `import_export/pdf-export.tab.js` de forma ESTÁTICA, então um `import initGdalJs from
 *    'gdal3.js'` no topo deste arquivo devolveria os 193 kB ao payload de boot da página do mapa,
 *    desfazendo a onda de 2026-08-25 que tirou a `<script defer>` do `index.html`. O único ponto
 *    que carrega a biblioteca é a linha de `import()` aqui dentro, e quem cobra isso é
 *    `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`, que lista `gdal3.js` entre os
 *    pacotes que só podem entrar por dinâmico, nos dois sentidos (ausente do grafo ansioso E
 *    presente no completo, senão a afirmação passaria verde sobre um caminhador quebrado).
 *
 * 2. **Default, e não namespace, ao contrário do MapLibre e do Three.** O pacote publica um bundle
 *    UMD (`main: dist/package/gdal3.js`, sem campo `exports`), cujo corpo é
 *    `module.exports = initGdalJs`. Sob o interop de CJS do Vite isso chega como `default`, e é a
 *    única exportação que existe. O UMD também escreve `window.initGdalJs`, e o produto NÃO lê
 *    mais esse global: a diretiva de eslint que o declarava saiu de `pdf-export.tab.js` em
 *    2026-08-25.
 *
 * 3. **O `.wasm` e o `.data` viajam por `?url`, e é isso que substitui o caminho que o app
 *    calculava.** O Emscripten pede os dois irmãos por `Module.locateFile`, e o `initGdalJs`
 *    devolve `config.paths.wasm` / `config.paths.data` quando eles existem, sem prefixo nenhum
 *    (o prefixo só entra quando se passa `config.path`). Os dois `?url` daqui viram, no `dist/`,
 *    `/assets/gdal3WebAssembly-<hash>.wasm` e `/assets/gdal3WebAssembly-<hash>.data`, e o `base`
 *    do deploy já vem embutido neles. Isso APOSENTOU `PDFExportTab._getGdalPath`, que montava
 *    `window.location.origin + BASE_URL + 'vendors/gdal'` à mão; o caminho passou a ser
 *    responsabilidade do bundler, que é quem sabe onde pôs o arquivo.
 *
 *    Uma sutileza que só se vê lendo o `locateFile` do pacote: ele acrescenta uma barra inicial
 *    quando a saída não começa por `/` nem por `http`. As URLs do Vite já começam por `/`, então
 *    ele não toca nelas. O que os dois `?url` custam ao payload ANSIOSO são duas strings, 110
 *    bytes medidos dentro do chunk `import-export` que a página do mapa já baixava.
 *
 * 4. **NÃO HÁ WEB WORKER, e a premissa contrária é fácil de adotar** porque `useWorker` é `true`
 *    por padrão no gdal3.js e a documentação dele fala de worker o tempo todo. Este produto sempre
 *    passou `useWorker: false`, e o ramo de worker é o único lugar do pacote que usa
 *    `config.paths.js` e `new Worker(...)`. Sob bundler, um worker resolvido por nome de arquivo
 *    seria exatamente a armadilha do `setWorkerUrl` do MapLibre; aqui o ramo está desligado, então
 *    não há URL de worker a resolver. Ligá-lo de novo exigiria um `?worker&url` como o do MapLibre
 *    e uma releitura deste parágrafo.
 *
 * 5. **Nenhum cabeçalho novo no deploy: este WebAssembly não usa `SharedArrayBuffer`.** Medido no
 *    bundle publicado: zero ocorrências de `SharedArrayBuffer` e zero de `pthread`. Não é preciso
 *    COOP/COEP (as duas políticas de isolamento de origem cruzada), que é o custo que normalmente
 *    acompanha WebAssembly com threads e que teria de ser negociado com o servidor de produção. O
 *    `initGdalJs` ainda põe `GDAL_NUM_THREADS = '0'` no ambiente, de modo que o pedido de
 *    paralelismo também não existe do lado do GDAL.
 *
 * O MEMO É DA CARGA, e o que ele conserta é estreito. Ele existe para que dois chamadores
 * concorrentes (o aquecimento de `show()` e o clique em Exportar) dividam UMA carga, e para que a
 * falha do `import()` não fique herdada. O que ele NÃO conserta é a falha da inicialização:
 * `initGdalJs` memoiza a própria promessa em escopo de módulo e nunca a limpa, então um `.wasm`
 * que falhe uma vez falha pelo resto da sessão, e é o F5 que resolve. Dizer isto aqui é mais
 * barato que prometer uma nova tentativa que não acontece.
 */

import wasmUrl from 'gdal3.js/dist/package/gdal3WebAssembly.wasm?url';
import dataUrl from 'gdal3.js/dist/package/gdal3WebAssembly.data?url';

/** A carga em voo (ou já resolvida). Memoizada para os concorrentes dividirem uma só. */
let carregando = null;

/**
 * Carrega o gdal3.js sob demanda e devolve o namespace `Gdal` já inicializado.
 *
 * Seguro de chamar mais de uma vez: depois da primeira, é a mesma promessa.
 *
 * @returns {Promise<object>} o namespace do gdal3.js (`open`, `gdal_translate`, `getFileBytes`,
 *   `close`, ...)
 * @throws {Error} quando o chunk da biblioteca não carrega, ou o WebAssembly aborta na init
 */
export function initGdal() {
    if (carregando) return carregando;

    carregando = import('gdal3.js')
        .then(({ default: initGdalJs }) => initGdalJs({
            paths: { wasm: wasmUrl, data: dataUrl },
            useWorker: false,
        }))
        .catch((err) => {
            // Ver o último parágrafo do `@fileoverview`: isto devolve a chance de uma segunda
            // tentativa ao `import()`, e não à init do WebAssembly, que memoiza por conta própria.
            carregando = null;
            throw err;
        });

    return carregando;
}
