// Path: js/utilities/turf-loader.js

/**
 * @fileoverview Carregador sob demanda do global do Turf (`window.turf`).
 *
 * POR QUE ELE EXISTE. O Turf era uma tag `<script>` ansiosa em `index.html`. MEDIDO no pacote de
 * producao em 2026-08-25: a pagina do mapa baixava 3749 kB de script no boot (fora o `prefetch` do
 * Cesium), e o Turf era o maior item depois do MapLibre. O MapLibre nao sai, porque o mapa E a
 * pagina. O Turf sai, porque nada no boot le uma unica funcao dele quando o mapa esta vazio.
 *
 * O TURF E GLOBAL PURO NO PRODUTO: os 352 sitios de chamada em 48 arquivos escrevem `turf.x(...)`
 * ou `window.turf.x(...)` direto, e nao ha um unico ponto de entrada natural por onde esperar. E o
 * oposto do milsymbol, que tem `generateSymbol` como funil. (Esta linha dizia 257 sitios em 35
 * arquivos, de uma medicao anterior; remedido em 2026-09-14.)
 *
 * O TRANSPORTE MUDOU EM 2026-09-14, E O COMPORTAMENTO NAO. Ate ali este modulo injetava uma tag
 * `<script>` apontando `vendors/turf.min.js` (um UMD de 634 kB, resolvido por hash como a 7.0.0), e
 * a mecanica dessa injecao vivia em `utilities/vendor-loader.js`. Agora a biblioteca vem do npm
 * (`@turf/turf` 7.4.0), por um `import()` do ponto unico `js/vendor/turf.js`, que e quem publica o
 * global. A troca e de ONDE a biblioteca vem, nunca de QUANDO: quem espera continua sendo
 * `ensureTurf()`, e continua sendo o primeiro uso que paga.
 *
 * AS QUATRO DECISOES DO INJETOR DE TAG SOBREVIVEM, e tres delas o `import()` resolve de graca, o
 * que e a razao de este arquivo ter encolhido:
 *
 *   1. A PROMESSA E MEMOIZADA, e nao a tag. Dois chamadores concorrentes dividem UMA carga. O
 *      `import()` ja o faz pelo registro de modulos do proprio motor, e o memo local abaixo o faz
 *      tambem, porque ele guarda a promessa.
 *   2. `onload` NAO E PROVA de que o global existe. Deixou de haver `onload`: a promessa do
 *      `import()` so resolve depois de o modulo ter EXECUTADO, e executar e justamente escrever o
 *      global. Mesmo assim o predicado continua sendo reavaliado abaixo, e uma ausencia vira erro
 *      alto em vez de `undefined` entregue ao chamador.
 *   3. A FALHA LIMPA O MEMO. Esta continua sendo TRABALHO NOSSO e e a unica que o `import()` nao
 *      faz: sem a linha do `catch`, um blip de rede herdaria a promessa rejeitada para o resto da
 *      sessao e o Turf ficaria morto ate o F5.
 *   4. O `src` SAI DO `BASE_URL`. Deixou de existir como decisao: o bundler emite o chunk e a URL
 *      dele com a `base` do build ja aplicada, entao o deploy sob sub-caminho resolve sozinho. Era
 *      a divergencia mais dificil de ler num relato de defeito, e agora ela nao tem como nascer.
 *
 * `utilities/vendor-loader.js` continua de pe para o GDAL, que e o ultimo vendor de `public/` com
 * carga sob demanda por tag.
 *
 * @module utilities/turf-loader
 */

import { carregarSobDemanda } from './carga-sob-demanda.js';

/** Carga em voo (ou ja resolvida). Memoizada para os concorrentes dividirem uma so. */
let carregando = null;

/**
 * Garante que `window.turf` existe, baixando o pacote no primeiro uso.
 *
 * Barato de chamar em todo gesto: depois do primeiro resolve e uma leitura de
 * propriedade dentro de uma promessa ja resolvida.
 *
 * @returns {Promise<Object>} o global do Turf
 * @throws {Error} quando o pacote nao carrega, ou carrega sem definir `turf`
 */
export function ensureTurf() {
    if (typeof globalThis.turf !== 'undefined') return Promise.resolve(globalThis.turf);
    if (carregando) return carregando;

    // Pela porta de carga sob demanda: uma nova tentativa, e depois o aviso com "Recarregar".
    carregando = carregarSobDemanda(() => import('../vendor/turf.js'))
        .then(() => {
            // Ver a decisao 2 do `@fileoverview`: o modulo ter executado nao e, por si so, prova de
            // que o global esta la. Perguntar ao global custa uma leitura e mantem a falha alta.
            if (typeof globalThis.turf === 'undefined') {
                throw new Error('js/vendor/turf.js carregou sem definir "turf"');
            }
            return globalThis.turf;
        })
        .catch((err) => {
            // Ver a decisao 3: sem esta linha um blip de rede desliga o recurso pelo resto da sessao.
            carregando = null;
            throw err;
        });

    return carregando;
}

/**
 * Costura de teste: esquece a carga memoizada.
 * @returns {void}
 */
export function resetTurfLoader() {
    carregando = null;
}
