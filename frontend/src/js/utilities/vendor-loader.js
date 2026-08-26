// Path: js/utilities/vendor-loader.js

/**
 * @fileoverview O INJETOR DE TAG que os carregadores sob demanda compartilham.
 *
 * POR QUE ELE EXISTE. Esta e a TERCEIRA onda de "tirar um vendor pesado do
 * `index.html`", e as duas primeiras deixaram duas copias literais do mesmo
 * corpo: `military_tools/military_symbol_tool/milsymbol-loader.js` (855 kB de
 * milsymbol) e `utilities/gdal-loader.js` (187 kB de gdal3.js). O corpo tem
 * quatro decisoes finas, e cada copia teria de repeti-las certas. A terceira
 * copia seria o momento de parar, e e este arquivo.
 *
 * AS QUATRO DECISOES, todas medidas antes de virarem codigo:
 *
 *   1. A PROMESSA E MEMOIZADA, e nao o `<script>`. O `loadScript` de
 *      `3d_models_viewer_tool/map_3d.js` resolve assim que existe uma tag com
 *      aquele `src` no DOM, o que e verdade desde o `appendChild` e muito antes
 *      de o arquivo ter EXECUTADO. Dois chamadores concorrentes recebem la uma
 *      promessa resolvida com o global ainda indefinido. Aqui todos esperam a
 *      MESMA carga.
 *   2. `onload` NAO E PROVA. Ele diz que o arquivo rodou, nunca que ele definiu
 *      o que se pediu: um caminho errado servido como HTML pelo servidor de
 *      desenvolvimento dispara `onload` normalmente. Por isso o predicado
 *      `pronto` e reavaliado DEPOIS do `onload`, e um global ausente vira erro
 *      alto em vez de `undefined` entregue ao chamador.
 *   3. A FALHA LIMPA O MEMO. Sem isso um blip de rede herdaria a promessa
 *      rejeitada para o resto da sessao, e o recurso ficaria morto ate o F5.
 *   4. O `src` SAI DO `BASE_URL`. Um `/vendors/...` cravado carrega na raiz e da
 *      404 num deploy sob sub-caminho, enquanto os arquivos irmaos (`.wasm`,
 *      `.data`) continuam resolvendo pelo `BASE_URL` que o chamador passa. E a
 *      divergencia mais dificil de ler num relato de defeito.
 *
 * O QUE ELE DE PROPOSITO NAO FAZ: conhecer nenhum vendor. Ele recebe um caminho
 * relativo ao `BASE_URL` e um predicado de prontidao, e devolve a funcao
 * `ensureX` do chamador. O acoplamento fica em UMA direcao, e cada carregador
 * continua sendo o dono do `@fileoverview` que explica POR QUE aquele vendor
 * saiu do boot, que e a informacao que nao se compartilha.
 *
 * @module utilities/vendor-loader
 */

/**
 * Monta um carregador sob demanda memoizado para um vendor global.
 *
 * @template T
 * @param {Object} opcoes
 * @param {string} opcoes.caminho - Caminho do arquivo relativo ao `BASE_URL` do deploy,
 *   sem barra inicial (ex.: `vendors/turf.min.js`).
 * @param {() => (T|undefined|null)} opcoes.pronto - Devolve o global quando ele ja existe,
 *   e algo falsy quando nao. E reavaliado depois do `onload`.
 * @param {string} opcoes.nome - O nome do global, so para a mensagem de erro.
 * @returns {{ensure: () => Promise<T>, reset: () => void}}
 */
export function criarCarregadorDeVendor({ caminho, pronto, nome }) {
    /** Carga em voo (ou ja resolvida). Memoizada para os concorrentes dividirem uma so. */
    let carregando = null;

    function origem() {
        const base = import.meta.env?.BASE_URL || '/';
        return `${base}${caminho}`;
    }

    function ensure() {
        const jaTem = pronto();
        if (jaTem) return Promise.resolve(jaTem);
        if (carregando) return carregando;

        const src = origem();
        carregando = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => {
                // Ver a decisao 2 do `@fileoverview`: `onload` diz que o arquivo
                // rodou, e nao que ele definiu o que se pediu.
                const global = pronto();
                if (!global) {
                    reject(new Error(`${src} carregou sem definir "${nome}"`));
                    return;
                }
                resolve(global);
            };
            script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
            document.head.appendChild(script);
        }).catch((err) => {
            // Ver a decisao 3: sem esta linha um blip de rede desliga o recurso
            // pelo resto da sessao.
            carregando = null;
            throw err;
        });

        return carregando;
    }

    return {
        ensure,
        /** Costura de teste: esquece a carga memoizada. */
        reset: () => { carregando = null; },
    };
}
